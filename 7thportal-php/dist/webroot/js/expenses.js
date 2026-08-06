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
      <table class="rcards"><thead><tr><th>Claimant</th><th>Claim</th><th>Item</th><th>Account</th><th>Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${approvals.map(i => `
        <tr>
          <td data-label="Claimant">${escapeHtml(i.claimant ? i.claimant.name : '')}</td><td data-label="Claim">${escapeHtml(i.claimNumber)}</td><td data-label="Item" class="rcard-title">${escapeHtml(i.title)}</td>
          <td data-label="Account">${escapeHtml(i.account.name)}</td><td data-label="Amount">&pound;${(i.claimedAmount || 0).toFixed(2)}</td><td data-label="Status">${statusBadge(i.status)}</td>
          <td class="rcard-actions"><a class="btn btn-secondary btn-sm" href="claim-edit.html?id=${i.claimId}">Review</a></td>
        </tr>`).join('')}</tbody></table>
    </div>` : ''}

    <div class="card">
      <h2>My claims</h2>
      <div class="actions-row">
        <button class="btn btn-primary btn-sm" id="new-claim">New claim</button>
      </div>
      <div id="new-claim-error"></div>
      ${claims.length === 0 ? '<p class="muted">No claims yet.</p>' : `
      <table class="rcards"><thead><tr><th>Claim</th><th>Title</th><th>Items</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${claims.map(c => `
        <tr>
          <td data-label="Claim">${escapeHtml(c.claimNumber)}</td><td data-label="Title" class="rcard-title">${escapeHtml(c.title)}</td><td data-label="Items">${c.itemCount}</td>
          <td data-label="Total">&pound;${c.claimTotalAmount.toFixed(2)}</td><td data-label="Status">${statusBadge(c.status)}</td>
          <td class="rcard-actions"><a class="btn btn-secondary btn-sm" href="claim-edit.html?id=${c.id}">${c.status === 'draft' ? 'Edit' : 'View'}</a></td>
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
