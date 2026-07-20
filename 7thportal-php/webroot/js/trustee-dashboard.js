let ME = null;
const STATUS_LABELS = {
  draft: 'Draft', submitted: 'Submitted', more_info_requested: 'More info requested',
  pending_second_approval: 'Awaiting second approval', approved: 'Approved', rejected: 'Rejected',
  ready_for_payment: 'Ready for payment', paid: 'Paid', archived: 'Archived',
};

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (!['trustee_viewer', 'chair', 'treasurer', 'admin'].includes(ME.role)) {
    document.getElementById('content').innerHTML = '<div class="alert alert-error">Trustee Board access required.</div>';
    return;
  }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const cfg = await Api.get('/api/config');
  if (!cfg.financeEnabled) {
    content.innerHTML = '<div class="alert alert-warning">Expenses and mileage claims are not enabled yet.</div>';
    return;
  }
  const d = await Api.get('/api/trustee/dashboard');

  const exceptionRows = (list) => list.length === 0 ? '<p class="muted">None.</p>' : `
    <table><thead><tr><th>Item</th><th>Account</th><th>Amount</th><th>Age</th></tr></thead>
    <tbody>${list.map(e => `<tr><td>#${e.itemId}</td><td>${escapeHtml(e.account)}</td><td>&pound;${e.amount.toFixed(2)}</td><td>${e.ageDays !== null ? e.ageDays + ' days' : ''}</td></tr>`).join('')}</tbody></table>`;

  content.innerHTML = `
    <div class="summary-stats">
      <div class="stat-tile"><div class="num">&pound;${d.kpis.monthlySpend.toFixed(2)}</div><div class="label">Spend this month</div></div>
      <div class="stat-tile"><div class="num">&pound;${d.kpis.ytdSpend.toFixed(2)}</div><div class="label">Spend year-to-date</div></div>
      <div class="stat-tile"><div class="num">${d.kpis.awaitingApproval}</div><div class="label">Awaiting approval</div></div>
      <div class="stat-tile"><div class="num">${d.kpis.readyToPay}</div><div class="label">Ready to pay</div></div>
      <div class="stat-tile"><div class="num">${d.kpis.mileagePaidMiles}</div><div class="label">Paid mileage (miles)</div></div>
    </div>

    <div class="card">
      <h2>Spend by account</h2>
      ${d.spendByAccount.length === 0 ? '<p class="muted">No accounts configured yet.</p>' : `
      <table><thead><tr><th>Account</th><th>Paid spend</th></tr></thead>
      <tbody>${d.spendByAccount.map(a => `<tr><td>${escapeHtml(a.account)}</td><td>&pound;${a.spend.toFixed(2)}</td></tr>`).join('')}</tbody></table>`}
    </div>

    <div class="card">
      <h2>Approval pipeline</h2>
      <table><thead><tr><th>Status</th><th>Count</th></tr></thead>
      <tbody>${Object.entries(d.pipeline).map(([status, count]) => `<tr><td>${STATUS_LABELS[status] || escapeHtml(status)}</td><td>${count}</td></tr>`).join('')}</tbody></table>
    </div>

    <div class="card card-accent accent-yellow">
      <h2>Exceptions</h2>
      <h3>High-value items awaiting second approval</h3>
      ${exceptionRows(d.exceptions.highValuePendingSecondApproval)}
      <h3>Missing receipts</h3>
      ${exceptionRows(d.exceptions.missingReceipts)}
      <h3>Old pending items (14+ days)</h3>
      ${exceptionRows(d.exceptions.oldPending)}
    </div>
  `;
}
