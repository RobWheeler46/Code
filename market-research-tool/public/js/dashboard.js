function assetRow(asset, extra) {
  const price = asset.snapshot ? formatPrice(asset.snapshot.price, asset.snapshot.currency) : '&ndash;';
  const change = asset.snapshot ? formatPct(asset.snapshot.change24hPct) : '&ndash;';
  return `
    <div class="search-result" style="cursor:pointer" onclick="location.href='asset.html?id=${asset.id}'">
      <div>
        <strong>${escapeHtml(asset.symbol)}</strong> <span class="badge asset-class">${escapeHtml(assetClassLabel(asset.assetClass))}</span>
        ${asset.isHighRisk ? '<span class="badge risk-flag">high risk</span>' : ''}
        <div class="meta">${escapeHtml(asset.name || '')}</div>
      </div>
      <div style="text-align:right">
        <div>${price}</div>
        <div>${change}</div>
        ${extra || ''}
      </div>
    </div>
  `;
}

function signalRow(signal) {
  const symbol = signal.asset ? signal.asset.symbol : `Asset #${signal.assetId}`;
  return `
    <div class="search-result" style="cursor:pointer" onclick="location.href='signal.html?id=${signal.id}'">
      <div>
        ${signalTypeBadge(signal.signalType)} ${strengthBadge(signal.strength)}
        <div class="meta">${escapeHtml(symbol)} &middot; ${escapeHtml(signal.explanation)}</div>
      </div>
      <div style="text-align:right">
        <div><strong>${signal.score}</strong>/100</div>
        <div class="meta">${formatDateTime(signal.createdAt)}</div>
      </div>
    </div>
  `;
}

function alertRow(alert) {
  return `
    <div class="notif-item ${alert.readAt ? '' : 'unread'}">
      <span class="badge" style="background:${alert.severity === 'critical' ? 'var(--red)' : alert.severity === 'high' ? 'var(--amber)' : 'var(--muted)'}">${escapeHtml(alert.severity)}</span>
      ${escapeHtml(alert.message)}
      <small>${formatDateTime(alert.createdAt)}</small>
    </div>
  `;
}

async function loadDashboard() {
  const me = await initNav();
  if (!me) return;

  const data = await Api.get('/api/dashboard');

  document.getElementById('stat-tiles').innerHTML = `
    <div class="stat-tile"><div class="label">Watchlists</div><div class="value">${data.watchlistCount}</div></div>
    <div class="stat-tile"><div class="label">Watched Assets</div><div class="value">${data.assetCount}</div></div>
    <div class="stat-tile"><div class="label">Active Signals</div><div class="value">${data.activeSignals.length}</div></div>
    <div class="stat-tile"><div class="label">Stale Data</div><div class="value">${data.dataStatus.staleCount}</div></div>
  `;

  if (data.dataStatus.staleCount > 0) {
    document.getElementById('stale-warning').innerHTML = `
      <div class="alert alert-warning">Data for ${data.dataStatus.staleCount} asset(s) looks delayed or stale:
      ${data.dataStatus.staleAssets.map(a => escapeHtml(a.symbol)).join(', ')}.</div>
    `;
  }

  document.getElementById('top-risers').innerHTML = data.topRisers.length
    ? data.topRisers.map(a => assetRow(a)).join('')
    : '<div class="empty-state">No data yet.</div>';

  document.getElementById('top-fallers').innerHTML = data.topFallers.length
    ? data.topFallers.map(a => assetRow(a)).join('')
    : '<div class="empty-state">No data yet.</div>';

  document.getElementById('volume-movers').innerHTML = data.highestVolumeMovers.length
    ? data.highestVolumeMovers.map(a => assetRow(a, `<div class="meta">${(a.snapshot.volume / a.snapshot.avgVolume).toFixed(1)}x avg vol</div>`)).join('')
    : '<div class="empty-state">No data yet.</div>';

  document.getElementById('risk-warnings').innerHTML = data.pennyShareWarnings.length
    ? data.pennyShareWarnings.map(a => assetRow(a)).join('')
    : '<div class="empty-state">No high-risk assets flagged.</div>';

  document.getElementById('recent-alerts').innerHTML = data.recentAlerts.length
    ? data.recentAlerts.map(alertRow).join('')
    : '<div class="empty-state">No alerts yet.</div>';

  document.getElementById('active-signals').innerHTML = data.activeSignals.length
    ? data.activeSignals.map(signalRow).join('')
    : '<div class="empty-state">No active signals. Add assets to a watchlist to start monitoring.</div>';
}

loadDashboard();
