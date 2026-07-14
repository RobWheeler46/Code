const express = require('express');
const db = require('../db');
const osm = require('../lib/osm');
const gallery = require('../lib/gallery');
const { verifyPassword, publicUser, logAudit, roleLabel, isLeaderRole } = require('../lib/helpers');
const { requireAuth } = require('../lib/middleware');

const router = express.Router();

router.get('/api/config', (req, res) => {
  res.json({ osmConfigured: osm.isConfigured(), demoModeAllowed: osm.demoModeAllowed(), galleryEnabled: gallery.galleryEnabled() });
});

// state -> { createdAt, intent } (10 minute expiry). In-memory is fine for a
// small group portal with a single server process. intent 'service' marks
// the OAuth round-trip as an admin designating the shared OSM service
// connection (see helpers.getServiceAccount) rather than a normal login.
const pendingStates = new Map();
function cleanStates() {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, entry] of pendingStates) if (entry.createdAt < cutoff) pendingStates.delete(state);
}

router.get('/auth/osm/login', (req, res) => {
  if (!osm.isConfigured()) {
    return res.redirect('/login.html?error=' + encodeURIComponent('OSM is not configured yet on this server. Ask a Portal Administrator to add OSM app credentials, or try Demo Mode below.'));
  }
  const intent = req.query.intent === 'service' ? 'service' : 'login';
  if (intent === 'service' && (!req.session.userId || db.prepare('SELECT portal_role FROM users WHERE id = ?').get(req.session.userId)?.portal_role !== 'admin')) {
    return res.status(403).send('Only a Portal Administrator can connect the OSM service account.');
  }
  cleanStates();
  const state = osm.randomState();
  pendingStates.set(state, { createdAt: Date.now(), intent });
  res.redirect(osm.buildAuthorizeUrl(state));
});

router.get('/auth/osm/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || !pendingStates.has(state)) {
    return res.redirect('/login.html?error=' + encodeURIComponent('The OSM sign-in link expired or was invalid. Please try again.'));
  }
  const { intent } = pendingStates.get(state);
  pendingStates.delete(state);

  try {
    const token = await osm.exchangeCodeForToken(code);
    const startup = await osm.getStartupData(token.accessToken);
    const identity = osm.extractIdentity(startup);

    let user = db.prepare('SELECT * FROM users WHERE osm_user_id = ?').get(identity.osmUserId);
    const totalOsmUsers = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE auth_type = 'osm'`).get().n;
    const isFirstOsmUser = totalOsmUsers === 0;

    if (user) {
      db.prepare(`
        UPDATE users SET first_name = ?, last_name = ?, osm_roles_json = ?, osm_access_token = ?, osm_refresh_token = ?,
          osm_token_expires_at = ?, last_login_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(identity.firstName, identity.lastName, JSON.stringify(identity.roles), token.accessToken, token.refreshToken, String(token.expiresAt), user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    } else {
      const defaultRole = isFirstOsmUser ? 'admin' : (identity.roles.length > 0 ? 'section_leader' : 'group_leadership');
      const info = db.prepare(`
        INSERT INTO users (auth_type, osm_user_id, email, first_name, last_name, portal_role, osm_roles_json,
          osm_access_token, osm_refresh_token, osm_token_expires_at, is_osm_service_account, last_login_at)
        VALUES ('osm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(identity.osmUserId, identity.email, identity.firstName, identity.lastName, defaultRole,
        JSON.stringify(identity.roles), token.accessToken, token.refreshToken, String(token.expiresAt), isFirstOsmUser ? 1 : 0);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }

    if (user.account_status !== 'active') {
      logAudit({ userId: user.id, action: 'login_denied_inactive', ipAddress: req.ip });
      return res.redirect('/login.html?error=' + encodeURIComponent('Your 7thPortal account has been disabled. Contact a Portal Administrator.'));
    }

    if (intent === 'service') {
      db.prepare(`UPDATE users SET is_osm_service_account = 0 WHERE is_osm_service_account = 1`).run();
      db.prepare(`UPDATE users SET is_osm_service_account = 1 WHERE id = ?`).run(user.id);
      logAudit({ userId: req.session.userId || user.id, action: 'admin_connect_service_account', entityType: 'user', entityId: String(user.id), ipAddress: req.ip });
      return res.redirect('/admin.html?tab=settings&connected=1');
    }

    req.session.userId = user.id;
    logAudit({ userId: user.id, action: 'login', ipAddress: req.ip, details: { method: 'osm' } });
    res.redirect(isLeaderRole(user.portal_role) ? '/leader-dashboard.html' : '/parent-dashboard.html');
  } catch (e) {
    console.error('OSM callback failed:', e);
    logAudit({ action: 'login_failed', ipAddress: req.ip, details: { method: 'osm', error: e.message } });
    res.redirect('/login.html?error=' + encodeURIComponent('We could not sign you in with OSM. Please try again or contact a Portal Administrator.'));
  }
});

// Demo mode - only reachable when explicitly allowed (default on until real
// OSM credentials are configured). Lets anyone explore the app with fake data.
router.get('/auth/demo/login', async (req, res) => {
  if (!osm.demoModeAllowed()) return res.status(403).send('Demo mode is disabled on this server.');
  const as = ['parent', 'leader', 'admin'].includes(req.query.as) ? req.query.as : 'parent';

  let user;
  if (as === 'parent') {
    user = db.prepare(`SELECT * FROM users WHERE email = 'demo.parent@example.com'`).get();
    if (!user) {
      const info = db.prepare(`
        INSERT INTO users (auth_type, email, first_name, last_name, portal_role, last_login_at)
        VALUES ('local', 'demo.parent@example.com', 'Demo', 'Parent', 'parent', datetime('now'))
      `).run();
      const userId = info.lastInsertRowid;
      db.prepare(`INSERT OR IGNORE INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?, 'm201', 's101', 'Cubs', 'cubs', 'Amelia Turner')`).run(userId);
      db.prepare(`INSERT OR IGNORE INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?, 'm203', 's102', 'Scouts', 'scouts', 'Freddie Brown')`).run(userId);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    }
  } else {
    const osmUserId = `demo-${as}`;
    const portalRole = as === 'admin' ? 'admin' : 'section_leader';
    user = db.prepare('SELECT * FROM users WHERE osm_user_id = ?').get(osmUserId);
    if (!user) {
      const startup = osm.demoStartupForRole(as);
      const info = db.prepare(`
        INSERT INTO users (auth_type, osm_user_id, first_name, last_name, portal_role, osm_roles_json,
          osm_access_token, osm_refresh_token, osm_token_expires_at, last_login_at)
        VALUES ('osm', ?, ?, ?, ?, ?, 'demo', 'demo', ?, datetime('now'))
      `).run(osmUserId, startup.data.globals.firstname, startup.data.globals.lastname, portalRole,
        JSON.stringify(startup.data.globals.roles), String(Date.now() + 3600000));
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    if (as === 'leader') await gallery.seedDemoAlbumIfMissing(user.id).catch(() => {});
  }

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  req.session.userId = user.id;
  logAudit({ userId: user.id, action: 'login', ipAddress: req.ip, details: { method: 'demo', as } });
  res.redirect(isLeaderRole(user.portal_role) ? '/leader-dashboard.html' : '/parent-dashboard.html');
});

router.post('/api/auth/local-login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND auth_type = 'local'`).get(normalizedEmail);
  if (!user || !verifyPassword(password, user.password_hash)) {
    logAudit({ action: 'login_failed', ipAddress: req.ip, details: { method: 'local', email: normalizedEmail } });
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.account_status !== 'active') {
    logAudit({ userId: user.id, action: 'login_denied_inactive', ipAddress: req.ip });
    return res.status(403).json({ error: 'Your account is not active. Contact a Portal Administrator.' });
  }
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
  req.session.userId = user.id;
  logAudit({ userId: user.id, action: 'login', ipAddress: req.ip, details: { method: 'local' } });
  res.json({ ok: true, redirect: isLeaderRole(user.portal_role) ? '/leader-dashboard.html' : '/parent-dashboard.html' });
});

router.get('/api/auth/invite/:token', (req, res) => {
  const user = db.prepare(`SELECT * FROM users WHERE invite_token = ?`).get(req.params.token);
  if (!user || !user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
    return res.status(404).json({ error: 'This invite link is invalid or has expired. Ask a Portal Administrator for a new one.' });
  }
  res.json({ firstName: user.first_name, email: user.email });
});

router.post('/api/auth/set-password', (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 8) return res.status(400).json({ error: 'A password of at least 8 characters is required.' });
  const user = db.prepare(`SELECT * FROM users WHERE invite_token = ?`).get(token);
  if (!user || !user.invite_expires_at || new Date(user.invite_expires_at) < new Date()) {
    return res.status(404).json({ error: 'This invite link is invalid or has expired. Ask a Portal Administrator for a new one.' });
  }
  const { hashPassword } = require('../lib/helpers');
  db.prepare(`UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires_at = NULL, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(hashPassword(password), user.id);
  req.session.userId = user.id;
  logAudit({ userId: user.id, action: 'set_password', ipAddress: req.ip });
  res.json({ ok: true, redirect: '/parent-dashboard.html' });
});

router.post('/api/auth/logout', requireAuth, (req, res) => {
  const userId = req.user.id;
  req.session.destroy(() => {
    logAudit({ userId, action: 'logout' });
    res.json({ ok: true });
  });
});

router.get('/api/me', requireAuth, (req, res) => {
  res.json({ ...publicUser(req.user), osmConnected: !!req.user.osm_access_token, isServiceAccount: !!req.user.is_osm_service_account });
});

module.exports = router;
