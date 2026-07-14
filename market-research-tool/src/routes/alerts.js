const express = require('express');
const db = require('../db');
const { serializeAlert } = require('../lib/helpers');

const router = express.Router();

router.get('/unread-count', (req, res) => {
  const { n } = db.prepare('SELECT COUNT(*) as n FROM alerts WHERE read_at IS NULL').get();
  res.json({ unreadCount: n });
});

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare('SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?').all(limit);
  const assetIds = [...new Set(rows.map(r => r.asset_id).filter(Boolean))];
  const assets = assetIds.length
    ? db.prepare(`SELECT id, symbol, name FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`).all(...assetIds)
    : [];
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]));
  res.json({ alerts: rows.map(r => ({ ...serializeAlert(r), asset: assetById[r.asset_id] || null })) });
});

router.post('/:id/read', (req, res) => {
  db.prepare("UPDATE alerts SET read_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.post('/read-all', (req, res) => {
  db.prepare("UPDATE alerts SET read_at = datetime('now') WHERE read_at IS NULL").run();
  res.json({ ok: true });
});

module.exports = router;
