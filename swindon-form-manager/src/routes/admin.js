const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../lib/middleware');
const { logAudit } = require('../lib/helpers');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

// --- Users ---

router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, name, email, is_admin, active, created_at FROM users ORDER BY name').all();
  const groups = db.prepare(`
    SELECT ug.user_id, g.id, g.name, g.type FROM user_groups ug JOIN groups g ON g.id = ug.group_id
  `).all();
  const byUser = {};
  for (const g of groups) {
    (byUser[g.user_id] = byUser[g.user_id] || []).push({ id: g.id, name: g.name, type: g.type });
  }
  res.json(users.map(u => ({ ...u, groups: byUser[u.id] || [] })));
});

// Registers a user by their OSM email. This is required before they can sign in at all -
// login checks for an existing, active local profile and denies access otherwise, even with
// valid OSM credentials (see src/routes/auth.js). No password is collected here - identity is
// always proven by signing in with the matching OSM account (see src/lib/osm.js).
router.post('/users', (req, res) => {
  const { name, email, isAdmin } = req.body || {};
  if (!email) return res.status(400).json({ error: 'The person\'s OSM email address is required.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(400).json({ error: 'A user with that email already exists.' });

  const result = db.prepare(`
    INSERT INTO users (name, email, is_admin) VALUES (?, ?, ?)
  `).run(name || normalizedEmail.split('@')[0], normalizedEmail, isAdmin ? 1 : 0);
  logAudit({ userId: req.user.id, action: 'user_preregistered', detail: normalizedEmail });
  res.status(201).json({ id: result.lastInsertRowid });
});

router.patch('/users/:id', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const name = req.body.name ?? user.name;
  const active = req.body.active === undefined ? user.active : (req.body.active ? 1 : 0);
  const isAdmin = req.body.isAdmin === undefined ? user.is_admin : (req.body.isAdmin ? 1 : 0);

  db.prepare('UPDATE users SET name = ?, active = ?, is_admin = ? WHERE id = ?').run(name, active, isAdmin, user.id);
  logAudit({ userId: req.user.id, action: 'user_updated', detail: user.email });
  res.json({ ok: true });
});

router.post('/users/:id/groups', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.body.groupId);
  if (!group) return res.status(404).json({ error: 'Group not found.' });

  if (req.body.action === 'remove') {
    db.prepare('DELETE FROM user_groups WHERE user_id = ? AND group_id = ?').run(user.id, group.id);
    logAudit({ userId: req.user.id, action: 'user_removed_from_group', detail: `${user.email} <- ${group.name}` });
  } else {
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)').run(user.id, group.id);
    logAudit({ userId: req.user.id, action: 'user_added_to_group', detail: `${user.email} -> ${group.name}` });
  }
  res.json({ ok: true });
});

// --- Groups ---

router.get('/groups', (req, res) => {
  const groups = db.prepare(`
    SELECT g.*, (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.id) AS member_count
    FROM groups g ORDER BY g.type, g.name
  `).all();
  res.json(groups);
});

router.post('/groups', (req, res) => {
  const { name, type } = req.body || {};
  if (!name || !['requester', 'approver'].includes(type)) {
    return res.status(400).json({ error: 'A name and a type of "requester" or "approver" are required.' });
  }
  try {
    const result = db.prepare('INSERT INTO groups (name, type) VALUES (?, ?)').run(name, type);
    logAudit({ userId: req.user.id, action: 'group_created', detail: name });
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(400).json({ error: 'A group with that name already exists.' });
  }
});

// --- Requests: manual retention actions (automated scheduling is a follow-up) ---

router.post('/requests/:id/archive', (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (!['Approved', 'Rejected', 'Withdrawn', 'Completed'].includes(request.status)) {
    return res.status(400).json({ error: `Cannot archive a request with status "${request.status}".` });
  }
  db.prepare(`UPDATE requests SET status = 'Archived', archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(request.id);
  logAudit({ requestId: request.id, userId: req.user.id, action: 'archived', previousValue: request.status, newValue: 'Archived' });
  res.json({ ok: true, status: 'Archived' });
});

router.post('/requests/:id/complete', (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'Approved') return res.status(400).json({ error: 'Only approved requests can be marked completed.' });
  db.prepare(`UPDATE requests SET status = 'Completed', updated_at = datetime('now') WHERE id = ?`).run(request.id);
  logAudit({ requestId: request.id, userId: req.user.id, action: 'completed', previousValue: 'Approved', newValue: 'Completed' });
  res.json({ ok: true, status: 'Completed' });
});

router.post('/requests/:id/delete', (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (request.status !== 'Archived') return res.status(400).json({ error: 'Only archived requests can be permanently deleted.' });

  const form = db.prepare('SELECT * FROM forms WHERE id = ?').get(request.form_id);
  const dir = path.join(uploadsDir, String(request.id));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

  db.prepare('DELETE FROM request_documents WHERE request_id = ?').run(request.id);
  db.prepare(`UPDATE requests SET status = 'Deleted', data = '{}', deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(request.id);
  db.prepare('INSERT INTO deletion_records (reference, form_name, deleted_by_id) VALUES (?, ?, ?)').run(request.reference, form.name, req.user.id);

  logAudit({ requestId: request.id, userId: req.user.id, action: 'permanently_deleted', previousValue: 'Archived', newValue: 'Deleted' });
  res.json({ ok: true, status: 'Deleted' });
});

module.exports = router;
