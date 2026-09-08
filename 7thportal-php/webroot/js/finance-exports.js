// Finance Exports view (FR-FIN-003): build a filtered CSV of claim items and download
// it. Treasurer / admin only (route-enforced); the CSV includes claimant names.
(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  if (!['treasurer', 'admin'].includes(me.role)) {
    box.innerHTML = '<div class="alert alert-error">Treasurer access is required to export finance data.</div>';
    return;
  }
  let opts;
  try { opts = await Api.get('/api/finance/export-options'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  const accountOpts = ['<option value="">All accounts</option>']
    .concat(opts.accounts.map(a => `<option value="${a.id}">${escapeHtml(a.name)}${a.active ? '' : ' (inactive)'}</option>`)).join('');
  const statusOpts = ['<option value="">All statuses (excludes drafts)</option>']
    .concat(Object.entries(opts.statuses).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`)).join('');

  box.innerHTML = `
    <div class="card">
      <p class="muted">Download claim items as a CSV for your records or accounting software. Drafts are always excluded; leave a filter blank to include everything. Dates filter on the expense date.</p>
      <div class="grid cols-2">
        <div class="field"><label>Account</label><select id="ex-account">${accountOpts}</select></div>
        <div class="field"><label>Status</label><select id="ex-status">${statusOpts}</select></div>
        <div class="field"><label>Expense date from</label><input type="date" id="ex-from"></div>
        <div class="field"><label>Expense date to</label><input type="date" id="ex-to"></div>
      </div>
      <div class="cap-actions" style="margin-top:.5rem"><button class="btn" id="ex-download">Download CSV</button></div>
      <p class="help">Includes claimant names, so treat the file as confidential.</p>
    </div>`;

  document.getElementById('ex-download').addEventListener('click', () => {
    const p = new URLSearchParams();
    const acc = document.getElementById('ex-account').value;
    const st = document.getElementById('ex-status').value;
    const from = document.getElementById('ex-from').value;
    const to = document.getElementById('ex-to').value;
    if (acc) p.set('accountId', acc);
    if (st) p.set('status', st);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    // A real browser download from the authenticated endpoint (session cookie carries).
    window.location.href = '/api/finance/export.csv' + (p.toString() ? '?' + p.toString() : '');
  });
})();
