// Quartermaster booking UI (FRD FR-QM). List + detail SPA. No native dialogs
// (prompt/confirm) - all confirms are inline modals so it works under preview too.
let ME = null, CAN_APPROVE = false, META = { statuses: {}, lineStatuses: {} };

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  route();
  window.addEventListener('popstate', route);
})();

function route() {
  const id = new URLSearchParams(location.search).get('id');
  if (id) renderDetail(id);
  else renderList();
}

function go(id) {
  const url = id ? `quartermaster.html?id=${id}` : 'quartermaster.html';
  history.pushState({}, '', url);
  route();
}

// ── Shared UI helpers ──────────────────────────────────────────────────────────
function statusChip(b) {
  const map = { submitted: 'pending_approval', approved: 'active', partially_approved: 'pending_approval', ready_for_collection: 'active', collected: 'active', returned: 'pending_approval', closed: 'archived', cancelled: 'deleted', draft: 'suspended' };
  let label = b.statusLabel;
  let key = map[b.status] || 'pending_approval';
  if (b.derivedState === 'overdue') { label = 'Overdue'; key = 'deleted'; }
  else if (b.derivedState === 'due_back') { label = 'On loan'; key = 'active'; }
  return `<span class="badge" data-status="${key}">${escapeHtml(label)}</span>`;
}

function windowLabel(b) {
  if (!b.collectAt && !b.returnAt) return '<span class="muted">Dates not set</span>';
  return `${b.collectAt ? formatDateTime(b.collectAt) : '?'} &rarr; ${b.returnAt ? formatDateTime(b.returnAt) : '?'}`;
}

function openModal(title, innerHtml) {
  const existing = document.getElementById('qm-modal'); if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'qm-modal'; modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal-box"><h2>${escapeHtml(title)}</h2><div id="qm-modal-msg"></div>${innerHtml}</div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  return modal;
}
function modalError(msg) { const m = document.getElementById('qm-modal-msg'); if (m) m.innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`; }
function closeModal() { const m = document.getElementById('qm-modal'); if (m) m.remove(); }

// ── List view ──────────────────────────────────────────────────────────────────
async function renderList() {
  const box = document.getElementById('content');
  const head = document.getElementById('qm-head-actions');
  head.innerHTML = '';
  const params = new URLSearchParams();
  if (listFilters.status) params.set('status', listFilters.status);
  if (listFilters.scope) params.set('scope', listFilters.scope);

  let data;
  try { data = await Api.get('/api/qm/bookings?' + params.toString()); }
  catch (e) {
    if (e.status === 403) return renderSummaryOnly(box); // trustee/chair
    box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return;
  }
  CAN_APPROVE = data.canApprove; META = data.meta;

  head.innerHTML = `<button class="btn" id="qm-new">New booking</button>`;
  document.getElementById('qm-new').addEventListener('click', createBooking);

  let summaryHtml = '';
  if (CAN_APPROVE) {
    try {
      const s = (await Api.get('/api/qm/summary')).counts;
      summaryHtml = `<div class="cap-stats">
        <div class="card"><div class="muted">Awaiting review</div><div class="cap-big">${s.pendingReview}</div></div>
        <div class="card"><div class="muted">On loan</div><div class="cap-big">${s.onLoan}</div></div>
        <div class="card"><div class="muted">Overdue</div><div class="cap-big">${s.overdue}</div></div>
        <div class="card"><div class="muted">Upcoming (14 days)</div><div class="cap-big">${s.upcoming}</div></div>
      </div>`;
    } catch (e) { /* summary is best-effort */ }
  }

  const scopeToggle = CAN_APPROVE ? `<select id="qm-scope">
      <option value=""${listFilters.scope === '' ? ' selected' : ''}>All requests</option>
      <option value="mine"${listFilters.scope === 'mine' ? ' selected' : ''}>My requests</option>
    </select>` : '';

  box.innerHTML = `${summaryHtml}
    <div class="card">
      <div class="cap-actions" style="margin-bottom:.8rem">
        ${scopeToggle}
        <select id="qm-status">${optionList(META.statuses, listFilters.status, 'All statuses')}</select>
      </div>
      ${data.bookings.length ? `<table class="data-table">
        <thead><tr><th>Ref</th><th>Purpose</th><th>For</th><th>Loan window</th><th>Status</th></tr></thead>
        <tbody>${data.bookings.map(b => `
          <tr class="qm-row clickable" data-id="${b.id}">
            <td><strong>${escapeHtml(b.reference)}</strong></td>
            <td>${escapeHtml(b.purpose || '—')}</td>
            <td class="muted">${escapeHtml(b.eventName || b.sectionName || '—')}</td>
            <td class="muted">${windowLabel(b)}</td>
            <td>${statusChip(b)}</td>
          </tr>`).join('')}</tbody>
      </table>` : '<div class="empty-state">No bookings yet. Create a booking request to get started.</div>'}
    </div>`;

  document.getElementById('qm-status').addEventListener('change', e => { listFilters.status = e.target.value; renderList(); });
  const sc = document.getElementById('qm-scope'); if (sc) sc.addEventListener('change', e => { listFilters.scope = e.target.value; renderList(); });
  document.querySelectorAll('.qm-row').forEach(r => r.addEventListener('click', () => go(r.dataset.id)));
}
const listFilters = { status: '', scope: '' };

function optionList(map, selected, allLabel) {
  return `<option value="">${allLabel}</option>` + Object.entries(map).map(([k, v]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

async function renderSummaryOnly(box) {
  document.getElementById('qm-head-actions').innerHTML = '';
  let s;
  try { s = await Api.get('/api/qm/summary'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  const c = s.counts;
  box.innerHTML = `<p class="muted">Summary reporting only.</p>
    <div class="cap-stats">
      <div class="card"><div class="muted">Awaiting review</div><div class="cap-big">${c.pendingReview}</div></div>
      <div class="card"><div class="muted">On loan</div><div class="cap-big">${c.onLoan}</div></div>
      <div class="card"><div class="muted">Overdue</div><div class="cap-big">${c.overdue}</div></div>
      <div class="card"><div class="muted">Damaged items logged</div><div class="cap-big">${c.damagedItems}</div></div>
    </div>
    <div class="card"><h2>Most-requested items</h2>
      ${s.utilisation.length ? `<table class="data-table"><thead><tr><th>Item</th><th>Bookings</th><th>Units</th></tr></thead>
        <tbody>${s.utilisation.map(u => `<tr><td>${escapeHtml(u.itemName)}</td><td>${u.bookings}</td><td>${u.units}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">No bookings recorded yet.</p>'}
    </div>`;
}

async function createBooking() {
  try {
    const b = await Api.post('/api/qm/bookings', {});
    go(b.id);
  } catch (e) { alert(e.message); }
}

// ── Detail view ─────────────────────────────────────────────────────────────────
async function renderDetail(id) {
  const box = document.getElementById('content');
  document.getElementById('qm-head-actions').innerHTML = `<button class="btn btn-secondary" id="qm-back">Back to list</button>`;
  document.getElementById('qm-back').addEventListener('click', () => go(null));

  let data;
  try { data = await Api.get(`/api/qm/bookings/${id}`); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }
  const b = data.booking, items = data.items;
  CAN_APPROVE = data.canApprove; META = data.meta;
  const isOwner = data.isOwner;
  const reviewing = CAN_APPROVE && ['submitted', 'approved', 'partially_approved'].includes(b.status);

  box.innerHTML = `
    <div class="card">
      <div class="cap-head"><h2 style="margin:0">${escapeHtml(b.reference)}</h2>${statusChip(b)}</div>
      <div id="qm-detail-msg"></div>
      <table class="kv-table" style="margin-top:.6rem">
        <tr><td class="muted">Purpose</td><td>${escapeHtml(b.purpose || '—')}</td></tr>
        <tr><td class="muted">For</td><td>${escapeHtml(b.eventName || b.sectionName || '—')}</td></tr>
        <tr><td class="muted">Loan window</td><td>${windowLabel(b)}</td></tr>
        ${b.collectionDetails ? `<tr><td class="muted">Collection</td><td>${escapeHtml(b.collectionDetails)}</td></tr>` : ''}
        ${b.collectedByName ? `<tr><td class="muted">Collected by</td><td>${escapeHtml(b.collectedByName)} &middot; ${formatDateTime(b.collectedAt)}</td></tr>` : ''}
        ${b.returnedAt ? `<tr><td class="muted">Returned</td><td>${formatDateTime(b.returnedAt)}${b.returnConditionNote ? ' &middot; ' + escapeHtml(b.returnConditionNote) : ''}</td></tr>` : ''}
        ${b.cancelReason ? `<tr><td class="muted">Cancel reason</td><td>${escapeHtml(b.cancelReason)}</td></tr>` : ''}
      </table>
      ${(isOwner && b.status === 'draft') ? `<div class="cap-actions" style="margin-top:.8rem"><button class="btn btn-secondary btn-sm" id="qm-edit-header">Edit request details</button></div>` : ''}
    </div>

    <div class="card">
      <div class="cap-head"><h2 style="margin:0">Items</h2>
        ${(isOwner && b.status === 'draft') ? `<button class="btn btn-sm" id="qm-add-item">Add item</button>` : ''}
      </div>
      ${renderItemsTable(b, items, { editable: isOwner && b.status === 'draft', reviewing })}
    </div>

    <div class="card"><h2>Actions</h2><div class="cap-actions" id="qm-actions"></div></div>`;

  if (isOwner && b.status === 'draft') {
    document.getElementById('qm-edit-header').addEventListener('click', () => editHeader(b));
    document.getElementById('qm-add-item').addEventListener('click', () => addItem(b));
    document.querySelectorAll('.qm-item-edit').forEach(el => el.addEventListener('click', () => editItem(b, items.find(i => i.id == el.dataset.id))));
    document.querySelectorAll('.qm-item-del').forEach(el => el.addEventListener('click', () => removeItem(b, el.dataset.id)));
  }
  if (reviewing) {
    document.querySelectorAll('.qm-decide').forEach(el => el.addEventListener('click', () => decideItem(b, items.find(i => i.id == el.dataset.id), el.dataset.decision)));
  }
  renderActions(b, items, isOwner);
}

function renderItemsTable(b, items, opts) {
  if (!items.length) return '<p class="muted">No items on this request yet.</p>';
  return `<table class="data-table">
    <thead><tr><th>Item</th><th>Requested</th><th>Decision</th>${(b.status !== 'draft') ? '<th>Approved</th>' : ''}${opts.editable ? '<th></th>' : ''}</tr></thead>
    <tbody>${items.map(i => {
      const decided = i.lineStatus !== 'requested';
      const lineKey = { approved: 'active', rejected: 'deleted', substituted: 'pending_approval', more_info: 'suspended', requested: 'archived' }[i.lineStatus] || 'archived';
      return `<tr>
        <td><strong>${escapeHtml(i.itemName)}</strong>${i.substituteName ? ` <span class="muted">&rarr; ${escapeHtml(i.substituteName)}</span>` : ''}${i.restricted ? ` <span class="badge" data-status="suspended">Restricted</span>` : ''}${i.qmNotes ? `<br><span class="muted">${escapeHtml(i.qmNotes)}</span>` : ''}${i.damageNotes ? `<br><span class="badge" data-status="deleted">Damage: ${escapeHtml(i.damageNotes)}</span>` : ''}${i.restricted ? `<br><span class="muted" style="font-size:.82rem">Permit: ${i.permitConfirmed ? '<span class="badge" data-status="active">confirmed</span>' : '<span class="badge" data-status="deleted">not confirmed</span>'}${i.responsibleAdult ? ' · Responsible: ' + escapeHtml(i.responsibleAdult) : ' · <span class="badge" data-status="deleted">no responsible adult</span>'}</span>` : ''}</td>
        <td>${i.requestedQty}</td>
        <td>${decided ? `<span class="badge" data-status="${lineKey}">${escapeHtml(i.lineStatusLabel)}</span>` : '<span class="muted">Pending</span>'}
          ${opts.reviewing ? `<div class="cap-actions" style="margin-top:.4rem;gap:.3rem;flex-wrap:wrap">
            <button class="btn btn-sm qm-decide" data-id="${i.id}" data-decision="approve">Approve</button>
            <button class="btn btn-secondary btn-sm qm-decide" data-id="${i.id}" data-decision="substitute">Substitute</button>
            <button class="btn btn-secondary btn-sm qm-decide" data-id="${i.id}" data-decision="more_info">More info</button>
            <button class="btn btn-secondary btn-sm qm-decide" data-id="${i.id}" data-decision="reject">Reject</button>
          </div>` : ''}
        </td>
        ${(b.status !== 'draft') ? `<td>${i.approvedQty === null ? '&mdash;' : i.approvedQty}</td>` : ''}
        ${opts.editable ? `<td class="cap-actions"><button class="btn btn-secondary btn-sm qm-item-edit" data-id="${i.id}">Edit</button> <button class="btn btn-secondary btn-sm qm-item-del" data-id="${i.id}">Remove</button></td>` : ''}
      </tr>`;
    }).join('')}</tbody></table>`;
}

// ── Action panel (state machine buttons) ────────────────────────────────────────
function renderActions(b, items, isOwner) {
  const box = document.getElementById('qm-actions');
  const btns = [];
  if (isOwner && b.status === 'draft') {
    btns.push(`<button class="btn" id="qm-submit">Submit for review</button>`);
    btns.push(`<button class="btn btn-secondary" id="qm-delete">Delete draft</button>`);
  }
  if (CAN_APPROVE && b.status === 'submitted') btns.push(`<button class="btn" id="qm-finalise">Finalise decision</button>`);
  if (CAN_APPROVE && ['approved', 'partially_approved'].includes(b.status)) btns.push(`<button class="btn" id="qm-ready">Mark ready for collection</button>`);
  if (CAN_APPROVE && ['ready_for_collection', 'approved', 'partially_approved'].includes(b.status)) btns.push(`<button class="btn" id="qm-collect">Record collection</button>`);
  if (CAN_APPROVE && b.status === 'collected') btns.push(`<button class="btn" id="qm-return">Record return</button>`);
  if (CAN_APPROVE && b.status === 'returned') btns.push(`<button class="btn" id="qm-close">Close booking</button>`);
  // Cancel: owner while draft/submitted, QM at any non-terminal point.
  const cancellable = !['closed', 'cancelled'].includes(b.status) && (CAN_APPROVE || (isOwner && ['draft', 'submitted'].includes(b.status)));
  if (cancellable && b.status !== 'draft') btns.push(`<button class="btn btn-secondary" id="qm-cancel">Cancel booking</button>`);

  if (!btns.length) { box.innerHTML = `<span class="muted">No actions available for this booking${['closed', 'cancelled'].includes(b.status) ? ' (' + b.statusLabel.toLowerCase() + ')' : ''}.</span>`; return; }
  box.innerHTML = btns.join(' ');

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('qm-submit', () => act(`/api/qm/bookings/${b.id}/submit`, {}, 'Submitted for review.'));
  on('qm-delete', () => confirmModal('Delete this draft?', 'This cannot be undone.', async () => { await Api.delete(`/api/qm/bookings/${b.id}`); go(null); }));
  on('qm-finalise', () => finalise(b));
  on('qm-ready', () => readyForCollection(b));
  on('qm-collect', () => recordCollection(b));
  on('qm-return', () => recordReturn(b, items));
  on('qm-close', () => act(`/api/qm/bookings/${b.id}/close`, {}, 'Booking closed.'));
  on('qm-cancel', () => cancelBooking(b));
}

async function act(url, body, okMsg) {
  const msg = document.getElementById('qm-detail-msg');
  try { await Api.post(url, body); route(); }
  catch (e) { if (msg) msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; else alert(e.message); }
}

// ── Owner: header + item editing ────────────────────────────────────────────────
async function editHeader(b) {
  let events = [];
  try { events = (await Api.get('/api/events')).events || []; } catch (e) { /* events module may be off */ }
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const toLocal = v => v ? v.replace(' ', 'T').slice(0, 16) : '';
  const modal = openModal('Request details', `
    ${field('Purpose', `<input id="qh-purpose" value="${escapeHtml(b.purpose || '')}" placeholder="e.g. Beavers weekend camp">`)}
    ${field('Section (optional)', `<input id="qh-section" value="${escapeHtml(b.sectionName || '')}">`)}
    ${events.length ? field('Linked event/camp (optional)', `<select id="qh-event"><option value="">None</option>${events.map(ev => `<option value="${ev.id}"${ev.id == b.eventHubId ? ' selected' : ''}>${escapeHtml(ev.title)}</option>`).join('')}</select>`) : ''}
    <div class="cap-actions">
      ${field('Collect at', `<input id="qh-collect" type="datetime-local" value="${toLocal(b.collectAt)}">`)}
      ${field('Return by', `<input id="qh-return" type="datetime-local" value="${toLocal(b.returnAt)}">`)}
    </div>
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qh-save">Save</button><button class="btn btn-secondary" id="qh-cancel">Cancel</button></div>`);
  document.getElementById('qh-cancel').addEventListener('click', closeModal);
  document.getElementById('qh-save').addEventListener('click', async () => {
    const payload = {
      purpose: document.getElementById('qh-purpose').value.trim(),
      sectionName: document.getElementById('qh-section').value.trim(),
      collectAt: document.getElementById('qh-collect').value,
      returnAt: document.getElementById('qh-return').value,
    };
    const ev = document.getElementById('qh-event'); if (ev) payload.eventHubId = ev.value || null;
    try { await Api.patch(`/api/qm/bookings/${b.id}`, payload); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

async function addItem(b) {
  const cat = await loadCatalogue(b);
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const modal = openModal('Add item', `
    ${field('Item from the register', `<select id="qi-asset"><option value="">&mdash; free-text item &mdash;</option>${cat.map(a => `<option value="${a.id}" data-name="${escapeHtml(a.name)}" data-restricted="${a.restricted ? 1 : 0}">${escapeHtml(a.name)}${a.restricted ? ' [restricted]' : ''}${a.windowKnown ? ` (${a.available} free)` : ''}</option>`).join('')}</select>`)}
    ${field('Or type an item name', `<input id="qi-name" placeholder="Only needed for a free-text item">`)}
    ${field('Quantity', `<input id="qi-qty" type="number" min="1" value="1" style="width:100px">`)}
    <div id="qi-permit-wrap" style="display:none;border:1px solid var(--amber);border-radius:var(--radius);padding:.6rem .8rem;margin:.5rem 0">
      <p class="muted" style="margin:0 0 .4rem">This is <strong>controlled equipment</strong>. A Quartermaster can only approve it once the permit/qualification is confirmed and a responsible adult is named (FR-QM-ADV-008).</p>
      <label class="check"><input type="checkbox" id="qi-permit"> I confirm the required permit/qualification is held for this activity</label>
      ${field('Named responsible adult', `<input id="qi-responsible" placeholder="Full name of the responsible adult">`)}
    </div>
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qi-save">Add</button><button class="btn btn-secondary" id="qi-cancel">Cancel</button></div>`);
  const permitWrap = document.getElementById('qi-permit-wrap');
  document.getElementById('qi-asset').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    permitWrap.style.display = opt && opt.dataset.restricted === '1' ? '' : 'none';
  });
  document.getElementById('qi-cancel').addEventListener('click', closeModal);
  document.getElementById('qi-save').addEventListener('click', async () => {
    const assetSel = document.getElementById('qi-asset');
    const assetId = assetSel.value || null;
    const name = document.getElementById('qi-name').value.trim() || (assetId ? assetSel.selectedOptions[0].dataset.name : '');
    const payload = { assetId, itemName: name, requestedQty: document.getElementById('qi-qty').value };
    if (permitWrap.style.display !== 'none') {
      payload.permitConfirmed = document.getElementById('qi-permit').checked;
      payload.responsibleAdult = document.getElementById('qi-responsible').value.trim();
    }
    try { await Api.post(`/api/qm/bookings/${b.id}/items`, payload); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

async function editItem(b, item) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const modal = openModal('Edit item', `
    ${field('Item name', `<input id="qie-name" value="${escapeHtml(item.itemName)}">`)}
    ${field('Quantity', `<input id="qie-qty" type="number" min="1" value="${item.requestedQty}" style="width:100px">`)}
    ${item.restricted ? `<div style="border:1px solid var(--amber);border-radius:var(--radius);padding:.6rem .8rem;margin:.5rem 0">
      <p class="muted" style="margin:0 0 .4rem"><strong>Controlled equipment</strong> — required before a Quartermaster can approve it.</p>
      <label class="check"><input type="checkbox" id="qie-permit" ${item.permitConfirmed ? 'checked' : ''}> Permit/qualification is held for this activity</label>
      ${field('Named responsible adult', `<input id="qie-responsible" value="${escapeHtml(item.responsibleAdult || '')}" placeholder="Full name">`)}
    </div>` : ''}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qie-save">Save</button><button class="btn btn-secondary" id="qie-cancel">Cancel</button></div>`);
  document.getElementById('qie-cancel').addEventListener('click', closeModal);
  document.getElementById('qie-save').addEventListener('click', async () => {
    const payload = { itemName: document.getElementById('qie-name').value.trim(), requestedQty: document.getElementById('qie-qty').value };
    if (item.restricted) {
      payload.permitConfirmed = document.getElementById('qie-permit').checked;
      payload.responsibleAdult = document.getElementById('qie-responsible').value.trim();
    }
    try { await Api.patch(`/api/qm/bookings/${b.id}/items/${item.id}`, payload); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

function removeItem(b, itemId) {
  confirmModal('Remove this item?', '', async () => { await Api.delete(`/api/qm/bookings/${b.id}/items/${itemId}`); route(); });
}

// ── QM: item decision ───────────────────────────────────────────────────────────
async function decideItem(b, item, decision) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  let extra = '';
  if (decision === 'approve') extra = field('Approved quantity', `<input id="qd-qty" type="number" min="1" value="${item.approvedQty ?? item.requestedQty}" style="width:100px">`);
  if (decision === 'substitute') {
    const cat = await loadCatalogue(b);
    extra = field('Approved quantity', `<input id="qd-qty" type="number" min="1" value="${item.approvedQty ?? item.requestedQty}" style="width:100px">`)
      + field('Substitute item', `<select id="qd-sub"><option value="">&mdash; type below &mdash;</option>${cat.map(a => `<option value="${a.id}" data-name="${escapeHtml(a.name)}">${escapeHtml(a.name)}${a.windowKnown ? ` (${a.available} free)` : ''}</option>`).join('')}</select>`)
      + field('Or substitute name', `<input id="qd-subname" value="${escapeHtml(item.substituteName || '')}">`);
  }
  const titles = { approve: 'Approve item', reject: 'Reject item', substitute: 'Substitute item', more_info: 'Request more information' };
  const modal = openModal(titles[decision] + ': ' + item.itemName, `
    ${extra}
    ${field('Note to requester (optional)', `<textarea id="qd-notes" rows="2">${escapeHtml(item.qmNotes || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qd-save">Confirm</button><button class="btn btn-secondary" id="qd-cancel">Cancel</button></div>`);
  document.getElementById('qd-cancel').addEventListener('click', closeModal);
  document.getElementById('qd-save').addEventListener('click', async () => {
    const payload = { decision, qmNotes: document.getElementById('qd-notes').value.trim() };
    const qty = document.getElementById('qd-qty'); if (qty) payload.approvedQty = qty.value;
    const sub = document.getElementById('qd-sub');
    if (sub) { payload.substituteAssetId = sub.value || null; payload.substituteName = document.getElementById('qd-subname').value.trim() || (sub.value ? sub.selectedOptions[0].dataset.name : ''); }
    try { await Api.post(`/api/qm/bookings/${b.id}/items/${item.id}/decide`, payload); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

// ── QM: finalise (with clash override) ──────────────────────────────────────────
async function finalise(b, override) {
  try {
    await Api.post(`/api/qm/bookings/${b.id}/finalise`, override ? { override: true, overrideReason: override } : {});
    route();
  } catch (e) {
    if (e.status === 409 && /not available/i.test(e.message)) return clashOverride(b);
    const msg = document.getElementById('qm-detail-msg'); if (msg) msg.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
  }
}

async function clashOverride(b) {
  // Re-request to surface the clash list.
  let clashes = [];
  try { await Api.post(`/api/qm/bookings/${b.id}/finalise`, {}); route(); return; }
  catch (e) { clashes = e.clashes || []; }
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const modal = openModal('Booking clash', `
    <p>Some items are not available for the requested dates:</p>
    <ul>${clashes.map(c => `<li><strong>${escapeHtml(c.itemName)}</strong>: ${c.requested} requested, ${c.available} free</li>`).join('')}</ul>
    ${field('Reason for overriding the clash', `<input id="qf-reason" placeholder="Required">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qf-ok">Override &amp; approve</button><button class="btn btn-secondary" id="qf-cancel">Cancel</button></div>`);
  document.getElementById('qf-cancel').addEventListener('click', closeModal);
  document.getElementById('qf-ok').addEventListener('click', () => {
    const reason = document.getElementById('qf-reason').value.trim();
    if (!reason) { modalError('A reason is required to override.'); return; }
    closeModal(); finalise(b, reason);
  });
}

// ── QM: ready / collect / return / cancel ───────────────────────────────────────
function readyForCollection(b) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  openModal('Ready for collection', `
    ${field('Collection details (where/when to collect)', `<textarea id="qr-details" rows="3">${escapeHtml(b.collectionDetails || '')}</textarea>`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qr-ok">Confirm ready</button><button class="btn btn-secondary" id="qr-cancel">Cancel</button></div>`);
  document.getElementById('qr-cancel').addEventListener('click', closeModal);
  document.getElementById('qr-ok').addEventListener('click', async () => {
    try { await Api.post(`/api/qm/bookings/${b.id}/ready`, { collectionDetails: document.getElementById('qr-details').value.trim() }); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

function recordCollection(b) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  openModal('Record collection', `
    ${field('Collected by', `<input id="qc-by" placeholder="Name of collector">`)}
    ${field('Condition at handover (optional)', `<input id="qc-cond" placeholder="e.g. All good, checked">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qc-ok">Confirm collected</button><button class="btn btn-secondary" id="qc-cancel">Cancel</button></div>`);
  document.getElementById('qc-cancel').addEventListener('click', closeModal);
  document.getElementById('qc-ok').addEventListener('click', async () => {
    try { await Api.post(`/api/qm/bookings/${b.id}/collect`, { collectedByName: document.getElementById('qc-by').value.trim(), issueCondition: document.getElementById('qc-cond').value.trim() }); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

function recordReturn(b, items) {
  const approved = items.filter(i => ['approved', 'substituted'].includes(i.lineStatus));
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  const rows = approved.map(i => `<tr>
      <td>${escapeHtml(i.substituteName || i.itemName)}</td>
      <td><select class="qrt-flag" data-id="${i.id}"><option value="">OK</option><option value="damaged">Damaged</option><option value="missing">Missing</option></select></td>
      <td><input class="qrt-damage" data-id="${i.id}" placeholder="Damage / missing note"></td>
    </tr>`).join('');
  openModal('Record return', `
    ${field('Overall condition note (optional)', `<input id="qrt-note" placeholder="e.g. All returned, tent 2 needs drying">`)}
    ${approved.length ? `<table class="data-table"><thead><tr><th>Item</th><th>State</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="margin-top:.5rem">Items flagged damaged are set to <em>Under repair</em> in the register; missing items are set to <em>Missing</em>.</p>` : ''}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn" id="qrt-ok">Confirm return</button><button class="btn btn-secondary" id="qrt-cancel">Cancel</button></div>`);
  document.getElementById('qrt-cancel').addEventListener('click', closeModal);
  document.getElementById('qrt-ok').addEventListener('click', async () => {
    const lines = approved.map(i => {
      const flag = document.querySelector(`.qrt-flag[data-id="${i.id}"]`).value;
      const damage = document.querySelector(`.qrt-damage[data-id="${i.id}"]`).value.trim();
      return { itemId: i.id, flag, damageNotes: damage, returnCondition: flag ? flag : 'ok' };
    });
    try { await Api.post(`/api/qm/bookings/${b.id}/return`, { returnConditionNote: document.getElementById('qrt-note').value.trim(), lines }); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

function cancelBooking(b) {
  const field = (label, html) => `<div class="field"><label>${label}</label>${html}</div>`;
  openModal('Cancel booking', `
    ${field('Reason (optional)', `<input id="qx-reason" placeholder="Why is this being cancelled?">`)}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn btn-secondary" id="qx-ok">Cancel booking</button><button class="btn" id="qx-keep">Keep booking</button></div>`);
  document.getElementById('qx-keep').addEventListener('click', closeModal);
  document.getElementById('qx-ok').addEventListener('click', async () => {
    try { await Api.post(`/api/qm/bookings/${b.id}/cancel`, { reason: document.getElementById('qx-reason').value.trim() }); closeModal(); route(); }
    catch (e) { modalError(e.message); }
  });
}

// Generic inline confirm modal (avoids native confirm()).
function confirmModal(title, body, onYes) {
  openModal(title, `${body ? `<p>${escapeHtml(body)}</p>` : ''}
    <div class="modal-actions" style="display:flex;gap:.5rem;margin-top:1rem"><button class="btn btn-secondary" id="qcf-yes">Yes</button><button class="btn" id="qcf-no">No</button></div>`);
  document.getElementById('qcf-no').addEventListener('click', closeModal);
  document.getElementById('qcf-yes').addEventListener('click', async () => { try { await onYes(); closeModal(); } catch (e) { modalError(e.message); } });
}

async function loadCatalogue(b) {
  const params = new URLSearchParams();
  if (b.collectAt) params.set('collectAt', b.collectAt);
  if (b.returnAt) params.set('returnAt', b.returnAt);
  params.set('excludeBookingId', b.id);
  try { return (await Api.get('/api/qm/catalogue?' + params.toString())).items || []; }
  catch (e) { return []; }
}
