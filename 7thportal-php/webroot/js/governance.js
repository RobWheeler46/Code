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
  box.innerHTML =
    `<div style="display:flex;justify-content:flex-end;margin-bottom:1rem;"><button class="btn" id="board-pack">Download board pack</button></div>` +
    [
      incidentsPanel(p.incidents),
      capacityPanel(p.capacity),
      financePanel(p.finance),
      quartermasterPanel(p.quartermaster),
      equipmentPanel(p.equipment),
      eventsPanel(p.events),
    ].filter(Boolean).join('') +
    `<p class="muted" style="margin-top:.5rem">Generated ${new Date(data.generatedAt).toLocaleString('en-GB')} &middot; viewing as ${escapeHtml(data.role)}.</p>`;
  document.getElementById('board-pack').addEventListener('click', () => openBoardPack(data));
})();

// A printable, exception-led board pack (backlog P3): a counts-only monthly summary
// a trustee can save as PDF / circulate. Opens a self-contained print window so it
// carries no app chrome and never any personal data.
function openBoardPack(data) {
  const p = data.panels;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const gbp = n => '£' + Number(n || 0).toFixed(2);
  const plural = (n, s) => n + ' ' + s + (n === 1 ? '' : 's');
  const when = new Date(data.generatedAt);
  const period = when.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  // Exceptions first — only the things that actually need the board's attention.
  const ex = [];
  if (p.incidents && p.incidents.overdueActions) ex.push(plural(p.incidents.overdueActions, 'overdue safeguarding / incident action'));
  if (p.capacity && p.capacity.atRisk && p.capacity.atRisk.length) ex.push(plural(p.capacity.atRisk.length, 'section') + ' near or over capacity (' + p.capacity.atRisk.map(s => esc(s.section)).join(', ') + ')');
  if (p.finance && p.finance.awaitingPayment) ex.push(plural(p.finance.awaitingPayment, 'claim') + ' awaiting payment');
  if (p.finance && p.finance.pending) ex.push(plural(p.finance.pending, 'claim') + ' pending approval');
  if (p.quartermaster && p.quartermaster.overdue) ex.push(plural(p.quartermaster.overdue, 'overdue equipment return'));
  if (p.quartermaster && p.quartermaster.damaged) ex.push(plural(p.quartermaster.damaged, 'damaged equipment item'));
  if (p.equipment && p.equipment.replacementRisk) ex.push(plural(p.equipment.replacementRisk, 'asset') + ' at replacement risk');
  if (p.equipment && p.equipment.checksDue) ex.push(plural(p.equipment.checksDue, 'equipment check') + ' due within 30 days');

  const row = (label, val) => `<tr><td>${label}</td><td class="n">${val}</td></tr>`;
  const table = rows => `<table>${rows}</table>`;
  let sections = '';
  if (p.incidents) sections += `<h2>Safeguarding &amp; incidents</h2>${table(
    row('Open records', p.incidents.open) + row('Overdue actions', p.incidents.overdueActions) + row('Logged this month', p.incidents.thisMonth) + row('Total records', p.incidents.total))}
    <p class="note">Counts only. Sensitive detail stays with safeguarding leads and is never in this pack.</p>`;
  if (p.capacity) sections += `<h2>Section capacity</h2>${table(
    row('Active young people', p.capacity.totalActive) + row('Available spaces', p.capacity.availableSpaces) + row('Sections near/over capacity', p.capacity.nearCapacity) + row('Sections', p.capacity.sections))}`;
  if (p.finance) sections += `<h2>Finance</h2>${table(
    row('Spend this month', gbp(p.finance.monthlySpend)) + row('Spend year to date', gbp(p.finance.ytdSpend)) + row('Claims pending approval', p.finance.pending) + row('Awaiting payment', p.finance.awaitingPayment))}`;
  if (p.quartermaster) sections += `<h2>Quartermaster</h2>${table(
    row('Awaiting review', p.quartermaster.pendingReview) + row('On loan', p.quartermaster.onLoan) + row('Overdue returns', p.quartermaster.overdue) + row('Damaged items', p.quartermaster.damaged))}`;
  if (p.equipment) sections += `<h2>Equipment</h2>${table(
    row('Assets', p.equipment.total) + row('Checks due (30 days)', p.equipment.checksDue) + row('Replacement risk', p.equipment.replacementRisk))}`;
  if (p.events) sections += `<h2>Events &amp; camps</h2>${table(
    row('Upcoming published', p.events.upcoming) + row('Published total', p.events.published) + row('In draft', p.events.draft))}`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Board pack ${esc(period)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1a1420;max-width:760px;margin:0 auto;padding:28px 32px;line-height:1.5}
      h1{font-size:1.5rem;margin:0} .sub{color:#555;margin:.2rem 0 0}
      h2{font-size:1.05rem;border-bottom:2px solid #6d28d9;padding-bottom:.2rem;margin:1.4rem 0 .4rem;color:#4c1d95}
      table{width:100%;border-collapse:collapse;font-size:.95rem} td{padding:.3rem 0;border-bottom:1px solid #eee} td.n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
      .exc{background:#f8f4ff;border:1px solid #e3ddf0;border-radius:8px;padding:.8rem 1rem;margin:1rem 0}
      .exc h2{border:0;margin:0 0 .4rem;color:#b3261e;padding:0} .exc ul{margin:0;padding-left:1.1rem} .exc li{margin:.15rem 0}
      .ok{color:#0a5f49;font-weight:600} .note{color:#666;font-size:.78rem;margin:.2rem 0 0}
      .foot{color:#777;font-size:.78rem;margin-top:1.6rem;border-top:1px solid #eee;padding-top:.6rem}
      .bar{display:flex;justify-content:flex-end;gap:.5rem;margin-bottom:1rem}
      .bar button{font:inherit;padding:.5rem 1rem;border:0;border-radius:999px;background:#6d28d9;color:#fff;cursor:pointer}
      @media print{.bar{display:none}}
    </style></head><body>
    <div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>
    <h1>7th Swindon Scouts &mdash; Trustee Board Pack</h1>
    <p class="sub">${esc(period)} &middot; generated ${when.toLocaleString('en-GB')} &middot; counts only, no personal data</p>
    <div class="exc"><h2>For the board&rsquo;s attention</h2>${ex.length ? `<ul>${ex.map(e => `<li>${e}</li>`).join('')}</ul>` : '<p class="ok">Nothing needs the board&rsquo;s attention this period.</p>'}</div>
    ${sections}
    <p class="foot">7thPortal governance export. Figures are point-in-time aggregates from the operational modules; open the relevant module for detail.</p>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to open the board pack.'); return; }
  w.document.write(html);
  w.document.close();
}

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
