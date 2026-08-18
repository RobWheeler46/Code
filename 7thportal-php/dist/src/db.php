<?php
// PDO/SQLite port of the Node version's src/db.js - same schema, same file
// name, so the two apps' data files are interchangeable if ever needed.

// The DB file defaults to data/7thportal.db, but SEVENTHPORTAL_DB can point it
// elsewhere (a throwaway file for the smoke-test harness, or a staging DB) without
// touching the real data. Read straight from the environment so it works however
// early db.php is required.
$dbFile = getenv('SEVENTHPORTAL_DB') ?: (__DIR__ . '/../data/7thportal.db');
$dataDir = dirname($dbFile);
if (!is_dir($dataDir)) mkdir($dataDir, 0775, true);

$GLOBALS['__db'] = new PDO('sqlite:' . $dbFile);
$GLOBALS['__db']->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$GLOBALS['__db']->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
// busy_timeout is the main defence against the post-deploy "database is locked"
// 500: migrations run at bootstrap, so when several first-load requests hit at
// once, one holds the write lock while it migrates. Without a busy timeout the
// others fail INSTANTLY; with it they wait (up to 15s) for the lock to clear and
// then find the work already done. Must be set on every connection, before any
// write. WAL also lets readers run while one writer holds the lock.
$GLOBALS['__db']->exec('PRAGMA busy_timeout = 15000');
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
  phone TEXT,
  portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','quartermaster','trustee_viewer','treasurer','chair','admin')),
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

-- A named pool of eligible approvers for a finance account (FRD s28). An account
-- may link to one group; at claim time the claimant nominates one member of that
-- group as the approver. Kept separate from the account's legacy single
-- approver/deputy so accounts without a group fall back to the old behaviour.
CREATE TABLE IF NOT EXISTS finance_approval_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS finance_approval_group_members (
  group_id INTEGER NOT NULL REFERENCES finance_approval_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS expense_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT,
  approver_user_id INTEGER REFERENCES users(id),
  deputy_approver_user_id INTEGER REFERENCES users(id),
  approval_group_id INTEGER REFERENCES finance_approval_groups(id),
  claimant_selects_approver INTEGER NOT NULL DEFAULT 0,
  approver_selection_level TEXT NOT NULL DEFAULT 'account',
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
  selected_approver_user_id INTEGER REFERENCES users(id),
  selected_approver_group_id INTEGER REFERENCES finance_approval_groups(id),
  selected_approver_snapshot_json TEXT,
  approver_assigned_by_user_id INTEGER REFERENCES users(id),
  approver_assignment_reason TEXT,
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
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'osm'
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

-- Camp Planning Toolkit: location & emergency directory (FRD FR-CAMP-OP-004..008).
-- Structured locations per event/camp with a visibility tier: parent-visible (e.g.
-- drop-off/collection), leader-only, or emergency (leader-only + shown prominently
-- in the emergency directory / offline pack). Parents only ever see 'parents' rows.
CREATE TABLE IF NOT EXISTS event_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id INTEGER NOT NULL REFERENCES event_hubs(id) ON DELETE CASCADE,
  location_type TEXT NOT NULL DEFAULT 'other' CHECK(location_type IN ('campsite','hospital','minor_injuries','dentist','optician','vet','fuel','gas','supermarket','supplier','activity_venue','drop_off','collection','other')),
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  opening_times TEXT,
  notes TEXT,
  map_url TEXT,
  visibility TEXT NOT NULL DEFAULT 'leaders' CHECK(visibility IN ('parents','leaders','emergency')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_event_locations_hub ON event_locations(hub_id);

-- Camp Planning Toolkit: adult rota (FR-CAMP-OP-018..021). The camp's adult team
-- (with driver/first-aid flags + permits/skills notes) and rota entries by day,
-- session, role and optional activity. An entry with no adult assigned is a "gap".
-- Leader-only; parents never see any of this.
CREATE TABLE IF NOT EXISTS camp_rota_adults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id INTEGER NOT NULL REFERENCES event_hubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_driver INTEGER NOT NULL DEFAULT 0,
  is_first_aider INTEGER NOT NULL DEFAULT 0,
  skills TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_camp_rota_adults_hub ON camp_rota_adults(hub_id);

CREATE TABLE IF NOT EXISTS camp_rota_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hub_id INTEGER NOT NULL REFERENCES event_hubs(id) ON DELETE CASCADE,
  day_label TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT 'am' CHECK(session IN ('am','pm','evening','night','all_day')),
  role TEXT NOT NULL DEFAULT 'other',
  adult_id INTEGER REFERENCES camp_rota_adults(id) ON DELETE SET NULL,
  activity TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_camp_rota_entries_hub ON camp_rota_entries(hub_id);

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
  maintenance_locked INTEGER NOT NULL DEFAULT 0,
  -- QM Advanced Controls (FRD FR-QM-ADV/INV): richer inventory model
  item_type TEXT NOT NULL DEFAULT 'asset' CHECK(item_type IN ('asset','kit','kit_component','consumable')),
  -- QM v2.4.3 tracking mode (Appendix I 18.4): serialised (per-instance), bulk
  -- reusable (by quantity), or consumable (issued/used up). Distinct from the
  -- Controlled-Equipment rule profile (the `restricted` flag).
  tracking_mode TEXT NOT NULL DEFAULT 'bulk_reusable' CHECK(tracking_mode IN ('serialised','bulk_reusable','consumable')),
  parent_kit_id INTEGER,
  restricted INTEGER NOT NULL DEFAULT 0,
  restricted_category TEXT,
  storage_area TEXT,
  location_code TEXT,
  location_confidence TEXT,
  stock_level INTEGER,
  reorder_threshold INTEGER,
  issue_unit TEXT,
  replacement_value REAL,
  supplier TEXT,
  warranty_expiry TEXT,
  serial_number TEXT,
  insurance_relevant INTEGER NOT NULL DEFAULT 0,
  -- QM Advanced Controls suitability rules (FR-QM-ADV-013)
  suitable_sections TEXT,
  suitable_events TEXT,
  max_group_size INTEGER,
  setup_time_mins INTEGER,
  vehicle_required TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Equipment inspection history + repair tasks (QM Maintenance & Inspection
-- Workflow). Each inspection records an outcome that drives condition, lock and
-- retirement; a maintenance lock blocks booking until a return-to-service pass.
CREATE TABLE IF NOT EXISTS equipment_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  outcome TEXT NOT NULL,
  condition_set TEXT,
  next_inspection_date TEXT,
  note TEXT,
  locked INTEGER NOT NULL DEFAULT 0,
  inspected_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_inspections_asset ON equipment_inspections(asset_id);
CREATE TABLE IF NOT EXISTS equipment_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  opened_by INTEGER REFERENCES users(id),
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_equipment_repairs_asset ON equipment_repairs(asset_id, status);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment_assets(status, category);

-- QM Advanced Controls kits (FRD FR-QM-ADV-002/003, INV-010). A kit (an asset with
-- item_type='kit') has an expected-contents checklist; a completeness check records
-- the state of each expected component pre-loan or post-return.
CREATE TABLE IF NOT EXISTS equipment_kit_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  expected_qty INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_components_kit ON equipment_kit_components(kit_asset_id);
CREATE TABLE IF NOT EXISTS equipment_kit_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kit_asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK(check_type IN ('pre_loan','post_return','routine')),
  result TEXT NOT NULL CHECK(result IN ('complete','incomplete','damaged')),
  note TEXT,
  booking_id INTEGER,
  checked_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_checks_kit ON equipment_kit_checks(kit_asset_id);
CREATE TABLE IF NOT EXISTS equipment_kit_check_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES equipment_kit_checks(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','missing','damaged')),
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_equipment_kit_check_items_check ON equipment_kit_check_items(check_id);

-- QM v2.4.3 stock ledger (Appendix I 18.8). Every stock-affecting event is an
-- attributable, immutable movement; the current bulk/consumable balance is the sum
-- of deltas. There is NO direct set-current-quantity anywhere - a correction is a
-- movement with a reason and a recorded before/after. movement_type: opening,
-- purchase, issue, loss, disposal, stocktake, correction, return.
CREATE TABLE IF NOT EXISTS equipment_stock_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('opening','purchase','issue','loss','disposal','stocktake','correction','return')),
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT,
  source_ref TEXT,
  actor_user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_stock_ledger_asset ON equipment_stock_ledger(asset_id, id);

-- QM v2.4.3 serialised asset instances (Appendix I 18.4/18.8). A serialised asset
-- (tracking_mode='serialised') has one record per physical unit with a stable
-- reference, lifecycle status, condition and location. Active/available counts are
-- derived from these instances, not the stock ledger. A qty>1 master row is not a
-- valid live identity record.
CREATE TABLE IF NOT EXISTS equipment_asset_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  instance_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','issued','maintenance','quarantine','retired','disposed')),
  condition TEXT NOT NULL DEFAULT 'good' CHECK(condition IN ('new','good','fair','poor','unserviceable')),
  location TEXT,
  barcode TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  retired_at TEXT,
  UNIQUE(asset_id, instance_ref)
);
CREATE INDEX IF NOT EXISTS idx_equipment_asset_instances_asset ON equipment_asset_instances(asset_id, status);

-- QM v2.4.3 stocktake (Appendix I 18.8). A stocktake snapshots system balances for
-- a scope of bulk/consumable items, records the counted quantity, computes variance
-- and, on posting, writes a 'stocktake' ledger movement per varying line with the
-- stocktake reference and reason. The original count and variance stay auditable.
CREATE TABLE IF NOT EXISTS equipment_stocktakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT NOT NULL,
  scope TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted','cancelled')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS equipment_stocktake_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stocktake_id INTEGER NOT NULL REFERENCES equipment_stocktakes(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES equipment_assets(id) ON DELETE CASCADE,
  system_qty INTEGER NOT NULL,
  counted_qty INTEGER,
  posted_delta INTEGER
);
CREATE INDEX IF NOT EXISTS idx_equipment_stocktake_lines_stocktake ON equipment_stocktake_lines(stocktake_id);

-- QM v2.4.3 import review (Appendix I). A stock-control import stages into review
-- rows with a proposed tracking mode / unit / opening quantity; ambiguous or
-- incomplete rows stay in needs_review, mixed rows can be split, and only validated
-- ('ready') rows are activated into the live register.
CREATE TABLE IF NOT EXISTS equipment_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','activated')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS equipment_import_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES equipment_import_batches(id) ON DELETE CASCADE,
  source_row INTEGER,
  name TEXT NOT NULL,
  category TEXT,
  location TEXT,
  tracking_mode TEXT,
  issue_unit TEXT,
  opening_qty INTEGER NOT NULL DEFAULT 0,
  review_status TEXT NOT NULL DEFAULT 'needs_review' CHECK(review_status IN ('needs_review','ready','activated','skipped')),
  issues TEXT,
  created_asset_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_equipment_import_rows_batch ON equipment_import_rows(batch_id, review_status);

-- Quartermaster Booking (FRD FR-QM / backlog LATER-005). Builds on the equipment
-- register: leaders raise booking requests for stores items and Quartermasters
-- (Group Leadership Team + admins) approve/substitute at item-line level, then run
-- the collection -> return -> condition-check workflow. Not self-service: nothing is
-- reserved until a QM approves. Ships off by default. Parents are never granted
-- access (FR-QM-024). Overdue/due-back are derived at read time from return_at, so
-- they are not stored states.
CREATE TABLE IF NOT EXISTS qm_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT,
  requester_user_id INTEGER NOT NULL REFERENCES users(id),
  purpose TEXT,
  osm_section_id TEXT,
  section_name TEXT,
  event_hub_id INTEGER REFERENCES event_hubs(id) ON DELETE SET NULL,
  event_name TEXT,
  collect_at TEXT,
  return_at TEXT,
  collection_details TEXT,
  return_details TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted','approved','partially_approved','ready_for_collection','collected','returned','closed','cancelled')),
  cancel_reason TEXT,
  submitted_at TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  collected_at TEXT,
  collected_by_name TEXT,
  returned_at TEXT,
  return_condition_note TEXT,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qm_bookings_status ON qm_bookings(status, return_at);
CREATE INDEX IF NOT EXISTS idx_qm_bookings_requester ON qm_bookings(requester_user_id, status);

CREATE TABLE IF NOT EXISTS qm_booking_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id INTEGER NOT NULL REFERENCES qm_bookings(id) ON DELETE CASCADE,
  equipment_asset_id INTEGER REFERENCES equipment_assets(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  requested_qty INTEGER NOT NULL DEFAULT 1,
  approved_qty INTEGER,
  substitute_asset_id INTEGER REFERENCES equipment_assets(id) ON DELETE SET NULL,
  substitute_name TEXT,
  line_status TEXT NOT NULL DEFAULT 'requested' CHECK(line_status IN ('requested','approved','rejected','substituted','more_info')),
  qm_notes TEXT,
  issue_condition TEXT,
  return_condition TEXT,
  damage_notes TEXT,
  permit_confirmed INTEGER NOT NULL DEFAULT 0,
  responsible_adult TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qm_booking_items_booking ON qm_booking_items(booking_id);
CREATE INDEX IF NOT EXISTS idx_qm_booking_items_asset ON qm_booking_items(equipment_asset_id);

-- QM equipment bundles (FR-QM-ADV-014): a reusable named kit list a Quartermaster
-- curates (e.g. "Camping weekend kit") that can generate a draft booking request in
-- one action.
CREATE TABLE IF NOT EXISTS qm_bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS qm_bundle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER NOT NULL REFERENCES qm_bundles(id) ON DELETE CASCADE,
  equipment_asset_id INTEGER REFERENCES equipment_assets(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  requested_qty INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qm_bundle_items_bundle ON qm_bundle_items(bundle_id);

-- A booking can be for one OR MORE sections (v2.4.3: booking selects mandatory
-- section(s)). Stored as a join; qm_bookings.section_name keeps a display summary.
CREATE TABLE IF NOT EXISTS qm_booking_sections (
  booking_id INTEGER NOT NULL REFERENCES qm_bookings(id) ON DELETE CASCADE,
  osm_section_id TEXT NOT NULL,
  section_name TEXT NOT NULL,
  PRIMARY KEY (booking_id, osm_section_id)
);

-- Internal calendar (FRD FR-CAL / backlog LATER-007). A local planning layer that
-- links modules together - it does NOT replace OSM as the source of truth for OSM
-- programme/event data. The calendar view aggregates these local entries with
-- Event & Camp Hub records and QM booking resource blocks (read live from those
-- tables, not copied). Entries are leader-only until deliberately published to
-- parents with a parent-safe title/description. Ships off by default.
CREATE TABLE IF NOT EXISTS calendar_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'placeholder' CHECK(entry_type IN ('placeholder','activity','deadline','note')),
  scope TEXT NOT NULL DEFAULT 'group' CHECK(scope IN ('group','section')),
  osm_section_id TEXT,
  section_name TEXT,
  start_at TEXT NOT NULL,
  end_at TEXT,
  all_day INTEGER NOT NULL DEFAULT 1,
  location TEXT,
  owner_name TEXT,
  notes TEXT,
  parent_safe_title TEXT,
  parent_safe_description TEXT,
  visibility TEXT NOT NULL DEFAULT 'leaders' CHECK(visibility IN ('leaders','parents')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled')),
  converted_event_hub_id INTEGER REFERENCES event_hubs(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calendar_entries_range ON calendar_entries(start_at, end_at);

-- Section attendance registers (FRD FR-SEC-ATT / FR-SEC-REG). A register is a local
-- historical record of who attended a session, pre-populated from the live OSM
-- roster and then owned locally. Unlike the roster (fetch-not-stored), attendance
-- IS stored - the member name/grouping are snapshotted per row so the record
-- survives later OSM membership changes (FR-SEC-REG-005). This is the deliberate,
-- FRD-authorised exception to "counts only, never store names". Emergency contact
-- details are NOT part of this and are never stored here. Ships off by default.
CREATE TABLE IF NOT EXISTS attendance_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  osm_section_id TEXT NOT NULL,
  section_name TEXT,
  title TEXT NOT NULL,
  session_date TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'ad_hoc' CHECK(source_type IN ('ad_hoc','calendar','event')),
  source_ref_id INTEGER,
  source_label TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','submitted')),
  created_by INTEGER REFERENCES users(id),
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_attendance_registers_section ON attendance_registers(osm_section_id, session_date);

CREATE TABLE IF NOT EXISTS attendance_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  register_id INTEGER NOT NULL REFERENCES attendance_registers(id) ON DELETE CASCADE,
  osm_member_id TEXT,
  member_name TEXT NOT NULL,
  grouping TEXT,
  status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('present','absent','late','left_early','excused','unknown','guest')),
  note TEXT,
  sort_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(register_id, osm_member_id)
);
CREATE INDEX IF NOT EXISTS idx_attendance_marks_register ON attendance_marks(register_id);

-- Activity Approval forms (Activity Approval Testing Pack). A digital form + a
-- two-stage sequential approval workflow (Section Lead -> GLV). Off by default.
-- Uploaded evidence lives in data/activity-uploads (private, authenticated-proxy
-- only, same as receipts/gallery). activity_form_events is the approval trail.
CREATE TABLE IF NOT EXISTS activity_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  leader_name TEXT, leader_phone TEXT, leader_email TEXT,
  activity_description TEXT, activity_location TEXT, activity_date TEXT, activity_end_date TEXT,
  osm_section_id TEXT, section_names TEXT, yp_count INTEGER, adult_count INTEGER,
  activity_type TEXT, qualifications TEXT, in_touch TEXT,
  external_provider_used INTEGER NOT NULL DEFAULT 0,
  unity_approval_required INTEGER NOT NULL DEFAULT 0,
  risk_assessment_confirmed INTEGER NOT NULL DEFAULT 0,
  public_liability_confirmed INTEGER NOT NULL DEFAULT 0,
  activity_rules_confirmed INTEGER NOT NULL DEFAULT 0,
  add_to_calendar INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','awaiting_section','awaiting_glv','approved','rejected','more_info')),
  more_info_stage TEXT,
  submitted_at TEXT,
  section_decided_by INTEGER REFERENCES users(id), section_decided_at TEXT,
  glv_decided_by INTEGER REFERENCES users(id), glv_decided_at TEXT,
  calendar_entry_id INTEGER REFERENCES calendar_entries(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_forms_status ON activity_forms(status, osm_section_id);
CREATE INDEX IF NOT EXISTS idx_activity_forms_creator ON activity_forms(created_by, status);

CREATE TABLE IF NOT EXISTS activity_form_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES activity_forms(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'supporting' CHECK(doc_type IN ('risk_assessment','public_liability','unity_insurance','supporting')),
  storage_key TEXT NOT NULL,
  ext TEXT NOT NULL,
  original_filename TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_form_files_form ON activity_form_files(form_id);

CREATE TABLE IF NOT EXISTS activity_form_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL REFERENCES activity_forms(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  stage TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_form_events_form ON activity_form_events(form_id);

-- Patrol Points (FRD v2.1 s13). Competitions with named teams, scoring categories,
-- comment-required score submissions (multi-team, approvable, no self-approval) and
-- a derived tie-aware leaderboard. Optional module, off by default.
CREATE TABLE IF NOT EXISTS pp_competitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','paused','completed','archived')),
  approval_mode TEXT NOT NULL DEFAULT 'immediate' CHECK(approval_mode IN ('immediate','approval')),
  visibility TEXT NOT NULL DEFAULT 'leaders' CHECK(visibility IN ('leaders','parents')),
  allow_deductions INTEGER NOT NULL DEFAULT 0,
  osm_section_id TEXT, section_name TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pp_teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_teams_comp ON pp_teams(competition_id);
CREATE TABLE IF NOT EXISTS pp_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  points_type TEXT NOT NULL DEFAULT 'free' CHECK(points_type IN ('free','fixed')),
  fixed_points INTEGER,
  point_buttons TEXT,
  reason_presets TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_categories_comp ON pp_categories(competition_id);
CREATE TABLE IF NOT EXISTS pp_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES pp_categories(id) ON DELETE CASCADE,
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('pending','approved','rejected','returned')),
  withdrawn INTEGER NOT NULL DEFAULT 0,
  revises_id INTEGER REFERENCES pp_submissions(id) ON DELETE SET NULL,
  superseded_by INTEGER REFERENCES pp_submissions(id) ON DELETE SET NULL,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_submissions_comp ON pp_submissions(competition_id, status);
CREATE TABLE IF NOT EXISTS pp_score_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES pp_submissions(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES pp_teams(id) ON DELETE CASCADE,
  points INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pp_score_lines_sub ON pp_score_lines(submission_id);
CREATE INDEX IF NOT EXISTS idx_pp_score_lines_team ON pp_score_lines(team_id);
-- Competition participants: a young person (OSM-linked or manual) assigned to one
-- team within a competition. One active team per person per competition (enforced
-- for OSM members by the partial unique index). Membership is retained and locked
-- once the competition is completed (FRD v2.1 s13 PP-TEAM-003/004/005, BR-03/04).
CREATE TABLE IF NOT EXISTS pp_participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES pp_teams(id) ON DELETE CASCADE,
  person_ref TEXT,
  display_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('osm','manual')),
  patrol TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_participants_comp ON pp_participants(competition_id);
CREATE INDEX IF NOT EXISTS idx_pp_participants_team ON pp_participants(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_participants_person ON pp_participants(competition_id, person_ref) WHERE person_ref IS NOT NULL;
-- Activity/station profiles: a reusable scoring definition bound to a category,
-- with its own Quick Score buttons/reasons and an optional team scope. Quick Score
-- can launch straight into a profile; per-activity QR guest links point at one
-- (FRD v2.4 s13.11). team_scope is a JSON array of team ids (null = all teams).
CREATE TABLE IF NOT EXISTS pp_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES pp_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  point_buttons TEXT,
  reason_presets TEXT,
  team_scope TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_activities_comp ON pp_activities(competition_id);
-- Guest Quick Entry links (FRD v2.4 s13.8): a high-entropy, revocable token that
-- lets an un-logged-in helper submit PENDING-ONLY scores for one activity profile.
-- Optional PIN and expiry; scope is enforced server-side from the activity.
CREATE TABLE IF NOT EXISTS pp_guest_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES pp_competitions(id) ON DELETE CASCADE,
  activity_id INTEGER NOT NULL REFERENCES pp_activities(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  label TEXT,
  pin_hash TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pp_guest_links_comp ON pp_guest_links(competition_id);
-- Demo/UAT feedback (Test Environment pack DEMO-FB): testers leave feedback from
-- any page in demo mode - persona, page, device, rating, category and comment.
CREATE TABLE IF NOT EXISTS demo_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  persona TEXT,
  page TEXT,
  device TEXT,
  rating INTEGER,
  category TEXT,
  comment TEXT,
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

// Migration: users gained osm_terms_json - the OSM terms (with dates) for the
// leader's sections, captured from the login startup payload (no extra OSM call)
// so the portal can show current-term context. Add the column if missing.
$usersTermsSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")['sql'] ?? '';
if ($usersTermsSql && !str_contains($usersTermsSql, 'osm_terms_json')) {
    db()->exec('ALTER TABLE users ADD COLUMN osm_terms_json TEXT');
}

// Migration: users gained phone - the leader's own phone, remembered from the
// last Activity Approval form they filled (and seeded once from OSM), so future
// forms prefill it. Add the column if an older users table predates it.
if ($usersTermsSql && !str_contains($usersTermsSql, 'phone')) {
    db()->exec('ALTER TABLE users ADD COLUMN phone TEXT');
}

// Migration: section_capacity gained active_count (an admin-entered active-member
// count for the capacity tracker, since OSM blocks live /ext/ member reads from a
// server). Add the column if an older section_capacity table predates it.
$secCapSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='section_capacity'")['sql'] ?? '';
if ($secCapSql && !str_contains($secCapSql, 'active_count')) {
    db()->exec('ALTER TABLE section_capacity ADD COLUMN active_count INTEGER');
}

// Migration: expense_accounts gained a link to a finance approval group plus the
// nominated-approver config flags (FRD s28). Accounts without a group keep the
// legacy single approver/deputy behaviour. Add the columns if an older table
// predates them.
$acctSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='expense_accounts'")['sql'] ?? '';
if ($acctSql && !str_contains($acctSql, 'approval_group_id')) {
    // Plain INTEGER (no inline REFERENCES): some SQLite builds reject an
    // ADD COLUMN that carries a foreign-key clause. The link is enforced in code.
    db()->exec('ALTER TABLE expense_accounts ADD COLUMN approval_group_id INTEGER');
    db()->exec('ALTER TABLE expense_accounts ADD COLUMN claimant_selects_approver INTEGER NOT NULL DEFAULT 0');
    db()->exec("ALTER TABLE expense_accounts ADD COLUMN approver_selection_level TEXT NOT NULL DEFAULT 'account'");
}

// Migration: expense_claim_items gained the claimant-nominated approver + its
// immutable submission snapshot (FRD s28 stage 2). Add if an older table predates.
$eciSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='expense_claim_items'")['sql'] ?? '';
if ($eciSql && !str_contains($eciSql, 'selected_approver_user_id')) {
    // Plain INTEGER (no inline REFERENCES) - see the account migration above.
    db()->exec('ALTER TABLE expense_claim_items ADD COLUMN selected_approver_user_id INTEGER');
    db()->exec('ALTER TABLE expense_claim_items ADD COLUMN selected_approver_group_id INTEGER');
    db()->exec('ALTER TABLE expense_claim_items ADD COLUMN selected_approver_snapshot_json TEXT');
}

// Migration: reassignment metadata for the nominated approver (FRD s28 stage 3,
// FR-FIN-NA-009) - who set the current assignee and why (claimant_selection,
// reassignment, overdue, conflict, admin_correction). The original submission
// snapshot above is never overwritten, so audit history stays stable.
$eciSql2 = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='expense_claim_items'")['sql'] ?? '';
if ($eciSql2 && !str_contains($eciSql2, 'approver_assigned_by_user_id')) {
    db()->exec('ALTER TABLE expense_claim_items ADD COLUMN approver_assigned_by_user_id INTEGER');
    db()->exec('ALTER TABLE expense_claim_items ADD COLUMN approver_assignment_reason TEXT');
}

// Migration: activity_forms gained conditional-insurance flags (improved-flow
// spec). external_provider_used gates the public-liability confirmation + PL
// document; unity_approval_required gates the Unity Insurance approval document.
$activityFormsSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_forms'")['sql'] ?? '';
if ($activityFormsSql && !str_contains($activityFormsSql, 'external_provider_used')) {
    db()->exec('ALTER TABLE activity_forms ADD COLUMN external_provider_used INTEGER NOT NULL DEFAULT 0');
    db()->exec('ALTER TABLE activity_forms ADD COLUMN unity_approval_required INTEGER NOT NULL DEFAULT 0');
}
// Migration: activity_forms gained activity_type (improved-flow spec) - the
// selected activity type drives whether "Relevant qualifications" is required.
if ($activityFormsSql && !str_contains($activityFormsSql, 'activity_type')) {
    db()->exec('ALTER TABLE activity_forms ADD COLUMN activity_type TEXT');
}
// Migration: pp_submissions gained withdraw + revision columns (FRD v2.1 s13
// PP-PTS-008/009). withdrawn cancels a pending/returned submission; revises_id
// links a correction to the approved submission it replaces; superseded_by marks
// the original once its revision is approved (so it stops counting).
$ppSubsSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='pp_submissions'")['sql'] ?? '';
if ($ppSubsSql && !str_contains($ppSubsSql, 'revises_id')) {
    db()->exec('ALTER TABLE pp_submissions ADD COLUMN withdrawn INTEGER NOT NULL DEFAULT 0');
    db()->exec('ALTER TABLE pp_submissions ADD COLUMN revises_id INTEGER');
    db()->exec('ALTER TABLE pp_submissions ADD COLUMN superseded_by INTEGER');
}
// Migration: pp_categories gained Quick Score config - configurable point buttons
// and reason presets (FRD v2.4 s13.7).
$ppCatsSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='pp_categories'")['sql'] ?? '';
if ($ppCatsSql && !str_contains($ppCatsSql, 'point_buttons')) {
    db()->exec('ALTER TABLE pp_categories ADD COLUMN point_buttons TEXT');
    db()->exec('ALTER TABLE pp_categories ADD COLUMN reason_presets TEXT');
}
// Migration: pp_competitions gained allow_deductions (Module Design: negative
// points disabled by default unless deliberately enabled and governed).
$ppCompsSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='pp_competitions'")['sql'] ?? '';
if ($ppCompsSql && !str_contains($ppCompsSql, 'allow_deductions')) {
    db()->exec('ALTER TABLE pp_competitions ADD COLUMN allow_deductions INTEGER NOT NULL DEFAULT 0');
}
// Migration: equipment_assets gained a maintenance lock (QM inspection workflow).
$eqSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='equipment_assets'")['sql'] ?? '';
if ($eqSql && !str_contains($eqSql, 'maintenance_locked')) {
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN maintenance_locked INTEGER NOT NULL DEFAULT 0');
}
// Migration: QM Advanced Controls richer inventory model (FRD FR-QM-ADV/INV).
// Add the columns if an older equipment_assets table predates them.
if ($eqSql && !str_contains($eqSql, 'item_type')) {
    db()->exec("ALTER TABLE equipment_assets ADD COLUMN item_type TEXT NOT NULL DEFAULT 'asset'");
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN parent_kit_id INTEGER');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN restricted INTEGER NOT NULL DEFAULT 0');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN restricted_category TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN storage_area TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN location_code TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN location_confidence TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN stock_level INTEGER');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN reorder_threshold INTEGER');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN issue_unit TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN replacement_value REAL');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN supplier TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN warranty_expiry TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN serial_number TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN insurance_relevant INTEGER NOT NULL DEFAULT 0');
}
// Migration: QM suitability rules (FR-QM-ADV-013). Add if an older table predates them.
if ($eqSql && !str_contains($eqSql, 'suitable_sections')) {
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN suitable_sections TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN suitable_events TEXT');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN max_group_size INTEGER');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN setup_time_mins INTEGER');
    db()->exec('ALTER TABLE equipment_assets ADD COLUMN vehicle_required TEXT');
}
// Migration: QM v2.4.3 tracking mode (Appendix I 18.4). Add the column and backfill
// from the existing item_type (consumables map to consumable; everything else to
// bulk reusable - serialised is opted into deliberately per item).
if ($eqSql && !str_contains($eqSql, 'tracking_mode')) {
    db()->exec("ALTER TABLE equipment_assets ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'bulk_reusable'");
    db()->exec("UPDATE equipment_assets SET tracking_mode = 'consumable' WHERE item_type = 'consumable'");
}
// Migration: seed opening stock balances into the ledger (v2.4.3 18.8) so current
// balance is reproducible from movements. One-off per asset that has no ledger yet:
// the opening delta is the consumable stock_level where set, else the owned
// quantity. Idempotent - only assets with zero ledger rows are seeded.
if (dbGet("SELECT name FROM sqlite_master WHERE type='table' AND name='equipment_stock_ledger'")) {
    foreach (dbAll("SELECT a.id, a.item_type, a.quantity, a.stock_level FROM equipment_assets a WHERE NOT EXISTS (SELECT 1 FROM equipment_stock_ledger l WHERE l.asset_id = a.id)") as $a) {
        $opening = $a['item_type'] === 'consumable' && $a['stock_level'] !== null ? (int) $a['stock_level'] : (int) $a['quantity'];
        db()->prepare('INSERT INTO equipment_stock_ledger (asset_id, movement_type, delta, balance_after, reason) VALUES (?, ?, ?, ?, ?)')
            ->execute([$a['id'], 'opening', $opening, $opening, 'Opening balance (migrated)']);
    }
}
// Migration: restricted-equipment booking gate (FRD FR-QM-ADV-008) - a booking
// line for controlled kit carries a permit/qualification confirmation and a named
// responsible adult. Add the columns if an older table predates them.
$qmiSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='qm_booking_items'")['sql'] ?? '';
if ($qmiSql && !str_contains($qmiSql, 'permit_confirmed')) {
    db()->exec('ALTER TABLE qm_booking_items ADD COLUMN permit_confirmed INTEGER NOT NULL DEFAULT 0');
    db()->exec('ALTER TABLE qm_booking_items ADD COLUMN responsible_adult TEXT');
}
// Migration: osm_sections gained a source marker so admin-managed local sections
// (added when OSM is not connected, e.g. the test site) can coexist with OSM-synced
// ones - an OSM sync only touches source='osm' rows and never clobbers local ones.
$osmSecSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='osm_sections'")['sql'] ?? '';
if ($osmSecSql && !str_contains($osmSecSql, 'source')) {
    db()->exec("ALTER TABLE osm_sections ADD COLUMN source TEXT NOT NULL DEFAULT 'osm'");
}
// Migration: pp_submissions gained guest attribution (FRD v2.4 s13.8) - guest
// scores are owned by a service user but carry the link id and unverified name.
if ($ppSubsSql && !str_contains($ppSubsSql, 'guest_link_id')) {
    db()->exec('ALTER TABLE pp_submissions ADD COLUMN guest_link_id INTEGER');
    db()->exec('ALTER TABLE pp_submissions ADD COLUMN guest_name TEXT');
}
// Migration: GLV-only workflow (glv-only-1.0) drops the Section Lead stage. Move
// any in-flight forms still awaiting Section Lead approval into the GLV queue so
// nothing is stranded. Idempotent - the guard skips it once none remain.
if (dbGet("SELECT 1 FROM activity_forms WHERE status = 'awaiting_section' OR more_info_stage = 'section' LIMIT 1")) {
    db()->exec("UPDATE activity_forms SET status = 'awaiting_glv' WHERE status = 'awaiting_section'");
    db()->exec("UPDATE activity_forms SET more_info_stage = 'glv' WHERE more_info_stage = 'section'");
}

// Migration: the finance module was rebuilt from a single-item-per-claim
// model to the header+items model above (7thPortal_Expenses_Data_Model.docx).
// The old `claims` table only ever held local test/demo data (this predates
// any real deployment), so it's dropped outright rather than migrated -
// no-op if it doesn't exist.
db()->exec('DROP TABLE IF EXISTS claims');

// Migration: widen users.portal_role to the current role set (adds 'treasurer'/
// 'chair' for the finance module and 'quartermaster' for the equipment role).
// SQLite can't ALTER a CHECK constraint in place, so the table is rebuilt when the
// live constraint still lacks the newest role ('quartermaster') - which also covers
// any older DB that predates 'treasurer', bringing it fully up to date in one step.
// A no-op on fresh installs, where the CREATE TABLE above already has the full list.
//
// The row copy lists columns EXPLICITLY (the intersection of the target schema and
// whatever columns the live table actually has) rather than using SELECT *, so a
// server whose users table drifted in column set or order can't break the copy and
// no data is silently shifted into the wrong column.
$usersTableSql = dbGet("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'")['sql'] ?? '';
if ($usersTableSql && !str_contains($usersTableSql, "'quartermaster'")) {
    // PRAGMA foreign_keys is a no-op inside a transaction, and SQLite refuses to
    // DROP a table other tables still hold a foreign key against while it's ON - so
    // this has to be toggled off before BEGIN, not inside it.
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
      portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','quartermaster','trustee_viewer','treasurer','chair','admin')),
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
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      osm_terms_json TEXT,
      phone TEXT
    )
    SQL);
    // Copy only the columns both tables share, in the target order.
    $targetCols = ['id', 'auth_type', 'osm_user_id', 'email', 'password_hash', 'first_name', 'last_name', 'portal_role', 'account_status', 'osm_roles_json', 'osm_access_token', 'osm_refresh_token', 'osm_token_expires_at', 'is_osm_service_account', 'invite_token', 'invite_expires_at', 'last_login_at', 'created_at', 'updated_at', 'osm_terms_json', 'phone'];
    $liveCols = array_column(dbAll('PRAGMA table_info(users)'), 'name');
    $shared = array_values(array_intersect($targetCols, $liveCols));
    $colList = implode(', ', $shared);
    db()->exec("INSERT INTO users_new ($colList) SELECT $colList FROM users");
    db()->exec('DROP TABLE users');
    db()->exec('ALTER TABLE users_new RENAME TO users');
    db()->exec('CREATE INDEX IF NOT EXISTS idx_users_role ON users(portal_role, account_status)');
    db()->exec('COMMIT');
    db()->exec('PRAGMA foreign_keys = ON');
}
