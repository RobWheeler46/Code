// Token encryption + password hashing, all with Node's built-in crypto (no deps).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('../db');

function loadKey() {
  const fromEnv = process.env.TOKEN_ENCRYPTION_KEY;
  if (fromEnv) {
    const buf = /^[0-9a-fA-F]{64}$/.test(fromEnv)
      ? Buffer.from(fromEnv, 'hex')
      : Buffer.from(fromEnv, 'base64');
    if (buf.length === 32) return buf;
    console.warn('[crypto] TOKEN_ENCRYPTION_KEY is not 32 bytes; falling back to a generated key file.');
  }
  // Fall back to a key file in DATA_DIR (persisted on the Railway volume).
  const keyFile = path.join(dataDir, 'token-key');
  if (fs.existsSync(keyFile)) return Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'hex');
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key.toString('hex'), { mode: 0o600 });
  console.warn('[crypto] Generated a token encryption key in data/. Set TOKEN_ENCRYPTION_KEY to control it explicitly.');
  return key;
}

const KEY = loadKey();

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(blob) {
  if (!blob) return null;
  try {
    const [ivHex, tagHex, dataHex] = String(blob).split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function hashRef(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// Mask an identifier for display: keep the first and last character only.
function maskId(value) {
  const s = String(value ?? '');
  if (s.length <= 2) return '**';
  return `${s[0]}${'*'.repeat(Math.min(6, s.length - 2))}${s[s.length - 1]}`;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// --- passwords (scrypt) -------------------------------------------------------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 32);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const derived = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(hashHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

module.exports = {
  encrypt, decrypt, hashRef, maskId, randomToken, hashPassword, verifyPassword
};
