// Admin shell: users & roles, notice management, children, audit and settings.
const express = require('express');
const db = require('../db');
const config = require('../lib/config');
const users = require('../lib/users');
const audit = require('../lib/audit');
const { requireRole } = require('../lib/middleware');

const router = express.Router();
router.use(requireRole('admin'));
router.use(express.json({ limit: '256kb' }));

// --- users --------------------------------------------------------------------

router.get('/users', (req, res) => res.json({ users: users.listAll() }));

router.post('/users', (req, res) => {
  const { email, displayName, password, role } = req.body || {};
  if (!email || !displayName || !password) return res.status(400).json({ error: 'Email, name and password are required.' });
  if (users.findByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists.' });
  const safeRole = ['parent', 'leader', 'admin'].includes(role) ? role : 'parent';
  const user = users.createLocal({ email, password, displayName, role: safeRole });
  audit.fromReq(req, { event: 'admin.user.created', detail: `${email} (${safeRole})` });
  res.status(201).json({ id: user.id });
});

router.patch('/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  if (!['parent', 'leader', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (Number(req.params.id) === req.session.user.id && role !== 'admin') {
    return res.status(400).json({ error: 'You cannot remove your own admin role.' });
  }
  users.setRole(req.params.id, role);
  audit.fromReq(req, { event: 'admin.user.role', detail: `#${req.params.id} -> ${role}` });
  res.json({ ok: true });
});

router.patch('/users/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended'].includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  if (Number(req.params.id) === req.session.user.id) return res.status(400).json({ error: 'You cannot suspend your own account.' });
  users.setStatus(req.params.id, status);
  audit.fromReq(req, { event: 'admin.user.status', detail: `#${req.params.id} -> ${status}` });
  res.json({ ok: true });
});

// --- children (parent dashboard data) ----------------------------------------

router.get('/children', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, u.display_name AS parent_name, u.email AS parent_email
    FROM children c JOIN users u ON u.id = c.parent_user_id ORDER BY u.display_name, c.name
  `).all();
  res.json({ children: rows });
});

router.post('/children', (req, res) => {
  const { parentUserId, name, section, osmLink } = req.body || {};
  const parent = users.findById(parentUserId);
  if (!parent || parent.role !== 'parent') return res.status(400).json({ error: 'Select a valid parent account.' });
  if (!name) return res.status(400).json({ error: 'A child name is required.' });
  db.prepare('INSERT INTO children (parent_user_id, name, section, osm_link) VALUES (?, ?, ?, ?)')
    .run(parent.id, String(name).slice(0, 120), section || null, osmLink || null);
  audit.fromReq(req, { event: 'admin.child.added', detail: `${name} -> ${parent.email}` });
  res.status(201).json({ ok: true });
});

router.delete('/children/:id', (req, res) => {
  db.prepare('DELETE FROM children WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- notices ------------------------------------------------------------------

router.get('/notices', (req, res) => {
  const rows = db.prepare(`
    SELECT n.*, u.display_name AS author FROM notices n LEFT JOIN users u ON u.id = n.created_by ORDER BY n.id DESC
  `).all();
  res.json({ notices: rows });
});

router.post('/notices', (req, res) => {
  const { title, body, audience, published } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'A title and body are required.' });
  const aud = ['all', 'parents', 'leaders'].includes(audience) ? audience : 'all';
  const info = db.prepare('INSERT INTO notices (title, body, audience, published, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(String(title).slice(0, 150), String(body), aud, published ? 1 : 0, req.session.user.id);
  audit.fromReq(req, { event: 'admin.notice.created', detail: title });
  res.status(201).json({ id: info.lastInsertRowid });
});

router.patch('/notices/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Notice not found.' });
  const { title, body, audience, published } = req.body || {};
  const aud = ['all', 'parents', 'leaders'].includes(audience) ? audience : existing.audience;
  db.prepare("UPDATE notices SET title = ?, body = ?, audience = ?, published = ?, updated_at = datetime('now') WHERE id = ?")
    .run(title ?? existing.title, body ?? existing.body, aud, published ? 1 : 0, existing.id);
  audit.fromReq(req, { event: 'admin.notice.updated', detail: `#${existing.id}` });
  res.json({ ok: true });
});

router.delete('/notices/:id', (req, res) => {
  db.prepare('DELETE FROM notices WHERE id = ?').run(req.params.id);
  audit.fromReq(req, { event: 'admin.notice.deleted', detail: `#${req.params.id}` });
  res.json({ ok: true });
});

// --- audit & settings ---------------------------------------------------------

router.get('/audit', (req, res) => res.json({ events: audit.list(req.query.limit || 200) }));

router.get('/settings', (req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  res.json({
    osmConfigured: config.osmConfigured(),
    osmCallbackUrl: config.osm.callbackUrl,
    seedDemoUsers: config.seedDemoUsers,
    sessionIdleMinutes: config.sessionIdleMinutes,
    counts: {
      users: count('SELECT count(*) AS n FROM users'),
      children: count('SELECT count(*) AS n FROM children'),
      notices: count('SELECT count(*) AS n FROM notices'),
      documents: count('SELECT count(*) AS n FROM documents')
    }
  });
});

module.exports = router;
