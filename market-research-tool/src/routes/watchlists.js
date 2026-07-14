const express = require('express');
const db = require('../db');
const marketData = require('../lib/marketData');
const scheduler = require('../lib/scheduler');
const { serializeAsset } = require('../lib/helpers');

const router = express.Router();

function watchlistSummary(watchlist) {
  const assets = db.prepare(`
    SELECT a.* FROM assets a
    JOIN watchlist_assets wa ON wa.asset_id = a.id
    WHERE wa.watchlist_id = ?
  `).all(watchlist.id).map(serializeAsset);

  const activeSignals = db.prepare(`
    SELECT COUNT(*) as n FROM signals s
    JOIN watchlist_assets wa ON wa.asset_id = s.asset_id
    WHERE wa.watchlist_id = ? AND s.status = 'active'
  `).get(watchlist.id).n;

  const withChange = assets.filter(a => a.snapshot && a.snapshot.change24hPct !== null && a.snapshot.change24hPct !== undefined);
  const biggestRiser = withChange.length ? withChange.reduce((a, b) => (a.snapshot.change24hPct > b.snapshot.change24hPct ? a : b)) : null;
  const biggestFaller = withChange.length ? withChange.reduce((a, b) => (a.snapshot.change24hPct < b.snapshot.change24hPct ? a : b)) : null;

  const withVolume = assets.filter(a => a.snapshot && a.snapshot.volume && a.snapshot.avgVolume);
  const highestVolumeMover = withVolume.length
    ? withVolume.reduce((a, b) => (a.snapshot.volume / a.snapshot.avgVolume > b.snapshot.volume / b.snapshot.avgVolume ? a : b))
    : null;

  const lastUpdated = assets
    .map(a => a.snapshot && a.snapshot.fetchedAt)
    .filter(Boolean)
    .sort()
    .pop() || null;

  return {
    id: watchlist.id,
    name: watchlist.name,
    description: watchlist.description,
    category: watchlist.category,
    createdAt: watchlist.created_at,
    updatedAt: watchlist.updated_at,
    assetCount: assets.length,
    activeSignalCount: activeSignals,
    biggestRiser: biggestRiser ? { symbol: biggestRiser.symbol, id: biggestRiser.id, change24hPct: biggestRiser.snapshot.change24hPct } : null,
    biggestFaller: biggestFaller ? { symbol: biggestFaller.symbol, id: biggestFaller.id, change24hPct: biggestFaller.snapshot.change24hPct } : null,
    highestVolumeMover: highestVolumeMover ? { symbol: highestVolumeMover.symbol, id: highestVolumeMover.id } : null,
    lastUpdated
  };
}

router.get('/', (req, res) => {
  const watchlists = db.prepare('SELECT * FROM watchlists WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json(watchlists.map(watchlistSummary));
});

router.post('/', (req, res) => {
  const { name, description, category } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Watchlist name is required.' });
  const result = db.prepare('INSERT INTO watchlists (user_id, name, description, category) VALUES (?, ?, ?, ?)')
    .run(req.user.id, name, description || null, category || null);
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(result.lastInsertRowid);
  res.json(watchlistSummary(watchlist));
});

router.get('/:id', (req, res) => {
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!watchlist) return res.status(404).json({ error: 'Watchlist not found.' });
  const summary = watchlistSummary(watchlist);
  const assets = db.prepare(`
    SELECT a.* FROM assets a
    JOIN watchlist_assets wa ON wa.asset_id = a.id
    WHERE wa.watchlist_id = ?
    ORDER BY a.symbol
  `).all(watchlist.id).map(serializeAsset);
  res.json({ ...summary, assets });
});

router.patch('/:id', (req, res) => {
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!watchlist) return res.status(404).json({ error: 'Watchlist not found.' });
  const { name, description, category } = req.body || {};
  db.prepare("UPDATE watchlists SET name = COALESCE(?, name), description = ?, category = ?, updated_at = datetime('now') WHERE id = ?")
    .run(name || null, description !== undefined ? description : watchlist.description, category !== undefined ? category : watchlist.category, watchlist.id);
  res.json(watchlistSummary(db.prepare('SELECT * FROM watchlists WHERE id = ?').get(watchlist.id)));
});

router.delete('/:id', (req, res) => {
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!watchlist) return res.status(404).json({ error: 'Watchlist not found.' });
  db.prepare('DELETE FROM watchlist_assets WHERE watchlist_id = ?').run(watchlist.id);
  db.prepare('DELETE FROM watchlists WHERE id = ?').run(watchlist.id);
  res.json({ ok: true });
});

router.post('/:id/assets', async (req, res) => {
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!watchlist) return res.status(404).json({ error: 'Watchlist not found.' });

  const { symbol, name, assetClass, exchange, sector } = req.body || {};
  if (!symbol || !assetClass) return res.status(400).json({ error: 'symbol and assetClass are required.' });

  let asset = db.prepare('SELECT * FROM assets WHERE symbol = ? AND asset_class = ?').get(symbol, assetClass);
  if (!asset) {
    const result = db.prepare('INSERT INTO assets (symbol, name, asset_class, exchange, sector) VALUES (?, ?, ?, ?, ?)')
      .run(symbol, name || symbol, assetClass, exchange || null, sector || null);
    asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.lastInsertRowid);
  }

  db.prepare('INSERT OR IGNORE INTO watchlist_assets (watchlist_id, asset_id) VALUES (?, ?)').run(watchlist.id, asset.id);
  db.prepare("UPDATE watchlists SET updated_at = datetime('now') WHERE id = ?").run(watchlist.id);

  scheduler.refreshAsset(asset).catch(() => {});

  res.json(serializeAsset(asset));
});

router.delete('/:id/assets/:assetId', (req, res) => {
  const watchlist = db.prepare('SELECT * FROM watchlists WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!watchlist) return res.status(404).json({ error: 'Watchlist not found.' });
  db.prepare('DELETE FROM watchlist_assets WHERE watchlist_id = ? AND asset_id = ?').run(watchlist.id, req.params.assetId);
  res.json({ ok: true });
});

module.exports = router;
