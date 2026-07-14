const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'market-research.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  name TEXT,
  asset_class TEXT NOT NULL CHECK(asset_class IN ('us_share','uk_share','crypto')),
  exchange TEXT,
  currency TEXT,
  sector TEXT,
  is_penny_share INTEGER NOT NULL DEFAULT 0,
  is_high_risk INTEGER NOT NULL DEFAULT 0,
  research_status TEXT NOT NULL DEFAULT 'not_reviewed',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, asset_class)
);

CREATE TABLE IF NOT EXISTS watchlist_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watchlist_id INTEGER NOT NULL REFERENCES watchlists(id),
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  added_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(watchlist_id, asset_id)
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  price REAL,
  previous_close REAL,
  day_high REAL,
  day_low REAL,
  volume REAL,
  avg_volume REAL,
  market_cap REAL,
  fifty_two_week_high REAL,
  fifty_two_week_low REAL,
  currency TEXT,
  market_state TEXT,
  change_24h_pct REAL,
  change_7d_pct REAL,
  change_30d_pct REAL,
  source TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS daily_bars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  bar_date TEXT NOT NULL,
  close REAL NOT NULL,
  volume REAL,
  UNIQUE(asset_id, bar_date)
);

CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  signal_type TEXT NOT NULL,
  score INTEGER NOT NULL,
  strength TEXT NOT NULL,
  explanation TEXT NOT NULL,
  triggered_rules TEXT,
  supporting_data TEXT,
  price_at_signal REAL,
  status TEXT NOT NULL DEFAULT 'active',
  outcome TEXT NOT NULL DEFAULT 'still_open',
  user_feedback TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expiry_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER REFERENCES assets(id),
  signal_id INTEGER REFERENCES signals(id),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'normal',
  message TEXT NOT NULL,
  dedup_key TEXT,
  emailed INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id),
  signal_id INTEGER REFERENCES signals(id),
  note_text TEXT NOT NULL,
  tags TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// node:sqlite has no "ALTER TABLE ADD COLUMN IF NOT EXISTS", so new columns on existing
// tables are migrated in here, guarded by a check against the current schema.
function ensureColumn(table, column, definition) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all();
  if (existing.some(col => col.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

for (const days of ['1d', '3d', '7d', '30d', '90d']) {
  ensureColumn('signals', `outcome_price_${days}`, 'REAL');
}

module.exports = db;
