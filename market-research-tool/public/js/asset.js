const params = new URLSearchParams(location.search);
const assetId = params.get('id');

function drawSparkline(canvas, bars) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (bars.length < 2) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Not enough history yet.', 10, h / 2);
    return;
  }
  const closes = bars.map(b => b.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const padding = 10;

  ctx.strokeStyle = closes[closes.length - 1] >= closes[0] ? '#1e8449' : '#b3261e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  closes.forEach((close, i) => {
    const x = padding + (i / (closes.length - 1)) * (w - padding * 2);
    const y = h - padding - ((close - min) / range) * (h - padding * 2);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function signalCard(signal) {
  return `
    <div class="search-result" style="cursor:pointer" onclick="location.href='signal.html?id=${signal.id}'">
      <div>
        ${signalTypeBadge(signal.signalType)} ${strengthBadge(signal.strength)}
        <div class="meta">${escapeHtml(signal.explanation)}</div>
      </div>
      <div style="text-align:right">
        <div><strong>${signal.score}</strong>/100</div>
        <div class="meta">${formatDateTime(signal.createdAt)} &middot; ${escapeHtml(signal.status)}</div>
      </div>
    </div>
  `;
}

function noteItem(note) {
  return `
    <div class="note-item">
      <div>${escapeHtml(note.noteText)}</div>
      ${note.tags.length ? `<div class="tag-list">${note.tags.map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
      <div class="when">${formatDateTime(note.createdAt)}</div>
    </div>
  `;
}

async function load() {
  const asset = await Api.get(`/api/assets/${assetId}`);

  document.title = `${asset.symbol} - Market Research Desk`;
  document.getElementById('asset-title').textContent = `${asset.symbol} - ${asset.name || ''}`;
  document.getElementById('asset-subtitle').innerHTML =
    `${assetClassLabel(asset.assetClass)} ${asset.exchange ? '&middot; ' + escapeHtml(asset.exchange) : ''} ${asset.sector ? '&middot; ' + escapeHtml(asset.sector) : ''}`;

  if (asset.isStale) {
    document.getElementById('stale-warning').innerHTML = '<div class="alert alert-warning">Data for this asset looks delayed or stale. Use Refresh now to try again.</div>';
  }

  const s = asset.snapshot || {};
  document.getElementById('stat-tiles').innerHTML = `
    <div class="stat-tile"><div class="label">Price</div><div class="value">${formatPrice(s.price, s.currency)}</div></div>
    <div class="stat-tile"><div class="label">24h Change</div><div class="value">${formatPct(s.change24hPct)}</div></div>
    <div class="stat-tile"><div class="label">Volume vs Avg</div><div class="value">${s.volume && s.avgVolume ? (s.volume / s.avgVolume).toFixed(1) + 'x' : '&ndash;'}</div></div>
    <div class="stat-tile"><div class="label">52wk Range</div><div class="value" style="font-size:1rem">${s.fiftyTwoWeekLow ? formatPrice(s.fiftyTwoWeekLow, s.currency) : '&ndash;'} - ${s.fiftyTwoWeekHigh ? formatPrice(s.fiftyTwoWeekHigh, s.currency) : '&ndash;'}</div></div>
  `;

  drawSparkline(document.getElementById('sparkline'), asset.chartBars || []);

  const ind = asset.indicators;
  document.getElementById('indicators').innerHTML = ind ? `
    <table>
      <tr><td>20-day average</td><td>${formatPrice(ind.sma20, s.currency)}</td></tr>
      <tr><td>50-day average</td><td>${formatPrice(ind.sma50, s.currency)}</td></tr>
      <tr><td>200-day average</td><td>${formatPrice(ind.sma200, s.currency)}</td></tr>
      <tr><td>RSI (14)</td><td>${ind.rsi14 !== null ? ind.rsi14.toFixed(0) : '&ndash;'}</td></tr>
      <tr><td>Volatility</td><td>${ind.volatilityPct !== null ? ind.volatilityPct.toFixed(1) + '%' : '&ndash;'}</td></tr>
      <tr><td>Support / Resistance</td><td>${formatPrice(ind.support, s.currency)} / ${formatPrice(ind.resistance, s.currency)}</td></tr>
    </table>
    <p class="muted">${escapeHtml(asset.indicatorsExplanation || '')}</p>
  ` : '<p class="empty-state">Not enough price history yet.</p>';

  const flags = [];
  if (asset.isPennyShare) flags.push('Penny share');
  if (asset.isHighRisk) flags.push('High risk');
  document.getElementById('risk-flags').innerHTML = flags.length
    ? flags.map(f => `<span class="badge risk-flag">${escapeHtml(f)}</span>`).join(' ')
    : '<p class="muted">No risk flags.</p>';
  document.getElementById('research-status').value = asset.researchStatus;

  document.getElementById('active-signals').innerHTML = asset.activeSignals.length
    ? asset.activeSignals.map(signalCard).join('')
    : '<div class="empty-state">No active signals for this asset.</div>';

  document.getElementById('historical-signals').innerHTML = asset.historicalSignals.length
    ? asset.historicalSignals.map(signalCard).join('')
    : '<div class="empty-state">No signal history yet.</div>';

  document.getElementById('notes-list').innerHTML = asset.notes.length
    ? asset.notes.map(noteItem).join('')
    : '<div class="empty-state">No notes yet.</div>';
}

document.getElementById('refresh-btn').addEventListener('click', async () => {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  btn.textContent = 'Refreshing...';
  try {
    await Api.post(`/api/assets/${assetId}/refresh`);
    await load();
  } catch (err) {
    alert('Refresh failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Refresh now';
  }
});

document.getElementById('research-status').addEventListener('change', async (e) => {
  await Api.patch(`/api/assets/${assetId}`, { researchStatus: e.target.value });
});

document.getElementById('note-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = document.getElementById('note-text').value.trim();
  if (!text) return;
  const tags = document.getElementById('note-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  await Api.post('/api/notes', { assetId, noteText: text, tags });
  document.getElementById('note-text').value = '';
  document.getElementById('note-tags').value = '';
  await load();
});

(async () => {
  const me = await initNav();
  if (!me) return;
  await load();
})();
