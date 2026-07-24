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

// Migration: mileage_rates gained annual_threshold_miles/rate_after_threshold
// columns for the HMRC AMAP car/van tiering. It only ever held seeded demo
// rates (no real data at stake), so drop-and-recreate is simpler than an
// ALTER TABLE ADD COLUMN here.
$mileageRatesSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='mileage_rates'")['sql'] ?? '';
if ($mileageRatesSql && !str_contains($mileageRatesSql, 'annual_threshold_miles')) {
    db()->exec('DROP TABLE mileage_rates');
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
  portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','trustee_viewer','treasurer','chair','admin')),
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

CREATE TABLE IF NOT EXISTS expense_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  approver_user_id INTEGER REFERENCES users(id),
  deputy_approver_user_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- rate_after_threshold/annual_threshold_miles implement the 2026/27 HMRC AMAP
-- car/van tiering (55p for the claimant's first 10,000 business miles in the
-- UK tax year, 25p after) - both null for vehicle types with a flat rate
-- (motorcycle, bicycle). See mileageRateForClaim() in lib/finance.php.
CREATE TABLE IF NOT EXISTS mileage_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_type TEXT NOT NULL CHECK(vehicle_type IN ('car','motorcycle','bicycle','other')),
  rate_per_mile REAL NOT NULL,
  annual_threshold_miles REAL,
  rate_after_threshold REAL,
  effective_from TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Multi-item claims (7thPortal_Expenses_Data_Model.docx): a claim is a
-- container: the financially meaningful records are its items. A claim can
-- mix receipt and mileage items across different accounts under one claim
-- reference; approval, rejection and payment all happen at item level, not
-- claim level - claim_status is derived from item statuses, never set
-- directly (see deriveClaimStatus() in lib/finance.php).
CREATE TABLE IF NOT EXISTS expense_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_number TEXT NOT NULL UNIQUE,
  claimant_user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
    'draft','submitted','partially_approved','approved','rejected','partially_paid','paid'
  )),
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Item states per FRD 10.3 / Data Model section 11, applied per item rather
-- than per claim: draft -> submitted -> (more_info_requested <-> submitted)
-- -> [account approver approves] -> pending_second_approval (only if
-- claimed_amount is over the tier-2 threshold, FRD 19) -> [Treasurer/Chair
-- second-approves] -> approved -> [Treasurer selects it into a payment
-- batch] -> paid -> archived (soft-archived past the retention window, never
-- hard-deleted - see pruneOldClaims() in lib/finance.php). "adjustment" item
-- type and true partial-amount payment splitting are explicitly out of scope
-- for now (Data Model section 15 open question) - not built.
CREATE TABLE IF NOT EXISTS expense_claim_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES expense_claims(id),
  item_number INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK(item_type IN ('receipt','mileage')),
  title TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES expense_accounts(id),
  category_id INTEGER REFERENCES expense_categories(id),
  expense_date TEXT,
  claimed_amount REAL,
  approved_amount REAL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN (
    'draft','submitted','more_info_requested','pending_second_approval',
    'approved','rejected','ready_for_payment','paid','archived'
  )),
  receipt_exception_reason TEXT,
  second_approval_required INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT,
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  second_approved_by INTEGER REFERENCES users(id),
  second_approved_at TEXT,
  rejected_by INTEGER REFERENCES users(id),
  rejected_at TEXT,
  rejection_reason TEXT,
  more_info_requested_by INTEGER REFERENCES users(id),
  more_info_requested_at TEXT,
  more_info_note TEXT,
  ready_for_payment_by INTEGER REFERENCES users(id),
  ready_for_payment_at TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_mileage_details (
  claim_item_id INTEGER PRIMARY KEY REFERENCES expense_claim_items(id),
  journey_purpose TEXT,
  start_location TEXT,
  end_location TEXT,
  return_journey INTEGER NOT NULL DEFAULT 0,
  miles_claimed REAL,
  vehicle_type TEXT,
  rate_applied REAL,
  declaration_accepted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS expense_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storage_key TEXT NOT NULL UNIQUE,
  ext TEXT NOT NULL,
  original_filename TEXT,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many per policy doc section 15: "one receipt may support multiple
-- items only if the system allows the receipt to be linked to each relevant
-- item and the split is clear."
CREATE TABLE IF NOT EXISTS expense_claim_item_receipts (
  claim_item_id INTEGER NOT NULL REFERENCES expense_claim_items(id),
  receipt_id INTEGER NOT NULL REFERENCES expense_receipts(id),
  PRIMARY KEY (claim_item_id, receipt_id)
);

-- Lets the Treasurer mark several approved items paid in one action with one
-- bank reference/date, rather than one at a time (Data Model section 10:
-- "PaymentAllocation... allows partial payment of approved items" - this
-- implements the "several items, one payment action" part; true split-amount
-- partial payment of a single item is not built, see item 15 open question).
CREATE TABLE IF NOT EXISTS expense_payment_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_reference TEXT NOT NULL,
  created_by_user_id INTEGER REFERENCES users(id),
  payment_date TEXT NOT NULL,
  bank_reference TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expense_payment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_batch_id INTEGER NOT NULL REFERENCES expense_payment_batches(id),
  claim_item_id INTEGER NOT NULL UNIQUE REFERENCES expense_claim_items(id),
  paid_amount REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Leader-only document library (wireframe screens 48-51): a document is a
-- record of metadata; document_versions holds the actual files, so
-- publishing a new version doesn't lose the old one (version history,
-- screen 51). Not safeguarding/finance-sensitive like the gallery or
-- expenses modules, but ships off by default anyway for consistency with
-- how every other optional module was introduced here - an admin opts in
-- once real policies/templates are ready to load.
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'guidance' CHECK(category IN ('policy','process','template','guidance','other')),
  owner_user_id INTEGER REFERENCES users(id),
  review_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  current_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  version_number INTEGER NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  ext TEXT NOT NULL,
  original_filename TEXT,
  notes TEXT,
  uploaded_by_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tied to a specific version, not just the document, so publishing a new
-- version naturally surfaces everyone who acknowledged the old one as
-- "outstanding" again (screen 51's "tracking acknowledgements").
CREATE TABLE IF NOT EXISTS document_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  version_id INTEGER NOT NULL REFERENCES document_versions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  acknowledged_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(version_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(portal_role, account_status);
CREATE INDEX IF NOT EXISTS idx_parent_links_parent ON parent_child_links(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status, audience, start_date);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_gallery_albums_status ON gallery_albums(status, visibility_scope);
CREATE INDEX IF NOT EXISTS idx_gallery_photos_album ON gallery_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_gallery_album_parents_parent ON gallery_album_parents(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_expense_accounts_active ON expense_accounts(active);
CREATE INDEX IF NOT EXISTS idx_expense_claims_claimant ON expense_claims(claimant_user_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claim_items_claim ON expense_claim_items(claim_id);
CREATE INDEX IF NOT EXISTS idx_expense_claim_items_account ON expense_claim_items(account_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claim_item_receipts_receipt ON expense_claim_item_receipts(receipt_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status, category);
CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_document_acknowledgements_document ON document_acknowledgements(document_id, version_id);
CREATE INDEX IF NOT EXISTS idx_document_acknowledgements_user ON document_acknowledgements(user_id);
SQL
);

// Migration: the finance module was rebuilt from a single-item-per-claim
// model to the header+items model above (7thPortal_Expenses_Data_Model.docx).
// The old `claims` table only ever held local test/demo data (this predates
// any real deployment), so it's dropped outright rather than migrated -
// no-op if it doesn't exist.
db()->exec('DROP TABLE IF EXISTS claims');

// Migration: widen users.portal_role to include 'treasurer' and 'chair' (added
// for the Expenses/Mileage/Treasurer/Trustee finance module - see
// 7thportal-php/DECISIONS-finance-module.md). SQLite can't ALTER a CHECK
// constraint in place, so this rebuilds the table only if the narrower,
// pre-finance-module constraint is still there - a no-op on fresh installs,
// where the CREATE TABLE above already has the widened list.
$usersTableSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")['sql'] ?? '';
if ($usersTableSql && !str_contains($usersTableSql, "'treasurer'")) {
    // PRAGMA foreign_keys is a no-op inside a transaction, and SQLite refuses
    // to DROP a table other tables still hold a foreign key against while
    // it's ON - so this has to be toggled off before BEGIN, not inside it.
    db()->exec('PRAGMA foreign_keys = OFF');
    db()->exec('BEGIN TRANSACTION');
    db()->exec(<<<'SQL'
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      auth_type TEXT NOT NULL CHECK(auth_type IN ('osm','local')),
      osm_user_id TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','trustee_viewer','treasurer','chair','admin')),
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
    )
    SQL);
    db()->exec('INSERT INTO users_new SELECT * FROM users');
    db()->exec('DROP TABLE users');
    db()->exec('ALTER TABLE users_new RENAME TO users');
    db()->exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(portal_role, account_status)');
    db()->exec('COMMIT');
    db()->exec('PRAGMA foreign_keys = ON');
}
