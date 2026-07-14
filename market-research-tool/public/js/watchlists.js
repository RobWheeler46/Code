function watchlistCard(w) {
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:start">
        <div>
          <h2><a href="watchlists.html?id=${w.id}">${escapeHtml(w.name)}</a></h2>
          <p class="muted">${escapeHtml(w.description || '')}</p>
        </div>
        <button class="btn btn-danger btn-sm" onclick="deleteWatchlist(${w.id})">Delete</button>
      </div>
      <div class="grid cols-4">
        <div class="stat-tile"><div class="label">Assets</div><div class="value">${w.assetCount}</div></div>
        <div class="stat-tile"><div class="label">Active Signals</div><div class="value">${w.activeSignalCount}</div></div>
        <div class="stat-tile"><div class="label">Biggest Riser</div><div class="value">${w.biggestRiser ? escapeHtml(w.biggestRiser.symbol) : '&ndash;'}</div></div>
        <div class="stat-tile"><div class="label">Biggest Faller</div><div class="value">${w.biggestFaller ? escapeHtml(w.biggestFaller.symbol) : '&ndash;'}</div></div>
      </div>
      <p class="muted" style="margin-top:0.5rem">Last updated: ${w.lastUpdated ? formatDateTime(w.lastUpdated) : 'never'}</p>
    </div>
  `;
}

async function deleteWatchlist(id) {
  if (!confirm('Delete this watchlist? Assets and signal history are kept, only the watchlist grouping is removed.')) return;
  await Api.del(`/api/watchlists/${id}`);
  loadList();
}

async function loadList() {
  const watchlists = await Api.get('/api/watchlists');
  document.getElementById('watchlist-cards').innerHTML = watchlists.length
    ? watchlists.map(watchlistCard).join('')
    : '<div class="empty-state">No watchlists yet. Create one above.</div>';
}

document.getElementById('create-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const alertBox = document.getElementById('create-alert');
  alertBox.innerHTML = '';
  try {
    await Api.post('/api/watchlists', {
      name: document.getElementById('wl-name').value.trim(),
      description: document.getElementById('wl-description').value.trim(),
      category: document.getElementById('wl-category').value.trim()
    });
    document.getElementById('create-form').reset();
    loadList();
  } catch (err) {
    alertBox.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
  }
});

function assetTableRow(watchlistId, asset) {
  const price = asset.snapshot ? formatPrice(asset.snapshot.price, asset.snapshot.currency) : '&ndash;';
  const change = asset.snapshot ? formatPct(asset.snapshot.change24hPct) : '&ndash;';
  return `
    <tr class="clickable" onclick="location.href='asset.html?id=${asset.id}'">
      <td><strong>${escapeHtml(asset.symbol)}</strong>${asset.isHighRisk ? ' <span class="badge risk-flag">risk</span>' : ''}</td>
      <td>${escapeHtml(asset.name || '')}</td>
      <td><span class="badge asset-class">${escapeHtml(assetClassLabel(asset.assetClass))}</span></td>
      <td>${price}</td>
      <td>${change}</td>
      <td>${asset.isStale ? '<span class="stale-warning">stale</span>' : 'live'}</td>
      <td><button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); removeAsset(${watchlistId}, ${asset.id})">Remove</button></td>
    </tr>
  `;
}

let currentWatchlistId = null;

async function removeAsset(watchlistId, assetId) {
  await Api.del(`/api/watchlists/${watchlistId}/assets/${assetId}`);
  loadDetail(watchlistId);
}

async function loadDetail(id) {
  currentWatchlistId = id;
  const w = await Api.get(`/api/watchlists/${id}`);
  document.getElementById('detail-name').textContent = w.name;
  document.getElementById('detail-description').textContent = w.description || '';
  document.getElementById('asset-rows').innerHTML = w.assets.length
    ? w.assets.map(a => assetTableRow(id, a)).join('')
    : '<tr><td colspan="7" class="empty-state">No assets yet - search above to add one.</td></tr>';
}

let searchTimer = null;
document.getElementById('asset-search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const resultsBox = document.getElementById('asset-search-results');
  if (q.length < 2) { resultsBox.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const results = await Api.get(`/api/assets/search?q=${encodeURIComponent(q)}`);
    resultsBox.innerHTML = results.length
      ? results.map(r => `
        <div class="search-result">
          <div>
            <strong>${escapeHtml(r.symbol)}</strong> <span class="badge asset-class">${escapeHtml(assetClassLabel(r.assetClass))}</span>
            <div class="meta">${escapeHtml(r.name)} ${r.exchange ? '&middot; ' + escapeHtml(r.exchange) : ''}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick='addAsset(${JSON.stringify(r)})'>Add</button>
        </div>
      `).join('')
      : '<div class="empty-state">No matches.</div>';
  }, 350);
});

async function addAsset(result) {
  await Api.post(`/api/watchlists/${currentWatchlistId}/assets`, {
    symbol: result.symbol, name: result.name, assetClass: result.assetClass, exchange: result.exchange, sector: result.sector
  });
  document.getElementById('asset-search-input').value = '';
  document.getElementById('asset-search-results').innerHTML = '';
  loadDetail(currentWatchlistId);
}

async function init() {
  const me = await initNav();
  if (!me) return;
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id) {
    document.getElementById('list-view').style.display = 'none';
    document.getElementById('detail-view').style.display = 'block';
    await loadDetail(id);
  } else {
    await loadList();
  }
}

init();
