// OAuth authorisation code flow against OSM (FRD 12.2).
//
// The client secret never leaves the server (FR-AUTH-010), the state value is single
// use and time limited (FR-AUTH-007, FR-SEC-006), an authorisation code is used once
// (FR-AUTH-008) and tokens are stored encrypted (FR-AUTH-012).

const db = require('../db');
const config = require('./config');
const audit = require('./audit');
const redact = require('./redact');
const correlation = require('./correlation');
const osmClient = require('./osmClient');
const { encrypt, decrypt, hashRef, maskId, randomToken, timingSafeEqual } = require('./crypto');
const { parseUtc } = require('./times');

// --- connection attempts -----------------------------------------------------

const insertAttempt = db.prepare(`
  INSERT INTO oauth_attempts (state, attempt_ref, return_to, expires_at) VALUES (?, ?, ?, ?)
`);
const findAttempt = db.prepare('SELECT * FROM oauth_attempts WHERE state = ?');
const markAttempt = db.prepare("UPDATE oauth_attempts SET used_at = datetime('now'), outcome = ? WHERE id = ?");

/** FR-AUTH-006: create the state, attempt reference, timestamps and return location. */
function createAttempt(returnTo = '/dashboard.html') {
  const state = randomToken(32);
  const attemptRef = correlation.newCorrelationId();
  const lifetime = (config.get('attemptExpirySeconds') || 600) * 1000;
  const expiresAt = new Date(Date.now() + lifetime).toISOString();
  insertAttempt.run(state, attemptRef, returnTo, expiresAt);
  return { state, attemptRef, expiresAt, returnTo };
}

function authorizeUrl(state) {
  const url = new URL(config.get('authorizeUrl'));
  url.searchParams.set('client_id', config.get('osmClientId'));
  url.searchParams.set('redirect_uri', config.get('callbackUrl'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', config.get('scopes') || '');
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * FR-AUTH-007: reject a missing, incorrect, expired, already-used or unknown state.
 * Returns { ok, code, attempt }.
 */
function validateState(returnedState) {
  if (!returnedState) return { ok: false, code: 'OSM-CALLBACK-004', reason: 'No state value was returned.' };

  const rows = db.prepare('SELECT * FROM oauth_attempts ORDER BY id DESC LIMIT 50').all();
  const attempt = rows.find((r) => timingSafeEqual(r.state, returnedState));
  if (!attempt) return { ok: false, code: 'OSM-CALLBACK-004', reason: 'The state value does not match an active connection attempt.' };
  if (attempt.used_at) return { ok: false, code: 'OSM-CALLBACK-006', reason: 'This connection attempt has already been processed.', attempt };
  const expires = parseUtc(attempt.expires_at);
  if (expires === null || Date.now() > expires) {
    markAttempt.run('expired', attempt.id);
    return { ok: false, code: 'OSM-CALLBACK-005', reason: 'The connection attempt expired.', attempt };
  }
  return { ok: true, attempt };
}

function consumeAttempt(attemptId, outcome) {
  markAttempt.run(outcome, attemptId);
}

// --- token exchange ----------------------------------------------------------

function tokenFields(payload) {
  const accessToken = payload?.access_token ?? payload?.accessToken ?? null;
  const refreshToken = payload?.refresh_token ?? payload?.refreshToken ?? null;
  const tokenType = payload?.token_type ?? payload?.tokenType ?? 'Bearer';
  const expiresIn = Number(payload?.expires_in ?? payload?.expiresIn);
  const scope = payload?.scope ?? null;
  return {
    accessToken, refreshToken, tokenType, scope,
    expiresAt: Number.isFinite(expiresIn) ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
  };
}

async function exchangeCode(code, { userId = null, correlationId = null } = {}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.get('callbackUrl'),
    client_id: config.get('osmClientId'),
    client_secret: config.get('osmClientSecret')
  });

  // OSM expects form-encoded bodies rather than JSON (FR-API-005).
  const result = await osmClient.send({
    url: config.get('tokenUrl'),
    method: 'POST',
    allowWrite: true, // the token endpoint is not an OSM data write
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    correlationId,
    userId,
    label: 'Token exchange'
  });

  if (!result.ok) {
    return { ok: false, code: result.code === 'OSM-API-002' ? 'OSM-TOKEN-003' : mapTokenFailure(result), result };
  }
  const fields = tokenFields(result.data);
  if (!fields.accessToken) return { ok: false, code: 'OSM-TOKEN-004', result };
  return { ok: true, code: 'OSM-TOKEN-002', fields, result };
}

async function refresh(connection, { userId = null, correlationId = null } = {}) {
  const refreshToken = decrypt(connection.refresh_token_enc);
  if (!refreshToken) return { ok: false, code: 'OSM-TOKEN-007', reason: 'No usable refresh token is stored.' };

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.get('osmClientId'),
    client_secret: config.get('osmClientSecret')
  });

  const result = await osmClient.send({
    url: config.get('tokenUrl'),
    method: 'POST',
    allowWrite: true,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    correlationId,
    userId,
    label: 'Token refresh'
  });

  if (!result.ok) return { ok: false, code: 'OSM-TOKEN-007', result };
  const fields = tokenFields(result.data);
  if (!fields.accessToken) return { ok: false, code: 'OSM-TOKEN-004', result };
  return { ok: true, code: 'OSM-TOKEN-006', fields, result };
}

function mapTokenFailure(result) {
  switch (result.outcome) {
    case 'dns': case 'timeout': case 'tls': case 'interrupted': case 'network':
      return result.code; // keep the network-specific message
    case 'not-sent':
      return result.code;
    default:
      return 'OSM-TOKEN-003';
  }
}

// --- application users and stored connections --------------------------------

const findUserByHash = db.prepare('SELECT * FROM app_users WHERE osm_user_hash = ?');
const insertUser = db.prepare(`
  INSERT INTO app_users (osm_user_hash, osm_user_masked, display_name, role, last_sign_in_at)
  VALUES (?, ?, ?, ?, datetime('now'))
`);
const touchUser = db.prepare("UPDATE app_users SET last_sign_in_at = datetime('now'), role = ?, display_name = ? WHERE id = ?");

function resolveRole(osmUserId, email) {
  const { emails, ids, developers } = config.adminIdentifiers();
  const lowerEmail = String(email || '').toLowerCase();
  if (ids.includes(String(osmUserId)) || (lowerEmail && emails.includes(lowerEmail))) return 'admin';
  if (lowerEmail && developers.includes(lowerEmail)) return 'developer';
  return 'tester';
}

/**
 * Find or create the application user for an OSM identity. The raw OSM user id is
 * hashed; only a masked form is stored for display (FRD 19.1).
 */
function upsertUser({ osmUserId, email, displayName }) {
  const hash = hashRef(osmUserId ?? email ?? 'unknown');
  const role = resolveRole(osmUserId, email);
  // A display name may be a real person's name, so it is masked before storage.
  const safeName = displayName ? redact.maskValue(String(displayName)) : null;
  const existing = findUserByHash.get(hash);
  if (existing) {
    touchUser.run(role, safeName || existing.display_name, existing.id);
    return findUserByHash.get(hash);
  }
  insertUser.run(hash, maskId(osmUserId ?? email ?? 'unknown'), safeName, role);
  return findUserByHash.get(hash);
}

const insertConnection = db.prepare(`
  INSERT INTO osm_connections (app_user_id, access_token_enc, refresh_token_enc, token_type, scope, expires_at, status)
  VALUES (?, ?, ?, ?, ?, ?, 'connected')
`);
const revokeConnections = db.prepare("UPDATE osm_connections SET status = 'revoked', revoked_at = datetime('now'), access_token_enc = NULL, refresh_token_enc = NULL WHERE app_user_id = ? AND status != 'revoked'");
const activeConnection = db.prepare("SELECT * FROM osm_connections WHERE app_user_id = ? AND status IN ('connected','expired') ORDER BY id DESC LIMIT 1");
const updateTokens = db.prepare(`
  UPDATE osm_connections SET access_token_enc = ?, refresh_token_enc = ?, token_type = ?,
    expires_at = ?, last_refresh_at = datetime('now'), status = 'connected' WHERE id = ?
`);
const markConnectionStatus = db.prepare('UPDATE osm_connections SET status = ? WHERE id = ?');
const touchSuccess = db.prepare("UPDATE osm_connections SET last_success_at = datetime('now') WHERE id = ?");

function storeConnection(userId, fields) {
  revokeConnections.run(userId);
  insertConnection.run(
    userId,
    encrypt(fields.accessToken),
    encrypt(fields.refreshToken),
    fields.tokenType,
    fields.scope,
    fields.expiresAt
  );
  return activeConnection.get(userId);
}

function storeRefreshedTokens(connectionId, fields, previousRefreshEnc) {
  updateTokens.run(
    encrypt(fields.accessToken),
    fields.refreshToken ? encrypt(fields.refreshToken) : previousRefreshEnc,
    fields.tokenType,
    fields.expiresAt,
    connectionId
  );
}

function getConnection(userId) {
  return activeConnection.get(userId) || null;
}

function accessTokenFor(connection) {
  return decrypt(connection?.access_token_enc);
}

function tokenExpired(connection) {
  if (!connection?.expires_at) return false; // unknown expiry: let OSM decide
  const ms = parseUtc(connection.expires_at);
  return ms !== null && Date.now() >= ms - 30_000; // 30s safety margin
}

function disconnect(userId, { auditIt = true } = {}) {
  revokeConnections.run(userId);
  if (auditIt) {
    audit.record({ userId, event: 'token.removed', outcome: 'removed', messageCode: 'OSM-TOKEN-007' });
    audit.record({ userId, event: 'user.disconnected', outcome: 'disconnected' });
  }
}

module.exports = {
  createAttempt, authorizeUrl, validateState, consumeAttempt,
  exchangeCode, refresh, upsertUser, storeConnection, storeRefreshedTokens,
  getConnection, accessTokenFor, tokenExpired, disconnect,
  markConnectionStatus, touchSuccess, resolveRole
};
