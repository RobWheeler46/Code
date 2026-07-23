// Local application health (FRD 22.2, FR-HOME-003, guided stage 1).
//
// These checks deliberately touch nothing outside the application, so a failure here
// clearly separates "the test harness is broken" from "OSM is broken".

const db = require('../db');
const config = require('./config');
const { encrypt, decrypt } = require('./crypto');

function check() {
  const checks = [];

  const add = (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = fn();
      checks.push({ name, ok: true, detail: detail || 'OK', durationMs: Date.now() - t0 });
    } catch (err) {
      checks.push({ name, ok: false, detail: err.message, durationMs: Date.now() - t0 });
    }
  };

  add('Database readable', () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM app_users').get();
    return `${row.n} application user${row.n === 1 ? '' : 's'}`;
  });

  add('Database writable', () => {
    db.exec('CREATE TABLE IF NOT EXISTS health_probe (id INTEGER PRIMARY KEY, at TEXT)');
    db.prepare("INSERT OR REPLACE INTO health_probe (id, at) VALUES (1, datetime('now'))").run();
    return 'write succeeded';
  });

  add('Token encryption', () => {
    const probe = `health-${Date.now()}`;
    const round = decrypt(encrypt(probe));
    if (round !== probe) throw new Error('encrypt/decrypt round trip did not match');
    return 'AES-256-GCM round trip succeeded';
  });

  add('Configuration store', () => {
    const missing = config.missingRequired();
    if (missing.length) throw new Error(`incomplete: ${missing.join(', ')}`);
    return 'all required items present';
  });

  add('Callback address', () => {
    const result = config.callbackUrlIsValid();
    if (!result.valid) throw new Error(result.reason);
    return 'valid';
  });

  add('Session secret', () => {
    if (!process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
    if (process.env.SESSION_SECRET.length < 16) throw new Error('SESSION_SECRET is too short');
    return 'set';
  });

  const failed = checks.filter((c) => !c.ok).map((c) => c.name);
  return { healthy: failed.length === 0, failed, checks };
}

module.exports = { check };
