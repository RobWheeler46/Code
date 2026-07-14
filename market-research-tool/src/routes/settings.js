const express = require('express');
const db = require('../db');
const { getThresholds, DEFAULT_THRESHOLDS } = require('../lib/signals');

const router = express.Router();

router.get('/thresholds', (req, res) => {
  res.json(getThresholds(db));
});

router.patch('/thresholds', (req, res) => {
  const updates = req.body || {};
  const insert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of Object.keys(updates)) {
    if (!(key in DEFAULT_THRESHOLDS)) continue;
    insert.run(key, String(updates[key]));
  }
  res.json(getThresholds(db));
});

router.get('/system-health', (req, res) => {
  const recentLog = db.prepare('SELECT * FROM ingestion_log ORDER BY id DESC LIMIT 50').all();
  const lastOkBySource = {};
  const failuresLast24h = db.prepare(
    "SELECT COUNT(*) as n FROM ingestion_log WHERE status = 'error' AND created_at > datetime('now', '-24 hours')"
  ).get().n;
  const lastOk = db.prepare("SELECT MAX(created_at) as ts FROM ingestion_log WHERE status = 'ok'").get().ts;
  res.json({
    lastSuccessfulRefresh: lastOk,
    failuresLast24h,
    recentLog
  });
});

router.get('/refresh-intervals', (req, res) => {
  res.json({
    sharesMinutes: parseFloat(process.env.REFRESH_MINUTES_SHARES) || 15,
    cryptoMinutes: parseFloat(process.env.REFRESH_MINUTES_CRYPTO) || 10,
    emailConfigured: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.ALERT_EMAIL_TO)
  });
});

module.exports = router;
