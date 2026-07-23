// Encryption of tokens and other secret values at rest (FR-AUTH-012, FR-SEC-003).
// AES-256-GCM. Decryption happens only here, on the server, and the plaintext is
// never returned to a client (FR-SEC-004).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const KEY_FILE = path.join(DATA_DIR, 'token-encryption.key');

function parseKey(raw) {
  const trimmed = String(raw).trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const b64 = Buffer.from(trimmed, 'base64');
  if (b64.length === 32) return b64;
  return null;
}

let warnedAboutGeneratedKey = false;

function loadKey() {
  const fromEnv = process.env.TOKEN_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = parseKey(fromEnv);
    if (key) return key;
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, supplied as 64 hex characters or base64.');
  }

  // No key supplied. Fall back to a generated key held beside the database so a
  // restart does not silently invalidate every stored token. On Railway the data
  // directory is a persistent volume, so this survives redeploys - but an explicit
  // TOKEN_ENCRYPTION_KEY is the supported production configuration.
  if (fs.existsSync(KEY_FILE)) return parseKey(fs.readFileSync(KEY_FILE, 'utf8'));

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  if (!warnedAboutGeneratedKey) {
    console.warn('[security] TOKEN_ENCRYPTION_KEY is not set. A key has been generated in data/. ' +
      'Set TOKEN_ENCRYPTION_KEY explicitly before relying on this deployment.');
    warnedAboutGeneratedKey = true;
  }
  return generated;
}

let cachedKey = null;
function key() {
  if (!cachedKey) cachedKey = loadKey();
  return cachedKey;
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // A key change or tampering. Treat as unusable rather than throwing into a request.
    return null;
  }
}

// Stable one-way reference for an OSM user id, so the raw id is never stored.
function hashRef(value) {
  return crypto.createHash('sha256')
    .update(`osm-connect-test:${value}`)
    .digest('hex')
    .slice(0, 32);
}

// Partially masked identifier for display (FR-PERM-003).
function maskId(value) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (s.length <= 2) return '*'.repeat(s.length);
  if (s.length <= 4) return `${s[0]}${'*'.repeat(s.length - 1)}`;
  return `${s.slice(0, 2)}${'*'.repeat(Math.max(3, s.length - 4))}${s.slice(-2)}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

module.exports = { encrypt, decrypt, hashRef, maskId, randomToken, timingSafeEqual };
