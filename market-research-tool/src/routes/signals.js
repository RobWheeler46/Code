const express = require('express');
const db = require('../db');
const { serializeSignal, serializeNote } = require('../lib/helpers');
const { rulePerformance } = require('../lib/outcomes');

const router = express.Router();

const VALID_FEEDBACK = ['useful', 'not_useful', 'false_positive', 'missed_context', 'needs_rule_adjustment'];

router.get('/', (req, res) => {
  const { status, type, assetId, watchlistId, minScore, outcome, feedback, dateFrom, dateTo } = req.query;
  const clauses = [];
  const params = [];

  let sql = `
    SELECT s.* FROM signals s
    ${watchlistId ? 'JOIN watchlist_assets wa ON wa.asset_id = s.asset_id' : ''}
  `;
  if (watchlistId) { clauses.push('wa.watchlist_id = ?'); params.push(watchlistId); }
  if (status) { clauses.push('s.status = ?'); params.push(status); }
  if (type) { clauses.push('s.signal_type = ?'); params.push(type); }
  if (assetId) { clauses.push('s.asset_id = ?'); params.push(assetId); }
  if (minScore) { clauses.push('s.score >= ?'); params.push(parseInt(minScore, 10)); }
  if (outcome) { clauses.push('s.outcome = ?'); params.push(outcome); }
  if (feedback) { clauses.push('s.user_feedback = ?'); params.push(feedback); }
  if (dateFrom) { clauses.push('s.created_at >= ?'); params.push(dateFrom); }
  if (dateTo) { clauses.push('s.created_at <= ?'); params.push(dateTo); }

  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY s.created_at DESC LIMIT 200';

  const rows = db.prepare(sql).all(...params);
  const assetIds = [...new Set(rows.map(r => r.asset_id))];
  const assets = assetIds.length
    ? db.prepare(`SELECT id, symbol, name, asset_class FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`).all(...assetIds)
    : [];
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]));

  res.json(rows.map(r => ({ ...serializeSignal(r), asset: assetById[r.asset_id] || null })));
});

router.get('/rule-performance', (req, res) => {
  res.json(rulePerformance(db));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM signals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Signal not found.' });
  const asset = db.prepare('SELECT id, symbol, name, asset_class FROM assets WHERE id = ?').get(row.asset_id);
  const notes = db.prepare('SELECT * FROM notes WHERE signal_id = ? ORDER BY created_at DESC').all(row.id).map(serializeNote);
  const conflicting = db.prepare(
    "SELECT * FROM signals WHERE asset_id = ? AND status = 'active' AND id != ?"
  ).all(row.asset_id, row.id).map(serializeSignal);
  res.json({ ...serializeSignal(row), asset, notes, otherActiveSignals: conflicting });
});

router.post('/:id/feedback', (req, res) => {
  const row = db.prepare('SELECT * FROM signals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Signal not found.' });
  const { feedback } = req.body || {};
  if (!VALID_FEEDBACK.includes(feedback)) return res.status(400).json({ error: 'Invalid feedback value.' });
  db.prepare('UPDATE signals SET user_feedback = ? WHERE id = ?').run(feedback, row.id);
  res.json(serializeSignal(db.prepare('SELECT * FROM signals WHERE id = ?').get(row.id)));
});

module.exports = router;
