const express = require('express');
const db = require('../db');
const { serializeAsset, serializeSignal, serializeAlert } = require('../lib/helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const watchlists = db.prepare('SELECT * FROM watchlists WHERE user_id = ?').all(req.user.id);

  const assets = db.prepare(`
    SELECT DISTINCT a.* FROM assets a
    JOIN watchlist_assets wa ON wa.asset_id = a.id
    JOIN watchlists w ON w.id = wa.watchlist_id
    WHERE w.user_id = ?
  `).all(req.user.id).map(serializeAsset);

  const withChange = assets.filter(a => a.snapshot && a.snapshot.change24hPct !== null && a.snapshot.change24hPct !== undefined);
  const topRisers = [...withChange].sort((a, b) => b.snapshot.change24hPct - a.snapshot.change24hPct).slice(0, 5);
  const topFallers = [...withChange].sort((a, b) => a.snapshot.change24hPct - b.snapshot.change24hPct).slice(0, 5);

  const withVolume = assets.filter(a => a.snapshot && a.snapshot.volume && a.snapshot.avgVolume);
  const highestVolumeMovers = [...withVolume]
    .sort((a, b) => (b.snapshot.volume / b.snapshot.avgVolume) - (a.snapshot.volume / a.snapshot.avgVolume))
    .slice(0, 5);

  const cryptoAssets = assets.filter(a => a.assetClass === 'crypto');
  const pennyShareWarnings = assets.filter(a => a.isPennyShare || a.isHighRisk);

  const assetIds = assets.map(a => a.id);
  let activeSignals = [];
  if (assetIds.length) {
    const placeholders = assetIds.map(() => '?').join(',');
    activeSignals = db.prepare(
      `SELECT * FROM signals WHERE asset_id IN (${placeholders}) AND status = 'active' ORDER BY score DESC LIMIT 20`
    ).all(...assetIds).map(serializeSignal);
  }

  const assetById = Object.fromEntries(assets.map(a => [a.id, a]));
  const recentAlerts = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 10').all().map(serializeAlert);

  const staleAssets = assets.filter(a => a.isStale);
  const lastRefresh = db.prepare("SELECT MAX(created_at) as ts FROM ingestion_log WHERE status = 'ok'").get().ts;

  res.json({
    watchlistCount: watchlists.length,
    assetCount: assets.length,
    activeSignals: activeSignals.map(s => ({ ...s, asset: assetById[s.assetId] || null })),
    topRisers,
    topFallers,
    highestVolumeMovers,
    cryptoAssets,
    pennyShareWarnings,
    recentAlerts,
    dataStatus: {
      lastRefresh,
      staleCount: staleAssets.length,
      staleAssets: staleAssets.map(a => ({ id: a.id, symbol: a.symbol }))
    }
  });
});

module.exports = router;
