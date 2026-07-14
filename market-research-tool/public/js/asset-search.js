let searchTimer = null;

async function loadWatchlistOptions() {
  const watchlists = await Api.get('/api/watchlists');
  const select = document.getElementById('watchlist-select');
  select.innerHTML = watchlists.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');
}

document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  const resultsBox = document.getElementById('search-results');
  if (q.length < 2) { resultsBox.innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    resultsBox.innerHTML = '<div class="muted">Searching&hellip;</div>';
    const results = await Api.get(`/api/assets/search?q=${encodeURIComponent(q)}`);
    resultsBox.innerHTML = results.length
      ? results.map(r => `
        <div class="search-result">
          <div>
            <strong>${escapeHtml(r.symbol)}</strong> <span class="badge asset-class">${escapeHtml(assetClassLabel(r.assetClass))}</span>
            <div class="meta">${escapeHtml(r.name)} ${r.exchange ? '&middot; ' + escapeHtml(r.exchange) : ''}</div>
          </div>
          <button class="btn btn-primary btn-sm" onclick='addAsset(${JSON.stringify(r)})'>Add to watchlist</button>
        </div>
      `).join('')
      : '<div class="empty-state">No matches.</div>';
  }, 350);
});

async function addAsset(result) {
  const watchlistId = document.getElementById('watchlist-select').value;
  if (!watchlistId) { alert('Create a watchlist first.'); return; }
  await Api.post(`/api/watchlists/${watchlistId}/assets`, {
    symbol: result.symbol, name: result.name, assetClass: result.assetClass, exchange: result.exchange, sector: result.sector
  });
  document.getElementById('search-results').innerHTML = `<div class="alert alert-success">Added ${escapeHtml(result.symbol)} to watchlist.</div>`;
}

(async () => {
  const me = await initNav();
  if (!me) return;
  await loadWatchlistOptions();
})();
