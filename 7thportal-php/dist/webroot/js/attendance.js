// Section attendance UI (FRD FR-SEC-ATT / FR-SEC-REG). List + register SPA.
// No native dialogs - inline modals. Emergency contact details are never shown.
let ME = null, META = { statuses: {}, sourceTypes: {} }, SECTIONS = [];

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  route();
  window.addEventListener('popstate', route);
})();

function route() {
  const id = new URLSearchParams(location.search).get('id');
  if (id) renderRegister(id); else renderList();
}
function go(id) { history.pushState({}, '', id ? `attendance.html?id=${id}` : 'attendance.html'); route(); }

// ── List ────────────────────────────────────────────────────────────────────────
function attBaseCrumbs() { return [{ label: 'Attendance', href: 'attendance.html' }]; }

async function renderList() {
  const box = document.getElementById('content');
  renderPageHeader({
    title: 'Section attendance',
    description: 'Take a register for your section, pre-filled from the live OSM roster. Records are kept in the portal; emergency contact details are not shown here.',
    actions: '<span class="cap-actions" id="att-head-actions"></span>',
  });
  document.getElementById('att-head-actions').innerHTML = `<button class="btn" id="att-new">New register</button>`;
  document.getElementById('att-new').addEventListener('click', newRegister);

  let data;
  try { data = await Api.get('/api/attendance/registers'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  META = data.meta;

  box.innerHTML = `<div class="card">
    ${data.registers.length ? `<table class="data-table rcards">
      <thead><tr><th>Session</th><th>Section</th><th>Date</th><th>Source</th><th>Present</th><th>Status</th></tr></thead>
      <tbody>${data.registers.map(r => `
        <tr class="att-row clickable" data-id="${r.id}">
          <td class="rcard-title"><strong>${escapeHtml(r.title)}</strong></td>
          <td data-label="Section" class="muted">${escapeHtml(r.sectionName || r.sectionId)}</td>
          <td data-label="Date" class="muted">${formatDate(r.sessionDate)}</td>
          <td data-label="Source" class="muted">${escapeHtml(r.sourceLabel || r.sourceTypeLabel)}</td>
          <td data-label="Present">${r.presentCount}/${r.total}</td>
          <td data-label="Status"><span class="badge" data-status="${r.status === 'submitted' ? 'active' : 'suspended'}">${r.status === 'submitted' ? 'Submitted' : 'Open'}</span></td>
        </tr>`).join('')}</tbody>
    </table>` : '<div class="empty-state">No registers yet. Create one to take attendance for a session.</div>'}
  </div>`;
  document.querySelectorAll('.att-row').forEach(r => r.addEventListener('click', () => go(r.dataset.id)));
}

async function getSections() {
  if (SECTIONS.length) return SECTIONS;
  try { SECTIONS = (await Api.get('/api/leader/dashboard')).sections || []; } catch (e) { SECTIONS = []; }
  return SECTIONS;
}

async function newRegister() {
  const sections = await getSections();
  // Events are optional context: a register for an event/camp links to it (source_ref_id)
  // so the event Command Centre can roll up attendance. Module off -> 404 -> no picker.
  let events = [];
  try { events = (await Api.get('/api/events')).events || []; } catch { events = []; }
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const today = new Date().toISOString().slice(0, 10);
  const secOpts = sections.length
    ? sections.map(s => `<option value="${escapeHtml(s.sectionId)}" data-name="${escapeHtml(s.sectionName)}">${escapeHtml(s.sectionName)}</option>`).join('')
    : '';
  openModal('New register', `
    ${sections.length ? field('Section', `<select id="ar-section">${secOpts}</select>`) : '<div class="alert alert-error">No sections found for your account. You can only take attendance for a section you lead.</div>'}
    ${field('Session date', `<input id="ar-date" type="date" value="${today}">`)}
    ${field('Type', `<select id="ar-type">${Object.entries(META.sourceTypes).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join('')}</select>`)}
    ${events.length ? `<div class="field" id="ar-event-wrap" style="display:none"><label>Event / camp</label><select id="ar-event"><option value="">Choose an event&hellip;</option>${events.map(e => `<option value="${e.id}">${escapeHtml(e.title)}</option>`).join('')}</select></div>` : ''}
    ${field('Title (optional)', `<input id="ar-title" placeholder="e.g. Pack meeting">`)}
    ${field('Linked session / note (optional)', `<input id="ar-label" placeholder="e.g. Programme: Pioneering night">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="ar-save"${sections.length ? '' : ' disabled'}>Create &amp; load roster</button><button class="btn btn-secondary" id="ar-cancel">Cancel</button></div>`);
  document.getElementById('ar-cancel').addEventListener('click', closeModal);
  // Show the event picker only when the register is for an event/camp.
  const typeSel = document.getElementById('ar-type');
  const evWrap = document.getElementById('ar-event-wrap');
  const syncEv = () => { if (evWrap) evWrap.style.display = typeSel.value === 'event' ? '' : 'none'; };
  typeSel.addEventListener('change', syncEv); syncEv();
  const saveBtn = document.getElementById('ar-save');
  if (saveBtn && sections.length) saveBtn.addEventListener('click', async () => {
    const sel = document.getElementById('ar-section');
    const payload = {
      sectionId: sel.value,
      sectionName: sel.selectedOptions[0].dataset.name,
      sessionDate: document.getElementById('ar-date').value,
      sourceType: document.getElementById('ar-type').value,
      title: document.getElementById('ar-title').value.trim(),
      sourceLabel: document.getElementById('ar-label').value.trim(),
    };
    const evSel = document.getElementById('ar-event');
    if (payload.sourceType === 'event' && evSel && evSel.value) {
      payload.sourceRefId = Number(evSel.value);
      if (!payload.sourceLabel) payload.sourceLabel = evSel.options[evSel.selectedIndex].text;
    }
    saveBtn.disabled = true; saveBtn.textContent = 'Loading roster…';
    try {
      const res = await Api.post('/api/attendance/registers', payload);
      closeModal();
      if (res.rosterWarning) alert(res.rosterWarning);
      go(res.register.id);
    } catch (e) { modalError(e.message); saveBtn.disabled = false; saveBtn.textContent = 'Create & load roster'; }
  });
}

// ── Register detail (marking grid) ──────────────────────────────────────────────
async function renderRegister(id) {
  const box = document.getElementById('content');
  // Canonical header: Attendance > <register>. Title + status fill in on load.
  renderPageHeader({
    crumbs: attBaseCrumbs().concat([{ label: 'Register' }]),
    title: 'Register',
    actions: '<span class="cap-actions" id="att-head-actions"></span>',
  });
  document.getElementById('att-head-actions').innerHTML = `<button class="btn btn-secondary" id="att-back">Back to registers</button>`;
  document.getElementById('att-back').addEventListener('click', () => go(null));

  let data;
  try { data = await Api.get(`/api/attendance/registers/${id}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  META = data.meta;
  const r = data.register, groups = data.groups;
  const open = r.status === 'open';
  window.__reg = r; window.__groups = groups;
  setPageHeaderRecord(r.title, { title: r.title, status: { label: open ? 'Open' : 'Submitted', tone: open ? 'attention' : 'ready' } });

  const statusOpts = (sel) => Object.entries(META.statuses).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');

  const groupsHtml = groups.length ? groups.map(g => `
    <div class="att-group">
      <h3 style="margin:.8rem 0 .3rem">${escapeHtml(g.grouping)} <span class="muted" style="font-weight:400">(${g.members.length})</span></h3>
      <table class="data-table rcards"><tbody>
        ${g.members.map(m => `<tr>
          <td class="rcard-title" style="width:45%">${escapeHtml(m.name)}</td>
          <td data-label="Status">${open
            ? `<select class="att-mark" data-id="${m.id}">${statusOpts(m.status)}</select>`
            : `<span class="badge" data-status="${m.status === 'absent' ? 'deleted' : (m.status === 'unknown' ? 'archived' : 'active')}">${escapeHtml(META.statuses[m.status] || m.status)}</span>`}</td>
          <td${(open || m.note) ? ' data-label="Note"' : ''}>${open ? `<input class="att-note" data-id="${m.id}" placeholder="Note (optional)" value="${escapeHtml(m.note || '')}" style="width:100%">` : (m.note ? `<span class="muted">${escapeHtml(m.note)}</span>` : '')}</td>
        </tr>`).join('')}
      </tbody></table>
    </div>`).join('') : '<p class="muted">No members yet. Use “Sync roster” to load them from OSM, or add a guest.</p>';

  box.innerHTML = `
    <div class="card">
      <p class="muted" style="margin-top:0">${escapeHtml(r.sectionName || r.sectionId)} &middot; ${formatDate(r.sessionDate)} &middot; ${escapeHtml(r.sourceLabel || r.sourceTypeLabel)}</p>
      <p><strong id="att-present">${r.presentCount}</strong> present of <strong>${r.total}</strong></p>
      <div class="cap-actions">
        <button class="btn btn-secondary btn-sm" id="att-print">Print register</button>
        ${open ? `<button class="btn btn-sm" id="att-submit">Submit</button>` : `<button class="btn btn-secondary btn-sm" id="att-reopen">Reopen</button>`}
        <button class="btn btn-secondary btn-sm" id="att-del" style="margin-left:auto">Delete</button>
      </div>
    </div>
    <div class="card">
      ${open ? `<div class="cap-actions" style="margin-bottom:.6rem">
        <button class="btn btn-secondary btn-sm" id="att-allpresent">Mark all present</button>
        <button class="btn btn-secondary btn-sm" id="att-clear">Clear</button>
        <button class="btn btn-secondary btn-sm" id="att-sync">Sync roster</button>
        <button class="btn btn-secondary btn-sm" id="att-guest">Add guest</button>
      </div>` : ''}
      <div id="att-grid">${groupsHtml}</div>
    </div>`;

  // Wire marking (auto-save each change).
  document.querySelectorAll('.att-mark').forEach(sel => sel.addEventListener('change', () => saveMark(r.id, sel.dataset.id, { status: sel.value })));
  document.querySelectorAll('.att-note').forEach(inp => inp.addEventListener('change', () => {
    const sel = document.querySelector(`.att-mark[data-id="${inp.dataset.id}"]`);
    saveMark(r.id, inp.dataset.id, { status: sel ? sel.value : undefined, note: inp.value });
  }));
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('att-print', () => printRegister(r, groups));
  on('att-submit', () => act(`/api/attendance/registers/${r.id}/submit`, {}));
  on('att-reopen', () => act(`/api/attendance/registers/${r.id}/reopen`, {}));
  on('att-del', () => confirmModal('Delete this register?', 'This removes the attendance record permanently.', async () => { await Api.delete(`/api/attendance/registers/${r.id}`); go(null); }));
  on('att-allpresent', () => bulk(r.id, 'all_present'));
  on('att-clear', () => bulk(r.id, 'clear'));
  on('att-sync', () => syncRoster(r.id));
  on('att-guest', () => addGuest(r.id));
}

async function saveMark(regId, markId, patch) {
  try {
    const res = await Api.post(`/api/attendance/registers/${regId}/marks`, { marks: [{ id: Number(markId), status: patch.status, note: patch.note }] });
    const p = document.getElementById('att-present'); if (p) p.textContent = res.register.presentCount;
  } catch (e) { alert(e.message); }
}
async function bulk(regId, action) {
  try { await Api.post(`/api/attendance/registers/${regId}/bulk`, { action }); route(); }
  catch (e) { alert(e.message); }
}
async function act(url, body) { try { await Api.post(url, body); route(); } catch (e) { alert(e.message); } }
async function syncRoster(regId) {
  const btn = document.getElementById('att-sync'); if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try { const res = await Api.post(`/api/attendance/registers/${regId}/sync-roster`, {}); alert(res.added ? `${res.added} member(s) added.` : 'Roster already up to date.'); route(); }
  catch (e) { alert(e.message); if (btn) { btn.disabled = false; btn.textContent = 'Sync roster'; } }
}
function addGuest(regId) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  openModal('Add guest', `${field('Name', `<input id="ag-name" placeholder="Guest name">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="ag-ok">Add</button><button class="btn btn-secondary" id="ag-cancel">Cancel</button></div>`);
  document.getElementById('ag-cancel').addEventListener('click', closeModal);
  document.getElementById('ag-ok').addEventListener('click', async () => {
    const name = document.getElementById('ag-name').value.trim();
    if (!name) { modalError('A name is required.'); return; }
    try { await Api.post(`/api/attendance/registers/${regId}/guest`, { name }); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

// Parent-safe printable register: names + status by group, NO leader notes.
function printRegister(r, groups) {
  const rows = groups.map(g => `
    <h3>${escapeHtml(g.grouping)}</h3>
    <table><thead><tr><th>Name</th><th>Attendance</th></tr></thead><tbody>
      ${g.members.map(m => `<tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(META.statuses[m.status] || m.status)}</td></tr>`).join('')}
    </tbody></table>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Register - ${escapeHtml(r.title)}</title>
    <style>body{font-family:Arial,Helvetica,sans-serif;margin:1.5rem;color:#111}
    h1{font-size:1.3rem;margin:0} h3{margin:1rem 0 .3rem} .meta{color:#555;margin:.3rem 0 1rem}
    table{width:100%;border-collapse:collapse;margin-bottom:.5rem} th,td{border:1px solid #ccc;padding:.35rem .5rem;text-align:left;font-size:.9rem}
    .foot{margin-top:1rem;color:#777;font-size:.75rem}</style></head>
    <body onload="window.print()">
      <h1>${escapeHtml(r.sectionName || '')} - attendance register</h1>
      <div class="meta">${escapeHtml(r.title)} &middot; ${new Date(r.sessionDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
      ${rows || '<p>No members.</p>'}
      <div class="foot">Parent-safe register - excludes leader notes. Generated ${new Date().toLocaleString('en-GB')} from 7thPortal.</div>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to print the register.'); return; }
  w.document.write(html); w.document.close();
}

// ── Modal helpers ────────────────────────────────────────────────────────────────
function openModal(title, innerHtml) {
  const existing = document.getElementById('att-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'att-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>${escapeHtml(title)}</h2><div id="att-modal-msg"></div>${innerHtml}</div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  return modal;
}
function modalError(msg) { const m = document.getElementById('att-modal-msg'); if (m) m.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`; }
function closeModal() { const m = document.getElementById('att-modal'); if (m) m.remove(); }
function confirmModal(title, body, onYes) {
  openModal(title, `${body ? `<p>${escapeHtml(body)}</p>` : ''}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn btn-secondary" id="ac-yes">Yes</button><button class="btn" id="ac-no">No</button></div>`);
  document.getElementById('ac-no').addEventListener('click', closeModal);
  document.getElementById('ac-yes').addEventListener('click', async () => { try { await onYes(); closeModal(); } catch (e) { modalError(e.message); } });
}
