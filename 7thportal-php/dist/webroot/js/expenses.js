let ME = null;

(async () => {
  ME = await requireUserNav();
  if (!ME) return;
  if (ME.role === 'parent') { location.href = 'parent-dashboard.html'; return; }
  await load();
})();

async function load() {
  const content = document.getElementById('content');
  content.innerHTML = '<p class="muted">Loading&hellip;</p>';
  const cfg = await Api.get('/api/config');
  if (!cfg.financeEnabled) {
    content.innerHTML = '<div class="alert alert-warning">Expenses and mileage claims are not enabled yet. Ask a Portal Administrator to turn this on in Admin Settings.</div>';
    return;
  }
  const [claims, myStatus] = await Promise.all([Api.get('/api/finance/claims'), Api.get('/api/finance/my-status')]);
  const approvals = myStatus.isApprover || myStatus.isTreasurer || myStatus.isChair ? await Api.get('/api/finance/approvals') : [];

  content.innerHTML = `
    ${approvals.length ? `
    <div class="card card-accent accent-yellow">
      <h2>Awaiting your approval (${approvals.length})</h2>
      <table><thead><tr><th>Claimant</th><th>Claim</th><th>Item</th><th>Account</th><th>Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${approvals.map(i => `
        <tr>
          <td>${escapeHtml(i.claimant ? i.claimant.name : '')}</td><td>${escapeHtml(i.claimNumber)}</td><td>${escapeHtml(i.title)}</td>
          <td>${escapeHtml(i.account.name)}</td><td>&pound;${(i.claimedAmount || 0).toFixed(2)}</td><td>${statusBadge(i.status)}</td>
          <td><a class="btn btn-secondary btn-sm" href="claim-edit.html?id=${i.claimId}">Review</a></td>
        </tr>`).join('')}</tbody></table>
    </div>` : ''}

    <div class="card">
      <h2>My claims</h2>
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" id="new-claim">New claim</button>
      </div>
      <div id="new-claim-error"></div>
      ${claims.length === 0 ? '<p class="muted">No claims yet.</p>' : `
      <table><thead><tr><th>Claim</th><th>Title</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${claims.map(c => `
        <tr>
          <td>${escapeHtml(c.claimNumber)}</td><td>${escapeHtml(c.title)}</td><td>${c.itemCount}</td>
          <td>&pound;${c.claimTotalAmount.toFixed(2)}</td><td>${statusBadge(c.status)}</td>
          <td><a class="btn btn-secondary btn-sm" href="claim-edit.html?id=${c.id}">${c.status === 'draft' ? 'Edit' : 'View'}</a></td>
        </tr>`).join('')}</tbody></table>`}
    </div>
  `;

  document.getElementById('new-claim').addEventListener('click', async () => {
    try {
      const created = await Api.post('/api/finance/claims', { title: 'New expense claim' });
      location.href = `claim-edit.html?id=${created.id}`;
    } catch (err) {
      document.getElementById('new-claim-error').innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  });
}
