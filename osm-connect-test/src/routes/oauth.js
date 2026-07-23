// OAuth redirection and callback (FRD 10.1, 12.2).

const express = require('express');
const router = express.Router();

const config = require('../lib/config');
const oauth = require('../lib/oauth');
const audit = require('../lib/audit');
const messages = require('../lib/messages');
const contextLib = require('../lib/context');
const endpoints = require('../lib/endpoints');
const osmClient = require('../lib/osmClient');
const { currentUser } = require('../lib/middleware');

// Outcomes are handed to the callback page as a code only, never as a message body
// in the URL, so nothing sensitive can end up in browser history (privacy rules).
function finish(req, res, { code, sessionKey = null }) {
  req.session.lastOutcome = { code, at: new Date().toISOString() };
  const target = sessionKey ? `/connected.html?ref=${encodeURIComponent(sessionKey)}` : '/connected.html';
  return res.redirect(target);
}

router.get('/connect', (req, res) => {
  if (!config.isComplete()) {
    req.session.lastOutcome = { code: 'OSM-CONN-003', at: new Date().toISOString() };
    return res.redirect('/connected.html');
  }
  const attempt = oauth.createAttempt(typeof req.query.returnTo === 'string' ? req.query.returnTo : '/dashboard.html');
  req.session.pendingAttemptRef = attempt.attemptRef;
  audit.record({
    userId: currentUser(req)?.id || null,
    event: 'connection.started', outcome: 'redirecting',
    correlationId: attempt.attemptRef, messageCode: 'OSM-CONN-004'
  });
  return res.redirect(oauth.authorizeUrl(attempt.state));
});

router.get('/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    audit.record({ event: 'connection.failed', outcome: String(error).slice(0, 60), messageCode: 'OSM-CALLBACK-002' });
    return finish(req, res, { code: 'OSM-CALLBACK-002' });
  }

  const stateCheck = oauth.validateState(state);
  if (!stateCheck.ok) {
    audit.record({ event: 'connection.failed', outcome: 'state-rejected', messageCode: stateCheck.code, detail: stateCheck.reason });
    return finish(req, res, { code: stateCheck.code });
  }
  if (!code) {
    oauth.consumeAttempt(stateCheck.attempt.id, 'no-code');
    audit.record({ event: 'connection.failed', outcome: 'no-code', correlationId: stateCheck.attempt.attempt_ref, messageCode: 'OSM-CALLBACK-003' });
    return finish(req, res, { code: 'OSM-CALLBACK-003' });
  }

  // FR-AUTH-008: the attempt is consumed before the exchange, so a replayed callback
  // cannot trigger a second token request.
  oauth.consumeAttempt(stateCheck.attempt.id, 'exchanging');
  const correlationId = stateCheck.attempt.attempt_ref;

  const exchange = await oauth.exchangeCode(code, { correlationId });
  if (!exchange.ok) {
    audit.record({ event: 'connection.failed', outcome: 'token-rejected', correlationId, messageCode: exchange.code });
    return finish(req, res, { code: exchange.code });
  }

  // Identify the user with one context request, so the connection can be attributed
  // and the section list populated immediately (FRD 10.1).
  let identity = { osmUserIdRaw: null, userEmailRaw: null, userNameRaw: null };
  const def = endpoints.byKey('context');
  if (def && def.enabled) {
    const probe = await osmClient.send({
      url: endpoints.buildUrl(def),
      headers: { Authorization: `${exchange.fields.tokenType || 'Bearer'} ${exchange.fields.accessToken}` },
      correlationId,
      label: 'Identify user'
    });
    if (probe.ok && probe.data) {
      try { identity = contextLib.extract(probe.data); } catch { /* keep the fallback identity */ }
    }
  }

  const user = oauth.upsertUser({
    osmUserId: identity.osmUserIdRaw,
    email: identity.userEmailRaw,
    displayName: identity.userNameRaw
  });
  oauth.storeConnection(user.id, exchange.fields);

  // Personal values are used only to establish identity and role, then dropped.
  identity.userEmailRaw = null;
  identity.userNameRaw = null;

  req.session.appUserId = user.id;
  req.session.authenticatedAt = new Date().toISOString();
  req.session.lastSeenAt = new Date().toISOString();

  audit.record({ userId: user.id, event: 'connection.completed', outcome: 'connected', correlationId, messageCode: 'OSM-TOKEN-002' });
  return finish(req, res, { code: 'OSM-TOKEN-002' });
});

/** The outcome of the last connection attempt, for the callback landing page. */
router.get('/outcome', (req, res) => {
  const outcome = req.session.lastOutcome;
  if (!outcome) return res.json({ message: messages.build('OSM-CONN-001') });
  return res.json({ message: messages.build(outcome.code), at: outcome.at });
});

module.exports = router;
