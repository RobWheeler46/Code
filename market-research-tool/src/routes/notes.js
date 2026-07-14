const express = require('express');
const db = require('../db');
const { serializeNote } = require('../lib/helpers');

const router = express.Router();

router.get('/', (req, res) => {
  const { assetId, tag } = req.query;
  let rows;
  if (assetId) {
    rows = db.prepare('SELECT * FROM notes WHERE asset_id = ? ORDER BY created_at DESC').all(assetId);
  } else {
    rows = db.prepare('SELECT * FROM notes ORDER BY created_at DESC LIMIT 200').all();
  }
  let notes = rows.map(serializeNote);
  if (tag) notes = notes.filter(n => n.tags.includes(tag));

  const assetIds = [...new Set(rows.map(r => r.asset_id))];
  const assets = assetIds.length
    ? db.prepare(`SELECT id, symbol, name FROM assets WHERE id IN (${assetIds.map(() => '?').join(',')})`).all(...assetIds)
    : [];
  const assetById = Object.fromEntries(assets.map(a => [a.id, a]));

  res.json(notes.map(n => ({ ...n, asset: assetById[n.assetId] || null })));
});

router.post('/', (req, res) => {
  const { assetId, signalId, noteText, tags } = req.body || {};
  if (!assetId || !noteText) return res.status(400).json({ error: 'assetId and noteText are required.' });
  const result = db.prepare('INSERT INTO notes (asset_id, signal_id, note_text, tags) VALUES (?, ?, ?, ?)')
    .run(assetId, signalId || null, noteText, JSON.stringify(tags || []));
  res.json(serializeNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid)));
});

router.patch('/:id', (req, res) => {
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'Note not found.' });
  const { noteText, tags } = req.body || {};
  db.prepare("UPDATE notes SET note_text = COALESCE(?, note_text), tags = ?, updated_at = datetime('now') WHERE id = ?")
    .run(noteText || null, tags !== undefined ? JSON.stringify(tags) : note.tags, note.id);
  res.json(serializeNote(db.prepare('SELECT * FROM notes WHERE id = ?').get(note.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
