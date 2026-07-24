// Authentication: local (password) login for parents, OSM OAuth for leaders/admins.
const express = require('express');
const db = require('../db');
const config = require('../lib/config');
const users = require('../lib/users');
const oauth = require('../lib/oauth');
const osm = require('../lib/osm');
const audit = require('../lib/audit');
const { encrypt } = require('../lib/crypto');

const router = express.Router();

const storeConn = db.prepare(`
  INSERT INTO osm_connections (user_id, access_token_enc, refresh_token_enc, token_type, scope, expires_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const revokeConns = db.prepare("UPDATE osm_connections SET status = 'revoked', access_token_enc = NULL, refresh_token_enc = NULL WHERE user_id = ? AND status = 'connected'");

// Tells the login page what sign-in options to show.
router.get('/config', (req, res) => {
  res.json({ osmConfigured: config.osmConfigured(), seedDemoUsers: config.seedDemoUsers });
});

// Local login for issued parent (and demo) accounts.
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  const user = users.authenticateLocal(String(email), String(password));
  if (!user) {
    audit.fromReq(req, { event: 'login.failed', detail: `local:${email}` });
    return res.status(401).json({ error: 'Those sign-in details were not recognised.' });
  }
  req.session.user = users.toSession(user);
  req.session.lastSeen = Date.now();
  audit.fromReq(req, { event: 'login.success', detail: 'local' });
  res.json({ ok: true, user: req.session.user });
});

// Begin the OSM OAuth flow.
router.get('/osm/start', (req, res) => {
  if (!config.osmConfigured()) return res.status(503).send('OSM sign-in is not configured yet.');
  const state = oauth.createAttempt('/dashboard');
  res.redirect(oauth.authorizeUrl(state));
});

// OSM redirects back here with ?code & ?state.
router.get('/osm/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const fail = (msg) => res.redirect('/login?error=' + encodeURIComponent(msg));

  if (error) return fail('OSM sign-in was cancelled or refused.');
  if (!config.osmConfigured()) return fail('OSM sign-in is not configured.');

  const check = oauth.consumeState(state);
  if (!check.ok) return fail(check.reason);
  if (!code) return fail('OSM did not return an authorisation code.');

  try {
    const token = await osm.exchangeCode(String(code));
    if (!token.ok) { audit.fromReq(req, { event: 'login.osm.failed', detail: 'token exchange' }); return fail('Could not complete OSM sign-in (token exchange failed).'); }

    const profile = await osm.fetchProfile(token.accessToken);
    if (!profile.ok) { audit.fromReq(req, { event: 'login.osm.failed', detail: 'profile' }); return fail('Signed in to OSM, but your profile could not be read.'); }

    const user = users.upsertOsmUser({ osmUserId: profile.userId, email: profile.email, name: profile.name });
    revokeConns.run(user.id);
    storeConn.run(user.id, encrypt(token.accessToken), encrypt(token.refreshToken), token.tokenType, token.scope, token.expiresAt);

    req.session.user = users.toSession(user);
    req.session.lastSeen = Date.now();
    audit.record({ userId: user.id, actor: user.email, event: 'login.osm.success', ip: req.ip });
    res.redirect(check.returnTo || '/dashboard');
  } catch (err) {
    console.error('[oauth] callback error', err);
    fail('Something went wrong completing OSM sign-in.');
  }
});

router.post('/logout', (req, res) => {
  audit.fromReq(req, { event: 'logout' });
  req.session.destroy(() => { res.clearCookie('portal.sid'); res.json({ ok: true }); });
});

module.exports = router;
