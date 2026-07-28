let HUB = null;
let HUB_META = {};
const RAG = { green: 'active', amber: 'suspended', red: 'deleted' };
let PARENT_PREVIEW = false;

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No event specified.</div>'; return; }
  window.HUB_ID = id;
  // Meta comes from the list endpoint (statuses/visibilities for the editors).
  try { HUB_META = (await Api.get('/api/events')).meta; } catch (e) { /* best effort */ }
  loadHub();
})();

async function loadHub() {
  const box = document.getElementById('content');
  try { HUB = await Api.get(`/api/events/${window.HUB_ID}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  HUB.isLeaderView && !PARENT_PREVIEW ? renderLeader(box) : renderParent(box);
}

function hubDates() {
  return HUB.startDate ? formatDate(HUB.startDate) + (HUB.endDate && HUB.endDate !== HUB.startDate ? ' - ' + formatDate(HUB.endDate) : '') : 'Dates to confirm';
}
function osmBtn() {
  return HUB.osmEventUrl ? `<a class="btn btn-secondary" href="${escapeHtml(HUB.osmEventUrl)}" target="_blank" rel="noopener">Open in OSM &rarr;</a>` : '';
}
function infoCards() {
  const card = (t, v) => `<div class="card"><h2 style="margin:0 0 .3rem">${t}</h2><p class="muted" style="margin:0;white-space:pre-wrap">${v ? escapeHtml(v) : 'To be confirmed.'}</p></div>`;
  return `<div class="grid cols-2">
    ${card('Key information', HUB.keyInformation)}
    ${card('What to bring', HUB.whatToBring)}
    ${card('Programme highlights', HUB.programmeHighlights)}
  </div>`;
}

function renderParent(box) {
  const rows = (HUB.items || []).map(i => `<tr>
    <td>${escapeHtml(i.label)}</td>
    <td><span class="badge" data-status="${i.itemStatus === 'published' ? 'published' : 'draft'}">${escapeHtml(i.itemStatusLabel)}</span></td>
    <td>${i.linkUrl && i.itemStatus === 'published' ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(i.linkUrl)}" target="_blank" rel="noopener">View</a>` : '<span class="muted">Check later</span>'}</td>
    <td class="muted">Parents</td>
  </tr>`).join('');
  box.innerHTML = `
    ${PARENT_PREVIEW ? '<div class="alert alert-warning">Parent preview - this is exactly what parents can see. <a href="#" id="exit-preview">Back to leader view</a></div>' : ''}
    <div class="card">
      <div class="cap-head"><h1 style="margin:0">${escapeHtml(HUB.title)}</h1><span class="cap-actions">${osmBtn()}</span></div>
      <p class="muted" style="margin:.3rem 0 0">${escapeHtml(HUB.eventTypeLabel)} &middot; ${escapeHtml(hubDates())}${HUB.location ? ' &middot; ' + escapeHtml(HUB.location) : ''}</p>
      <p class="muted" style="margin:.5rem 0 0">OSM stays the source of truth for sign-up, payment and attendance.</p>
    </div>
    ${infoCards()}
    <div class="card">
      <h2>Documents &amp; links</h2>
      ${(HUB.items || []).length ? `<table class="data-table"><thead><tr><th>Item</th><th>Status</th><th>Action</th><th>Visible to</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No parent documents yet.</p>'}
    </div>`;
  const ep = document.getElementById('exit-preview');
  if (ep) ep.addEventListener('click', e => { e.preventDefault(); PARENT_PREVIEW = false; loadHub(); });
}

function renderLeader(box) {
  const r = HUB.readiness || { complete: 0, total: 6, rag: 'red', tasks: {} };
  const linked = ['osmEventUrl'].every(k => HUB[k]);
  const itemRows = (HUB.items || []).map(i => `<tr>
    <td><strong>${escapeHtml(i.label)}</strong>${i.linkUrl ? ` <a href="${escapeHtml(i.linkUrl)}" target="_blank" rel="noopener" class="muted">link</a>` : ''}</td>
    <td><span class="badge" data-status="${i.itemStatus === 'published' || i.itemStatus === 'linked' ? 'active' : (i.itemStatus === 'awaiting' ? 'suspended' : 'draft')}">${escapeHtml(i.itemStatusLabel)}</span></td>
    <td>${escapeHtml(i.visibilityLabel)}</td>
    <td class="muted">${escapeHtml(i.owner || '&mdash;')}</td>
    <td><button class="btn btn-secondary btn-sm ev-item-edit" data-id="${i.id}">Edit</button></td>
  </tr>`).join('');

  box.innerHTML = `
    <div class="cap-stats">
      <div class="card"><div class="muted">Hub readiness</div><div style="margin-top:.3rem"><span class="badge" data-status="${RAG[r.rag]}">${r.rag === 'green' ? 'Ready' : (r.rag === 'amber' ? 'Amber' : 'Not ready')}</span></div><div class="muted" style="font-size:.82rem;margin-top:.3rem">${r.complete} of ${r.total} setup tasks complete</div></div>
      <div class="card"><div class="muted">Status</div><div style="margin-top:.3rem"><span class="badge" data-status="${HUB.status === 'published' ? 'published' : 'draft'}">${escapeHtml(HUB.statusLabel)}</span></div><div style="margin-top:.4rem">${HUB.status === 'published' ? '<button class="btn btn-secondary btn-sm" id="ev-unpublish">Unpublish</button>' : `<button class="btn btn-sm" id="ev-publish" ${r.complete < 3 ? 'disabled title="Complete more setup first"' : ''}>Publish</button>`}</div></div>
      <div class="card"><div class="muted">OSM link</div><div style="margin-top:.3rem"><span class="badge" data-status="${linked ? 'active' : 'suspended'}">${linked ? 'Linked' : 'Not linked'}</span></div><div style="margin-top:.4rem"><button class="btn btn-secondary btn-sm" id="ev-preview">Parent preview</button></div></div>
    </div>
    <div class="card">
      <div class="cap-head"><h1 style="margin:0">${escapeHtml(HUB.title)}</h1><span class="cap-actions"><button class="btn btn-secondary" id="ev-edit">Edit details</button>${HUB.canManage ? '<button class="btn btn-secondary ev-delete" id="ev-delete">Delete</button>' : ''}</span></div>
      <p class="muted" style="margin:.3rem 0 0">${escapeHtml(HUB.eventTypeLabel)} &middot; ${escapeHtml(hubDates())}${HUB.location ? ' &middot; ' + escapeHtml(HUB.location) : ''}${HUB.sectionName ? ' &middot; ' + escapeHtml(HUB.sectionName) : ''}</p>
    </div>
    ${infoCards()}
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Hub items</h2><span class="cap-actions"><button class="btn" id="ev-add-item">Add item</button></span></div>
      <p class="muted">Parent packs, kit lists, risk assessments, linked albums and expense accounts. Leader-only items are never shown to parents.</p>
      ${(HUB.items || []).length ? `<table class="data-table"><thead><tr><th>Hub item</th><th>Status</th><th>Visibility</th><th>Owner</th><th></th></tr></thead><tbody>${itemRows}</tbody></table>` : '<p class="muted">No items yet.</p>'}
    </div>`;

  document.getElementById('ev-edit').addEventListener('click', openHubEdit);
  document.getElementById('ev-add-item').addEventListener('click', () => openItemForm(null));
  document.getElementById('ev-preview').addEventListener('click', () => { PARENT_PREVIEW = true; loadHub(); });
  const pub = document.getElementById('ev-publish'); if (pub) pub.addEventListener('click', () => setHubStatus('published'));
  const unpub = document.getElementById('ev-unpublish'); if (unpub) unpub.addEventListener('click', () => setHubStatus('draft'));
  const del = document.getElementById('ev-delete'); if (del) del.addEventListener('click', deleteHub);
  box.querySelectorAll('.ev-item-edit').forEach(b => b.addEventListener('click', () => openItemForm((HUB.items || []).find(i => i.id == b.dataset.id))));
}

async function setHubStatus(status) {
  try { await Api.patch(`/api/events/${window.HUB_ID}`, { status }); loadHub(); } catch (e) { alert(e.message); }
}
async function deleteHub() {
  if (!confirm('Delete this event hub and all its items?')) return;
  try { await Api.delete(`/api/events/${window.HUB_ID}`); location.href = 'events.html'; } catch (e) { alert(e.message); }
}

function modal(html) {
  const m = document.createElement('div'); m.className = 'modal-backdrop'; m.id = 'hub-modal'; m.innerHTML = `<div class="modal-box">${html}</div>`;
  document.body.appendChild(m); m.addEventListener('click', e => { if (e.target === m) m.remove(); }); return m;
}
const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
const selOpts = (map, v) => Object.entries(map).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');

function openHubEdit() {
  const h = HUB;
  const m = modal(`<h2>Edit event details</h2><div id="he-msg"></div>
    ${field('Title', `<input id="he-title" value="${escapeHtml(h.title)}">`)}
    <div class="cap-actions">${field('Type', `<select id="he-type">${selOpts(HUB_META.types, h.eventType)}</select>`)}${field('Section', `<input id="he-section" value="${escapeHtml(h.sectionName || '')}" placeholder="Blank = whole Group">`)}</div>
    <div class="cap-actions">${field('Start date', `<input id="he-start" type="date" value="${h.startDate || ''}">`)}${field('End date', `<input id="he-end" type="date" value="${h.endDate || ''}">`)}</div>
    ${field('Location', `<input id="he-location" value="${escapeHtml(h.location || '')}">`)}
    ${field('Key information (parents)', `<textarea id="he-key" rows="2">${escapeHtml(h.keyInformation || '')}</textarea>`)}
    ${field('What to bring (parents)', `<textarea id="he-bring" rows="2">${escapeHtml(h.whatToBring || '')}</textarea>`)}
    ${field('Programme highlights (parents)', `<textarea id="he-prog" rows="2">${escapeHtml(h.programmeHighlights || '')}</textarea>`)}
    ${field('OSM event link', `<input id="he-osm" value="${escapeHtml(h.osmEventUrl || '')}" placeholder="https://www.onlinescoutmanager.co.uk/...">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="he-save">Save</button><button class="btn btn-secondary" id="he-cancel">Cancel</button></div>`);
  m.querySelector('#he-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#he-save').addEventListener('click', async () => {
    const g = id => document.getElementById(id).value;
    try {
      await Api.patch(`/api/events/${window.HUB_ID}`, {
        title: g('he-title').trim(), eventType: g('he-type'), sectionName: g('he-section').trim(),
        startDate: g('he-start'), endDate: g('he-end'), location: g('he-location').trim(),
        keyInformation: g('he-key').trim(), whatToBring: g('he-bring').trim(), programmeHighlights: g('he-prog').trim(), osmEventUrl: g('he-osm').trim(),
      });
      m.remove(); loadHub();
    } catch (e) { document.getElementById('he-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

function openItemForm(item) {
  const isEdit = !!item; const a = item || { itemStatus: 'draft', visibility: 'parents' };
  const m = modal(`<h2>${isEdit ? 'Edit item' : 'Add hub item'}</h2><div id="hi-msg"></div>
    ${field('Label', `<input id="hi-label" value="${escapeHtml(a.label || '')}" placeholder="e.g. Kit list, Risk assessment">`)}
    <div class="cap-actions">${field('Status', `<select id="hi-status">${selOpts(HUB_META.itemStatuses, a.itemStatus)}</select>`)}${field('Visibility', `<select id="hi-visibility">${selOpts(HUB_META.visibilities, a.visibility)}</select>`)}</div>
    ${field('Owner', `<input id="hi-owner" value="${escapeHtml(a.owner || '')}">`)}
    ${field('Link (optional)', `<input id="hi-link" value="${escapeHtml(a.linkUrl || '')}" placeholder="Document / album / OSM URL">`)}
    ${field('Notes', `<textarea id="hi-notes" rows="2">${escapeHtml(a.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn" id="hi-save">${isEdit ? 'Save' : 'Add'}</button>
      <button class="btn btn-secondary" id="hi-cancel">Cancel</button>
      ${isEdit ? '<button class="btn btn-secondary ev-delete" id="hi-delete" style="margin-left:auto">Delete</button>' : ''}
    </div>`);
  m.querySelector('#hi-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#hi-save').addEventListener('click', async () => {
    const g = id => document.getElementById(id).value;
    const payload = { label: g('hi-label').trim(), itemStatus: g('hi-status'), visibility: g('hi-visibility'), owner: g('hi-owner').trim(), linkUrl: g('hi-link').trim(), notes: g('hi-notes').trim() };
    if (!payload.label) { document.getElementById('hi-msg').innerHTML = '<div class="alert alert-error">A label is required.</div>'; return; }
    try {
      if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/items/${item.id}`, payload);
      else await Api.post(`/api/events/${window.HUB_ID}/items`, payload);
      m.remove(); loadHub();
    } catch (e) { document.getElementById('hi-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('hi-delete');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('Delete this item?')) return;
    try { await Api.delete(`/api/events/${window.HUB_ID}/items/${item.id}`); m.remove(); loadHub(); } catch (e) { document.getElementById('hi-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
