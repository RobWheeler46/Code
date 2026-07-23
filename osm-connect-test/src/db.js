const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

// DATA_DIR lets the test harness and a Railway volume point elsewhere.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'osm-connect-test.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
-- FRD 19.1 ApplicationUser. The OSM user reference is hashed, never stored raw.
CREATE TABLE IF NOT EXISTS app_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  osm_user_hash TEXT NOT NULL UNIQUE,
  osm_user_masked TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'tester' CHECK(role IN ('tester','admin','developer','support')),
  account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_sign_in_at TEXT,
  last_successful_test_at TEXT
);

-- FRD 19.1 OSMConnection. Tokens are stored encrypted (FR-AUTH-012).
CREATE TABLE IF NOT EXISTS osm_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_user_id INTEGER NOT NULL REFERENCES app_users(id),
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_type TEXT,
  scope TEXT,
  expires_at TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_refresh_at TEXT,
  last_success_at TEXT,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK(status IN ('connected','expired','revoked','failed','blocked')),
  revoked_at TEXT,
  selected_section_ref INTEGER REFERENCES osm_section_refs(id)
);

-- FRD 19.1 OSMSectionReference. Identifiers are stored masked.
CREATE TABLE IF NOT EXISTS osm_section_refs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL REFERENCES osm_connections(id) ON DELETE CASCADE,
  group_id_masked TEXT,
  group_name TEXT,
  section_id_masked TEXT,
  section_id_enc TEXT,
  section_name TEXT,
  section_type TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  permission_summary TEXT,
  retrieved_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth connection attempts: state is single use and time limited (FR-SEC-006).
CREATE TABLE IF NOT EXISTS oauth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL UNIQUE,
  attempt_ref TEXT NOT NULL,
  return_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  outcome TEXT
);

-- FRD 19.1 TestSession
CREATE TABLE IF NOT EXISTS test_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_ref TEXT NOT NULL UNIQUE,
  app_user_id INTEGER NOT NULL REFERENCES app_users(id),
  kind TEXT NOT NULL DEFAULT 'guided',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  overall_result TEXT,
  section_ref_id INTEGER REFERENCES osm_section_refs(id),
  warning_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0
);

-- FRD 19.1 TestResult
CREATE TABLE IF NOT EXISTS test_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  test_session_id INTEGER NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  stage_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  duration_ms INTEGER,
  message_code TEXT,
  correlation_id TEXT,
  technical_summary TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- FRD 19.1 EndpointDefinition. Release 1 is read only, so method is GET only.
CREATE TABLE IF NOT EXISTS endpoint_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  method TEXT NOT NULL DEFAULT 'GET',
  path TEXT NOT NULL,
  query_params TEXT,
  requires_section INTEGER NOT NULL DEFAULT 0,
  expected_status TEXT NOT NULL DEFAULT '200',
  expected_content_type TEXT NOT NULL DEFAULT 'application/json',
  mandatory_fields TEXT,
  optional_fields TEXT,
  personal_data_risk TEXT NOT NULL DEFAULT 'none'
    CHECK(personal_data_risk IN ('none','low','medium','high')),
  enabled INTEGER NOT NULL DEFAULT 0,
  what_it_tests TEXT,
  why_useful TEXT,
  permission_required TEXT,
  last_verified_at TEXT,
  notes TEXT,
  display_order INTEGER NOT NULL DEFAULT 0
);

-- Sanitised request log for inspection (FRD 12.8).
CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  correlation_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  test_session_id INTEGER REFERENCES test_sessions(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  method TEXT,
  destination TEXT,
  query_param_names TEXT,
  request_content_type TEXT,
  timeout_ms INTEGER,
  attempt_number INTEGER,
  duration_ms INTEGER,
  response_status INTEGER,
  response_content_type TEXT,
  response_headers TEXT,
  response_bytes INTEGER,
  parse_result TEXT,
  schema_result TEXT,
  redaction_count INTEGER NOT NULL DEFAULT 0,
  truncated INTEGER NOT NULL DEFAULT 0,
  preview TEXT,
  message_code TEXT
);

-- FRD 18. Audit records never contain secrets, tokens or member information.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  app_user_id INTEGER REFERENCES app_users(id),
  event_type TEXT NOT NULL,
  outcome TEXT,
  correlation_id TEXT,
  section_ref TEXT,
  message_code TEXT,
  detail TEXT
);

-- Administrator-managed configuration. Secret values are stored encrypted and are
-- write only: they are never returned to any client (FR-CONFIG-002).
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  is_secret INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

-- Circuit breaker state (FRD 15.3) and the local rate-limit counter (FRD 16).
CREATE TABLE IF NOT EXISTS breaker_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  state TEXT NOT NULL DEFAULT 'closed' CHECK(state IN ('closed','open','critical')),
  reason TEXT,
  opened_at TEXT,
  retry_after TEXT,
  recent_failures INTEGER NOT NULL DEFAULT 0,
  overridable INTEGER NOT NULL DEFAULT 1,
  message_code TEXT
);
INSERT OR IGNORE INTO breaker_state (id, state) VALUES (1, 'closed');

CREATE TABLE IF NOT EXISTS rate_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  window_started_at TEXT NOT NULL DEFAULT (datetime('now')),
  local_count INTEGER NOT NULL DEFAULT 0,
  reported_limit INTEGER,
  reported_remaining INTEGER,
  reported_reset TEXT,
  last_seen_at TEXT
);
INSERT OR IGNORE INTO rate_state (id) VALUES (1);

CREATE INDEX IF NOT EXISTS idx_results_session ON test_results(test_session_id);
CREATE INDEX IF NOT EXISTS idx_reqlog_session ON request_log(test_session_id);
CREATE INDEX IF NOT EXISTS idx_reqlog_corr ON request_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(app_user_id);
CREATE INDEX IF NOT EXISTS idx_sections_conn ON osm_section_refs(connection_id);
`);

module.exports = db;
