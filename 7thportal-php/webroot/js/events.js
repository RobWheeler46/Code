let EV_META = { types: {}, statuses: {} };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  loadEvents();
})();

const RAG_STATUS = { green: 'active', amber: 'suspended', red: 'deleted' };
// Camp Readiness checker: overall rollup status -> pill.
const READY_PILL = { ready: ['active', 'Ready'], attention: ['suspended', 'Needs attention'], blocked: ['deleted', 'Needs sorting'], none: ['draft', 'Not started'] };

async function loadEvents() {
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/events'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  EV_META = data.meta;

  document.getElementById('events-actions').innerHTML = data.canManage ? '<button class="btn" id="new-event">New event</button>' : '';

  // Critical readiness exceptions (blocked Command Centre areas on live events) - the
  // same signal pushed to leaders as notifications, surfaced here as a banner so it's
  // actionable the moment they land. Leader-only.
  const exc = (data.isLeaderView && data.exceptions) ? data.exceptions : [];
  const excBanner = exc.length ? `<div class="card" style="border-left:4px solid #c62828;margin-bottom:1rem">
    <h2 style="margin:0 0 .4rem;color:#c62828">&#9888; ${exc.length} critical exception${exc.length === 1 ? '' : 's'}</h2>
    <p class="muted" style="margin:0 0 .5rem;font-size:.85rem">Blocked readiness on live events &mdash; sort these first. Leaders have been notified.</p>
    ${exc.map(x => `<div style="padding:.4rem 0;border-bottom:1px solid var(--border)">
      <a href="${escapeHtml(x.link)}"><strong>${escapeHtml(x.hubTitle || 'Event')}</strong></a> &middot; ${escapeHtml(x.area)}
      <div class="muted" style="font-size:.85rem">${escapeHtml(x.summary)}</div>
    </div>`).join('')}
  </div>` : '';

  if (!data.events.length) {
    box.innerHTML = excBanner + `<div class="empty-state">${data.isLeaderView ? 'No events yet. Create one to get started.' : 'No event or camp pages are published for you right now.'}</div>`;
  } else {
    box.innerHTML = excBanner + `<div class="grid cols-2">${data.events.map(ev => {
      const dates = ev.startDate ? formatDate(ev.startDate) + (ev.endDate && ev.endDate !== ev.startDate ? ' - ' + formatDate(ev.endDate) : '') : 'Dates to confirm';
      const rollup = data.isLeaderView && ev.rollup ? ev.rollup : null;
      const readyPill = rollup ? (([st, lbl]) => ` <span class="badge" data-status="${st}">${lbl}</span>`)(READY_PILL[rollup.overall] || READY_PILL.none) : '';
      const badge = data.isLeaderView
        ? `<span class="badge" data-status="${ev.status === 'published' ? 'published' : (ev.status === 'archived' ? 'archived' : 'draft')}">${escapeHtml(ev.statusLabel)}</span>
           ${ev.readiness ? ` <span class="badge" data-status="${RAG_STATUS[ev.readiness.rag]}">${ev.readiness.complete}/${ev.readiness.total} set up</span>` : ''}${readyPill}`
        : '';
      const gaps = rollup && rollup.gaps.length
        ? `<p class="muted" style="margin:.45rem 0 0;font-size:.85rem">&#9888; ${rollup.gaps.slice(0, 3).map(g => escapeHtml(g.label) + ' &mdash; ' + escapeHtml(g.summary)).join('; ')}</p>`
        : '';
      return `<a class="card clickable" href="event-hub.html?id=${ev.id}">
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"><h2 style="margin:0">${escapeHtml(ev.title)}</h2></div>
        <p class="muted" style="margin:.3rem 0 0">${escapeHtml(EV_META.types[ev.eventType] || ev.eventType)} &middot; ${escapeHtml(dates)}${ev.location ? ' &middot; ' + escapeHtml(ev.location) : ''}${ev.sectionName ? ' &middot; ' + escapeHtml(ev.sectionName) : ''}</p>
        <div style="margin-top:.5rem">${badge}</div>
        ${gaps}
      </a>`;
    }).join('')}</div>`;
  }

  const nb = document.getElementById('new-event');
  if (nb) nb.addEventListener('click', openNewEvent);
}

function openNewEvent() {
  const sel = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const m = document.createElement('div');
  m.className = 'modal-backdrop'; m.id = 'ev-modal';
  m.innerHTML = `<div class="modal-box"><h2>New event or camp</h2>
    <div id="ev-msg"></div>
    ${field('Title', '<input id="nv-title" placeholder="e.g. Summer Camp 2027">')}
    <div class="cap-actions">
      ${field('Type', `<select id="nv-type">${sel(EV_META.types, 'camp')}</select>`)}
      ${field('Section (optional)', '<input id="nv-section" placeholder="Leave blank for whole Group">')}
    </div>
    <div class="cap-actions">
      ${field('Start date', '<input id="nv-start" type="date">')}
      ${field('End date', '<input id="nv-end" type="date">')}
    </div>
    ${field('Location', '<input id="nv-location">')}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn" id="nv-save">Create</button>
      <button class="btn btn-secondary" id="nv-cancel">Cancel</button>
    </div></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.getElementById('nv-cancel').addEventListener('click', () => m.remove());
  document.getElementById('nv-save').addEventListener('click', async () => {
    const title = document.getElementById('nv-title').value.trim();
    if (!title) { document.getElementById('ev-msg').innerHTML = '<div class="alert alert-error">A title is required.</div>'; return; }
    try {
      const created = await Api.post('/api/events', {
        title, eventType: document.getElementById('nv-type').value,
        sectionName: document.getElementById('nv-section').value.trim(),
        startDate: document.getElementById('nv-start').value, endDate: document.getElementById('nv-end').value,
        location: document.getElementById('nv-location').value.trim(),
      });
      location.href = `event-hub.html?id=${created.id}`;
    } catch (e) { document.getElementById('ev-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
