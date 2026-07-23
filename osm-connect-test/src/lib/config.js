// Application configuration (FRD 12.3).
//
// Values are read from the database first, falling back to environment variables.
// The client secret is write only: it is stored encrypted and there is no code path
// that returns it to any client (FR-CONFIG-002, FR-CONFIG-003, FR-CONFIG-005).

const db = require('../db');
const { encrypt, decrypt } = require('./crypto');

const SECRET_KEYS = new Set(['osmClientSecret']);

const FIELDS = {
  osmClientId: { env: 'OSM_CLIENT_ID', label: 'OSM client identifier', required: true },
  osmClientSecret: { env: 'OSM_CLIENT_SECRET', label: 'OSM client secret', required: true, secret: true },
  authorizeUrl: { env: 'OSM_AUTHORIZE_URL', label: 'Authorisation endpoint', required: true, default: 'https://www.onlinescoutmanager.co.uk/oauth/authorize' },
  tokenUrl: { env: 'OSM_TOKEN_URL', label: 'Token endpoint', required: true, default: 'https://www.onlinescoutmanager.co.uk/oauth/token' },
  apiBase: { env: 'OSM_API_BASE', label: 'API base address', required: true, default: 'https://www.onlinescoutmanager.co.uk' },
  callbackUrl: { env: 'OSM_CALLBACK_URL', label: 'Callback address', required: true },
  scopes: { env: 'OSM_SCOPES', label: 'Requested scopes', default: 'section:member:read section:programme:read section:event:read section:attendance:read section:badge:read' },
  allowedHosts: { env: 'OSM_ALLOWED_HOSTS', label: 'Approved OSM hostnames', default: 'www.onlinescoutmanager.co.uk,onlinescoutmanager.co.uk' },
  requestTimeoutMs: { env: 'REQUEST_TIMEOUT_MS', label: 'Request timeout (ms)', default: '15000', numeric: true },
  maxAutomaticRetries: { env: 'MAX_AUTOMATIC_RETRIES', label: 'Maximum automatic retries', default: '1', numeric: true },
  localRateLimitThreshold: { env: 'LOCAL_RATE_LIMIT_THRESHOLD', label: 'Local rate limit threshold', default: '60', numeric: true },
  maxResponseBytes: { env: 'MAX_RESPONSE_BYTES', label: 'Maximum response size (bytes)', default: '1048576', numeric: true },
  retentionDays: { env: 'DIAGNOSTIC_RETENTION_DAYS', label: 'Diagnostic retention (days)', default: '30', numeric: true },
  sessionIdleMinutes: { env: 'SESSION_IDLE_MINUTES', label: 'Session inactivity timeout (minutes)', default: '60', numeric: true },
  attemptExpirySeconds: { env: 'OAUTH_ATTEMPT_EXPIRY_SECONDS', label: 'Connection attempt lifetime (seconds)', default: '600', numeric: true },
  breakerFailureThreshold: { env: 'BREAKER_FAILURE_THRESHOLD', label: 'Circuit breaker failure threshold', default: '5', numeric: true },
  breakerCooldownSeconds: { env: 'BREAKER_COOLDOWN_SECONDS', label: 'Circuit breaker cooldown (seconds)', default: '300', numeric: true },
  slowResponseWarningMs: { env: 'SLOW_RESPONSE_WARNING_MS', label: 'Slow response warning threshold (ms)', default: '3000', numeric: true }
};

const selectStmt = db.prepare('SELECT value, is_secret FROM app_config WHERE key = ?');
const upsertStmt = db.prepare(`
  INSERT INTO app_config (key, value, is_secret, updated_at, updated_by)
  VALUES (?, ?, ?, datetime('now'), ?)
  ON CONFLICT(key) DO UPDATE SET
    value = excluded.value, is_secret = excluded.is_secret,
    updated_at = excluded.updated_at, updated_by = excluded.updated_by
`);
const metaStmt = db.prepare('SELECT updated_at, updated_by FROM app_config WHERE key = ?');

function rawGet(key) {
  const row = selectStmt.get(key);
  if (row && row.value !== null && row.value !== '') {
    return row.is_secret ? decrypt(row.value) : row.value;
  }
  const field = FIELDS[key];
  if (!field) return null;
  const fromEnv = process.env[field.env];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  return field.default ?? null;
}

function get(key) {
  const value = rawGet(key);
  if (value === null || value === undefined) return null;
  if (FIELDS[key]?.numeric) {
    const n = Number(value);
    return Number.isFinite(n) ? n : Number(FIELDS[key].default);
  }
  return value;
}

function set(key, value, updatedBy) {
  if (!FIELDS[key]) throw new Error(`Unknown configuration key: ${key}`);
  const isSecret = SECRET_KEYS.has(key);
  upsertStmt.run(key, isSecret ? encrypt(value) : String(value), isSecret ? 1 : 0, updatedBy || null);
}

function allowedHosts() {
  return String(get('allowedHosts') || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

function callbackUrlIsValid() {
  const url = get('callbackUrl');
  if (!url) return { valid: false, reason: 'Callback address is not configured.' };
  let u;
  try { u = new URL(url); } catch { return { valid: false, reason: 'Callback address is not a valid URL.' }; }
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  // FR-CONFIG-004: HTTPS is required except for an explicitly approved local address.
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal)) {
    return { valid: false, reason: 'Callback address must use HTTPS, except for a local development address.' };
  }
  return { valid: true };
}

/** Which required items are missing. Drives OSM-CONN-003 and the Home screen state. */
function missingRequired() {
  const missing = [];
  for (const [key, field] of Object.entries(FIELDS)) {
    if (!field.required) continue;
    const v = rawGet(key);
    if (v === null || v === undefined || String(v).trim() === '') missing.push(field.label);
  }
  const cb = callbackUrlIsValid();
  if (!cb.valid && !missing.includes('Callback address')) missing.push(`Callback address: ${cb.reason}`);
  return missing;
}

function isComplete() {
  return missingRequired().length === 0;
}

/**
 * Configuration for display. Secrets are reported as configured/not configured only,
 * with the date and user of the last change (FR-CONFIG-003).
 */
function forDisplay() {
  const out = {};
  for (const [key, field] of Object.entries(FIELDS)) {
    const meta = metaStmt.get(key);
    const overridden = !!selectStmt.get(key);
    if (SECRET_KEYS.has(key)) {
      const present = !!rawGet(key);
      out[key] = {
        label: field.label,
        secret: true,
        state: present ? 'Secret configured' : 'Secret not configured',
        lastChanged: meta?.updated_at || null,
        lastChangedBy: meta?.updated_by || null,
        source: overridden ? 'application configuration' : (process.env[field.env] ? 'environment variable' : 'not set')
      };
    } else {
      out[key] = {
        label: field.label,
        secret: false,
        value: get(key),
        source: overridden ? 'application configuration' : (process.env[field.env] ? 'environment variable' : 'default'),
        lastChanged: meta?.updated_at || null,
        lastChangedBy: meta?.updated_by || null
      };
    }
  }
  return out;
}

/** Values that must never appear in any log, message or export. */
function secretValues() {
  return [rawGet('osmClientSecret'), process.env.SESSION_SECRET, process.env.TOKEN_ENCRYPTION_KEY].filter(Boolean);
}

function adminIdentifiers() {
  const emails = String(process.env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const ids = String(process.env.ADMIN_OSM_USER_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const developers = String(process.env.DEVELOPER_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return { emails, ids, developers };
}

function personalDataTestsAllowed() {
  return String(process.env.ALLOW_PERSONAL_DATA_TESTS || 'false').toLowerCase() === 'true';
}

module.exports = {
  FIELDS, get, set, allowedHosts, callbackUrlIsValid, missingRequired, isComplete,
  forDisplay, secretValues, adminIdentifiers, personalDataTestsAllowed
};
