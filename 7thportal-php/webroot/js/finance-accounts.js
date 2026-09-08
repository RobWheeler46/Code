// Finance Accounts view (FR-FIN-003): per-account spend across the claim pipeline.
// Read-only oversight for the Treasurer / Trustee Board (route-enforced too).
const money = n => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  if (!['treasurer', 'admin', 'trustee_viewer', 'chair'].includes(me.role)) {
    box.innerHTML = '<div class="alert alert-error">Finance oversight access is required for this view.</div>';
    return;
  }
  let d;
  try { d = await Api.get('/api/finance/accounts-summary'); }
  catch (e) { box.innerHTML = `<div class="alert alert-error">${escapeHtml(e.message)}</div>`; return; }

  const yearLabel = (d.yearStart || '').slice(0, 4);
  const row = a => `<tr${a.active ? '' : ' class="muted"'}>
      <td class="rcard-title"><strong>${escapeHtml(a.name)}</strong>${a.code ? ` <span class="muted">${escapeHtml(a.code)}</span>` : ''}${a.active ? '' : ' <span class="badge" data-status="archived">inactive</span>'}</td>
      <td data-label="Items" class="num">${a.itemCount}</td>
      <td data-label="In flight" class="num">${money(a.inFlight)}</td>
      <td data-label="Payable" class="num">${money(a.payable)}</td>
      <td data-label="Paid ${yearLabel}" class="num">${money(a.paidYtd)}</td>
      <td data-label="Paid (all)" class="num">${money(a.paid)}</td>
    </tr>`;
  const t = d.totals || {};
  box.innerHTML = `
    <p class="muted">Every account's non-draft claim value, split by where it is in the pipeline. <strong>In flight</strong> is awaiting a decision, <strong>payable</strong> is approved but not yet paid, and paid totals are recorded payments.</p>
    <div class="card" style="padding:0;overflow-x:auto;">
      <table class="data-table rcards fin-accounts" style="margin:0;">
        <thead><tr><th>Account</th><th class="num">Items</th><th class="num">In flight</th><th class="num">Payable</th><th class="num">Paid ${yearLabel}</th><th class="num">Paid (all time)</th></tr></thead>
        <tbody>${d.accounts.length ? d.accounts.map(row).join('') : '<tr><td colspan="6"><div class="empty-state">No accounts yet. Add accounts in Admin › Finance.</div></td></tr>'}</tbody>
        ${d.accounts.length ? `<tfoot><tr class="fin-total">
          <td><strong>Total</strong></td><td class="num">${t.items}</td><td class="num">${money(t.inFlight)}</td>
          <td class="num">${money(t.payable)}</td><td class="num">${money(t.paidYtd)}</td><td class="num">${money(t.paid)}</td>
        </tr></tfoot>` : ''}
      </table>
    </div>`;
})();
