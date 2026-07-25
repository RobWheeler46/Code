let ME = null;

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (!['treasurer', 'admin'].includes(ME.role)) {
    document.getElementById('content').innerHTML = '<div class="alert alert-error">Treasurer access required.</div>';
    return;
  }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const cfg = await Api.get('/api/config');
  if (!cfg.financeEnabled) {
    content.innerHTML = '<div class="alert alert-warning">Expenses and mileage claims are not enabled yet. Turn this on in Admin Settings.</div>';
    return;
  }
  const [payable, batches, rates] = await Promise.all([
    Api.get('/api/treasurer/payable-items'), Api.get('/api/treasurer/payment-batches'), Api.get('/api/finance/mileage-rates'),
  ]);
  const approved = payable.filter(i => i.status === 'approved');
  const readyForPayment = payable.filter(i => i.status === 'ready_for_payment');

  content.innerHTML = `
    <div class="card">
      <h2>Approved - ready for your review (${approved.length})</h2>
      ${approved.length === 0 ? '<p class="muted">None right now.</p>' : `
      <table><thead><tr><th>Claimant</th><th>Claim</th><th>Item</th><th>Account</th><th>Amount</th><th></th></tr></thead>
      <tbody>${approved.map(i => `
        <tr>
          <td>${escapeHtml(i.claimant.name)}</td><td>${escapeHtml(i.claimNumber)}</td><td>${escapeHtml(i.title)}</td>
          <td>${escapeHtml(i.account.name)}</td><td>&pound;${i.claimedAmount.toFixed(2)}</td>
          <td><button class="btn btn-secondary btn-sm" data-ready="${i.id}">Mark ready for payment</button></td>
        </tr>`).join('')}</tbody></table>`}
      <div id="ready-error"></div>
    </div>

    <div class="card">
      <h2>Ready for payment - select for a payment batch (${readyForPayment.length})</h2>
      ${readyForPayment.length === 0 ? '<p class="muted">None right now.</p>' : `
      <form id="batch-form">
        <table><thead><tr><th></th><th>Claimant</th><th>Claim</th><th>Item</th><th>Account</th><th>Amount</th></tr></thead>
        <tbody>${readyForPayment.map(i => `
          <tr>
            <td><input type="checkbox" class="batch-item" value="${i.id}"></td>
            <td>${escapeHtml(i.claimant.name)}</td><td>${escapeHtml(i.claimNumber)}</td><td>${escapeHtml(i.title)}</td>
            <td>${escapeHtml(i.account.name)}</td><td>&pound;${i.claimedAmount.toFixed(2)}</td>
          </tr>`).join('')}</tbody></table>
        <div class="grid cols-3">
          <div class="field"><label>Bank reference</label><input type="text" id="b-reference" required></div>
          <div class="field"><label>Payment date</label><input type="date" id="b-date" required value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div id="batch-error"></div>
        <button class="btn btn-primary" type="submit">Create payment batch for selected items</button>
      </form>`}
    </div>

    <div class="card">
      <h2>Recent payment batches</h2>
      ${batches.length === 0 ? '<p class="muted">None yet.</p>' : `
      <table><thead><tr><th>Batch</th><th>Items</th><th>Total paid</th><th>Payment date</th><th>Bank reference</th></tr></thead>
      <tbody>${batches.map(b => `<tr><td>${escapeHtml(b.batchReference)}</td><td>${b.itemCount}</td><td>&pound;${b.totalPaid.toFixed(2)}</td><td>${formatDate(b.paymentDate)}</td><td>${escapeHtml(b.bankReference || '')}</td></tr>`).join('')}</tbody></table>`}
    </div>

    <div class="card">
      <h2>Mileage rates</h2>
      ${rates.length === 0 ? '<p class="muted">No rates configured yet - add one in Admin &rarr; Finance.</p>' : `
      <table><thead><tr><th>Vehicle</th><th>Rate/mile</th><th>Annual threshold</th><th>Rate after threshold</th><th>Effective from</th></tr></thead>
      <tbody>${rates.map(r => `<tr><td>${escapeHtml(r.vehicleType)}</td><td>&pound;${r.ratePerMile.toFixed(2)}</td><td>${r.annualThresholdMiles ? r.annualThresholdMiles + ' miles/tax year' : '&mdash;'}</td><td>${r.rateAfterThreshold ? '£' + r.rateAfterThreshold.toFixed(2) : '&mdash;'}</td><td>${formatDate(r.effectiveFrom)}</td></tr>`).join('')}</tbody></table>`}
    </div>

    <div class="card">
      <h2>Export</h2>
      <p class="muted">Download an item-level CSV of every submitted claim item (account, category, claimed/approved amount, status, payment date) for month-end records (FRD section 20).</p>
      <a class="btn btn-secondary" href="/api/treasurer/export.csv">Download expenses CSV</a>
    </div>
  `;

  document.querySelectorAll('[data-ready]').forEach(btn => btn.addEventListener('click', async () => {
    try { await Api.post(`/api/finance/items/${btn.dataset.ready}/ready-for-payment`); load(); }
    catch (err) { document.getElementById('ready-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`; }
  }));

  const batchForm = document.getElementById('batch-form');
  if (batchForm) batchForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const itemIds = [...document.querySelectorAll('.batch-item:checked')].map(c => Number(c.value));
    if (!itemIds.length) { document.getElementById('batch-error').innerHTML = '<div class="alert alert-error">Select at least one item.</div>'; return; }
    try {
      await Api.post('/api/treasurer/payment-batches', {
        itemIds, bankReference: document.getElementById('b-reference').value, paymentDate: document.getElementById('b-date').value,
      });
      load();
    } catch (err) {
      document.getElementById('batch-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}
