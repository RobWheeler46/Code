<?php
// PDO/SQLite port of the Node version's src/db.js - same schema, same file
// name, so the two apps' data files are interchangeable if ever needed.

$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);

$GLOBALS['__db'] = new PDO('sqlite:' . $dataDir . '/7thportal.db');
$GLOBALS['__db']->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$GLOBALS['__db']->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$GLOBALS['__db']->exec('PRAGMA journal_mode = WAL');
$GLOBALS['__db']->exec('PRAGMA foreign_keys = ON');

function db(): PDO
{
    return $GLOBALS['__db'];
}

// Thin query helpers mirroring node:sqlite's db.prepare(sql).get/all/run(...)
// ergonomics, so the ported route code reads close to the original src/*.js.
function dbGet(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    $row = $stmt->fetch();
    return $row === false ? null : $row;
}

function dbAll(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetchAll();
}

// Returns ['lastInsertId' => int, 'rowCount' => int] like node:sqlite's .run().
function dbRun(string $sql, array $params = []): array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return ['lastInsertId' => (int) db()->lastInsertId(), 'rowCount' => $stmt->rowCount()];
}

db()->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auth_type TEXT NOT NULL CHECK(auth_type IN ('osm','local')),
  osm_user_id TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','trustee_viewer','admin')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended','deleted')),
  osm_roles_json TEXT,
  osm_access_token TEXT,
  osm_refresh_token TEXT,
  osm_token_expires_at TEXT,
  is_osm_service_account INTEGER NOT NULL DEFAULT 0,
  invite_token TEXT,
  invite_expires_at TEXT,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS parent_child_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_user_id INTEGER NOT NULL REFERENCES users(id),
  osm_member_id TEXT NOT NULL,
  osm_section_id TEXT,
  osm_section_name TEXT,
  osm_section_type TEXT,
  child_display_name TEXT,
  linked_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(parent_user_id, osm_member_id)
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all','parents','leaders','section')),
  osm_section_id TEXT,
  section_name TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  ip_address TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS gallery_albums (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  grouping_type TEXT NOT NULL DEFAULT 'activity' CHECK(grouping_type IN ('section','event','camp','activity','term')),
  grouping_label TEXT,
  osm_section_id TEXT,
  osm_section_name TEXT,
  visibility_scope TEXT NOT NULL DEFAULT 'section' CHECK(visibility_scope IN ('section','all_parents','selected_parents')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending_approval','published','archived')),
  watermark_enabled INTEGER NOT NULL DEFAULT 0,
  consent_confirmed INTEGER NOT NULL DEFAULT 0,
  consent_confirmed_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gallery_album_parents (
  album_id INTEGER NOT NULL REFERENCES gallery_albums(id),
  parent_user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (album_id, parent_user_id)
);

CREATE TABLE IF NOT EXISTS gallery_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id INTEGER NOT NULL REFERENCES gallery_albums(id),
  storage_key TEXT NOT NULL UNIQUE,
  width INTEGER,
  height INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(portal_role, account_status);
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_child_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status, audience, start_date);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_albums_status ON gallery_albums(status, visibility_scope);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_album ON gallery_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_gallery_album_parents_parent ON gallery_album_parents(parent_user_id);
SQL
);
