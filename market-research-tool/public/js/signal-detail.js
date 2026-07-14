const params = new URLSearchParams(location.search);
const signalId = params.get('id');

async function load() {
  const s = await Api.get(`/api/signals/${signalId}`);

  document.title = `Signal - ${s.asset ? s.asset.symbol : ''} - Market Research Desk`;
  document.getElementById('signal-title').innerHTML = `${signalTypeBadge(s.signalType)} ${strengthBadge(s.strength)}`;
  document.getElementById('signal-explanation').textContent = s.explanation;
  document.getElementById('score-bar').style.width = `${s.score}%`;
  document.getElementById('score-text').textContent = `${s.score} / 100`;

  document.getElementById('triggered-rules').innerHTML = (s.triggeredRules || []).map(r => `<li>${escapeHtml(r)}</li>`).join('') || '<li class="muted">None recorded.</li>';

  document.getElementById('score-breakdown').innerHTML = (s.supportingData || []).map(b =>
    `<tr><td>${escapeHtml(b.component)}</td><td>${b.points} / ${b.max}</td></tr>`
  ).join('');

  document.getElementById('ctx-asset').innerHTML = s.asset
    ? `<a href="asset.html?id=${s.asset.id}">${escapeHtml(s.asset.symbol)}</a> - ${escapeHtml(s.asset.name || '')}`
    : `#${s.assetId}`;
  document.getElementById('ctx-price').textContent = s.priceAtSignal ?? '-';
  document.getElementById('ctx-created').textContent = formatDateTime(s.createdAt);
  document.getElementById('ctx-expiry').textContent = s.expiryAt ? formatDateTime(s.expiryAt) : 'n/a';
  document.getElementById('ctx-status').textContent = s.status;
  document.getElementById('ctx-outcome').innerHTML = `<span class="badge outcome-${s.outcome}">${escapeHtml(s.outcome.replace(/_/g, ' '))}</span>`;

  const checkpointLabels = { '1d': '1 day', '3d': '3 days', '7d': '7 days', '30d': '30 days', '90d': '90 days' };
  document.getElementById('outcome-checkpoints').innerHTML = Object.entries(s.outcomeCheckpoints || {}).map(([key, price]) => {
    if (price === null || price === undefined) {
      return `<tr><td>${checkpointLabels[key]}</td><td class="muted">not due yet</td><td class="muted">&ndash;</td></tr>`;
    }
    const pctChange = s.priceAtSignal ? ((price - s.priceAtSignal) / s.priceAtSignal) * 100 : null;
    return `<tr><td>${checkpointLabels[key]}</td><td>${price}</td><td>${formatPct(pctChange)}</td></tr>`;
  }).join('');

  const conflicting = (s.otherActiveSignals || []).filter(o =>
    (s.signalType === 'positive_setup' && o.signalType === 'sell_risk' && o.score >= 50) ||
    (s.signalType === 'sell_risk' && o.signalType === 'positive_setup' && o.score >= 50)
  );
  document.getElementById('conflict-warning').innerHTML = conflicting.length
    ? `<div class="alert alert-warning">Conflicting signal active for this asset: ${conflicting.map(c => `<a href="signal.html?id=${c.id}">${escapeHtml(c.signalType)}</a>`).join(', ')}. Review carefully before acting.</div>`
    : '';

  document.getElementById('feedback-current').textContent = s.userFeedback ? `Current feedback: ${s.userFeedback.replace(/_/g, ' ')}` : 'No feedback recorded yet.';
}

async function submitFeedback(feedback) {
  await Api.post(`/api/signals/${signalId}/feedback`, { feedback });
  await load();
}

(async () => {
  const me = await initNav();
  if (!me) return;
  await load();
})();
