const express = require('express');
const db = require('../db');
const { verifyPassword, userPermissions, logAudit } = require('../lib/helpers');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const normalizedEmail = String(email).trim().toLowerCase();

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    logAudit({ action: 'login_failed', details: normalizedEmail, ipAddress: req.ip });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.account_status !== 'active') {
    logAudit({ userId: user.id, action: 'login_denied_inactive', ipAddress: req.ip });
    return res.status(403).json({ error: 'Your account is not active. Contact a super administrator.' });
  }

  // Phase 2: any active user may log in (admins and registered end users share the users table).
  // Admin-only areas are still protected server-side by requireAuth; the client routes on isAdmin.
  const permissions = userPermissions(user.id);
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  req.session.userId = user.id;
  logAudit({ userId: user.id, action: 'login', ipAddress: req.ip });
  res.json({ ok: true, isAdmin: permissions.isAdmin });
});

router.post('/logout', (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(() => {
    if (userId) logAudit({ userId, action: 'logout' });
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in.' });
  const user = db.prepare('SELECT id, first_name, last_name, email, account_status FROM users WHERE id = ?').get(req.session.userId);
  if (!user || user.account_status !== 'active') return res.status(401).json({ error: 'Not logged in.' });
  const permissions = userPermissions(user.id);
  res.json({
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    ...permissions
  });
});

module.exports = router;
