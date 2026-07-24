// OSM OAuth authorisation-code flow. The client secret never leaves the server;
// the state value is single-use and time-limited (CSRF protection on the callback).
const crypto = require('crypto');
const db = require('../db');
const config = require('./config');
const { randomToken } = require('./crypto');

const insertAttempt = db.prepare('INSERT INTO oauth_attempts (state, return_to, expires_at) VALUES (?, ?, ?)');
const findAttempts = db.prepare('SELECT * FROM oauth_attempts WHERE used_at IS NULL ORDER BY id DESC LIMIT 50');
const markUsed = db.prepare("UPDATE oauth_attempts SET used_at = datetime('now') WHERE id = ?");

function createAttempt(returnTo = '/dashboard') {
  const state = randomToken(32);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes
  insertAttempt.run(state, returnTo, expiresAt);
  return state;
}

function authorizeUrl(state) {
  const url = new URL(config.osm.authorizeUrl);
  url.searchParams.set('client_id', config.osm.clientId);
  url.searchParams.set('redirect_uri', config.osm.callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.osm.scopes);
  url.searchParams.set('state', state);
  return url.toString();
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Validate a returned state: must match an unused attempt that has not expired.
function consumeState(returnedState) {
  if (!returnedState) return { ok: false, reason: 'No state value was returned.' };
  const attempt = findAttempts.all().find((a) => timingSafeEqual(a.state, returnedState));
  if (!attempt) return { ok: false, reason: 'The sign-in attempt could not be matched. Please try again.' };
  markUsed.run(attempt.id);
  if (Date.now() > Date.parse(attempt.expires_at)) {
    return { ok: false, reason: 'The sign-in attempt expired. Please try again.' };
  }
  return { ok: true, returnTo: attempt.return_to || '/dashboard' };
}

module.exports = { createAttempt, authorizeUrl, consumeState };
