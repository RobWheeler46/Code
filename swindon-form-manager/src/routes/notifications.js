const express = require('express');
const db = require('../db');
const { requireAuth } = require('../lib/middleware');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, r.reference FROM notifications n
    LEFT JOIN requests r ON r.id = n.request_id
    WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50
  `).all(req.user.id);
  const unreadCount = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
  res.json({ notifications: rows, unreadCount });
});

router.post('/:id/read', requireAuth, (req, res) => {
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!notification) return res.status(404).json({ error: 'Notification not found.' });
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE id = ?`).run(notification.id);
  res.json({ ok: true });
});

router.post('/read-all', requireAuth, (req, res) => {
  db.prepare(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL`).run(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
