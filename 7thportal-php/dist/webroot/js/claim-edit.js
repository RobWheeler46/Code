let ME = null;
let ACCOUNTS = [];
let CATEGORIES = [];
let RATES = [];
let EVENTS = [];
const claimId = new URLSearchParams(location.search).get('id');
const VEHICLE_LABELS = { car: 'Car/van', motorcycle: 'Motorcycle', bicycle: 'Bicycle', other: 'Other' };
const CLAIM_TONE = { draft: 'attention', submitted: 'pending', partially_approved: 'pending', approved: 'ready', partially_paid: 'ready', paid: 'ready', rejected: 'blocked' };
const claimStatusLabel = s => String(s || '').replace(/_/g, ' ');

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (!claimId) { document.getElementById('content').innerHTML = '<div class="alert alert-error">No claim specified.</div>'; return; }
  [ACCOUNTS, CATEGORIES, RATES] = await Promise.all([
    Api.get('/api/finance/accounts'), Api.get('/api/finance/categories'), Api.get('/api/finance/mileage-rates'),
  ]);
  // Events are optional context: a claim can be tagged to the event/camp it's for.
  // If the module is off the request 404s - swallow it and just hide the picker.
  try { EVENTS = (await Api.get('/api/events')).events || []; } catch { EVENTS = []; }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  try {
    const claim = await Api.get(`/api/finance/claims/${claimId}`);
    render(claim);
  } catch (err) {
    content.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function claimStatusNote(claim) {
  const notes = {
    submitted: 'Waiting for approval.',
    partially_approved: 'Some items are approved; others are still pending, need more information, or were rejected.',
    approved: 'All payable items are approved - waiting for the Treasurer to process payment.',
    partially_paid: 'Some approved items have been paid; others are still awaiting payment.',
    paid: 'All approved items have been paid.',
    rejected: 'All items in this claim were rejected.',
  };
  return notes[claim.status] ? `<div class="alert alert-info">${escapeHtml(notes[claim.status])}</div>` : '';
}

// Optional "which event/camp is this claim for" picker. Hidden entirely when the
// events module is off (no events fetched) and the claim isn't already linked, so it
// never adds noise where it can't be used. Read-only once the claim leaves draft.
function eventPickerField(claim, editable) {
  if (!EVENTS.length && !claim.eventHubId) return '';
  if (!editable) {
    return `<div class="field"><label>Event / camp</label><input type="text" value="${escapeHtml(claim.eventTitle || 'Not linked')}" disabled></div>`;
  }
  const opts = ['<option value="">Not linked to an event</option>']
    .concat(EVENTS.map(e => `<option value="${e.id}"${claim.eventHubId === e.id ? ' selected' : ''}>${escapeHtml(e.title)}</option>`))
    .join('');
  return `<div class="field"><label>Event / camp (optional)</label><select id="h-event">${opts}</select>
    <p class="muted" style="font-size:.82rem;margin:.25rem 0 0">Tagging a claim to an event lets its leaders see the spend in the event Command Centre.</p></div>`;
}

function render(claim) {
  const content = document.getElementById('content');
  const isOwner = claim.claimant && ME.id === claim.claimant.id;
  const headerEditable = isOwner && claim.status === 'draft';
  const canAddItems = isOwner && ['draft', 'submitted', 'partially_approved'].includes(claim.status);
  const hasSubmittableItems = claim.items.some(i => i.myActions && ['draft', 'more_info_requested'].includes(i.status));

  // Canonical header: Finance/Expenses > <claim reference>. Title is the human claim
  // title; the reference is the breadcrumb tail and the status sits beside the H1.
  renderPageHeader({
    crumbs: [{ label: 'Expenses & mileage', href: 'expenses.html' }, { label: claim.claimNumber }],
    title: claim.title,
    status: { label: claimStatusLabel(claim.status), tone: CLAIM_TONE[claim.status] || 'pending' },
  });

  content.innerHTML = `
    ${claimStatusNote(claim)}

    <div class="card">
      <h2>Claim details</h2>
      <form id="header-form">
        <div class="field"><label>Title</label><input type="text" id="h-title" value="${escapeHtml(claim.title)}" ${headerEditable ? '' : 'disabled'}></div>
        ${eventPickerField(claim, headerEditable)}
        <div class="field"><label>Notes for approvers/Treasurer (optional)</label><textarea id="h-notes" ${headerEditable ? '' : 'disabled'}>${escapeHtml(claim.notes || '')}</textarea></div>
        ${headerEditable ? '<button class="btn btn-secondary" type="submit">Save</button>' : ''}
        <div id="header-error"></div>
      </form>
      <div class="summary-stats" style="margin-top:1rem;">
        <div class="stat-tile"><div class="num">&pound;${claim.claimTotalAmount.toFixed(2)}</div><div class="label">Claimed total</div></div>
        <div class="stat-tile"><div class="num">&pound;${claim.approvedTotalAmount.toFixed(2)}</div><div class="label">Approved total</div></div>
        <div class="stat-tile"><div class="num">&pound;${claim.payableTotalAmount.toFixed(2)}</div><div class="label">Awaiting payment</div></div>
      </div>
    </div>

    <h2>Items (${claim.itemCount})</h2>
    ${claim.items.map(item => renderItem(item)).join('') || '<p class="muted">No items yet.</p>'}

    ${canAddItems ? `
    <div class="card">
      <h2>Add an item</h2>
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" id="add-receipt">Add receipt expense item</button>
        <button class="btn btn-secondary btn-sm" id="add-mileage">Add mileage item</button>
      </div>
      <div id="add-item-error"></div>
    </div>` : ''}

    <div class="actions-row">
      ${isOwner && hasSubmittableItems ? '<button class="btn btn-primary" id="submit-claim-btn">Send claim for approval</button>' : ''}
      ${isOwner && claim.status === 'draft' ? '<button class="btn btn-danger" id="delete-claim-btn">Delete claim</button>' : ''}
      <a class="btn btn-secondary" href="expenses.html">Back to claims</a>
    </div>
    <div id="claim-action-error"></div>
  `;

  document.getElementById('header-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const evSel = document.getElementById('h-event');
      const payload = { title: document.getElementById('h-title').value, notes: document.getElementById('h-notes').value };
      if (evSel) payload.eventHubId = evSel.value || null;
      await Api.patch(`/api/finance/claims/${claim.id}`, payload);
      load();
    } catch (err) {
      document.getElementById('header-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });

  claim.items.forEach(item => wireItem(claim, item));

  if (canAddItems) {
    document.getElementById('add-receipt').addEventListener('click', () => addItem(claim, 'receipt'));
    document.getElementById('add-mileage').addEventListener('click', () => addItem(claim, 'mileage'));
  }

  const submitBtn = document.getElementById('submit-claim-btn');
  if (submitBtn) submitBtn.addEventListener('click', async () => {
    try { await Api.post(`/api/finance/claims/${claim.id}/submit`); load(); }
    catch (err) { document.getElementById('claim-action-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
  const deleteBtn = document.getElementById('delete-claim-btn');
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    if (!confirm('Delete this claim and all its items? This cannot be undone.')) return;
    try { await Api.delete(`/api/finance/claims/${claim.id}`); location.href = 'expenses.html'; }
    catch (err) { document.getElementById('claim-action-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  });
}

async function addItem(claim, itemType) {
  const errorBox = document.getElementById('add-item-error');
  try {
    if (!ACCOUNTS.length) { errorBox.innerHTML = '<div class="alert alert-error">No expense accounts are set up yet. Ask a Portal Administrator to add one first.</div>'; return; }
    await Api.post(`/api/finance/claims/${claim.id}/items`, {
      itemType, accountId: ACCOUNTS[0].id, title: itemType === 'mileage' ? 'Mileage item' : 'Receipt item',
    });
    load();
  } catch (err) {
    errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}

function itemStatusNote(item) {
  if (item.status === 'more_info_requested') return `<div class="alert alert-warning">More information requested: ${escapeHtml(item.moreInfoNote || '')}</div>`;
  if (item.status === 'submitted') return '<div class="alert alert-info">Waiting for approval.</div>';
  if (item.status === 'pending_second_approval') return '<div class="alert alert-info">Approved by the account approver - waiting for a Treasurer or Chair second approval (over the higher claim threshold).</div>';
  if (item.status === 'approved') return '<div class="alert alert-success">Approved - waiting for the Treasurer to process payment.</div>';
  if (item.status === 'rejected') return `<div class="alert alert-error">Rejected: ${escapeHtml(item.rejectionReason || '')}</div>`;
  if (item.status === 'ready_for_payment') return '<div class="alert alert-info">Ready for payment - waiting for the Treasurer to include it in a payment batch.</div>';
  if (item.status === 'paid') return '<div class="alert alert-success">Paid.</div>';
  if (item.status === 'archived') return '<div class="alert alert-warning">Archived.</div>';
  return '';
}

function renderItem(item) {
  const editable = item.myActions && item.myActions.canEdit;
  const accountOptions = ACCOUNTS.map(a => `<option value="${a.id}" ${item.account && a.id === item.account.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')
    || (item.account ? `<option value="${item.account.id}" selected>${escapeHtml(item.account.name)}</option>` : '');
  const categoryOptions = '<option value="">(none)</option>' + CATEGORIES.map(c => `<option value="${c.id}" ${item.category && c.id === item.category.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

  return `
    <div class="card card-accent" id="item-${item.id}">
      <h3>${escapeHtml(item.itemNumber)}. ${escapeHtml(item.title)} ${statusBadge(item.status)}</h3>
      ${itemStatusNote(item)}
      <form id="item-form-${item.id}">
        <div class="grid cols-2">
          <div class="field"><label>Title</label><input type="text" id="i-title-${item.id}" value="${escapeHtml(item.title)}" ${editable ? '' : 'disabled'}></div>
          <div class="field"><label>Account</label><select id="i-account-${item.id}" ${editable ? '' : 'disabled'}>${accountOptions}</select></div>
        </div>
        <div class="grid cols-2">
          <div class="field" id="i-approver-wrap-${item.id}" style="display:none">
            <label>Approver</label>
            <select id="i-approver-${item.id}" ${editable ? '' : 'disabled'}></select>
            <p class="help" id="i-approver-hint-${item.id}"></p>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Category</label><select id="i-category-${item.id}" ${editable ? '' : 'disabled'}>${categoryOptions}</select></div>
          <div class="field"><label>${item.itemType === 'mileage' ? 'Journey date' : 'Purchase date'}</label><input type="date" id="i-date-${item.id}" value="${item.expenseDate || ''}" ${editable ? '' : 'disabled'}></div>
        </div>
        ${item.itemType === 'receipt' ? renderReceiptFields(item, editable) : renderMileageFields(item, editable)}
        ${editable ? '<button class="btn btn-secondary btn-sm" type="submit">Save item</button>' : ''}
        <div id="item-error-${item.id}"></div>
      </form>

      ${item.itemType === 'receipt' ? renderReceiptCard(item, editable) : ''}
      ${renderApprovalActions(item)}
      ${renderTreasurerActions(item)}
      ${editable && item.myActions.canDelete ? `<div class="actions-row"><button class="btn btn-danger btn-sm" id="delete-item-${item.id}">Delete item</button></div>` : ''}
    </div>
  `;
}

function renderReceiptFields(item, editable) {
  return `
    <div class="field" style="max-width:220px;"><label>Amount claimed (&pound;)</label><input type="number" step="0.01" min="0" id="i-amount-${item.id}" value="${item.claimedAmount ?? ''}" ${editable ? '' : 'disabled'}></div>
    ${editable ? `<div class="field"><label>Reason if no receipt available (optional)</label><input type="text" id="i-exception-${item.id}" value="${escapeHtml(item.receiptExceptionReason || '')}"></div>` : ''}
  `;
}

function renderReceiptCard(item, editable) {
  const receiptList = item.receipts.length
    ? item.receipts.map(r => `<a class="btn btn-secondary btn-sm" href="/api/finance/receipts/${r.id}/file" target="_blank" rel="noopener">${escapeHtml(r.filename || 'Receipt')}</a> ${editable ? `<button class="btn btn-danger btn-sm" data-remove-receipt="${item.id}:${r.id}">Remove</button>` : ''}`).join(' ')
    : '<p class="muted">No receipt uploaded yet.</p>';
  return `
    <div class="field">
      <label>Receipts</label>
      ${receiptList}
      ${editable ? `
      <div class="dropzone" id="dropzone-${item.id}" style="margin-top:0.5rem;">
        <p>Drag a receipt here, or</p>
        <input type="file" id="file-input-${item.id}" accept="image/*,application/pdf" style="display:none;">
        <input type="file" id="camera-input-${item.id}" accept="image/*" capture="environment" style="display:none;">
        <div class="cap-actions" style="justify-content:center">
          <button class="btn btn-primary btn-sm camera-only" id="camera-btn-${item.id}" type="button">📷 Take photo</button>
          <button class="btn btn-secondary btn-sm" id="choose-file-${item.id}" type="button">Choose file (JPG, PNG or PDF)</button>
        </div>
      </div>
      <div id="upload-status-${item.id}"></div>
      ` : ''}
    </div>
  `;
}

function renderMileageFields(item, editable) {
  const m = item.mileage || {};
  const vehicleOptions = Object.keys(VEHICLE_LABELS).map(v => `<option value="${v}" ${m.vehicleType === v ? 'selected' : ''}>${VEHICLE_LABELS[v]}</option>`).join('');
  const availableRates = RATES.length ? `<p class="help">Current rates: ${RATES.map(r => `${VEHICLE_LABELS[r.vehicleType] || r.vehicleType} &pound;${r.ratePerMile.toFixed(2)}/mile${r.annualThresholdMiles ? ` (first ${r.annualThresholdMiles} miles/tax year, then &pound;${r.rateAfterThreshold.toFixed(2)})` : ''} from ${formatDate(r.effectiveFrom)}`).join(' &middot; ')}</p>` : '';
  return `
    <div class="grid cols-2">
      <div class="field"><label>Vehicle type</label><select id="i-vehicle-${item.id}" ${editable ? '' : 'disabled'}>${vehicleOptions}</select></div>
      <div class="field"><label>Calculated amount</label><input type="text" value="${item.claimedAmount !== null ? '£' + item.claimedAmount.toFixed(2) + (item.mileage && item.mileage.rateApplied ? ` (£${item.mileage.rateApplied.toFixed(2)}/mile)` : '') : 'Enter journey details'}" disabled></div>
    </div>
    <div class="grid cols-2">
      <div class="field"><label>Start location</label><input type="text" id="i-start-${item.id}" value="${escapeHtml(m.startLocation || '')}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label>End location</label><input type="text" id="i-end-${item.id}" value="${escapeHtml(m.endLocation || '')}" ${editable ? '' : 'disabled'}></div>
    </div>
    <div class="field"><label>Journey purpose</label><input type="text" id="i-purpose-${item.id}" value="${escapeHtml(m.journeyPurpose || '')}" ${editable ? '' : 'disabled'}></div>
    <div class="grid cols-2">
      <div class="field"><label>Miles claimed</label><input type="number" step="0.1" min="0" id="i-miles-${item.id}" value="${m.miles ?? ''}" ${editable ? '' : 'disabled'}></div>
      <div class="field"><label style="font-weight:400;margin-top:1.6rem;"><input type="checkbox" id="i-return-${item.id}" ${m.returnJourney ? 'checked' : ''} ${editable ? '' : 'disabled'}> Return journey</label></div>
    </div>
    ${availableRates}
    <div class="field">
      <label style="font-weight:400;"><input type="checkbox" id="i-declaration-${item.id}" ${m.declarationAccepted ? 'checked' : ''} ${editable ? '' : 'disabled'}>
      I declare this journey was for an approved Scout purpose, the mileage is accurate and not claimed elsewhere, and I held a valid licence, MOT (where required) and suitable insurance (FRD 11.1).</label>
    </div>
  `;
}

function renderApprovalActions(item) {
  const a = item.myActions || {};
  if (!a.canApprove && !a.canSecondApprove && !a.canReject && !a.canRequestInfo) return '';
  return `
    <div class="actions-row">
      ${a.canApprove ? `<button class="btn btn-success btn-sm" data-approve="${item.id}">Approve</button>` : ''}
      ${a.canSecondApprove ? `<button class="btn btn-success btn-sm" data-second-approve="${item.id}">Approve (second approval)</button>` : ''}
      ${a.canRequestInfo ? `<button class="btn btn-secondary btn-sm" data-request-info="${item.id}">Ask for more info</button>` : ''}
      ${a.canReject ? `<button class="btn btn-danger btn-sm" data-reject="${item.id}">Reject</button>` : ''}
    </div>
    <div class="field" id="reason-field-${item.id}" style="display:none;">
      <label id="reason-label-${item.id}">Reason</label>
      <textarea id="reason-input-${item.id}"></textarea>
      <button class="btn btn-secondary btn-sm" type="button" data-reason-confirm="${item.id}" style="margin-top:0.5rem;">Confirm</button>
    </div>
  `;
}

function renderTreasurerActions(item) {
  if (!item.myActions || !item.myActions.canMarkReadyForPayment) return '';
  return `<div class="actions-row"><button class="btn btn-success btn-sm" data-ready="${item.id}">Mark ready for payment</button></div>`;
}

// Populate the per-account Approver field (FRD s28). Hidden unless the selected
// account requires the claimant to nominate an approver; the list excludes the
// claimant, and changing the account reloads it (keepSelectedId null clears it).
async function refreshApproverField(item, accountId, keepSelectedId) {
  const wrap = document.getElementById(`i-approver-wrap-${item.id}`);
  const sel = document.getElementById(`i-approver-${item.id}`);
  const hint = document.getElementById(`i-approver-hint-${item.id}`);
  if (!wrap || !sel) return;
  const acc = ACCOUNTS.find(a => a.id === Number(accountId));
  if (!acc || !acc.claimantSelectsApprover) { wrap.style.display = 'none'; sel.innerHTML = ''; return; }
  try {
    const data = await Api.get(`/api/finance/accounts/${accountId}/approvers`);
    sel.innerHTML = ['<option value="">(choose an approver)</option>']
      .concat(data.approvers.map(a => `<option value="${a.id}" ${a.id === keepSelectedId ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.roleLabel)})</option>`)).join('');
    // Preserve a previously-nominated approver who is no longer in the group.
    if (keepSelectedId && !data.approvers.some(a => a.id === keepSelectedId) && item.selectedApprover) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${item.selectedApprover.id}" selected>${escapeHtml(item.selectedApprover.name)} (nominated)</option>`);
    }
    hint.textContent = data.approvers.length
      ? `Select one approver from ${data.groupName || 'the account approver group'}. You cannot approve your own claim.`
      : 'No eligible approvers are set up for this account yet — ask a Finance Admin.';
    wrap.style.display = '';
  } catch (err) { wrap.style.display = 'none'; }
}

function wireItem(claim, item) {
  const errorBox = document.getElementById(`item-error-${item.id}`);
  const form = document.getElementById(`item-form-${item.id}`);
  // Show/refresh the nominated-approver field for the current account.
  refreshApproverField(item, item.account ? item.account.id : null, item.selectedApprover ? item.selectedApprover.id : null);
  if (item.myActions && item.myActions.canEdit) {
    const accountSel = document.getElementById(`i-account-${item.id}`);
    if (accountSel) accountSel.addEventListener('change', () => refreshApproverField(item, accountSel.value, null));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const body = {
          title: document.getElementById(`i-title-${item.id}`).value,
          accountId: Number(document.getElementById(`i-account-${item.id}`).value),
          categoryId: document.getElementById(`i-category-${item.id}`).value || null,
          expenseDate: document.getElementById(`i-date-${item.id}`).value,
        };
        const approverWrap = document.getElementById(`i-approver-wrap-${item.id}`);
        if (approverWrap && approverWrap.style.display !== 'none') {
          const v = document.getElementById(`i-approver-${item.id}`).value;
          body.selectedApproverUserId = v ? Number(v) : null;
        }
        if (item.itemType === 'receipt') {
          body.claimedAmount = Number(document.getElementById(`i-amount-${item.id}`).value);
          body.receiptExceptionReason = document.getElementById(`i-exception-${item.id}`).value;
        } else {
          body.vehicleType = document.getElementById(`i-vehicle-${item.id}`).value;
          body.startLocation = document.getElementById(`i-start-${item.id}`).value;
          body.endLocation = document.getElementById(`i-end-${item.id}`).value;
          body.journeyPurpose = document.getElementById(`i-purpose-${item.id}`).value;
          body.miles = Number(document.getElementById(`i-miles-${item.id}`).value);
          body.returnJourney = document.getElementById(`i-return-${item.id}`).checked;
          body.declarationAccepted = document.getElementById(`i-declaration-${item.id}`).checked;
        }
        await Api.patch(`/api/finance/claims/${claim.id}/items/${item.id}`, body);
        load();
      } catch (err) {
        errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
      }
    });

    if (item.itemType === 'receipt') {
      const input = document.getElementById(`file-input-${item.id}`);
      const chooseBtn = document.getElementById(`choose-file-${item.id}`);
      const dropzone = document.getElementById(`dropzone-${item.id}`);
      const cameraInput = document.getElementById(`camera-input-${item.id}`);
      const cameraBtn = document.getElementById(`camera-btn-${item.id}`);
      if (cameraBtn) {
        cameraBtn.addEventListener('click', () => cameraInput.click());
        cameraInput.addEventListener('change', () => uploadReceipt(item.id, cameraInput.files[0]));
      }
      if (chooseBtn) {
        chooseBtn.addEventListener('click', () => input.click());
        input.addEventListener('change', () => uploadReceipt(item.id, input.files[0]));
        ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
        ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
        dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) uploadReceipt(item.id, e.dataTransfer.files[0]); });
      }
    }

    const deleteBtn = document.getElementById(`delete-item-${item.id}`);
    if (deleteBtn) deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this item?')) return;
      try { await Api.delete(`/api/finance/claims/${claim.id}/items/${item.id}`); load(); }
      catch (err) { errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
    });

    document.querySelectorAll(`[data-remove-receipt^="${item.id}:"]`).forEach(btn => btn.addEventListener('click', async () => {
      const [itemId, receiptId] = btn.dataset.removeReceipt.split(':');
      await Api.delete(`/api/finance/items/${itemId}/receipts/${receiptId}`);
      load();
    }));
  }

  const run = async (fn) => { try { await fn(); load(); } catch (err) { errorBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; } };
  const approveBtn = document.querySelector(`[data-approve="${item.id}"]`);
  if (approveBtn) approveBtn.addEventListener('click', () => run(() => Api.post(`/api/finance/items/${item.id}/approve`)));
  const secondApproveBtn = document.querySelector(`[data-second-approve="${item.id}"]`);
  if (secondApproveBtn) secondApproveBtn.addEventListener('click', () => run(() => Api.post(`/api/finance/items/${item.id}/second-approve`)));
  const readyBtn = document.querySelector(`[data-ready="${item.id}"]`);
  if (readyBtn) readyBtn.addEventListener('click', () => run(() => Api.post(`/api/finance/items/${item.id}/ready-for-payment`)));

  const showReasonField = (label, onConfirm) => {
    const field = document.getElementById(`reason-field-${item.id}`);
    document.getElementById(`reason-label-${item.id}`).textContent = label;
    field.style.display = 'block';
    document.querySelector(`[data-reason-confirm="${item.id}"]`).onclick = () => run(() => onConfirm(document.getElementById(`reason-input-${item.id}`).value));
  };
  const requestInfoBtn = document.querySelector(`[data-request-info="${item.id}"]`);
  if (requestInfoBtn) requestInfoBtn.addEventListener('click', () => showReasonField('What more information is needed?', (note) => Api.post(`/api/finance/items/${item.id}/request-info`, { note })));
  const rejectBtn = document.querySelector(`[data-reject="${item.id}"]`);
  if (rejectBtn) rejectBtn.addEventListener('click', () => showReasonField('Reason for rejecting', (reason) => Api.post(`/api/finance/items/${item.id}/reject`, { reason })));
}

async function uploadReceipt(itemId, file) {
  if (!file) return;
  const status = document.getElementById(`upload-status-${itemId}`);
  status.innerHTML = '<p class="muted">Uploading&hellip;</p>';
  const form = new FormData();
  form.append('receipt', file);
  try {
    const res = await fetch(`/api/finance/items/${itemId}/receipts`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed.');
    status.innerHTML = '<div class="alert alert-success">Receipt uploaded.</div>';
    load();
  } catch (err) {
    status.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
}
