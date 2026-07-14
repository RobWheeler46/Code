const express = require('express');
const db = require('../db');
const { userRoles, logAudit } = require('../lib/helpers');
const osm = require('../lib/osm');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const normalizedEmail = String(email).trim().toLowerCase();

  let accessToken;
  try {
    ({ accessToken } = await osm.exchangeCredentialsForToken(normalizedEmail, password));
  } catch (err) {
    const status = err instanceof osm.OsmAuthError ? err.status : 502;
    const body = { error: err.message || 'Could not sign in with Online Scout Manager.' };
    // Invalid credentials are the one failure mode a forgotten password looks like - point
    // the user at OSM, since this app has no password reset flow of its own (FRD 4.4).
    if (status === 401) body.hint = 'osm_password_reset';
    return res.status(status).json(body);
  }

  // OSM authentication succeeded, but that alone isn't enough: the user must already have
  // an authorised local profile, created or linked by an administrator in advance (FRD 4.2,
  // 4.3). We do not auto-provision an account just because someone has a valid OSM login.
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    logAudit({ userId: null, action: 'login_denied_no_profile', detail: normalizedEmail });
    return res.status(403).json({
      error: 'Your OSM login is valid, but you do not have access to this application yet. Ask an administrator to add you.'
    });
  }
  if (!user.active) {
    logAudit({ userId: user.id, action: 'login_denied_deactivated', detail: normalizedEmail });
    return res.status(403).json({ error: 'Your account has been deactivated. Contact an administrator.' });
  }

  let osmSections = [];
  try {
    const rolesData = await osm.getUserRoles(accessToken);
    osmSections = osm.summariseSections(rolesData);
  } catch (e) {
    // Non-fatal: login already succeeded against OSM, section info is just a display extra.
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  req.session.userId = user.id;
  req.session.osmSections = osmSections;
  logAudit({ userId: user.id, action: 'login', detail: 'via OSM' });
  res.json({ ok: true });
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
  const user = db.prepare('SELECT id, name, email, is_admin, active FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.active) return res.status(401).json({ error: 'Not logged in.' });
  const roles = userRoles(user);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    isAdmin: roles.isAdmin,
    isRequester: roles.isRequester,
    isApprover: roles.isApprover,
    groups: roles.groups.map(g => ({ id: g.id, name: g.name, type: g.type })),
    osmSections: req.session.osmSections || []
  });
});

module.exports = router;
