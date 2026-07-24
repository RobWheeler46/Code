// First-run setup (bootstrap configuration).
//
// The Administration screen requires an OSM sign in, which requires the OSM
// configuration to exist first - a deadlock on a fresh deployment. This route breaks
// that deadlock: when a SETUP_KEY is configured, someone holding that key can enter
// the client identifier, client secret and endpoint addresses from the browser before
// anyone has connected.
//
// It reuses the same write path as the administrator screen (config.applyUpdates), so
// the client secret stays write only and every host/URL is validated. Every change is
// audited. If SETUP_KEY is not set, the whole route reports itself unavailable.

const express = require('express');
const router = express.Router();

const config = require('../lib/config');
const audit = require('../lib/audit');
const { timingSafeEqual } = require('../lib/crypto');
const { parseUtc } = require('../lib/times');

const SETUP_SESSION_MINUTES = 30;

function setupKey() {
  const key = process.env.SETUP_KEY;
  return key && key.length >= 8 ? key : null;
}

function setupEnabled() {
  return !!setupKey();
}

// Modest in-process brute-force guard. The key is expected to be long and random, so
// this is belt-and-braces rather than the primary defence.
const attempts = { count: 0, lockedUntil: 0 };
const MAX_ATTEMPTS = 10;
const LOCK_MS = 5 * 60 * 1000;

function setupAuthed(req) {
  if (!req.session?.setupAuthedAt) return false;
  const ms = parseUtc(req.session.setupAuthedAt);
  return ms !== null && Date.now() - ms < SETUP_SESSION_MINUTES * 60 * 1000;
}

function requireSetup(req, res, next) {
  if (!setupEnabled()) {
    return res.status(404).json({ error: 'Setup mode is not enabled. Set a SETUP_KEY to use the setup screen.' });
  }
  if (!setupAuthed(req)) {
    return res.status(401).json({ error: 'Enter the setup key to continue.' });
  }
  return next();
}

router.get('/status', (req, res) => {
  res.json({
    available: setupEnabled(),
    authed: setupAuthed(req),
    complete: config.isComplete(),
    csrfToken: req.session?.csrfToken || null
  });
});

router.post('/login', (req, res) => {
  const key = setupKey();
  if (!key) return res.status(404).json({ error: 'Setup mode is not enabled.' });

  if (Date.now() < attempts.lockedUntil) {
    return res.status(429).json({ error: 'Too many incorrect attempts. Try again shortly.' });
  }
  const supplied = String(req.body?.key || '');
  if (!supplied || !timingSafeEqual(supplied, key)) {
    attempts.count += 1;
    if (attempts.count >= MAX_ATTEMPTS) {
      attempts.lockedUntil = Date.now() + LOCK_MS;
      attempts.count = 0;
    }
    audit.record({ event: 'admin.override_attempted', outcome: 'setup-key-rejected', detail: 'An incorrect setup key was supplied.' });
    return res.status(403).json({ error: 'That setup key was not accepted.' });
  }

  attempts.count = 0;
  req.session.setupAuthedAt = new Date().toISOString();
  audit.record({ event: 'admin.override_attempted', outcome: 'setup-key-accepted', detail: 'Setup mode entered with a valid setup key.' });
  res.json({ ok: true, config: config.forDisplay(), complete: config.isComplete(), test: config.configTest() });
});

router.post('/logout', (req, res) => {
  if (req.session) delete req.session.setupAuthedAt;
  res.json({ ok: true });
});

router.get('/config', requireSetup, (req, res) => {
  res.json({
    config: config.forDisplay(),
    complete: config.isComplete(),
    missing: config.missingRequired(),
    callbackCheck: config.callbackUrlIsValid(),
    test: config.configTest(),
    note: 'The client secret cannot be displayed once it has been saved. It can only be replaced.'
  });
});

router.post('/config', requireSetup, (req, res) => {
  const updates = req.body?.updates;
  if (!updates || typeof updates !== 'object') return res.status(400).json({ error: 'No updates were supplied.' });

  const { applied, rejected } = config.applyUpdates(updates, 'setup');
  audit.record({
    event: 'config.changed', outcome: applied.length ? 'updated-via-setup' : 'no-change',
    detail: `Setup changed: ${applied.join(', ') || 'none'}${rejected.length ? `; rejected: ${rejected.join('; ')}` : ''}`
  });

  res.json({ applied, rejected, config: config.forDisplay(), complete: config.isComplete(), test: config.configTest() });
});

module.exports = router;
