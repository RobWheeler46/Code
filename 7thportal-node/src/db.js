// SQLite database (node:sqlite, no native build step). DATA_DIR lets a Railway
// volume hold the database and uploaded documents so redeploys keep state.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Uploaded document files are stored on disk, not in the database (only a
// reference is held in document_versions).
const documentsDir = path.join(dataDir, 'documents');
if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, '7thportal.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
-- Application users. Parents hold locally-issued password accounts; leaders and
-- admins sign in through OSM (auth_source = 'osm'). osm_user_ref is a masked
-- display form, never the raw OSM identifier.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'parent' CHECK(role IN ('parent','leader','admin')),
  auth_source TEXT NOT NULL DEFAULT 'local' CHECK(auth_source IN ('local','osm')),
  osm_user_hash TEXT UNIQUE,
  osm_user_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- A parent's linked children. OSM remains the system of record; these are light
-- portal records giving the parent dashboard something to show plus a hand-off
-- link back to OSM.
CREATE TABLE IF NOT EXISTS children (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  section TEXT,
  osm_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_user_id);

-- Group notices. Audience controls who sees a published notice.
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','parents','leaders')),
  published INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Leader-only document library. A document is a container; its files live in
-- document_versions so a new upload keeps the version history (wireframes 48-51).
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'General',
  audience TEXT NOT NULL DEFAULT 'leaders' CHECK(audience IN ('leaders','trustees','admins')),
  owner_user_id INTEGER REFERENCES users(id),
  review_date TEXT,
  requires_ack INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docversions_doc ON document_versions(document_id);

CREATE TABLE IF NOT EXISTS document_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, user_id)
);

-- Encrypted OSM tokens for leaders/admins who signed in through OSM.
CREATE TABLE IF NOT EXISTS osm_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','expired','revoked'))
);

-- Single-use, time-limited OAuth state values (CSRF protection on the callback).
CREATE TABLE IF NOT EXISTS oauth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL,
  return_to TEXT,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Immutable audit trail for key actions.
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER REFERENCES users(id),
  actor TEXT,
  event TEXT NOT NULL,
  detail TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_events(at);
`);

module.exports = db;
module.exports.dataDir = dataDir;
module.exports.documentsDir = documentsDir;
