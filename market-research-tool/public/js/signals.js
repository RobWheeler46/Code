function signalRow(signal) {
  const symbol = signal.asset ? signal.asset.symbol : `Asset #${signal.assetId}`;
  return `
    <div class="search-result" style="cursor:pointer" onclick="location.href='signal.html?id=${signal.id}'">
      <div>
        ${signalTypeBadge(signal.signalType)} ${strengthBadge(signal.strength)}
        <span class="badge">${escapeHtml(signal.status)}</span>
        <span class="badge outcome-${signal.outcome}">${escapeHtml(signal.outcome.replace(/_/g, ' '))}</span>
        <div class="meta">${escapeHtml(symbol)} &middot; ${escapeHtml(signal.explanation)}</div>
      </div>
      <div style="text-align:right">
        <div><strong>${signal.score}</strong>/100</div>
        <div class="meta">${formatDateTime(signal.createdAt)}</div>
      </div>
    </div>
  `;
}

async function loadSignals() {
  const status = document.getElementById('filter-status').value;
  const type = document.getElementById('filter-type').value;
  const minScore = document.getElementById('filter-min-score').value;
  const outcome = document.getElementById('filter-outcome').value;
  const feedback = document.getElementById('filter-feedback').value;
  const dateFrom = document.getElementById('filter-date-from').value;
  const dateTo = document.getElementById('filter-date-to').value;
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (type) qs.set('type', type);
  if (minScore) qs.set('minScore', minScore);
  if (outcome) qs.set('outcome', outcome);
  if (feedback) qs.set('feedback', feedback);
  if (dateFrom) qs.set('dateFrom', dateFrom);
  if (dateTo) qs.set('dateTo', dateTo + ' 23:59:59');

  const signals = await Api.get(`/api/signals?${qs.toString()}`);
  document.getElementById('signal-list').innerHTML = signals.length
    ? signals.map(signalRow).join('')
    : '<div class="empty-state">No signals match these filters.</div>';
}

function performanceRow(stat) {
  return `
    <tr>
      <td>${signalTypeBadge(stat.signalType)}</td>
      <td>${stat.total}</td>
      <td>${stat.positive}</td>
      <td>${stat.neutral}</td>
      <td>${stat.negative}</td>
      <td>${stat.stillOpen}</td>
      <td>${stat.positiveRatePct !== null ? stat.positiveRatePct.toFixed(0) + '%' : '&ndash;'}</td>
      <td>${stat.feedbackUseful} / ${stat.feedbackNotUseful + stat.feedbackFalsePositive}</td>
    </tr>
  `;
}

async function loadRulePerformance() {
  const stats = await Api.get('/api/signals/rule-performance');
  document.getElementById('rule-performance').innerHTML = stats.length
    ? stats.map(performanceRow).join('')
    : '<tr><td colspan="8" class="empty-state">No signal history yet.</td></tr>';
}

document.getElementById('filter-apply').addEventListener('click', loadSignals);

(async () => {
  const me = await initNav();
  if (!me) return;
  await Promise.all([loadSignals(), loadRulePerformance()]);
})();
