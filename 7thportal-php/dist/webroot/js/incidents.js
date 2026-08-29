let INC = { meta: { types: {}, statuses: {}, restrictedTypes: [] }, safeguarding: {}, leaders: [], canCreate: false };
let INC_EVENTS = [];
const incFilters = { status: '', type: '' };

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  // Events are optional context for linking a record to the camp it happened at.
  // If the module is off the request 404s - swallow it and keep the free-text field.
  try { INC_EVENTS = (await Api.get('/api/events')).events || []; } catch { INC_EVENTS = []; }
  loadIncidents();
})();

function safeguardingBanner() {
  const s = INC.safeguarding || {};
  return `<div class="card" style="border-left:4px solid var(--red)">
    <strong>Safeguarding comes first.</strong>
    <p style="margin:.35rem 0 0">${escapeHtml(s.notice || '')}</p>
    <p class="muted" style="margin:.35rem 0 0">Scouts safeguarding: <strong>${escapeHtml(s.phone || '')}</strong> &middot; <a href="mailto:${escapeHtml(s.email || '')}">${escapeHtml(s.email || '')}</a></p>
  </div>`;
}

async function loadIncidents() {
  const box = document.getElementById('content');
  const params = new URLSearchParams();
  if (incFilters.status) params.set('status', incFilters.status);
  if (incFilters.type) params.set('type', incFilters.type);
  let data;
  try { data = await Api.get('/api/incidents?' + params.toString()); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  INC = { meta: data.meta, safeguarding: data.safeguarding, leaders: data.leaders, canCreate: data.canCreate };

  document.getElementById('incident-actions').innerHTML = data.canCreate ? '<button class="btn" id="new-incident">Log incident</button>' : '';
  const sm = data.summary;
  const monthBits = Object.entries(sm.thisMonthByType || {}).map(([t, n]) => `${n} ${(INC.meta.types[t] || t).toLowerCase()}`).join(', ') || 'none';

  box.innerHTML = `
    ${safeguardingBanner()}
    <div class="cap-stats">
      <div class="card"><div class="muted">Open records</div><div class="cap-big">${sm.openRecords}</div></div>
      <div class="card"><div class="muted">Overdue actions</div><div class="cap-big">${sm.overdueActions}</div></div>
      <div class="card"><div class="muted">This month</div><div style="margin-top:.3rem">${escapeHtml(monthBits)}</div><div class="muted" style="font-size:.82rem">${sm.safeguardingVisible} safeguarding record(s) visible to you</div></div>
    </div>
    <div class="card">
      ${sm.countsOnly ? '<div class="alert alert-warning">You have summary access to incident counts only. Detailed records are restricted to the leaders directly involved.</div>' : ''}
      <div class="cap-actions" style="margin-bottom:.8rem">
        <select id="inc-type">${optList(INC.meta.types, incFilters.type, 'All types')}</select>
        <select id="inc-status">${optList(INC.meta.statuses, incFilters.status, 'All statuses')}</select>
      </div>
      ${data.incidents.length ? `<table class="data-table">
        <thead><tr><th>Type</th><th>Section</th><th>Summary</th><th>Due</th><th>Status</th></tr></thead>
        <tbody>${data.incidents.map(i => `
          <tr class="clickable" data-id="${i.id}">
            <td>${escapeHtml(i.recordTypeLabel)}${INC.meta.restrictedTypes.includes(i.recordType) ? ' <span class="badge" data-status="suspended">Restricted</span>' : ''}</td>
            <td class="muted">${escapeHtml(i.sectionName || '&mdash;')}</td>
            <td>${escapeHtml(i.summary)}</td>
            <td>${dueLabel(i)}</td>
            <td><span class="badge" data-status="${i.status === 'closed' ? 'archived' : (i.status === 'open' ? 'pending_approval' : 'active')}">${escapeHtml(i.statusLabel)}</span></td>
          </tr>`).join('')}</tbody>
      </table>` : `<p class="muted">${sm.countsOnly ? 'No detailed records available to your role.' : 'No incident records yet.'}</p>`}
    </div>`;

  const nb = document.getElementById('new-incident');
  if (nb) nb.addEventListener('click', () => openIncidentForm(null));
  document.getElementById('inc-type').addEventListener('change', e => { incFilters.type = e.target.value; loadIncidents(); });
  document.getElementById('inc-status').addEventListener('change', e => { incFilters.status = e.target.value; loadIncidents(); });
  box.querySelectorAll('tr.clickable').forEach(r => r.addEventListener('click', () => openIncidentDetail(r.dataset.id)));
}

function optList(map, selected, allLabel) {
  return `<option value="">${allLabel}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function dueLabel(i) {
  if (i.status === 'closed') return '<span class="muted">&mdash;</span>';
  if (!i.dueDate) return '<span class="muted">&mdash;</span>';
  const today = new Date().toISOString().slice(0, 10);
  return i.dueDate < today ? '<span class="badge" data-status="deleted">Overdue</span>' : (i.dueDate === today ? '<span class="badge" data-status="suspended">Due today</span>' : formatDate(i.dueDate));
}

async function openIncidentDetail(id) {
  let d;
  try { d = await Api.get(`/api/incidents/${id}`); } catch (e) { alert(e.message); return; }
  openIncidentForm(d);
}

function openIncidentForm(inc) {
  const isEdit = !!inc;
  const readOnly = isEdit && !inc.canEdit;
  const a = inc || { recordType: 'near_miss', status: 'open' };
  const sel = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const ro = readOnly ? 'disabled' : '';
  const existing = document.getElementById('inc-modal'); if (existing) existing.remove();
  const m = document.createElement('div');
  m.id = 'inc-modal'; m.className = 'modal-backdrop';
  m.innerHTML = `<div class="modal-box"><h2>${isEdit ? (readOnly ? 'Incident record' : 'Edit incident record') : 'Log incident or near miss'}</h2>
    <div class="alert alert-warning" style="font-size:.85rem">${escapeHtml((INC.safeguarding || {}).notice || '')} Safeguarding: <strong>${escapeHtml((INC.safeguarding || {}).phone || '')}</strong>.</div>
    <div id="inc-form-msg"></div>
    ${field('Record type', `<select id="if-type" ${ro}>${sel(INC.meta.types, a.recordType)}</select>`)}
    <div id="if-sg-note"></div>
    ${field('Short summary', `<input id="if-summary" ${ro} value="${escapeHtml(a.summary || '')}" placeholder="One line - avoid sensitive detail">`)}
    <div class="cap-actions">
      ${field('Section', `<input id="if-section" ${ro} value="${escapeHtml(a.sectionName || '')}">`)}
      ${field('Event / camp (optional)', INC_EVENTS.length
        ? `<select id="if-event-hub" ${ro}><option value="">Not linked / other</option>${INC_EVENTS.map(e => `<option value="${e.id}"${a.eventHubId === e.id ? ' selected' : ''}>${escapeHtml(e.title)}</option>`).join('')}</select>`
        : `<input id="if-event" ${ro} value="${escapeHtml(a.eventName || '')}">`)}
    </div>
    <div class="cap-actions">
      ${field('Date &amp; time', `<input id="if-when" type="datetime-local" ${ro} value="${(a.occurredAt || '').replace(' ', 'T').slice(0, 16)}">`)}
      ${field('Location', `<input id="if-location" ${ro} value="${escapeHtml(a.location || '')}">`)}
    </div>
    ${field('What happened', `<textarea id="if-what" rows="2" ${ro}>${escapeHtml(a.whatHappened || '')}</textarea>`)}
    ${field('Immediate action taken', `<textarea id="if-immediate" rows="2" ${ro}>${escapeHtml(a.immediateAction || '')}</textarea>`)}
    ${field('Follow-up actions', `<textarea id="if-followup" rows="2" ${ro}>${escapeHtml(a.followUpActions || '')}</textarea>`)}
    <div class="cap-actions">
      ${field('Assign to', `<select id="if-assign" ${ro}><option value="">Unassigned</option>${INC.leaders.map(l => `<option value="${l.id}"${a.assignedTo === l.id ? ' selected' : ''}>${escapeHtml(l.name)}</option>`).join('')}</select>`)}
      ${field('Action due', `<input id="if-due" type="date" ${ro} value="${a.dueDate || ''}">`)}
    </div>
    ${field('Status', `<select id="if-status" ${ro}>${sel(INC.meta.statuses, a.status)}</select>`)}
    ${field('Closing note (when closed)', `<textarea id="if-closed" rows="2" ${ro}>${escapeHtml(a.closedNote || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem">
      ${readOnly ? '' : `<button class="btn" id="if-save">${isEdit ? 'Save changes' : 'Create record'}</button>`}
      <button class="btn btn-secondary" id="if-cancel">${readOnly ? 'Close' : 'Cancel'}</button>
    </div></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  document.getElementById('if-cancel').addEventListener('click', () => m.remove());

  const sgNote = () => {
    const t = document.getElementById('if-type').value;
    document.getElementById('if-sg-note').innerHTML = t === 'safeguarding_signpost'
      ? '<div class="alert alert-error" style="font-size:.85rem">Do not record safeguarding detail here. Capture only that a concern was raised and escalated, and follow the formal Scouts process now.</div>' : '';
  };
  document.getElementById('if-type').addEventListener('change', sgNote); sgNote();

  const save = document.getElementById('if-save');
  if (save) save.addEventListener('click', async () => {
    const payload = {
      recordType: document.getElementById('if-type').value,
      summary: document.getElementById('if-summary').value.trim(),
      sectionName: document.getElementById('if-section').value.trim(),
      ...(() => {
        const sel = document.getElementById('if-event-hub');
        if (sel) return { eventHubId: sel.value || null, eventName: sel.value ? sel.options[sel.selectedIndex].text : '' };
        const txt = document.getElementById('if-event');
        return { eventName: txt ? txt.value.trim() : '' };
      })(),
      occurredAt: document.getElementById('if-when').value,
      location: document.getElementById('if-location').value.trim(),
      whatHappened: document.getElementById('if-what').value.trim(),
      immediateAction: document.getElementById('if-immediate').value.trim(),
      followUpActions: document.getElementById('if-followup').value.trim(),
      assignedTo: document.getElementById('if-assign').value,
      dueDate: document.getElementById('if-due').value,
      status: document.getElementById('if-status').value,
      closedNote: document.getElementById('if-closed').value.trim(),
    };
    if (!payload.summary) { document.getElementById('inc-form-msg').innerHTML = '<div class="alert alert-error">A short summary is required.</div>'; return; }
    try {
      if (isEdit) await Api.patch(`/api/incidents/${inc.id}`, payload);
      else await Api.post('/api/incidents', payload);
      m.remove(); loadIncidents();
    } catch (e) { document.getElementById('inc-form-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
