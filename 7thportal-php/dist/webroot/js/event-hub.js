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
      <div class="cap-head"><h1 style="margin:0">${escapeHtml(HUB.title)}</h1><span class="cap-actions"><button class="btn btn-secondary" id="ev-edit">Edit details</button>${HUB.canManage ? '<button class="btn btn-secondary ev-delete" id="ev-delete">Delete</button>' : ''}</span></div>
      <p class="muted" style="margin:.3rem 0 0">${escapeHtml(HUB.eventTypeLabel)} &middot; ${escapeHtml(hubDates())}${HUB.location ? ' &middot; ' + escapeHtml(HUB.location) : ''}${HUB.sectionName ? ' &middot; ' + escapeHtml(HUB.sectionName) : ''}</p>
    </div>
    ${infoCards()}
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Hub items</h2><span class="cap-actions"><button class="btn" id="ev-add-item">Add item</button></span></div>
      <p class="muted">Parent packs, kit lists, risk assessments, linked albums and expense accounts. Leader-only items are never shown to parents.</p>
      ${(HUB.items || []).length ? `<table class="data-table"><thead><tr><th>Hub item</th><th>Status</th><th>Visibility</th><th>Owner</th><th></th></tr></thead><tbody>${itemRows}</tbody></table>` : '<p class="muted">No items yet.</p>'}
    </div>
    ${locationsLeader()}
    ${rotaLeader()}`;

  document.getElementById('ev-edit').addEventListener('click', openHubEdit);
  document.getElementById('ev-add-item').addEventListener('click', () => openItemForm(null));
  const locAdd = document.getElementById('loc-add'); if (locAdd) locAdd.addEventListener('click', () => openLocationForm(null));
  box.querySelectorAll('.loc-edit').forEach(b => b.addEventListener('click', () => openLocationForm((HUB.locations || []).find(l => l.id == b.dataset.id))));
  const adultAdd = document.getElementById('rota-adult-add'); if (adultAdd) adultAdd.addEventListener('click', () => openAdultForm(null));
  const entryAdd = document.getElementById('rota-entry-add'); if (entryAdd) entryAdd.addEventListener('click', () => openRotaEntryForm(null));
  box.querySelectorAll('.rota-adult-edit').forEach(b => b.addEventListener('click', () => openAdultForm((HUB.rota.adults || []).find(a => a.id == b.dataset.id))));
  box.querySelectorAll('.rota-entry-edit').forEach(b => b.addEventListener('click', () => openRotaEntryForm((HUB.rota.entries || []).find(e => e.id == b.dataset.id))));
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
