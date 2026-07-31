// Internal calendar UI (FRD FR-CAL). Month grid aggregating local entries, Event &
// Camp Hub records and QM booking resource blocks. No native dialogs - inline modals.
let ME = null, CAN_MANAGE = false, META = {};
const view = { y: 0, m: 0, mode: 'month', filter: 'all' }; // m is 0-indexed month

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  const now = new Date();
  view.y = now.getFullYear(); view.m = now.getMonth();
  // Phones default to the agenda (the month grid is cramped); desktop to the grid.
  view.mode = window.innerWidth < 700 ? 'agenda' : 'month';
  // Deep link to a specific entry opens its detail after the month renders.
  await render();
  const entryId = new URLSearchParams(location.search).get('entry');
  if (entryId) openEntryFromServer(entryId);
})();

// ── Date helpers (work off the date portion to avoid timezone drift) ────────────
function dkey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDay(s) { if (!s) return null; const p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function gridStartFor(y, m) {
  const first = new Date(y, m, 1);
  const dow = (first.getDay() + 6) % 7; // 0 = Monday
  return addDays(first, -dow);
}

const MAX_LANES = 3;

async function render() {
  const box = document.getElementById('content');
  const gridStart = gridStartFor(view.y, view.m);
  const gridEnd = addDays(gridStart, 41);
  let data;
  try { data = await Api.get(`/api/calendar?from=${dkey(gridStart)}&to=${dkey(gridEnd)}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  CAN_MANAGE = data.canManage; META = data.meta; window.__items = data.items;

  // Head actions
  const head = document.getElementById('cal-head-actions');
  head.innerHTML = CAN_MANAGE ? `<button class="btn" id="cal-new">New entry</button>` : '';
  if (CAN_MANAGE) document.getElementById('cal-new').addEventListener('click', () => openEntryForm(null, dkey(new Date(view.y, view.m, 1))));

  const toolbar = `
    <div class="cal-toolbar">
      <button class="cal-nav-btn" id="cal-prev" aria-label="Previous month">&lsaquo;</button>
      <button class="cal-nav-btn" id="cal-next" aria-label="Next month">&rsaquo;</button>
      <button class="btn btn-secondary btn-sm" id="cal-today">Today</button>
      <span class="cal-title">${MONTHS[view.m]} ${view.y}</span>
      <span class="cal-viewtoggle">
        <button class="cal-vt${view.mode === 'month' ? ' active' : ''}" data-mode="month">Month</button>
        <button class="cal-vt${view.mode === 'agenda' ? ' active' : ''}" data-mode="agenda">Agenda</button>
      </span>
    </div>`;
  const legend = `
    <div class="cal-legend">
      <span><span class="cal-dot" style="background:var(--purple)"></span> Planning entry</span>
      ${META.eventHubEnabled ? '<span><span class="cal-dot" style="background:var(--green)"></span> Event / camp</span>' : ''}
      ${META.qmBookingEnabled && !isParent() ? '<span><span class="cal-dot" style="background:#d99a00"></span> QM booking</span>' : ''}
      <span><span class="cal-dot" style="box-shadow:inset 0 0 0 2px #c62828;background:transparent"></span> Overdue / provisional</span>
    </div>`;

  const body = view.mode === 'agenda' ? buildAgenda(data.items) : buildMonthGrid(data.items, gridStart, gridEnd);

  box.innerHTML = `
    <div class="card">${toolbar}${legend}${body}</div>
    ${view.mode === 'month' ? renderAgenda(data.items) : ''}`;

  document.getElementById('cal-prev').addEventListener('click', () => shiftMonth(-1));
  document.getElementById('cal-next').addEventListener('click', () => shiftMonth(1));
  document.getElementById('cal-today').addEventListener('click', () => { const n = new Date(); view.y = n.getFullYear(); view.m = n.getMonth(); render(); });
  document.querySelectorAll('.cal-vt').forEach(b => b.addEventListener('click', () => { view.mode = b.dataset.mode; render(); }));

  if (view.mode === 'agenda') {
    document.querySelectorAll('.cal-filter').forEach(b => b.addEventListener('click', () => { view.filter = b.dataset.filter; render(); }));
    document.querySelectorAll('.cal-agenda-row').forEach(r => r.addEventListener('click', () => openItemDetail(findItem(r.dataset.src, r.dataset.id))));
  } else {
    document.querySelectorAll('.cal-seg').forEach(s => s.addEventListener('click', ev => { ev.stopPropagation(); openItemDetail(findItem(s.dataset.src2, s.dataset.id)); }));
    document.querySelectorAll('.cal-more').forEach(m => m.addEventListener('click', ev => { ev.stopPropagation(); openDayList(m.dataset.day); }));
    if (CAN_MANAGE) document.querySelectorAll('.cal-cell.clickable-day').forEach(cell => cell.addEventListener('click', () => openEntryForm(null, cell.dataset.day)));
    document.querySelectorAll('.agenda-row').forEach(r => r.addEventListener('click', () => openItemDetail(findItem(r.dataset.src, r.dataset.id))));
  }
}

// The month grid body (unchanged layout, extracted so render() can pick month vs agenda).
function buildMonthGrid(items, gridStart, gridEnd) {
  const layout = layoutEvents(items, gridStart, gridEnd);
  const todayKey = dkey(new Date());
  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const key = dkey(d);
    const inMonth = d.getMonth() === view.m;
    const isMonday = i % 7 === 0;
    const perLane = layout.cell[key] || {};
    let lanes = '';
    for (let lane = 0; lane < MAX_LANES; lane++) {
      const ev = perLane[lane];
      if (!ev) { lanes += `<div class="cal-seg-empty"></div>`; continue; }
      const it = ev.it;
      const isStart = dkey(ev.s) === key;
      const isEnd = dkey(ev.e) === key;
      const showTitle = isStart || isMonday;
      const cls = `cal-seg${isStart ? ' is-start' : ''}${isEnd ? ' is-end' : ''}`;
      const flag = (it.overdue || it.provisional) ? ' data-flag="1"' : '';
      const label = showTitle ? `${it.allDay ? '' : '<span class="cal-seg-dot"></span>'}${escapeHtml(it.title)}` : '';
      lanes += `<div class="${cls}" data-src="${it.source}" data-status="${escapeHtml(it.status || '')}"${flag} data-id="${it.id}" data-src2="${it.source}" title="${escapeHtml(it.title)}">${label}</div>`;
    }
    const hidden = (layout.perDayCount[key] || 0) - Object.keys(perLane).filter(l => +l < MAX_LANES).length;
    const more = hidden > 0 ? `<div class="cal-more" data-day="${key}">+${hidden} more</div>` : '';
    cells += `<div class="cal-cell${inMonth ? '' : ' other-month'}${key === todayKey ? ' today' : ''}${CAN_MANAGE ? ' clickable-day' : ''}" data-day="${key}">
      <div class="cal-cell-head"><span class="cal-daynum">${d.getDate()}</span></div>
      <div class="cal-lanes">${lanes}</div>${more}</div>`;
  }
  return `<div class="cal-scroll"><div class="cal-grid">${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}${cells}</div></div>`;
}

// The agenda body: this month's items grouped by day, filterable by source.
function buildAgenda(items) {
  const monthStart = new Date(view.y, view.m, 1);
  const monthEnd = new Date(view.y, view.m + 1, 0);
  const chips = ['all', 'entry', META.eventHubEnabled ? 'event' : null, (META.qmBookingEnabled && !isParent()) ? 'qm' : null].filter(Boolean);
  const chipLabel = { all: 'All', entry: 'Planning', event: 'Events', qm: 'Bookings' };
  const filtersHtml = `<div class="cal-filters">${chips.map(f => `<button class="cal-filter${view.filter === f ? ' active' : ''}" data-filter="${f}">${chipLabel[f]}</button>`).join('')}</div>`;

  const shown = items.filter(it => {
    if (view.filter !== 'all' && it.source !== view.filter) return false;
    const s = parseDay(it.start) || monthStart, e = parseDay(it.end) || s;
    return e >= monthStart && s <= monthEnd; // intersects the visible month
  });
  const byDay = {};
  for (const it of shown) {
    let s = parseDay(it.start) || monthStart;
    if (s < monthStart) s = new Date(monthStart); // a run that began earlier lists on the 1st
    (byDay[dkey(s)] ||= []).push(it);
  }
  const dayKeys = Object.keys(byDay).sort();
  if (!dayKeys.length) return filtersHtml + '<p class="muted" style="margin-top:1rem">Nothing scheduled this month.</p>';

  const todayKey = dkey(new Date());
  const list = dayKeys.map(k => {
    const label = parseDay(k).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const rows = byDay[k].sort((a, b) => String(a.start).localeCompare(String(b.start))).map(it => `
      <button class="cal-agenda-row" data-src="${it.source}" data-id="${it.id}">
        <span class="cal-agenda-bar" style="background:${srcColor(it)}"></span>
        <span class="cal-agenda-main">
          <span class="cal-agenda-title">${escapeHtml(it.title)}${it.overdue ? ' <span class="badge" data-status="deleted">Overdue</span>' : (it.provisional ? ' <span class="badge" data-status="suspended">Provisional</span>' : '')}</span>
          <span class="cal-agenda-meta muted">${escapeHtml(fmtRange(it))}${it.typeLabel ? ' &middot; ' + escapeHtml(it.typeLabel) : ''}${it.sectionName ? ' &middot; ' + escapeHtml(it.sectionName) : ''}</span>
        </span>
      </button>`).join('');
    return `<div class="cal-agenda-day${k === todayKey ? ' today' : ''}"><div class="cal-agenda-date">${label}${k === todayKey ? ' &middot; Today' : ''}</div>${rows}</div>`;
  }).join('');
  return filtersHtml + `<div class="cal-agenda">${list}</div>`;
}

// Greedy lane assignment: sort multi-day/earlier/longer first, then give each event
// the lowest lane free on every day it spans, so its bar is a continuous row.
function layoutEvents(items, gridStart, gridEnd) {
  const evs = items.map((it, idx) => {
    let s = parseDay(it.start) || new Date(gridStart);
    let e = parseDay(it.end) || new Date(s);
    if (s < gridStart) s = new Date(gridStart);
    if (e > gridEnd) e = new Date(gridEnd);
    return { key: `${it.source}:${it.id}:${idx}`, it, s, e, span: daysBetween(s, e) + 1 };
  }).filter(x => x.e >= gridStart && x.s <= gridEnd);
  evs.sort((a, b) => (b.span > 1) - (a.span > 1) || a.s - b.s || b.span - a.span);

  const laneDays = {};   // lane -> Set(dayKey)
  const cell = {};       // dayKey -> { lane -> ev }
  const perDayCount = {};
  for (const ev of evs) {
    let lane = 0;
    for (; ; lane++) {
      laneDays[lane] ||= new Set();
      let free = true;
      for (let d = new Date(ev.s); d <= ev.e; d = addDays(d, 1)) { if (laneDays[lane].has(dkey(d))) { free = false; break; } }
      if (free) break;
    }
    for (let d = new Date(ev.s); d <= ev.e; d = addDays(d, 1)) {
      const k = dkey(d);
      laneDays[lane].add(k);
      (cell[k] ||= {})[lane] = ev;
      perDayCount[k] = (perDayCount[k] || 0) + 1;
    }
  }
  return { cell, perDayCount };
}
function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

// "+N more" opens a simple list of everything on that day.
function openDayList(key) {
  const items = (window.__items || []).filter(it => {
    const s = parseDay(it.start), e = parseDay(it.end) || s; const d = parseDay(key);
    return s && d >= s && d <= e;
  });
  const rows = items.map(it => `<button class="cal-daylist-row" data-src="${it.source}" data-id="${it.id}" style="display:flex;gap:.5rem;align-items:center;width:100%;text-align:left;border:none;background:none;padding:.4rem .2rem;border-bottom:1px solid var(--border);cursor:pointer">
      <span class="cal-dot" style="background:${srcColor(it)}"></span>
      <span style="flex:1">${escapeHtml(it.title)}</span>
      <span class="muted" style="font-size:.75rem">${escapeHtml(it.typeLabel || '')}</span>
    </button>`).join('');
  openModal(formatDate(key), rows || '<p class="muted">Nothing on this day.</p>');
  document.querySelectorAll('.cal-daylist-row').forEach(r => r.addEventListener('click', () => { closeModal(); openItemDetail(findItem(r.dataset.src, r.dataset.id)); }));
}

function isParent() { return ME && ME.role === 'parent'; }
function shiftMonth(n) { view.m += n; if (view.m < 0) { view.m = 11; view.y--; } else if (view.m > 11) { view.m = 0; view.y++; } render(); }
function findItem(src, id) { return (window.__items || []).find(it => it.source === src && String(it.id) === String(id)); }

function renderAgenda(items) {
  const future = items.filter(it => (parseDay(it.end) || parseDay(it.start)) >= new Date(new Date().toDateString()));
  if (!future.length) return '';
  const rows = future.slice(0, 12).map(it => `
    <tr class="agenda-row clickable" data-src="${it.source}" data-id="${it.id}">
      <td class="muted" style="white-space:nowrap">${fmtRange(it)}</td>
      <td><span class="cal-dot" style="background:${srcColor(it)}"></span> ${escapeHtml(it.title)}${it.overdue ? ' <span class="badge" data-status="deleted">Overdue</span>' : (it.provisional ? ' <span class="badge" data-status="suspended">Provisional</span>' : '')}</td>
      <td class="muted">${escapeHtml(it.typeLabel || '')}</td>
    </tr>`).join('');
  return `<div class="card"><h2>Upcoming</h2><div style="overflow-x:auto"><table class="data-table">
    <thead><tr><th>When</th><th>What</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}
function srcColor(it) { return it.source === 'entry' ? 'var(--purple)' : (it.source === 'event' ? 'var(--green)' : 'var(--yellow)'); }
function fmtRange(it) {
  const s = formatDate(it.start); const e = it.end ? formatDate(it.end) : '';
  const base = (e && e !== s) ? `${s} – ${e}` : s;
  return it.allDay ? base : `${base}${it.start && it.start.length > 10 ? ' ' + it.start.slice(11, 16) : ''}`;
}

// ── Item detail ─────────────────────────────────────────────────────────────────
function openItemDetail(it) {
  if (!it) return;
  if (it.source === 'event') { location.href = it.link; return; }
  if (it.source === 'qm') { location.href = it.link; return; }
  // Local entry
  const rows = [
    ['When', fmtRange(it)],
    ['Type', it.typeLabel || ''],
    ['Scope', it.scope === 'section' ? ('Section' + (it.sectionName ? ' · ' + it.sectionName : '')) : 'Group'],
    it.location ? ['Location', it.location] : null,
    it.description ? ['Notes', it.description] : null,
    ['Visibility', it.parentSafe ? 'Published to parents' : 'Leaders only'],
  ].filter(Boolean);
  let actions = '';
  if (it.canManage) {
    actions = `<div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap">
      <button class="btn btn-sm" id="ci-edit">Edit</button>
      ${it.parentSafe ? '<button class="btn btn-secondary btn-sm" id="ci-unpub">Unpublish</button>' : '<button class="btn btn-secondary btn-sm" id="ci-pub">Publish to parents</button>'}
      ${(META.eventHubEnabled && !it.convertedEventHubId) ? '<button class="btn btn-secondary btn-sm" id="ci-convert">Convert to event</button>' : ''}
      ${it.convertedEventHubId ? `<a class="btn btn-secondary btn-sm" href="event-hub.html?id=${it.convertedEventHubId}">Open linked event</a>` : ''}
      <button class="btn btn-secondary btn-sm" id="ci-cancel">Cancel</button>
      <button class="btn btn-secondary btn-sm" id="ci-del" style="margin-left:auto">Delete</button>
    </div>`;
  }
  openModal(it.title, `<table class="kv-table" style="margin-bottom:.4rem">${rows.map(r => `<tr><td class="muted">${escapeHtml(r[0])}</td><td>${escapeHtml(r[1])}</td></tr>`).join('')}</table>${actions}
    ${!actions ? '<div class="modal-actions" style="margin-top:1rem"><button class="btn btn-secondary" id="ci-close">Close</button></div>' : ''}`);
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('ci-close', closeModal);
  on('ci-edit', async () => { closeModal(); const e = (await Api.get(`/api/calendar/entries/${it.id}`)).entry; openEntryForm(e); });
  on('ci-pub', () => publishEntry(it.id));
  on('ci-unpub', async () => { await Api.post(`/api/calendar/entries/${it.id}/unpublish`, {}); closeModal(); render(); });
  on('ci-convert', () => convertEntry(it.id));
  on('ci-cancel', () => confirmModal('Cancel this entry?', 'It will be removed from the calendar.', async () => { await Api.post(`/api/calendar/entries/${it.id}/cancel`, {}); render(); }));
  on('ci-del', () => confirmModal('Delete this entry?', 'This cannot be undone.', async () => { await Api.delete(`/api/calendar/entries/${it.id}`); render(); }));
}

async function openEntryFromServer(id) {
  try { const e = (await Api.get(`/api/calendar/entries/${id}`)).entry;
    // Reuse the item-detail modal by shaping the entry like a feed item.
    openItemDetail({ source: 'entry', id: e.id, title: e.title, typeLabel: e.entryTypeLabel, scope: e.scope, sectionName: e.sectionName, start: e.startAt, end: e.endAt, allDay: e.allDay, location: e.location, description: e.notes, parentSafe: e.status === 'published' && e.visibility === 'parents', convertedEventHubId: e.convertedEventHubId, canManage: CAN_MANAGE });
  } catch (e) { /* not found / not permitted - ignore deep link */ }
}

// ── Create / edit entry ─────────────────────────────────────────────────────────
function openEntryForm(entry, defaultDate) {
  const e = entry || { entryType: 'placeholder', scope: 'group', allDay: true, startAt: (defaultDate ? defaultDate : '') };
  const isEdit = !!entry;
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const sel = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const dtVal = (v, allDay) => !v ? '' : (allDay ? v.slice(0, 10) : v.replace(' ', 'T').slice(0, 16));
  const allDay = e.allDay !== false;
  openModal(isEdit ? 'Edit entry' : 'New calendar entry', `
    ${field('Title', `<input id="ce-title" value="${escapeHtml(e.title || '')}" placeholder="e.g. Summer camp planning">`)}
    <div class="cap-actions">
      ${field('Type', `<select id="ce-type">${sel(META.entryTypes, e.entryType)}</select>`)}
      ${field('Scope', `<select id="ce-scope">${sel(META.scopes, e.scope)}</select>`)}
    </div>
    ${field('Section (if section-scoped)', `<input id="ce-section" value="${escapeHtml(e.sectionName || '')}" placeholder="e.g. Cubs">`)}
    <div class="field"><label style="font-weight:400"><input type="checkbox" id="ce-allday" ${allDay ? 'checked' : ''}> All-day</label></div>
    <div class="cap-actions">
      ${field('Start', `<input id="ce-start" type="${allDay ? 'date' : 'datetime-local'}" value="${dtVal(e.startAt, allDay)}">`)}
      ${field('End (optional)', `<input id="ce-end" type="${allDay ? 'date' : 'datetime-local'}" value="${dtVal(e.endAt, allDay)}">`)}
    </div>
    ${field('Location (optional)', `<input id="ce-location" value="${escapeHtml(e.location || '')}">`)}
    ${field('Owner (optional)', `<input id="ce-owner" value="${escapeHtml(e.ownerName || '')}">`)}
    ${field('Leader-only notes (optional)', `<textarea id="ce-notes" rows="2">${escapeHtml(e.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="ce-save">${isEdit ? 'Save' : 'Create'}</button><button class="btn btn-secondary" id="ce-cancel">Cancel</button></div>`);

  // Toggle the date inputs between date and datetime-local when all-day changes.
  document.getElementById('ce-allday').addEventListener('change', ev => {
    ['ce-start', 'ce-end'].forEach(id => {
      const el = document.getElementById(id); const had = el.value;
      el.type = ev.target.checked ? 'date' : 'datetime-local';
      el.value = ev.target.checked ? had.slice(0, 10) : (had ? had.slice(0, 10) + 'T09:00' : '');
    });
  });
  document.getElementById('ce-cancel').addEventListener('click', closeModal);
  document.getElementById('ce-save').addEventListener('click', async () => {
    const payload = {
      title: document.getElementById('ce-title').value.trim(),
      entryType: document.getElementById('ce-type').value,
      scope: document.getElementById('ce-scope').value,
      sectionName: document.getElementById('ce-section').value.trim(),
      allDay: document.getElementById('ce-allday').checked,
      startAt: document.getElementById('ce-start').value,
      endAt: document.getElementById('ce-end').value,
      location: document.getElementById('ce-location').value.trim(),
      ownerName: document.getElementById('ce-owner').value.trim(),
      notes: document.getElementById('ce-notes').value.trim(),
    };
    if (!payload.title) { modalError('A title is required.'); return; }
    if (!payload.startAt) { modalError('A start date is required.'); return; }
    try {
      if (isEdit) await Api.patch(`/api/calendar/entries/${entry.id}`, payload);
      else await Api.post('/api/calendar/entries', payload);
      closeModal(); render();
    } catch (err) { modalError(err.message); }
  });
}

function publishEntry(id) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  openModal('Publish to parents', `
    <p class="muted">Parents will see only the parent-safe title and description below - not leader-only notes.</p>
    ${field('Parent-safe title', `<input id="cp-title" placeholder="e.g. Cubs sleepover">`)}
    ${field('Parent-safe description (optional)', `<textarea id="cp-desc" rows="2"></textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="cp-ok">Publish</button><button class="btn btn-secondary" id="cp-cancel">Cancel</button></div>`);
  document.getElementById('cp-cancel').addEventListener('click', closeModal);
  document.getElementById('cp-ok').addEventListener('click', async () => {
    const t = document.getElementById('cp-title').value.trim();
    if (!t) { modalError('A parent-safe title is required.'); return; }
    try { await Api.post(`/api/calendar/entries/${id}/publish`, { parentSafeTitle: t, parentSafeDescription: document.getElementById('cp-desc').value.trim() }); closeModal(); render(); }
    catch (e) { modalError(e.message); }
  });
}

function convertEntry(id) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const opts = Object.entries(META.convertTemplates || {}).map(([k, l]) => `<option value="${k}">${escapeHtml(l)}</option>`).join('');
  openModal('Convert to Event & Camp Hub', `
    <p class="muted">Creates a draft event/camp record pre-filled from this entry. You can add the parent pack, leader docs and QM equipment there.</p>
    ${field('Template', `<select id="cv-template">${opts}</select>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="cv-ok">Convert</button><button class="btn btn-secondary" id="cv-cancel">Cancel</button></div>`);
  document.getElementById('cv-cancel').addEventListener('click', closeModal);
  document.getElementById('cv-ok').addEventListener('click', async () => {
    try { const r = await Api.post(`/api/calendar/entries/${id}/convert`, { template: document.getElementById('cv-template').value }); location.href = 'event-hub.html?id=' + r.eventHubId; }
    catch (e) { modalError(e.message); }
  });
}

// ── Shared modal helpers (mirrors quartermaster.js) ─────────────────────────────
function openModal(title, innerHtml) {
  const existing = document.getElementById('cal-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'cal-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>${escapeHtml(title)}</h2><div id="cal-modal-msg"></div>${innerHtml}</div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  return modal;
}
function modalError(msg) { const m = document.getElementById('cal-modal-msg'); if (m) m.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`; }
function closeModal() { const m = document.getElementById('cal-modal'); if (m) m.remove(); }
function confirmModal(title, body, onYes) {
  openModal(title, `${body ? `<p>${escapeHtml(body)}</p>` : ''}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn btn-secondary" id="cc-yes">Yes</button><button class="btn" id="cc-no">No</button></div>`);
  document.getElementById('cc-no').addEventListener('click', closeModal);
  document.getElementById('cc-yes').addEventListener('click', async () => { try { await onYes(); closeModal(); } catch (e) { modalError(e.message); } });
}
