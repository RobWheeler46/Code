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

-- Admin OSM Capacity Tracker & Movement Trends (FRD 29 / 6.1). osm_sections
-- caches the latest aggregate active count per OSM section (counts only - named
-- member records are never stored); section_capacity holds the local planning
-- capacity + amber/red warning thresholds; section_snapshots retains a periodic
-- aggregate so a rising/falling/stable trend can be shown over time.
CREATE TABLE IF NOT EXISTS osm_sections (
  osm_section_id TEXT PRIMARY KEY,
  section_name TEXT NOT NULL,
  section_type TEXT,
  active_count INTEGER,
  joining_count INTEGER,
  last_synced_at TEXT,
  synced_by INTEGER REFERENCES users(id),
  sync_status TEXT NOT NULL DEFAULT 'ok' CHECK(sync_status IN ('ok','error')),
  sync_error TEXT
);

CREATE TABLE IF NOT EXISTS section_capacity (
  osm_section_id TEXT PRIMARY KEY,
  section_name TEXT,
  capacity INTEGER,
  amber_pct INTEGER NOT NULL DEFAULT 85,
  red_pct INTEGER NOT NULL DEFAULT 95,
  joining_count INTEGER,
  active_count INTEGER,
  owner TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS section_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  osm_section_id TEXT NOT NULL,
  active_count INTEGER,
  joining_count INTEGER,
  snapshot_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(osm_section_id, snapshot_date)
);

-- Action Centre (FRD FR-ACT): actions are computed live from the other modules,
-- so only per-user dismissals of dismissible items are stored.
CREATE TABLE IF NOT EXISTS dismissed_actions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  action_key TEXT NOT NULL,
  dismissed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, action_key)
);

-- In-portal notifications (FRD FR-NOT).
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, id);

-- Per-user notification preferences: muted types (JSON list) + weekly digest opt-in.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  muted_types TEXT,
  weekly_digest INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Event and Camp Hub (FRD FR-EVT-HUB). A local information page per event/camp;
-- OSM stays the system of record for sign-up, payment and attendance (link-out
-- only). Leader-only items (risk assessments etc.) are never shown to parents.
-- Optional module, off by default.
CREATE TABLE IF NOT EXISTS event_hubs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'event' CHECK(event_type IN ('event','camp','sleepover','trip','activity')),
  osm_section_id TEXT,
  section_name TEXT,
  start_date TEXT,
  end_date TEXT,
  location TEXT,
  key_information TEXT,
  what_to_bring TEXT,
  programme_highlights TEXT,
  osm_event_url TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_hubs_status ON event_hubs(status, start_date);

CREATE TABLE IF NOT EXISTS event_hub_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id INTEGER NOT NULL REFERENCES event_hubs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  item_status TEXT NOT NULL DEFAULT 'draft' CHECK(item_status IN ('draft','published','linked','awaiting')),
  visibility TEXT NOT NULL DEFAULT 'parents' CHECK(visibility IN ('parents','leaders')),
  owner_name TEXT,
  link_url TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_hub_items_hub ON event_hub_items(hub_id);

-- Incident and near-miss logging (FRD FR-INC). Safeguarding-sensitive: this does
-- NOT replace formal Scouts safeguarding/accident reporting - the module signposts
-- to those and restricts access. Ships off by default. Restricted records
-- (accident follow-up, behaviour concern, safeguarding signpost) are visible only
-- to admins, GLV, the reporter and the assigned owner; all access is audited.
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL CHECK(record_type IN ('near_miss','accident_followup','behaviour_concern','building_issue','safeguarding_signpost')),
  sensitivity TEXT NOT NULL DEFAULT 'standard' CHECK(sensitivity IN ('standard','restricted')),
  summary TEXT NOT NULL,
  osm_section_id TEXT,
  section_name TEXT,
  event_name TEXT,
  occurred_at TEXT,
  location TEXT,
  what_happened TEXT,
  immediate_action TEXT,
  follow_up_actions TEXT,
  assigned_to INTEGER REFERENCES users(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','closed')),
  closed_note TEXT,
  reported_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, record_type);

-- Equipment and asset register (FRD FR-EQP). Ships off by default via Admin ->
-- Settings, like the other optional modules.
CREATE TABLE IF NOT EXISTS equipment_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general' CHECK(category IN ('camping','activity','safety','general')),
  quantity INTEGER NOT NULL DEFAULT 1,
  condition TEXT NOT NULL DEFAULT 'good' CHECK(condition IN ('new','good','fair','poor','unserviceable')),
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','allocated','loaned','under_repair','retired','missing')),
  owner_name TEXT,
  osm_section_id TEXT,
  section_name TEXT,
  location TEXT,
  linked_event TEXT,
  purchase_date TEXT,
  value REAL,
  notes TEXT,
  next_inspection_date TEXT,
  replacement_due_date TEXT,
  loan_due_date TEXT,
  last_checked_date TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment_assets(status, category);

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

// Migration: section_capacity gained active_count (an admin-entered active-member
// count for the capacity tracker, since OSM blocks live /ext/ member reads from a
// server). Add the column if an older section_capacity table predates it.
$secCapSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='section_capacity'")['sql'] ?? '';
if ($secCapSql && !str_contains($secCapSql, 'active_count')) {
    db()->exec('ALTER TABLE section_capacity ADD COLUMN active_count INTEGER');
}

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
