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
    </div>
    ${locationsParent()}`;
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
      ${overviewCard()}
    </div>
    <div class="card">
      <div class="cap-head"><h1 style="margin:0">${escapeHtml(HUB.title)}</h1><span class="cap-actions"><button class="btn" id="ev-camp-pack">Camp pack (print)</button><button class="btn btn-secondary" id="ev-edit">Edit details</button>${HUB.canManage ? '<button class="btn btn-secondary ev-delete" id="ev-delete">Delete</button>' : ''}</span></div>
      <p class="muted" style="margin:.3rem 0 0">${escapeHtml(HUB.eventTypeLabel)} &middot; ${escapeHtml(hubDates())}${HUB.location ? ' &middot; ' + escapeHtml(HUB.location) : ''}${HUB.sectionName ? ' &middot; ' + escapeHtml(HUB.sectionName) : ''}</p>
    </div>
    ${commandCentreCard()}
    ${infoCards()}
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Hub items</h2><span class="cap-actions"><button class="btn" id="ev-add-item">Add item</button></span></div>
      <p class="muted">Parent packs, kit lists, risk assessments, linked albums and expense accounts. Leader-only items are never shown to parents.</p>
      ${(HUB.items || []).length ? `<table class="data-table"><thead><tr><th>Hub item</th><th>Status</th><th>Visibility</th><th>Owner</th><th></th></tr></thead><tbody>${itemRows}</tbody></table>` : '<p class="muted">No items yet.</p>'}
    </div>
    ${locationsLeader()}
    ${rotaLeader()}
    ${programmeLeader()}
    ${cateringLeader()}
    ${transportLeader()}
    ${versionsLeader()}`;

  document.getElementById('ev-camp-pack').addEventListener('click', printCampPack);
  document.getElementById('ev-edit').addEventListener('click', openHubEdit);
  document.getElementById('ev-add-item').addEventListener('click', () => openItemForm(null));
  const locAdd = document.getElementById('loc-add'); if (locAdd) locAdd.addEventListener('click', () => openLocationForm(null));
  box.querySelectorAll('.loc-edit').forEach(b => b.addEventListener('click', () => openLocationForm((HUB.locations || []).find(l => l.id == b.dataset.id))));
  const adultAdd = document.getElementById('rota-adult-add'); if (adultAdd) adultAdd.addEventListener('click', () => openAdultForm(null));
  const entryAdd = document.getElementById('rota-entry-add'); if (entryAdd) entryAdd.addEventListener('click', () => openRotaEntryForm(null));
  box.querySelectorAll('.rota-adult-edit').forEach(b => b.addEventListener('click', () => openAdultForm((HUB.rota.adults || []).find(a => a.id == b.dataset.id))));
  box.querySelectorAll('.rota-entry-edit').forEach(b => b.addEventListener('click', () => openRotaEntryForm((HUB.rota.entries || []).find(e => e.id == b.dataset.id))));
  const trAdd = document.getElementById('tr-vehicle-add'); if (trAdd) trAdd.addEventListener('click', () => openVehicleForm(null));
  box.querySelectorAll('.tr-vehicle-edit').forEach(b => b.addEventListener('click', () => openVehicleForm((HUB.transport.vehicles || []).find(v => v.id == b.dataset.id))));
  box.querySelectorAll('.tr-pax-add').forEach(b => b.addEventListener('click', async () => {
    const inp = document.getElementById('tr-pax-input-' + b.dataset.vid);
    const name = inp.value.trim(); if (!name) { inp.focus(); return; }
    try { await Api.post(`/api/events/${window.HUB_ID}/transport/vehicles/${b.dataset.vid}/passengers`, { name }); loadHub(); } catch (e) { alert(e.message); }
  }));
  box.querySelectorAll('.tr-pax-remove').forEach(b => b.addEventListener('click', async () => {
    try { await Api.delete(`/api/events/${window.HUB_ID}/transport/passengers/${b.dataset.pid}`); loadHub(); } catch (e) { alert(e.message); }
  }));
  const trPrint = document.getElementById('tr-print'); if (trPrint) trPrint.addEventListener('click', printManifests);
  const progAdd = document.getElementById('prog-add'); if (progAdd) progAdd.addEventListener('click', () => openProgrammeSlotForm(null));
  const progImport = document.getElementById('prog-import'); if (progImport) progImport.addEventListener('click', openProgrammeImport);
  box.querySelectorAll('.prog-edit').forEach(b => b.addEventListener('click', () => openProgrammeSlotForm((HUB.programme.slots || []).find(s => s.id == b.dataset.id))));
  const cateringAdd = document.getElementById('catering-add'); if (cateringAdd) cateringAdd.addEventListener('click', () => openCateringMealForm(null));
  box.querySelectorAll('.catering-edit').forEach(b => b.addEventListener('click', () => openCateringMealForm((HUB.catering.meals || []).find(m => m.id == b.dataset.id))));
  const verCapture = document.getElementById('ver-capture'); if (verCapture) verCapture.addEventListener('click', openVersionCapture);
  box.querySelectorAll('.ver-ack').forEach(b => b.addEventListener('click', () => ackVersion(b.dataset.id)));
  box.querySelectorAll('.ver-delete').forEach(b => b.addEventListener('click', () => deleteVersion(b.dataset.id, b.dataset.no)));
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

// Command Centre: per-area readiness rollup (the event as the operational spine).
// Each area's status maps to the shared status pills.
const CC_PILL = { ready: ['active', 'Ready'], attention: ['suspended', 'Needs attention'], blocked: ['deleted', 'Blocked'], none: ['draft', 'Not started'] };
function commandCentreCard() {
  const areas = HUB.commandCentre;
  if (!areas || !areas.length) return '';
  const cards = areas.map(a => {
    const [st, lbl] = CC_PILL[a.status] || CC_PILL.none;
    const inner = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;">
        <strong>${escapeHtml(a.label)}</strong>
        <span class="badge" data-status="${st}">${lbl}</span>
      </div>
      <div class="muted" style="font-size:.88rem;margin-top:.3rem;">${escapeHtml(a.summary)}</div>`;
    return a.link
      ? `<a class="card clickable" href="${escapeHtml(a.link)}" style="margin:0;">${inner}</a>`
      : `<div class="card" style="margin:0;">${inner}</div>`;
  }).join('');
  return `
    <div class="card">
      <h2 style="margin:0 0 .2rem;">Command centre</h2>
      <p class="muted" style="margin:0 0 .8rem;">Readiness across the whole event at a glance &mdash; sort anything marked <span class="badge" data-status="deleted">Blocked</span> or <span class="badge" data-status="suspended">Needs attention</span> first.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:.8rem;">${cards}</div>
    </div>`;
}

// Camp overview stat card (FR-CAMP-OP-003).
function overviewCard() {
  const o = HUB.overview; if (!o) return '';
  const bits = [`${o.emergencyLocations} emergency`];
  if (o.days) bits.push(`${o.days} day${o.days === 1 ? '' : 's'}`);
  if (o.rotaAdults) bits.push(`${o.rotaAdults} adult${o.rotaAdults === 1 ? '' : 's'}`);
  if (o.rotaGaps) bits.push(`<span style="color:#c62828">${o.rotaGaps} rota gap${o.rotaGaps === 1 ? '' : 's'}</span>`);
  if (o.openActions) bits.push(`${o.openActions} open action${o.openActions === 1 ? '' : 's'}`);
  return `<div class="card"><div class="muted">Camp planning</div>
    <div style="font-size:1.3rem;font-weight:800;margin-top:.2rem">${o.locations} location${o.locations === 1 ? '' : 's'}</div>
    <div class="muted" style="font-size:.82rem;margin-top:.3rem">${bits.join(' &middot; ')}</div></div>`;
}

function locContact(l) {
  return `${l.phone ? `<a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>` : ''}${l.address ? `${l.phone ? '<br>' : ''}<span class="muted">${escapeHtml(l.address)}</span>` : ''}${l.openingTimes ? `<br><span class="muted">${escapeHtml(l.openingTimes)}</span>` : ''}${l.mapUrl ? ` <a href="${escapeHtml(l.mapUrl)}" target="_blank" rel="noopener">map</a>` : ''}`;
}

// Leader location & emergency directory (FR-CAMP-OP-004..008). Emergency locations
// are pulled out prominently at the top; the full list follows.
function locationsLeader() {
  const locs = HUB.locations || [];
  const emergency = locs.filter(l => l.isEmergency);
  const emergencyHtml = emergency.length ? `
    <div class="card" style="border-left:4px solid #c62828">
      <h2 style="margin:0 0 .5rem;color:#c62828">Emergency directory</h2>
      ${emergency.map(l => `<div style="padding:.45rem 0;border-bottom:1px solid var(--border)">
        <strong>${escapeHtml(l.typeLabel)}: ${escapeHtml(l.name)}</strong>${l.phone ? ` &middot; <a href="tel:${escapeHtml(l.phone)}"><strong>${escapeHtml(l.phone)}</strong></a>` : ''}
        ${l.address ? `<br><span class="muted">${escapeHtml(l.address)}</span>` : ''}${l.mapUrl ? ` <a href="${escapeHtml(l.mapUrl)}" target="_blank" rel="noopener">map</a>` : ''}
      </div>`).join('')}
    </div>` : '';
  const rows = locs.map(l => `<tr>
    <td data-label="Location" class="rcard-title"><strong>${escapeHtml(l.name)}</strong> <span class="muted">${escapeHtml(l.typeLabel)}</span></td>
    <td data-label="Contact">${locContact(l) || '<span class="muted">&mdash;</span>'}</td>
    <td data-label="Visible to"><span class="badge" data-status="${l.visibility === 'parents' ? 'active' : (l.visibility === 'emergency' ? 'deleted' : 'archived')}">${escapeHtml(l.visibilityLabel)}</span></td>
    <td class="rcard-actions"><button class="btn btn-secondary btn-sm loc-edit" data-id="${l.id}">Edit</button></td>
  </tr>`).join('');
  return emergencyHtml + `
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Locations &amp; emergency directory</h2><span class="cap-actions"><button class="btn" id="loc-add">Add location</button></span></div>
      <p class="muted">Campsite, hospitals, drop-off/collection, suppliers. Emergency locations (hospital, minor injuries, dentist, vet, or anything marked Emergency) show at the top. Parents only see parent-visible locations.</p>
      ${locs.length ? `<table class="data-table rcards"><thead><tr><th>Location</th><th>Contact</th><th>Visible to</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No locations added yet.</p>'}
    </div>`;
}

// Parent-facing key locations (already filtered to parent-visible by the API).
function locationsParent() {
  const locs = HUB.locations || [];
  if (!locs.length) return '';
  return `<div class="card"><h2>Key locations</h2>
    ${locs.map(l => `<div style="padding:.45rem 0;border-bottom:1px solid var(--border)">
      <strong>${escapeHtml(l.name)}</strong> <span class="muted">(${escapeHtml(l.typeLabel)})</span>
      ${l.address ? `<br><span class="muted">${escapeHtml(l.address)}</span>` : ''}${l.mapUrl ? ` <a href="${escapeHtml(l.mapUrl)}" target="_blank" rel="noopener">map</a>` : ''}
    </div>`).join('')}</div>`;
}

function openLocationForm(loc) {
  const isEdit = !!loc; const a = loc || { type: 'campsite', visibility: 'leaders' };
  const m = modal(`<h2>${isEdit ? 'Edit location' : 'Add location'}</h2><div id="lo-msg"></div>
    ${field('Name', `<input id="lo-name" value="${escapeHtml(a.name || '')}" placeholder="e.g. Youlbury Scout Camp">`)}
    <div class="cap-actions">${field('Type', `<select id="lo-type">${selOpts(HUB_META.locationTypes || (HUB.locationMeta && HUB.locationMeta.types) || {}, a.type)}</select>`)}${field('Visible to', `<select id="lo-vis">${selOpts((HUB.locationMeta && HUB.locationMeta.visibilities) || {}, a.visibility)}</select>`)}</div>
    ${field('Address', `<textarea id="lo-address" rows="2">${escapeHtml(a.address || '')}</textarea>`)}
    <div class="cap-actions">${field('Phone', `<input id="lo-phone" value="${escapeHtml(a.phone || '')}">`)}${field('Opening times', `<input id="lo-open" value="${escapeHtml(a.openingTimes || '')}">`)}</div>
    ${field('Map link', `<input id="lo-map" value="${escapeHtml(a.mapUrl || '')}" placeholder="https://maps.google.com/...">`)}
    ${field('Notes', `<textarea id="lo-notes" rows="2">${escapeHtml(a.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem">
      <button class="btn" id="lo-save">${isEdit ? 'Save' : 'Add'}</button>
      <button class="btn btn-secondary" id="lo-cancel">Cancel</button>
      ${isEdit ? '<button class="btn btn-secondary" id="lo-delete" style="margin-left:auto">Delete</button>' : ''}
    </div>`);
  m.querySelector('#lo-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#lo-save').addEventListener('click', async () => {
    const g = id => document.getElementById(id).value;
    const payload = { type: g('lo-type'), name: g('lo-name').trim(), address: g('lo-address').trim(), phone: g('lo-phone').trim(), openingTimes: g('lo-open').trim(), mapUrl: g('lo-map').trim(), notes: g('lo-notes').trim(), visibility: g('lo-vis') };
    if (!payload.name) { document.getElementById('lo-msg').innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try {
      if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/locations/${loc.id}`, payload);
      else await Api.post(`/api/events/${window.HUB_ID}/locations`, payload);
      m.remove(); loadHub();
    } catch (e) { document.getElementById('lo-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('lo-delete');
  if (del) del.addEventListener('click', async () => {
    try { await Api.delete(`/api/events/${window.HUB_ID}/locations/${loc.id}`); m.remove(); loadHub(); }
    catch (e) { document.getElementById('lo-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// ── Camp adult rota (FR-CAMP-OP-018..021) ───────────────────────────────────────
function rotaLeader() {
  const r = HUB.rota; if (!r) return '';
  const adults = r.adults || [], entries = r.entries || [];
  const adultChips = adults.length ? adults.map(a => `<button class="btn btn-secondary btn-sm rota-adult-edit" data-id="${a.id}">${escapeHtml(a.name)}${a.isDriver ? ' 🚗' : ''}${a.isFirstAider ? ' ➕' : ''}</button>`).join(' ') : '<span class="muted">No adults added yet.</span>';

  // Group entries by day, then session.
  const byDay = {};
  for (const e of entries) (byDay[e.dayLabel] ||= []).push(e);
  const daysHtml = Object.keys(byDay).length ? Object.entries(byDay).map(([day, es]) => `
    <h3 style="margin:.8rem 0 .3rem">${escapeHtml(day)}</h3>
    <table class="data-table rcards"><thead><tr><th>Session</th><th>Role</th><th>Adult</th><th>Activity</th><th></th></tr></thead>
    <tbody>${es.sort((a, b) => a.session.localeCompare(b.session)).map(e => `<tr${e.gap ? ' style="box-shadow:inset 3px 0 0 #c62828"' : ''}>
        <td data-label="Session">${escapeHtml(e.sessionLabel)}</td>
        <td data-label="Role" class="rcard-title">${escapeHtml(e.roleLabel)}</td>
        <td data-label="Adult">${e.adultName ? escapeHtml(e.adultName) : `<span class="badge" data-status="deleted">${escapeHtml(e.gap || 'Gap')}</span>`}${(e.gap && e.adultName) ? ` <span class="badge" data-status="suspended">${escapeHtml(e.gap)}</span>` : ''}</td>
        <td data-label="Activity" class="muted">${escapeHtml(e.activity || '—')}</td>
        <td class="rcard-actions"><button class="btn btn-secondary btn-sm rota-entry-edit" data-id="${e.id}">Edit</button></td>
      </tr>`).join('')}</tbody></table>`).join('') : '<p class="muted">No rota entries yet. Add the adult team, then add entries per day/session.</p>';

  return `
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Adult rota</h2>
        <span>${r.gaps > 0 ? `<span class="badge" data-status="deleted">${r.gaps} gap${r.gaps === 1 ? '' : 's'}</span>` : `<span class="badge" data-status="active">No gaps</span>`}</span></div>
      <p class="muted">Assign the adult team to day/session roles. A role with no adult (or a driver/first-aid role filled by someone not qualified) is flagged as a gap. Leader-only.</p>
      <div style="margin:.4rem 0 .8rem"><strong>Adult team</strong> <button class="btn btn-sm" id="rota-adult-add" style="margin-left:.4rem">Add adult</button>
        <div style="margin-top:.4rem;display:flex;gap:.3rem;flex-wrap:wrap">${adultChips}</div>
        <p class="field help">🚗 driver · ➕ first aider &middot; tap a name to edit.</p></div>
      <div class="cap-head" style="margin-bottom:.3rem"><strong>Rota</strong><button class="btn btn-sm" id="rota-entry-add">Add entry</button></div>
      ${daysHtml}
    </div>`;
}

// ── Offline camp pack (FR-CAMP-OP-031..033): one printable operational leader pack
// assembled from everything already loaded on the hub - to take to camp where there
// is no signal. Leader-only; reuses the loaded HUB data, no extra fetch.
function printCampPack() {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const sec = (title, html) => html ? `<section><h2>${title}</h2>${html}</section>` : '';

  const gaps = (HUB.commandCentre || []).filter(a => a.status === 'blocked' || a.status === 'attention');
  const readiness = `<div class="rk">${gaps.length ? `<strong>Still to sort:</strong><ul>${gaps.map(a => `<li><b>${esc(a.label)}</b> &mdash; ${esc(a.summary)}</li>`).join('')}</ul>` : '<strong class="ok">Everything is ready for this event.</strong>'}</div>`;

  const emg = (HUB.locations || []).filter(l => l.isEmergency);
  const emergency = emg.length ? `<table>${emg.map(l => `<tr><td><b>${esc(l.typeLabel)}: ${esc(l.name)}</b>${l.address ? `<br><span class="m">${esc(l.address)}</span>` : ''}${l.openingTimes ? `<br><span class="m">${esc(l.openingTimes)}</span>` : ''}</td><td class="ph">${l.phone ? esc(l.phone) : ''}</td></tr>`).join('')}</table>` : '<p class="m">No emergency contacts recorded.</p>';

  const locs = HUB.locations || [];
  const locations = locs.length ? `<table>${locs.map(l => `<tr><td><b>${esc(l.name)}</b> <span class="m">(${esc(l.typeLabel)})</span>${l.address ? `<br><span class="m">${esc(l.address)}</span>` : ''}${l.openingTimes ? `<br><span class="m">${esc(l.openingTimes)}</span>` : ''}</td><td class="ph">${l.phone ? esc(l.phone) : ''}</td></tr>`).join('')}</table>` : '';

  let rota = '';
  const adults = HUB.rota && (HUB.rota.adults || []).length ? `<p><b>Adult team:</b> ${HUB.rota.adults.map(a => esc(a.name) + (a.isDriver ? ' (driver)' : '') + (a.isFirstAider ? ' (first aid)' : '')).join(', ')}</p>` : '';
  if (HUB.rota && (HUB.rota.entries || []).length) {
    const byDay = {}; for (const e of HUB.rota.entries) (byDay[e.dayLabel] ||= []).push(e);
    rota = Object.entries(byDay).map(([day, es]) => `<h3>${esc(day)}</h3><table>${es.map(e => `<tr><td>${esc(e.sessionLabel)}</td><td><b>${esc(e.roleLabel)}</b></td><td>${e.adultName ? esc(e.adultName) : '<span class="g">&mdash; gap &mdash;</span>'}</td><td class="m">${esc(e.activity || '')}</td></tr>`).join('')}</table>`).join('');
  }

  let programme = '';
  if (HUB.programme && (HUB.programme.slots || []).length) {
    const byDayP = {}; for (const s of HUB.programme.slots) (byDayP[s.dayLabel] ||= []).push(s);
    programme = Object.entries(byDayP).map(([day, ss]) => `<h3>${esc(day)}</h3><table>${ss.slice().sort((a, b) => a.session.localeCompare(b.session)).map(s => `<tr><td>${esc(s.sessionLabel)}</td><td><b>${esc(s.activity)}</b></td><td>${esc(s.group || '')}</td><td class="m">${esc([s.location, s.lead].filter(Boolean).join(' · '))}</td></tr>`).join('')}</table>`).join('');
  }

  let transport = '';
  if (HUB.transport && (HUB.transport.vehicles || []).length) {
    transport = HUB.transport.vehicles.map(v => `<h3>${esc(v.name)} <span class="m">${esc(v.vehicleTypeLabel)}${v.capacity != null ? ` &middot; ${v.assigned}/${v.capacity}` : ''}</span></h3><p class="m">Driver: ${v.driverName ? esc(v.driverName) : '&mdash;'}${v.departAt ? ' &middot; departs ' + esc(v.departAt) : ''}</p><ol>${(v.passengers || []).map(p => `<li>${esc(p.name)}</li>`).join('') || '<li class="m">No passengers listed</li>'}</ol>`).join('');
  }

  const items = (HUB.items || []).length ? `<table>${HUB.items.map(i => `<tr><td><b>${esc(i.label)}</b></td><td class="m">${esc(i.itemStatusLabel)} &middot; ${esc(i.visibilityLabel)}</td></tr>`).join('')}</table>` : '';

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Camp pack &mdash; ${esc(HUB.title)}</title><style>
    *{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:760px;margin:0 auto;padding:24px 30px;color:#1a1420;line-height:1.5}
    h1{font-size:1.5rem;margin:0}.sub{color:#555;margin:.2rem 0 1rem}
    section{margin-top:1.1rem;page-break-inside:avoid}
    h2{font-size:1.1rem;border-bottom:2px solid #6d28d9;padding-bottom:.2rem;margin:0 0 .4rem;color:#4c1d95}
    h3{font-size:.98rem;margin:.7rem 0 .15rem}
    table{width:100%;border-collapse:collapse;font-size:.92rem}td{padding:.28rem .4rem .28rem 0;border-bottom:1px solid #eee;vertical-align:top}td.ph{text-align:right;font-weight:700;white-space:nowrap}
    ol{margin:.15rem 0 .15rem 1.2rem}li{margin:.12rem 0}.m{color:#666}.g{color:#b3261e;font-weight:600}.ok{color:#0a5f49}
    .rk{background:#f8f4ff;border:1px solid #e3ddf0;border-radius:8px;padding:.7rem .9rem;margin:.6rem 0}.rk ul{margin:.3rem 0 0 1.1rem}
    .emg h2{color:#b3261e;border-color:#b3261e}
    .bar{display:flex;justify-content:flex-end;margin-bottom:1rem}.bar button{font:inherit;padding:.5rem 1rem;border:0;border-radius:999px;background:#6d28d9;color:#fff;cursor:pointer}@media print{.bar{display:none}}
  </style></head><body>
    <div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
    <h1>${esc(HUB.title)} &mdash; camp pack</h1>
    <p class="sub">${esc(HUB.eventTypeLabel)} &middot; ${esc(hubDates())}${HUB.location ? ' &middot; ' + esc(HUB.location) : ''}${HUB.sectionName ? ' &middot; ' + esc(HUB.sectionName) : ''} &middot; leader-only &middot; generated ${new Date().toLocaleString('en-GB')}</p>
    ${readiness}
    <section class="emg"><h2>Emergency directory</h2>${emergency}</section>
    ${sec('Key information', HUB.keyInformation ? nl2br(HUB.keyInformation) : '')}
    ${sec('What to bring', HUB.whatToBring ? nl2br(HUB.whatToBring) : '')}
    ${sec('Programme highlights', HUB.programmeHighlights ? nl2br(HUB.programmeHighlights) : '')}
    ${sec('Locations', locations)}
    ${sec('Programme', programme)}
    ${sec('Adult rota', adults + rota)}
    ${sec('Transport &amp; manifests', transport)}
    ${sec('Packs &amp; hub items', items)}
    <p class="m" style="margin-top:1.6rem;border-top:1px solid #eee;padding-top:.6rem;font-size:.78rem">7thPortal camp pack. Point-in-time snapshot &mdash; check the portal for the latest before you travel.</p>
    </body></html>`;

  const w = window.open('', '_blank'); if (!w) { alert('Please allow pop-ups to open the camp pack.'); return; }
  w.document.write(html); w.document.close();
}

// ── Programme matrix & activity allocation (FR-CAMP-OP-009..017) ─────────────────
function programmeLeader() {
  const p = HUB.programme; if (!p) return '';
  const slots = p.slots || [];
  const clashBadge = p.clashes > 0 ? `<span class="badge" data-status="deleted">${p.clashes} clash${p.clashes === 1 ? '' : 'es'}</span>` : (slots.length ? '<span class="badge" data-status="active">No clashes</span>' : '');
  const byDay = {};
  for (const s of slots) (byDay[s.dayLabel] ||= []).push(s);
  const daysHtml = Object.keys(byDay).length ? Object.entries(byDay).map(([day, ss]) => `
    <h3 style="margin:.8rem 0 .3rem">${escapeHtml(day)}</h3>
    <table class="data-table rcards"><thead><tr><th>Session</th><th>Activity</th><th>Group</th><th>Where / lead</th><th></th></tr></thead>
    <tbody>${ss.slice().sort((a, b) => a.session.localeCompare(b.session)).map(s => `<tr${s.clash ? ' style="box-shadow:inset 3px 0 0 #c62828"' : ''}>
        <td data-label="Session">${escapeHtml(s.sessionLabel)}</td>
        <td data-label="Activity" class="rcard-title"><strong>${escapeHtml(s.activity)}</strong></td>
        <td data-label="Group">${s.group ? escapeHtml(s.group) : '<span class="muted">&mdash;</span>'}${s.clash ? ' <span class="badge" data-status="deleted">clash</span>' : ''}</td>
        <td data-label="Where / lead" class="muted">${escapeHtml([s.location, s.lead].filter(Boolean).join(' · ')) || '&mdash;'}</td>
        <td class="rcard-actions"><button class="btn btn-secondary btn-sm prog-edit" data-id="${s.id}">Edit</button></td>
      </tr>`).join('')}</tbody></table>`).join('') : '<p class="muted">No activities scheduled yet. Add activities per day/session and allocate a group.</p>';
  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">Programme</h2><span class="cap-actions">${clashBadge}<button class="btn btn-sm" id="prog-add">Add activity</button><button class="btn btn-secondary btn-sm" id="prog-import">Import</button></span></div>
    <p class="muted">Schedule activities by day and session, and allocate a group (patrol, team or section). A group double-booked in the same session is flagged as a clash. Leader-only.</p>
    ${daysHtml}
  </div>`;
}

function openProgrammeSlotForm(s) {
  const isEdit = !!s; const x = s || { session: 'am' };
  const sessOpts = Object.entries((HUB.programme.meta || {}).sessions || { am: 'Morning' }).map(([k, l]) => `<option value="${k}"${k === (x.session || 'am') ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const m = modal(`<h2>${isEdit ? 'Edit activity' : 'Add activity'}</h2><div id="pg-msg"></div>
    <div class="cap-actions">${field('Day', `<input id="pg-day" value="${escapeHtml(x.dayLabel || '')}" placeholder="e.g. Saturday">`)}${field('Session', `<select id="pg-session">${sessOpts}</select>`)}</div>
    ${field('Activity', `<input id="pg-activity" value="${escapeHtml(x.activity || '')}" placeholder="e.g. Climbing">`)}
    <div class="cap-actions">${field('Group (optional)', `<input id="pg-group" value="${escapeHtml(x.group || '')}" placeholder="e.g. Kestrel Patrol, All">`)}${field('Location (optional)', `<input id="pg-location" value="${escapeHtml(x.location || '')}">`)}</div>
    ${field('Lead (optional)', `<input id="pg-lead" value="${escapeHtml(x.lead || '')}">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="pg-save">${isEdit ? 'Save' : 'Add'}</button><button class="btn btn-secondary" id="pg-cancel">Cancel</button>${isEdit ? '<button class="btn btn-secondary" id="pg-delete" style="margin-left:auto">Delete</button>' : ''}</div>`);
  m.querySelector('#pg-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#pg-save').addEventListener('click', async () => {
    const payload = {
      dayLabel: document.getElementById('pg-day').value.trim(), session: document.getElementById('pg-session').value,
      activity: document.getElementById('pg-activity').value.trim(), group: document.getElementById('pg-group').value.trim(),
      location: document.getElementById('pg-location').value.trim(), lead: document.getElementById('pg-lead').value.trim(),
    };
    if (!payload.dayLabel || !payload.activity) { document.getElementById('pg-msg').innerHTML = '<div class="alert alert-error">A day and activity are required.</div>'; return; }
    try { if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/programme/${s.id}`, payload); else await Api.post(`/api/events/${window.HUB_ID}/programme`, payload); m.remove(); loadHub(); }
    catch (e) { document.getElementById('pg-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('pg-delete');
  if (del) del.addEventListener('click', async () => {
    try { await Api.delete(`/api/events/${window.HUB_ID}/programme/${s.id}`); m.remove(); loadHub(); }
    catch (e) { document.getElementById('pg-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

function openProgrammeImport() {
  const m = modal(`<h2>Import programme</h2><div id="pi-msg"></div>
    <p class="muted" style="margin:0 0 .5rem">Paste rows from a spreadsheet (keep the header row). Columns: <strong>Day, Session, Activity, Group, Location, Lead</strong> &mdash; only Day and Activity are required.</p>
    <textarea id="pi-csv" rows="7" placeholder="Day,Session,Activity,Group,Location,Lead&#10;Saturday,Morning,Climbing,Kestrels,Crag,Rob&#10;Saturday,Afternoon,Canoeing,Otters,Lake,Sam" style="width:100%;font-family:monospace;font-size:.85rem"></textarea>
    <div id="pi-preview"></div>
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn btn-secondary" id="pi-preview-btn">Preview</button><button class="btn" id="pi-import" disabled>Import</button><button class="btn btn-secondary" id="pi-cancel" style="margin-left:auto">Cancel</button></div>`);
  m.querySelector('#pi-cancel').addEventListener('click', () => m.remove());
  const csv = () => document.getElementById('pi-csv').value;
  document.getElementById('pi-preview-btn').addEventListener('click', async () => {
    try {
      const r = await Api.post(`/api/events/${window.HUB_ID}/programme/import`, { csv: csv(), dryRun: true });
      const rows = (r.preview || []).map(p => `<tr><td>${escapeHtml(p.day)}</td><td>${escapeHtml(p.session)}</td><td>${escapeHtml(p.activity)}</td><td>${escapeHtml(p.group || '')}</td></tr>`).join('');
      document.getElementById('pi-preview').innerHTML = `<p class="muted" style="margin:.6rem 0 .2rem">${r.readyCount} to import${r.errors.length ? `, ${r.errors.length} skipped` : ''}.</p>${rows ? `<table class="data-table"><thead><tr><th>Day</th><th>Session</th><th>Activity</th><th>Group</th></tr></thead><tbody>${rows}</tbody></table>` : ''}`;
      document.getElementById('pi-import').disabled = r.readyCount === 0;
      document.getElementById('pi-msg').innerHTML = '';
    } catch (e) { document.getElementById('pi-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  document.getElementById('pi-import').addEventListener('click', async () => {
    try { await Api.post(`/api/events/${window.HUB_ID}/programme/import`, { csv: csv() }); m.remove(); loadHub(); }
    catch (e) { document.getElementById('pi-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// ── Plan version history & acknowledgements (FRD-CAMP-010) ───────────────────────
// A short local datetime for stored UTC "YYYY-MM-DD HH:MM:SS" timestamps.
function fmtStamp(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? escapeHtml(s) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function versionsLeader() {
  const v = HUB.versions; if (!v) return '';
  const list = v.versions || [];
  const rows = list.map((ver, i) => {
    const snap = ver.snapshot || {};
    const facts = [];
    if (snap.programme) facts.push(`${snap.programme.activities} activit${snap.programme.activities === 1 ? 'y' : 'ies'}${snap.programme.clashes ? `, ${snap.programme.clashes} clash${snap.programme.clashes === 1 ? '' : 'es'}` : ''}`);
    if (snap.transport && snap.transport.vehicles) facts.push(`${snap.transport.vehicles} vehicle${snap.transport.vehicles === 1 ? '' : 's'}, ${snap.transport.passengers} passenger${snap.transport.passengers === 1 ? '' : 's'}`);
    if (snap.rota && snap.rota.adults) facts.push(`${snap.rota.adults} adult${snap.rota.adults === 1 ? '' : 's'}${snap.rota.gaps ? `, ${snap.rota.gaps} rota gap${snap.rota.gaps === 1 ? '' : 's'}` : ''}`);
    if (snap.readiness) facts.push(`readiness: ${escapeHtml(snap.readiness)}`);
    const ackList = ver.ackCount
      ? `<span class="badge" data-status="active">${ver.ackCount} acknowledged</span> <span class="muted" style="font-size:.82rem">${ver.acks.map(a => escapeHtml(a.userName)).join(', ')}</span>`
      : '<span class="muted" style="font-size:.82rem">No acknowledgements yet</span>';
    const ackBtn = ver.acknowledgedByMe
      ? `<span class="badge" data-status="active" title="You acknowledged on ${escapeHtml(fmtStamp(ver.acknowledgedByMe))}">You&rsquo;ve read this</span>`
      : `<button class="btn btn-sm ver-ack" data-id="${ver.id}">I&rsquo;ve read this</button>`;
    return `<div class="card" style="margin:0 0 .6rem">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;flex-wrap:wrap">
        <div><strong>v${ver.versionNo}${ver.label ? ' &middot; ' + escapeHtml(ver.label) : ''}</strong>${i === 0 ? ' <span class="badge" data-status="published">Latest</span>' : ''}
          <div class="muted" style="font-size:.82rem">${escapeHtml(ver.createdByName)} &middot; ${fmtStamp(ver.createdAt)}</div></div>
        <div style="display:flex;gap:.4rem;align-items:center">${ackBtn}${HUB.canManage ? `<button class="btn btn-secondary btn-sm ver-delete" data-id="${ver.id}" data-no="${ver.versionNo}">Delete</button>` : ''}</div>
      </div>
      ${ver.summary ? `<p style="margin:.5rem 0 .2rem">${escapeHtml(ver.summary)}</p>` : ''}
      ${facts.length ? `<div class="muted" style="font-size:.82rem">${facts.join(' &middot; ')}</div>` : ''}
      <div style="margin-top:.4rem">${ackList}</div>
    </div>`;
  }).join('');
  const banner = v.latestNeedsMyAck && list.length
    ? '<div class="alert" style="margin:0 0 .6rem">There&rsquo;s a plan version you haven&rsquo;t acknowledged yet.</div>' : '';
  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">Plan versions</h2><span class="cap-actions">${HUB.canManage ? '<button class="btn btn-sm" id="ver-capture">Capture version</button>' : ''}</span></div>
    <p class="muted">Freeze the plan as a numbered version with a note on what changed, so leaders can see the history and confirm they&rsquo;ve read the current one. Leader-only.</p>
    ${banner}
    ${list.length ? rows : '<p class="muted">No versions captured yet. Capture one once the plan is worth sharing.</p>'}
  </div>`;
}

function openVersionCapture() {
  const m = modal(`<h2>Capture plan version</h2><div id="vc-msg"></div>
    <p class="muted" style="margin:0 0 .5rem">This freezes a snapshot of the current plan (programme, transport, rota and readiness counts) as version ${(HUB.versions.total || 0) + 1}.</p>
    ${field('Label (optional)', `<input id="vc-label" placeholder="e.g. Final pre-camp plan" maxlength="120">`)}
    ${field('What changed', `<textarea id="vc-summary" rows="3" placeholder="e.g. Added Sunday programme, confirmed minibus drivers"></textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="vc-save">Capture</button><button class="btn btn-secondary" id="vc-cancel">Cancel</button></div>`);
  m.querySelector('#vc-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#vc-save').addEventListener('click', async () => {
    const summary = document.getElementById('vc-summary').value.trim();
    if (!summary) { document.getElementById('vc-msg').innerHTML = '<div class="alert alert-error">Add a short note on what changed.</div>'; return; }
    try { await Api.post(`/api/events/${window.HUB_ID}/versions`, { label: document.getElementById('vc-label').value.trim(), summary }); m.remove(); loadHub(); }
    catch (e) { document.getElementById('vc-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}
async function ackVersion(id) {
  try { await Api.post(`/api/events/${window.HUB_ID}/versions/${id}/ack`, {}); loadHub(); } catch (e) { alert(e.message); }
}
async function deleteVersion(id, no) {
  if (!confirm(`Delete version ${no}? This removes the snapshot and its acknowledgements.`)) return;
  try { await Api.delete(`/api/events/${window.HUB_ID}/versions/${id}`); loadHub(); } catch (e) { alert(e.message); }
}

// ── Catering / meal plan (Command Centre catering) ──────────────────────────────
function cateringLeader() {
  const c = HUB.catering; if (!c) return '';
  const meals = c.meals || [];
  const pill = c.total === 0 ? '' : (c.unplanned > 0
    ? `<span class="badge" data-status="suspended">${c.unplanned} to plan</span>`
    : '<span class="badge" data-status="active">All planned</span>');
  const mealOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, other: 4 };
  const byDay = {};
  for (const m of meals) (byDay[m.dayLabel] ||= []).push(m);
  const daysHtml = Object.keys(byDay).length ? Object.entries(byDay).map(([day, ms]) => `
    <h3 style="margin:.8rem 0 .3rem">${escapeHtml(day)}</h3>
    <table class="data-table rcards"><thead><tr><th>Meal</th><th>Dish</th><th>Cook / heads</th><th>Status</th><th></th></tr></thead>
    <tbody>${ms.slice().sort((a, b) => (mealOrder[a.meal] ?? 9) - (mealOrder[b.meal] ?? 9)).map(m => `<tr>
        <td data-label="Meal">${escapeHtml(m.mealLabel)}</td>
        <td data-label="Dish" class="rcard-title">${m.dish ? `<strong>${escapeHtml(m.dish)}</strong>` : '<span class="badge" data-status="suspended">To plan</span>'}${m.dietaryNotes ? `<div class="muted" style="font-size:.82rem">Dietary: ${escapeHtml(m.dietaryNotes)}</div>` : ''}</td>
        <td data-label="Cook / heads" class="muted">${escapeHtml([m.cook, m.headcount != null ? m.headcount + ' heads' : ''].filter(Boolean).join(' · ')) || '&mdash;'}</td>
        <td data-label="Status"><span class="badge" data-status="${m.status === 'prepped' ? 'active' : (m.status === 'shopping_done' ? 'published' : 'draft')}">${escapeHtml(m.statusLabel)}</span></td>
        <td class="rcard-actions"><button class="btn btn-secondary btn-sm catering-edit" data-id="${m.id}">Edit</button></td>
      </tr>`).join('')}</tbody></table>`).join('') : '<p class="muted">No meals planned yet. Add each meal per day, with a dish and who’s cooking.</p>';
  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">Catering</h2><span class="cap-actions">${pill}<button class="btn btn-sm" id="catering-add">Add meal</button></span></div>
    <p class="muted">Plan meals by day, with a dish, a cook, a headcount and a prep status. Dietary notes here are a catering aid, not a medical record. Leader-only.</p>
    ${daysHtml}
  </div>`;
}

function openCateringMealForm(m) {
  const isEdit = !!m; const x = m || { meal: 'breakfast', status: 'planned' };
  const meta = HUB.catering.meta || {};
  const opt = (map, v) => Object.entries(map || {}).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const mo = modal(`<h2>${isEdit ? 'Edit meal' : 'Add meal'}</h2><div id="cm-msg"></div>
    <div class="cap-actions">${field('Day', `<input id="cm-day" value="${escapeHtml(x.dayLabel || '')}" placeholder="e.g. Saturday">`)}${field('Meal', `<select id="cm-meal">${opt(meta.meals, x.meal || 'breakfast')}</select>`)}</div>
    ${field('Dish', `<input id="cm-dish" value="${escapeHtml(x.dish || '')}" placeholder="e.g. Sausage & mash">`)}
    <div class="cap-actions">${field('Cook (optional)', `<input id="cm-cook" value="${escapeHtml(x.cook || '')}">`)}${field('Headcount (optional)', `<input id="cm-heads" type="number" min="0" value="${x.headcount != null ? x.headcount : ''}" style="width:110px">`)}${field('Status', `<select id="cm-status">${opt(meta.statuses, x.status || 'planned')}</select>`)}</div>
    ${field('Dietary notes (optional)', `<input id="cm-dietary" value="${escapeHtml(x.dietaryNotes || '')}" placeholder="e.g. 3 vegetarian, 1 gluten-free">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="cm-save">${isEdit ? 'Save' : 'Add'}</button><button class="btn btn-secondary" id="cm-cancel">Cancel</button>${isEdit ? '<button class="btn btn-secondary" id="cm-delete" style="margin-left:auto">Delete</button>' : ''}</div>`);
  mo.querySelector('#cm-cancel').addEventListener('click', () => mo.remove());
  mo.querySelector('#cm-save').addEventListener('click', async () => {
    const payload = {
      dayLabel: document.getElementById('cm-day').value.trim(), meal: document.getElementById('cm-meal').value,
      dish: document.getElementById('cm-dish').value.trim(), cook: document.getElementById('cm-cook').value.trim(),
      headcount: document.getElementById('cm-heads').value, status: document.getElementById('cm-status').value,
      dietaryNotes: document.getElementById('cm-dietary').value.trim(),
    };
    if (!payload.dayLabel) { document.getElementById('cm-msg').innerHTML = '<div class="alert alert-error">A day is required.</div>'; return; }
    try { if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/catering/${m.id}`, payload); else await Api.post(`/api/events/${window.HUB_ID}/catering`, payload); mo.remove(); loadHub(); }
    catch (e) { document.getElementById('cm-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('cm-delete');
  if (del) del.addEventListener('click', async () => {
    try { await Api.delete(`/api/events/${window.HUB_ID}/catering/${m.id}`); mo.remove(); loadHub(); }
    catch (e) { document.getElementById('cm-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

// ── Transport & manifests (FR-CAMP-OP-023..028) ─────────────────────────────────
function transportLeader() {
  const t = HUB.transport; if (!t) return '';
  const vehicles = t.vehicles || [];
  const issuesBadge = t.issues > 0
    ? `<span class="badge" data-status="suspended">${t.issues} to check</span>`
    : (vehicles.length ? '<span class="badge" data-status="active">All set</span>' : '');
  const vehHtml = vehicles.length ? vehicles.map(v => {
    const cap = v.capacity != null
      ? `<span class="badge" data-status="${v.overCapacity ? 'deleted' : 'active'}">${v.assigned}/${v.capacity} seats${v.overCapacity ? ' — over' : ''}</span>`
      : `<span class="muted">${v.assigned} aboard</span>`;
    const driver = v.driverName ? escapeHtml(v.driverName) : '<span class="badge" data-status="suspended">No driver</span>';
    const pax = (v.passengers || []).map(p => `<li style="margin:.15rem 0">${escapeHtml(p.name)}${p.notes ? ` <span class="muted">&middot; ${escapeHtml(p.notes)}</span>` : ''} <button class="tr-pax-remove" data-pid="${p.id}" title="Remove" style="border:0;background:none;cursor:pointer;color:var(--muted);font-size:.9rem">&times;</button></li>`).join('');
    return `<div class="card" style="margin:.6rem 0 0">
      <div class="cap-head"><div><strong>${escapeHtml(v.name)}</strong> <span class="muted">&middot; ${escapeHtml(v.vehicleTypeLabel)}</span></div>
        <button class="btn btn-secondary btn-sm tr-vehicle-edit" data-id="${v.id}">Edit</button></div>
      <div class="muted" style="margin:.2rem 0 .4rem;font-size:.9rem">Driver: ${driver} &middot; ${cap}${v.departAt ? ' &middot; departs ' + escapeHtml(v.departAt) : ''}</div>
      <ul style="margin:.2rem 0;padding-left:1.1rem">${pax || '<li class="muted">No passengers yet.</li>'}</ul>
      <div class="inline-form" style="margin-top:.3rem"><input id="tr-pax-input-${v.id}" placeholder="Add passenger name"><button class="btn btn-sm tr-pax-add" data-vid="${v.id}">Add</button></div>
    </div>`;
  }).join('') : '<p class="muted">No vehicles yet. Add minibuses and cars, then list who travels in each.</p>';

  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">Transport &amp; manifests</h2><span class="cap-actions">${issuesBadge}<button class="btn btn-sm" id="tr-vehicle-add">Add vehicle</button>${vehicles.length ? '<button class="btn btn-secondary btn-sm" id="tr-print">Print manifests</button>' : ''}</span></div>
    <p class="muted">Minibuses and cars with a driver and seats, plus who travels in each. Leader-only &mdash; a manifest is a safety record for emergencies.</p>
    ${vehHtml}
  </div>`;
}

function openVehicleForm(v) {
  const isEdit = !!v; const x = v || { vehicleType: 'car' };
  const typeOpts = Object.entries((HUB.transport.meta || {}).types || { car: 'Car' }).map(([k, l]) => `<option value="${k}"${k === (x.vehicleType || 'car') ? ' selected' : ''}>${escapeHtml(l)}</option>`).join('');
  const m = modal(`<h2>${isEdit ? 'Edit vehicle' : 'Add vehicle'}</h2><div id="tv-msg"></div>
    ${field('Name', `<input id="tv-name" value="${escapeHtml(x.name || '')}" placeholder="e.g. Minibus A, Rob's car">`)}
    <div class="cap-actions">
      ${field('Type', `<select id="tv-type">${typeOpts}</select>`)}
      ${field('Seats (passengers)', `<input id="tv-cap" type="number" min="0" value="${x.capacity ?? ''}" style="width:120px">`)}
    </div>
    ${field('Driver', `<input id="tv-driver" value="${escapeHtml(x.driverName || '')}">`)}
    ${field('Departs (optional)', `<input id="tv-depart" value="${escapeHtml(x.departAt || '')}" placeholder="e.g. Sat 9am from the hut">`)}
    ${field('Notes (optional)', `<textarea id="tv-notes" rows="2">${escapeHtml(x.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="tv-save">${isEdit ? 'Save' : 'Add'}</button><button class="btn btn-secondary" id="tv-cancel">Cancel</button>${isEdit ? '<button class="btn btn-secondary" id="tv-delete" style="margin-left:auto">Delete</button>' : ''}</div>`);
  m.querySelector('#tv-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#tv-save').addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('tv-name').value.trim(), vehicleType: document.getElementById('tv-type').value,
      capacity: document.getElementById('tv-cap').value, driverName: document.getElementById('tv-driver').value.trim(),
      departAt: document.getElementById('tv-depart').value.trim(), notes: document.getElementById('tv-notes').value.trim(),
    };
    if (!payload.name) { document.getElementById('tv-msg').innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try { if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/transport/vehicles/${v.id}`, payload); else await Api.post(`/api/events/${window.HUB_ID}/transport/vehicles`, payload); m.remove(); loadHub(); }
    catch (e) { document.getElementById('tv-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('tv-delete');
  if (del) del.addEventListener('click', async () => {
    try { await Api.delete(`/api/events/${window.HUB_ID}/transport/vehicles/${v.id}`); m.remove(); loadHub(); }
    catch (e) { document.getElementById('tv-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
}

function printManifests() {
  const t = HUB.transport; if (!t) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const body = (t.vehicles || []).map(v => `<h2>${esc(v.name)} <span class="t">${esc(v.vehicleTypeLabel)}${v.capacity != null ? ` &middot; ${v.assigned}/${v.capacity} seats` : ''}</span></h2>
    <p class="d">Driver: ${v.driverName ? esc(v.driverName) : '&mdash;'}${v.departAt ? ' &middot; departs ' + esc(v.departAt) : ''}</p>
    <ol>${(v.passengers || []).map(p => `<li>${esc(p.name)}${p.notes ? ' &mdash; ' + esc(p.notes) : ''}</li>`).join('') || '<li class="m">No passengers listed</li>'}</ol>`).join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Transport manifest &mdash; ${esc(HUB.title)}</title><style>
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:720px;margin:0 auto;padding:24px;color:#1a1420;line-height:1.5}
    h1{font-size:1.4rem;margin:0}.sub{color:#555;margin:.2rem 0 1rem}
    h2{font-size:1.05rem;margin:1.2rem 0 .1rem;border-bottom:2px solid #6d28d9;padding-bottom:.15rem;color:#4c1d95}h2 .t{font-weight:400;font-size:.85rem;color:#666}
    .d{color:#555;margin:.1rem 0 .3rem;font-size:.9rem}ol{margin:.2rem 0}li{margin:.15rem 0}.m{color:#999;list-style:none}
    .bar{display:flex;justify-content:flex-end;margin-bottom:1rem}.bar button{font:inherit;padding:.5rem 1rem;border:0;border-radius:999px;background:#6d28d9;color:#fff;cursor:pointer}@media print{.bar{display:none}}
  </style></head><body><div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
    <h1>Transport manifest</h1><p class="sub">${esc(HUB.title)} &middot; generated ${new Date().toLocaleString('en-GB')} &middot; leader-only</p>${body || '<p>No vehicles yet.</p>'}</body></html>`;
  const w = window.open('', '_blank'); if (!w) { alert('Please allow pop-ups to open the manifest.'); return; }
  w.document.write(html); w.document.close();
}

function openAdultForm(a) {
  const isEdit = !!a; const x = a || { isDriver: false, isFirstAider: false };
  const m = modal(`<h2>${isEdit ? 'Edit adult' : 'Add adult'}</h2><div id="ra-msg"></div>
    ${field('Name', `<input id="ra-name" value="${escapeHtml(x.name || '')}">`)}
    <div class="field"><label style="font-weight:400"><input type="checkbox" id="ra-driver" ${x.isDriver ? 'checked' : ''}> Authorised driver</label></div>
    <div class="field"><label style="font-weight:400"><input type="checkbox" id="ra-firstaid" ${x.isFirstAider ? 'checked' : ''}> First aider</label></div>
    ${field('Permits / skills (leader-only)', `<textarea id="ra-skills" rows="2">${escapeHtml(x.skills || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="ra-save">${isEdit ? 'Save' : 'Add'}</button><button class="btn btn-secondary" id="ra-cancel">Cancel</button>${isEdit ? '<button class="btn btn-secondary" id="ra-delete" style="margin-left:auto">Delete</button>' : ''}</div>`);
  m.querySelector('#ra-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#ra-save').addEventListener('click', async () => {
    const payload = { name: document.getElementById('ra-name').value.trim(), isDriver: document.getElementById('ra-driver').checked, isFirstAider: document.getElementById('ra-firstaid').checked, skills: document.getElementById('ra-skills').value.trim() };
    if (!payload.name) { document.getElementById('ra-msg').innerHTML = '<div class="alert alert-error">A name is required.</div>'; return; }
    try { if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/rota/adults/${a.id}`, payload); else await Api.post(`/api/events/${window.HUB_ID}/rota/adults`, payload); m.remove(); loadHub(); }
    catch (e) { document.getElementById('ra-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; }
  });
  const del = document.getElementById('ra-delete');
  if (del) del.addEventListener('click', async () => { try { await Api.delete(`/api/events/${window.HUB_ID}/rota/adults/${a.id}`); m.remove(); loadHub(); } catch (e) { document.getElementById('ra-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; } });
}

function openRotaEntryForm(e) {
  const isEdit = !!e; const x = e || { session: 'am', role: 'duty_scouter' };
  const meta = HUB.rota.meta;
  const adults = HUB.rota.adults || [];
  const m = modal(`<h2>${isEdit ? 'Edit rota entry' : 'Add rota entry'}</h2><div id="re-msg"></div>
    <div class="cap-actions">${field('Day', `<input id="re-day" value="${escapeHtml(x.dayLabel || '')}" placeholder="e.g. Sat 22 Aug">`)}${field('Session', `<select id="re-session">${selOpts(meta.sessions, x.session)}</select>`)}</div>
    ${field('Role', `<select id="re-role">${selOpts(meta.roles, x.role)}</select>`)}
    ${field('Adult', `<select id="re-adult"><option value="">— unassigned (gap) —</option>${adults.map(a => `<option value="${a.id}"${a.id == x.adultId ? ' selected' : ''}>${escapeHtml(a.name)}${a.isDriver ? ' (driver)' : ''}${a.isFirstAider ? ' (first aid)' : ''}</option>`).join('')}</select>`)}
    ${field('Activity (optional)', `<input id="re-activity" value="${escapeHtml(x.activity || '')}">`)}
    ${field('Notes (optional)', `<textarea id="re-notes" rows="2">${escapeHtml(x.notes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="re-save">${isEdit ? 'Save' : 'Add'}</button><button class="btn btn-secondary" id="re-cancel">Cancel</button>${isEdit ? '<button class="btn btn-secondary" id="re-delete" style="margin-left:auto">Delete</button>' : ''}</div>`);
  m.querySelector('#re-cancel').addEventListener('click', () => m.remove());
  m.querySelector('#re-save').addEventListener('click', async () => {
    const payload = { dayLabel: document.getElementById('re-day').value.trim(), session: document.getElementById('re-session').value, role: document.getElementById('re-role').value, adultId: document.getElementById('re-adult').value || null, activity: document.getElementById('re-activity').value.trim(), notes: document.getElementById('re-notes').value.trim() };
    if (!payload.dayLabel) { document.getElementById('re-msg').innerHTML = '<div class="alert alert-error">A day is required.</div>'; return; }
    try { if (isEdit) await Api.patch(`/api/events/${window.HUB_ID}/rota/entries/${e.id}`, payload); else await Api.post(`/api/events/${window.HUB_ID}/rota/entries`, payload); m.remove(); loadHub(); }
    catch (err) { document.getElementById('re-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  const del = document.getElementById('re-delete');
  if (del) del.addEventListener('click', async () => { try { await Api.delete(`/api/events/${window.HUB_ID}/rota/entries/${e.id}`); m.remove(); loadHub(); } catch (err) { document.getElementById('re-msg').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; } });
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
