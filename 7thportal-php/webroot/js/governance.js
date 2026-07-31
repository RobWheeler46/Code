// Trustee governance dashboard (LATER-010). Read-only aggregate view over the
// operational modules. Panels only appear for enabled modules (the API omits them).
(async () => {
  const me = await requireUserNav();
  if (!me) return;
  const box = document.getElementById('content');
  let data;
  try { data = await Api.get('/api/governance/dashboard'); }
  catch (e) {
    box.innerHTML = e.status === 403
      ? '<div class="alert alert-error">Trustee Board access is required for this page.</div>'
      : `<div class="alert alert-error">${escapeHtml(e.message)}</div>`;
    return;
  }
  const p = data.panels;
  box.innerHTML = [
    incidentsPanel(p.incidents),
    capacityPanel(p.capacity),
    financePanel(p.finance),
    quartermasterPanel(p.quartermaster),
    equipmentPanel(p.equipment),
    eventsPanel(p.events),
  ].filter(Boolean).join('') +
    `<p class="muted" style="margin-top:.5rem">Generated ${new Date(data.generatedAt).toLocaleString('en-GB')} &middot; viewing as ${escapeHtml(data.role)}.</p>`;
})();

// A stat cell: big number + label, optional "warn" styling when non-zero.
function stat(n, label, warn) {
  const danger = warn && n > 0;
  return `<div class="card" style="${danger ? 'border-left:4px solid #c62828;' : ''}">
    <div class="muted">${escapeHtml(label)}</div>
    <div style="font-size:1.6rem;font-weight:800;margin-top:.15rem;${danger ? 'color:#c62828' : ''}">${n}</div></div>`;
}
function panel(title, link, linkLabel, statsHtml, extra) {
  return `<div class="card">
    <div class="cap-head"><h2 style="margin:0">${escapeHtml(title)}</h2>${link ? `<a class="btn btn-secondary btn-sm" href="${link}">${escapeHtml(linkLabel)} &rarr;</a>` : ''}</div>
    <div class="cap-stats" style="margin-top:.6rem">${statsHtml}</div>
    ${extra || ''}
  </div>`;
}

function incidentsPanel(d) {
  if (!d) return '';
  const byType = d.byType && d.byType.length
    ? `<p class="muted" style="margin-top:.4rem">This month: ${d.byType.map(t => `${escapeHtml(t.label)} (${t.count})`).join(', ')}</p>` : '';
  return panel('Safeguarding & incidents', 'incidents.html', 'Open incidents',
    stat(d.open, 'Open records') + stat(d.overdueActions, 'Overdue actions', true) + stat(d.thisMonth, 'Logged this month') + stat(d.total, 'Total records'),
    byType + '<p class="muted" style="font-size:.8rem">Counts only. Sensitive detail is restricted to safeguarding leads and never shown here.</p>');
}
function capacityPanel(d) {
  if (!d) return '';
  const atRisk = d.atRisk && d.atRisk.length
    ? `<p class="muted" style="margin-top:.4rem">Near/over capacity: ${d.atRisk.map(s => `${escapeHtml(s.section)} (${s.utilisation != null ? s.utilisation + '%' : s.status})`).join(', ')}</p>` : '';
  return panel('Section capacity', null, null,
    stat(d.totalActive, 'Active young people') + stat(d.availableSpaces, 'Available spaces') + stat(d.nearCapacity, 'Sections near/over capacity', true) + stat(d.sections, 'Sections'),
    atRisk);
}
function financePanel(d) {
  if (!d) return '';
  const gbp = n => '£' + Number(n || 0).toFixed(2);
  return panel('Finance', 'trustee-dashboard.html', 'Finance detail',
    `<div class="card"><div class="muted">Spend this month</div><div style="font-size:1.6rem;font-weight:800;margin-top:.15rem">${gbp(d.monthlySpend)}</div></div>
     <div class="card"><div class="muted">Spend year to date</div><div style="font-size:1.6rem;font-weight:800;margin-top:.15rem">${gbp(d.ytdSpend)}</div></div>`
    + stat(d.pending, 'Claims pending approval') + stat(d.awaitingPayment, 'Awaiting payment', true));
}
function quartermasterPanel(d) {
  if (!d) return '';
  return panel('Quartermaster', 'quartermaster.html', 'Open QM',
    stat(d.pendingReview, 'Awaiting review') + stat(d.onLoan, 'On loan') + stat(d.overdue, 'Overdue returns', true) + stat(d.damaged, 'Damaged items', true));
}
function equipmentPanel(d) {
  if (!d) return '';
  return panel('Equipment', 'equipment.html', 'Open register',
    stat(d.total, 'Assets') + stat(d.checksDue, 'Checks due (30 days)', true) + stat(d.replacementRisk, 'Replacement risk', true));
}
function eventsPanel(d) {
  if (!d) return '';
  return panel('Events & camps', 'events.html', 'Open events',
    stat(d.upcoming, 'Upcoming published') + stat(d.published, 'Published total') + stat(d.draft, 'In draft'));
}
