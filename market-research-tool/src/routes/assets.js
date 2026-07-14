const express = require('express');
const db = require('../db');
const marketData = require('../lib/marketData');
const indicatorsLib = require('../lib/indicators');
const scheduler = require('../lib/scheduler');
const { serializeAsset, serializeSignal, serializeNote } = require('../lib/helpers');

const router = express.Router();

router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const results = await marketData.searchAssets(q);
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: 'Could not search for assets right now. Try again shortly.' });
  }
});

router.get('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });

  const bars = db.prepare('SELECT bar_date, close, volume FROM daily_bars WHERE asset_id = ? ORDER BY bar_date').all(asset.id);
  const indicators = bars.length ? indicatorsLib.computeIndicators(bars.map(b => ({ close: b.close, volume: b.volume }))) : null;

  const activeSignals = db.prepare("SELECT * FROM signals WHERE asset_id = ? AND status = 'active' ORDER BY score DESC").all(asset.id).map(serializeSignal);
  const historicalSignals = db.prepare("SELECT * FROM signals WHERE asset_id = ? AND status != 'active' ORDER BY created_at DESC LIMIT 50").all(asset.id).map(serializeSignal);
  const notes = db.prepare('SELECT * FROM notes WHERE asset_id = ? ORDER BY created_at DESC').all(asset.id).map(serializeNote);
  const watchlists = db.prepare(`
    SELECT w.id, w.name FROM watchlists w
    JOIN watchlist_assets wa ON wa.watchlist_id = w.id
    WHERE wa.asset_id = ?
  `).all(asset.id);

  res.json({
    ...serializeAsset(asset),
    indicators,
    indicatorsExplanation: indicators ? indicatorsLib.explainIndicators(indicators) : null,
    chartBars: bars.slice(-90),
    activeSignals,
    historicalSignals,
    notes,
    watchlists
  });
});

router.patch('/:id', (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  const { researchStatus } = req.body || {};
  if (researchStatus) {
    db.prepare('UPDATE assets SET research_status = ? WHERE id = ?').run(researchStatus, asset.id);
  }
  res.json(serializeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id)));
});

router.post('/:id/refresh', async (req, res) => {
  const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found.' });
  try {
    await scheduler.refreshAsset(asset);
    res.json(serializeAsset(db.prepare('SELECT * FROM assets WHERE id = ?').get(asset.id)));
  } catch (err) {
    res.status(502).json({ error: 'Refresh failed: ' + err.message });
  }
});

module.exports = router;
