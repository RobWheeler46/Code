<?php
// Smoke-test harness (no framework, no Composer - matches the project's toolchain).
// Runs each scenario in its own PHP process against a throwaway SQLite DB (via the
// SEVENTHPORTAL_DB override), so the real data is never touched and every scenario
// gets a clean migration run. Covers the two things most likely to break a deploy:
//   1. migrations (fresh install + a drifted server DB - the case that 500'd UAT)
//   2. core business-logic invariants (finance routing, mileage, incident privacy)
//
// Usage:  php scripts/smoke-test.php            # run everything, exit 1 on any fail
//         php scripts/smoke-test.php --child X   # internal: run one scenario
//
// Add a scenario by writing a scenario_<name>() function and listing it in SCENARIOS.

$root = dirname(__DIR__);
chdir($root);

const SCENARIOS = ['migrate_fresh', 'migrate_drift', 'logic_finance', 'logic_mileage', 'logic_incident', 'logic_events', 'logic_equipment', 'logic_qm_restricted', 'logic_qm_edit_guard', 'logic_sections', 'logic_command_centre', 'logic_camp_versions', 'logic_exception_scan', 'logic_prepare_tonight', 'logic_camp_finance', 'logic_camp_attendance_safety', 'logic_feature_matrix', 'logic_demo_scenarios', 'logic_ical_feed', 'logic_parent_search', 'logic_equipment_disposal', 'logic_digest_exceptions', 'logic_qm_instance_alloc', 'logic_dlv_approval', 'logic_kit', 'logic_stock_ledger', 'logic_serialised', 'logic_stocktake', 'logic_import_review', 'logic_bundle', 'logic_forms', 'logic_forms_admin'];

// ── assertion helper (per child process) ─────────────────────────────────────
$GLOBALS['__checks'] = [];
function check(string $name, bool $ok, string $detail = ''): void
{
    $GLOBALS['__checks'][] = [$name, $ok, $detail];
}
function tmpDb(string $tag): string
{
    $f = sys_get_temp_dir() . '/7p-smoke-' . $tag . '-' . getmypid() . '-' . bin2hex(random_bytes(3)) . '.db';
    foreach (['', '-wal', '-shm'] as $s) @unlink($f . $s);
    return $f;
}
function useDb(string $file): void { putenv('SEVENTHPORTAL_DB=' . $file); }
function boot(): void { require dirname(__DIR__) . '/src/db.php'; }
function loadLibs(): void
{
    foreach (['helpers', 'notifications', 'finance', 'incidents', 'patrolpoints', 'events', 'equipment', 'actions', 'quartermaster', 'prepare', 'features', 'attendance', 'demoseed', 'calendar', 'activity', 'pdf', 'dlv', 'forms'] as $lib) {
        require_once dirname(__DIR__) . '/src/lib/' . $lib . '.php';
    }
}

// ── scenarios ────────────────────────────────────────────────────────────────

// Fresh install: db.php boots on an empty file and the current schema is present.
function scenario_migrate_fresh(): void
{
    useDb(tmpDb('fresh'));
    boot();
    $tables = array_column(dbAll("SELECT name FROM sqlite_master WHERE type='table'"), 'name');
    check('fresh: boots with many tables', count($tables) > 40, count($tables) . ' tables');
    $usersSql = dbGet("SELECT sql FROM sqlite_master WHERE name='users'")['sql'] ?? '';
    check('fresh: users allows quartermaster', str_contains($usersSql, 'quartermaster'));
    check('fresh: finance_approval_groups exists', in_array('finance_approval_groups', $tables, true));
    $eciCols = array_column(dbAll('PRAGMA table_info(expense_claim_items)'), 'name');
    check('fresh: claim items have nominated-approver cols', in_array('selected_approver_user_id', $eciCols, true) && in_array('approver_assignment_reason', $eciCols, true));
    $acctCols = array_column(dbAll('PRAGMA table_info(expense_accounts)'), 'name');
    check('fresh: accounts have approval_group_id', in_array('approval_group_id', $acctCols, true));
    $eqCols = array_column(dbAll('PRAGMA table_info(equipment_assets)'), 'name');
    check('fresh: equipment has QM-advanced cols', in_array('item_type', $eqCols, true) && in_array('reorder_threshold', $eqCols, true));
}

// Drifted server DB: an OLD users table (pre-quartermaster constraint, reordered
// columns, an extra legacy column) migrates cleanly and preserves data - the exact
// shape that crashed under the old SELECT * rebuild.
function scenario_migrate_drift(): void
{
    $file = tmpDb('drift');
    $pdo = new PDO('sqlite:' . $file);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->exec("CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, auth_type TEXT NOT NULL, osm_user_id TEXT UNIQUE, email TEXT UNIQUE,
      password_hash TEXT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      portal_role TEXT NOT NULL CHECK(portal_role IN ('parent','section_leader','assistant_leader','group_leadership','trustee_viewer','treasurer','chair','admin')),
      account_status TEXT NOT NULL DEFAULT 'active', osm_roles_json TEXT, osm_access_token TEXT, osm_refresh_token TEXT,
      osm_token_expires_at TEXT, is_osm_service_account INTEGER NOT NULL DEFAULT 0, invite_expires_at TEXT, last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      phone TEXT, osm_terms_json TEXT, legacy_flag INTEGER )");
    $pdo->exec("INSERT INTO users (auth_type,email,first_name,last_name,portal_role,phone) VALUES ('local','drift@x.com','Dee','Rift','admin','07700900123')");
    $pdo = null; // close before db.php opens it

    useDb($file);
    $err = null;
    try { boot(); } catch (Throwable $e) { $err = $e->getMessage(); }
    check('drift: migration completes without error', $err === null, (string) $err);
    if ($err !== null) return;
    $usersSql = dbGet("SELECT sql FROM sqlite_master WHERE name='users'")['sql'] ?? '';
    check('drift: users now allows quartermaster', str_contains($usersSql, 'quartermaster'));
    $row = dbGet("SELECT * FROM users WHERE email='drift@x.com'");
    check('drift: existing row preserved by name', $row && $row['phone'] === '07700900123' && $row['portal_role'] === 'admin');
    try { dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','qm@x.com','Q','M','quartermaster')"); $ins = true; }
    catch (Throwable $e) { $ins = false; }
    check('drift: can insert a quartermaster after migration', $ins);
}

// Finance: nominated-approver eligibility + routing invariants (FRD s28).
function scenario_logic_finance(): void
{
    useDb(tmpDb('fin')); boot(); loadLibs();
    $c = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','c@x.com','Cara','C','section_leader')")['lastInsertId'];
    $a = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','a@x.com','Amy','A','group_leadership')")['lastInsertId'];
    $b = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','b@x.com','Ben','B','section_leader')")['lastInsertId'];
    $g = dbRun("INSERT INTO finance_approval_groups (name) VALUES ('Camp')")['lastInsertId'];
    foreach ([$c, $a, $b] as $u) dbRun("INSERT INTO finance_approval_group_members (group_id,user_id) VALUES (?,?)", [$g, $u]);
    $acctId = dbRun("INSERT INTO expense_accounts (name,approval_group_id,claimant_selects_approver) VALUES ('Camp',?,1)", [$g])['lastInsertId'];
    $acct = dbGet('SELECT * FROM expense_accounts WHERE id=?', [$acctId]);

    $elig = array_column(financeEligibleApprovers($acct, (int) $c), 'id');
    check('finance: eligible excludes the claimant even if in group', !in_array((int) $c, $elig, true) && in_array((int) $a, $elig, true));
    check('finance: eligibility check rejects claimant', financeIsEligibleApprover($acct, (int) $c, (int) $c) === false && financeIsEligibleApprover($acct, (int) $a, (int) $c) === true);

    $claim = dbRun("INSERT INTO expense_claims (claim_number,claimant_user_id,title) VALUES ('CLM-1',?,'x')", [$c])['lastInsertId'];
    dbRun("INSERT INTO expense_claim_items (claim_id,item_number,item_type,title,account_id,claimed_amount,status,selected_approver_user_id) VALUES (?,1,'receipt','t',?,10,'submitted',?)", [$claim, $acctId, $a]);
    $item = loadItemWithClaim((int) dbGet("SELECT id FROM expense_claim_items WHERE claim_id=?", [$claim])['id']);
    $amy = dbGet('SELECT * FROM users WHERE id=?', [$a]);
    $ben = dbGet('SELECT * FROM users WHERE id=?', [$b]);
    check('finance: nominated approver can act', canActOnItemApproval($amy, $item) === true);
    check('finance: other group member cannot act on a nominated item', canActOnItemApproval($ben, $item) === false);
}

// Mileage: HMRC AMAP tiering (10k-mile band) computes exactly.
function scenario_logic_mileage(): void
{
    useDb(tmpDb('mil')); boot(); loadLibs();
    if (!function_exists('calculateMileageAmount')) { check('mileage: calculateMileageAmount present', false); return; }
    $rate = ['rate_per_mile' => 0.55, 'annual_threshold_miles' => 10000, 'rate_after_threshold' => 0.25];
    $u = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','m@x.com','M','X','section_leader')")['lastInsertId'];
    $calc = calculateMileageAmount($rate, 12000.0, 'car', gmdate('Y-m-d'), (int) $u, null);
    // 10000 * 0.55 + 2000 * 0.25 = 6000.00
    check('mileage: 12,000mi tiers to £6000.00', abs(((float) $calc['amount']) - 6000.0) < 0.001, '£' . ($calc['amount'] ?? '?'));
}

// Incident privacy: a restricted record's notification body never leaks the summary.
function scenario_logic_incident(): void
{
    useDb(tmpDb('inc')); boot(); loadLibs();
    $restricted = ['record_type' => 'safeguarding_signpost', 'sensitivity' => 'restricted', 'summary' => 'SENSITIVE_LEAK_CANARY'];
    $standard = ['record_type' => 'building_issue', 'sensitivity' => 'standard', 'summary' => 'Broken window'];
    $rb = incidentNotifyBody($restricted, 'You have been assigned an incident follow-up');
    $sb = incidentNotifyBody($standard, 'You have been assigned an incident follow-up');
    check('incident: restricted body omits the summary', !str_contains($rb, 'SENSITIVE_LEAK_CANARY'));
    check('incident: standard body includes the summary', str_contains($sb, 'Broken window'));
}

// Events: publishing a section hub notifies that section's parents, not others.
function scenario_logic_events(): void
{
    useDb(tmpDb('evt')); boot(); loadLibs();
    $p1 = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','p1@x.com','P','One','parent')")['lastInsertId'];
    $p2 = dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','p2@x.com','P','Two','parent')")['lastInsertId'];
    dbRun("INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?,?,?,?,?,?)", [$p1, 'm1', 's101', 'Cubs', 'cubs', 'Kid One']);
    dbRun("INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?,?,?,?,?,?)", [$p2, 'm2', 's102', 'Scouts', 'scouts', 'Kid Two']);
    $hub = ['id' => 999, 'title' => 'Summer Camp', 'osm_section_id' => 's101', 'start_date' => '2026-07-10'];
    eventHubNotifyPublished($hub);
    $n1 = (int) dbGet("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type='event_hub'", [$p1])['c'];
    $n2 = (int) dbGet("SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND type='event_hub'", [$p2])['c'];
    check('events: section parent is notified on publish', $n1 === 1);
    check('events: parent in a different section is not notified', $n2 === 0);
}

// Equipment (QM Advanced): low-stock + unknown-location surface as QM tasks.
function scenario_logic_equipment(): void
{
    useDb(tmpDb('eq')); boot(); loadLibs();
    dbRun("INSERT INTO settings (key,value) VALUES ('equipment_register_enabled','true') ON CONFLICT(key) DO UPDATE SET value='true'");
    dbRun("INSERT INTO equipment_assets (name, item_type, stock_level, reorder_threshold) VALUES ('Batteries', 'consumable', 2, 5)");
    dbRun("INSERT INTO equipment_assets (name, location_confidence) VALUES ('Mystery box', 'unknown')");
    dbRun("INSERT INTO equipment_assets (name) VALUES ('Well-known tent')"); // should NOT flag
    $acts = equipmentActionItems();
    $has = fn($needle) => (bool) array_filter($acts, fn($a) => str_contains($a['action'] ?? '', $needle));
    check('equipment: low-stock consumable raises a QM task', $has('at or below reorder level'));
    check('equipment: unknown-location item raises a QM task', $has('unconfirmed storage location'));
    check('equipment: no spurious tasks for a normal asset', count($acts) === 2, count($acts) . ' tasks');
}

// QM v2.4.3 stock ledger: balance is the sum of attributable movements, never a
// direct set; decrements clamp at zero; a correction moves to a target.
function scenario_logic_stock_ledger(): void
{
    useDb(tmpDb('stk')); boot(); loadLibs();
    $id = dbRun("INSERT INTO equipment_assets (name, item_type, tracking_mode) VALUES ('Rope', 'consumable', 'consumable')")['lastInsertId'];
    check('stock: fresh asset has zero balance', equipmentStockBalance((int) $id) === 0);
    equipmentPostStockMovement((int) $id, 'opening', 10, 'Opening', null, 0);
    equipmentPostStockMovement((int) $id, 'purchase', 5, 'Bought more', null, 0);
    equipmentPostStockMovement((int) $id, 'issue', -3, 'Camp', null, 0);
    check('stock: 10 + 5 - 3 = 12', equipmentStockBalance((int) $id) === 12);
    // cached column mirrors the ledger
    $col = (int) dbGet('SELECT stock_level FROM equipment_assets WHERE id = ?', [$id])['stock_level'];
    check('stock: cached stock_level mirrors ledger balance', $col === 12);
    // decrement clamps at zero (cannot go negative)
    equipmentPostStockMovement((int) $id, 'loss', -100, 'Flood', null, 0);
    check('stock: decrement clamps at zero', equipmentStockBalance((int) $id) === 0);
    // ledger rows are retained (audit surface), not overwritten
    $rows = (int) dbGet('SELECT COUNT(*) c FROM equipment_stock_ledger WHERE asset_id = ?', [$id])['c'];
    check('stock: every movement retained in the ledger', $rows === 4);
}

// QM v2.4.3 import review: a row is 'ready' only with an explicit valid tracking
// mode (and a unit for consumables); otherwise it is held in needs_review.
function scenario_logic_import_review(): void
{
    useDb(tmpDb('imp')); boot(); loadLibs();
    check('import: no tracking mode -> needs_review', equipmentImportRowReview(['name' => 'Tent', 'tracking_mode' => null])['status'] === 'needs_review');
    check('import: valid bulk mode -> ready', equipmentImportRowReview(['name' => 'Tent', 'tracking_mode' => 'bulk_reusable'])['status'] === 'ready');
    check('import: consumable without unit -> needs_review', equipmentImportRowReview(['name' => 'Rope', 'tracking_mode' => 'consumable', 'issue_unit' => ''])['status'] === 'needs_review');
    check('import: consumable with unit -> ready', equipmentImportRowReview(['name' => 'Rope', 'tracking_mode' => 'consumable', 'issue_unit' => 'm'])['status'] === 'ready');
    check('import: blank name -> needs_review', equipmentImportRowReview(['name' => '', 'tracking_mode' => 'bulk_reusable'])['status'] === 'needs_review');
}

// QM v2.4.3 stocktake: a counted variance posts a 'stocktake' ledger movement that
// adjusts the balance to the counted figure and stays auditable.
function scenario_logic_stocktake(): void
{
    useDb(tmpDb('stk2')); boot(); loadLibs();
    $id = dbRun("INSERT INTO equipment_assets (name, item_type, tracking_mode) VALUES ('Pegs', 'consumable', 'consumable')")['lastInsertId'];
    equipmentPostStockMovement((int) $id, 'opening', 10, 'Opening', null, 0);
    $counted = 7; $delta = $counted - equipmentStockBalance((int) $id); // -3
    equipmentPostStockMovement((int) $id, 'stocktake', $delta, 'Stocktake STK-1', 'STK-1', 0);
    check('stocktake: balance adjusts to the counted figure', equipmentStockBalance((int) $id) === 7);
    $st = (int) dbGet("SELECT COUNT(*) c FROM equipment_stock_ledger WHERE asset_id = ? AND movement_type = 'stocktake'", [$id])['c'];
    check('stocktake: an attributable stocktake movement is recorded', $st === 1);
}

// QM v2.4.3 serialised instances: active/available counts derive from instance
// lifecycle; a qty>1 master row is not the identity record.
function scenario_logic_serialised(): void
{
    useDb(tmpDb('ser')); boot(); loadLibs();
    $id = dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Radio', 'serialised')")['lastInsertId'];
    foreach (['R-01', 'R-02', 'R-03'] as $ref) dbRun('INSERT INTO equipment_asset_instances (asset_id, instance_ref) VALUES (?, ?)', [$id, $ref]);
    $c = equipmentInstanceCounts((int) $id);
    check('serialised: 3 instances -> active 3, available 3', $c['active'] === 3 && $c['available'] === 3);
    // one to maintenance: still active (owned) but not available
    dbRun("UPDATE equipment_asset_instances SET status = 'maintenance' WHERE asset_id = ? AND instance_ref = 'R-02'", [$id]);
    $c = equipmentInstanceCounts((int) $id);
    check('serialised: maintenance stays active, drops available', $c['active'] === 3 && $c['available'] === 2);
    // retire one: no longer active
    dbRun("UPDATE equipment_asset_instances SET status = 'retired' WHERE asset_id = ? AND instance_ref = 'R-03'", [$id]);
    check('serialised: retired instance drops active', equipmentInstanceCounts((int) $id)['active'] === 2);
    // cached quantity syncs to active count for booking availability
    equipmentSyncSerialisedQuantity((int) $id);
    check('serialised: cached quantity = active count', (int) dbGet('SELECT quantity FROM equipment_assets WHERE id = ?', [$id])['quantity'] === 2);
    // serializer balance for serialised is the active count
    check('serialised: serializeAsset balance = active count', serializeAsset(dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$id]))['stockBalance'] === 2);
}

// v2.4.4 (AC-126): tracking mode locks once operational history exists. A just-
// created record has none (only an opening balance / all-available instances), so
// a QM can still correct a mistaken tracking choice; a real movement, booking,
// issued unit, inspection or repair then locks it.
function scenario_logic_qm_edit_guard(): void
{
    useDb(tmpDb('guard')); boot(); loadLibs();
    // Bulk: opening balance alone is not "history".
    $id = dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Folding table', 'bulk_reusable')")['lastInsertId'];
    equipmentPostStockMovement((int) $id, 'opening', 4, 'Opening', null, 0);
    check('guard: opening-only bulk item has no history (tracking still editable)', equipmentHasHistory((int) $id) === false);
    equipmentPostStockMovement((int) $id, 'purchase', 2, 'Bought more', null, 0);
    check('guard: a real stock movement locks tracking', equipmentHasHistory((int) $id) === true);
    // Serialised: all-available instances are not history; an issued unit is.
    $sid = dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Stove', 'serialised')")['lastInsertId'];
    foreach (['S-01', 'S-02'] as $ref) dbRun('INSERT INTO equipment_asset_instances (asset_id, instance_ref) VALUES (?, ?)', [$sid, $ref]);
    check('guard: fresh serialised (all available) has no history', equipmentHasHistory((int) $sid) === false);
    dbRun("UPDATE equipment_asset_instances SET status = 'issued' WHERE asset_id = ? AND instance_ref = 'S-01'", [$sid]);
    check('guard: an issued serialised unit locks tracking', equipmentHasHistory((int) $sid) === true);
    // An inspection record also counts as history.
    $uid = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local', 'Quarter', 'Master', 'quartermaster')")['lastInsertId'];
    $iid = dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Ladder', 'bulk_reusable')")['lastInsertId'];
    check('guard: brand-new item has no history', equipmentHasHistory((int) $iid) === false);
    dbRun("INSERT INTO equipment_inspections (asset_id, outcome, inspected_by) VALUES (?, 'pass', ?)", [$iid, $uid]);
    check('guard: an inspection record locks tracking', equipmentHasHistory((int) $iid) === true);
}

// Centralised sections: the QM booking picker reads osm_sections (any source), so an
// admin-managed local section feeds it; with no rows it falls back to demo sections.
function scenario_logic_sections(): void
{
    useDb(tmpDb('sec')); boot(); loadLibs();
    require_once dirname(__DIR__) . '/src/lib/osm.php'; // for the OSM_DEMO_SECTIONS fallback
    $demo = qmSectionList();
    check('sections: empty osm_sections -> demo fallback', count($demo) >= 1 && $demo[0]['name'] !== '');
    dbRun("INSERT INTO osm_sections (osm_section_id, section_name, section_type, source, sync_status) VALUES ('local-aa', 'Beavers', 'beavers', 'local', 'ok')");
    $list = qmSectionList();
    check('sections: a local section feeds the QM picker', in_array('Beavers', array_column($list, 'name'), true));
    // once real rows exist, the demo fallback no longer applies
    check('sections: demo fallback drops once a section exists', count($list) === 1);
}

// Event/Camp Command Centre: per-area readiness computed from real event-linked
// data (no placeholders); each area reports ready/attention/blocked/none.
function scenario_logic_command_centre(): void
{
    useDb(tmpDb('cc')); boot(); loadLibs();
    $uid = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Cam','Lead','group_leadership')")['lastInsertId'];
    $hubId = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Summer Camp','camp','draft')")['lastInsertId'];
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hubId]);
    $byKey = fn() => array_column(eventCommandCentre($hub), null, 'key');

    $cc = $byKey();
    check('cc: eight readiness areas', count($cc) === 8);
    check('cc: fresh equipment = none', $cc['equipment']['status'] === 'none');
    check('cc: fresh parent pack = none', $cc['parentpack']['status'] === 'none');
    check('cc: fresh transport = none', $cc['transport']['status'] === 'none');
    check('cc: fresh programme = none', $cc['programme']['status'] === 'none');
    check('cc: fresh catering = none', $cc['catering']['status'] === 'none');
    // Catering: a meal with no dish -> attention; give it a dish -> ready.
    $mealId = dbRun("INSERT INTO camp_catering_meals (hub_id, day_label, meal) VALUES (?, 'Sat', 'breakfast')", [$hubId])['lastInsertId'];
    check('cc: unplanned meal -> catering attention', $byKey()['catering']['status'] === 'attention');
    dbRun("UPDATE camp_catering_meals SET dish = 'Porridge' WHERE id = ?", [$mealId]);
    check('cc: meal with a dish -> catering ready', $byKey()['catering']['status'] === 'ready');
    // a vehicle with no driver -> transport needs attention.
    dbRun("INSERT INTO camp_transport_vehicles (hub_id, name, vehicle_type, capacity) VALUES (?, 'Minibus A', 'minibus', 12)", [$hubId]);
    check('cc: vehicle without driver -> transport attention', $byKey()['transport']['status'] === 'attention');
    // Programme: same group twice in one day+session -> clash -> programme attention.
    dbRun("INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label) VALUES (?, 'Sat', 'am', 'Climbing', 'Kestrels')", [$hubId]);
    check('cc: one activity -> programme ready', $byKey()['programme']['status'] === 'ready');
    dbRun("INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label) VALUES (?, 'Sat', 'am', 'Canoeing', 'Kestrels')", [$hubId]);
    $prog = eventCampProgramme($hubId);
    check('cc: same group double-booked -> clash detected', $prog['clashes'] === 2);
    check('cc: clash -> programme attention', $byKey()['programme']['status'] === 'attention');

    // A submitted booking linked to the event -> equipment needs attention.
    dbRun("INSERT INTO qm_bookings (requester_user_id, event_hub_id, status) VALUES (?, ?, 'submitted')", [$uid, $hubId]);
    check('cc: submitted booking -> equipment attention', $byKey()['equipment']['status'] === 'attention');

    // A collected booking overdue to return -> equipment blocked (derived from return_at).
    dbRun("INSERT INTO qm_bookings (requester_user_id, event_hub_id, status, return_at) VALUES (?, ?, 'collected', '2000-01-01')", [$uid, $hubId]);
    check('cc: overdue return -> equipment blocked', $byKey()['equipment']['status'] === 'blocked');

    // A published parent item -> parent pack ready.
    dbRun("INSERT INTO event_hub_items (hub_id, label, visibility, item_status) VALUES (?, 'Kit list', 'parents', 'published')", [$hubId]);
    check('cc: published parent item -> parent pack ready', $byKey()['parentpack']['status'] === 'ready');

    // Readiness rollup: worst area wins, and gaps list the blocked/attention areas.
    $roll = eventReadinessRollup($hub);
    check('cc rollup: overall = blocked (worst area wins)', $roll['overall'] === 'blocked');
    check('cc rollup: gaps include the equipment blocker', in_array('Equipment', array_column($roll['gaps'], 'label'), true));
}

// Camp plan version history & acknowledgements (FRD-CAMP-010). Snapshot freezes the
// plan's shape; versions number sequentially; acks are per-user and idempotent.
function scenario_logic_camp_versions(): void
{
    useDb(tmpDb('ver')); boot(); loadLibs();
    $u1 = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Cam','Lead','group_leadership')")['lastInsertId'];
    $u2 = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Sam','Second','section_leader')")['lastInsertId'];
    $hubId = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Summer Camp','camp','draft')")['lastInsertId'];
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hubId]);
    dbRun("INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label) VALUES (?, 'Sat', 'am', 'Climbing', 'Kestrels')", [$hubId]);

    // Snapshot reflects current plan content.
    $snap = campPlanSnapshot($hub);
    check('ver: snapshot captures programme count', $snap['programme']['activities'] === 1);
    check('ver: snapshot carries a readiness verdict', isset($snap['readiness']));

    // Capture two versions the way the route does (sequential version_no).
    $cap = function ($summary) use ($hubId, $hub, $u1) {
        $n = (int) dbGet('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM camp_plan_versions WHERE hub_id = ?', [$hubId])['n'];
        dbRun('INSERT INTO camp_plan_versions (hub_id, version_no, summary, snapshot_json, created_by, created_by_name) VALUES (?,?,?,?,?,?)',
            [$hubId, $n, $summary, json_encode(campPlanSnapshot($hub)), $u1, 'Cam Lead']);
        return $n;
    };
    check('ver: first version is v1', $cap('Initial plan') === 1);
    check('ver: second version is v2', $cap('Added Sunday') === 2);

    $list = eventCampVersions($hubId, (int) $u2);
    check('ver: two versions, newest first', $list['total'] === 2 && $list['versions'][0]['versionNo'] === 2);
    check('ver: latest needs my ack when unacknowledged', $list['latestNeedsMyAck'] === true);
    check('ver: fresh version has no acks', $list['versions'][0]['ackCount'] === 0);

    // Acknowledge latest as u2 (idempotent via UNIQUE + INSERT OR IGNORE).
    $vid = $list['versions'][0]['id'];
    dbRun('INSERT OR IGNORE INTO camp_plan_acks (version_id, hub_id, user_id, user_name) VALUES (?,?,?,?)', [$vid, $hubId, $u2, 'Sam Second']);
    dbRun('INSERT OR IGNORE INTO camp_plan_acks (version_id, hub_id, user_id, user_name) VALUES (?,?,?,?)', [$vid, $hubId, $u2, 'Sam Second']);
    $list2 = eventCampVersions($hubId, (int) $u2);
    check('ver: ack is idempotent (one row)', $list2['versions'][0]['ackCount'] === 1);
    check('ver: my ack recorded', $list2['versions'][0]['acknowledgedByMe'] !== null);
    check('ver: latest no longer needs my ack', $list2['latestNeedsMyAck'] === false);
    // The older version is still unacknowledged by me.
    check('ver: older version still unacked by me', $list2['versions'][1]['acknowledgedByMe'] === null);
}

// Critical readiness exceptions (FR-NOT / Command Centre). The scan pushes each
// blocked area once, dedups on re-scan, resolves cleared ones, and re-notifies on
// recurrence.
function scenario_logic_exception_scan(): void
{
    useDb(tmpDb('exc')); boot(); loadLibs();
    dbRun("INSERT INTO settings (key, value) VALUES ('event_hub_enabled', 'true')");
    $leader = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role, account_status) VALUES ('local','Cam','Lead','group_leadership','active')")['lastInsertId'];
    $hubId = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Summer Camp','camp','draft')")['lastInsertId'];
    // A collected booking overdue to return -> equipment area is blocked (critical).
    $bk = dbRun("INSERT INTO qm_bookings (requester_user_id, event_hub_id, status, return_at) VALUES (?, ?, 'collected', '2000-01-01')", [$leader, $hubId])['lastInsertId'];

    $r1 = scanEventCriticalExceptions();
    check('exc: first scan finds the new exception', $r1['new'] === 1 && $r1['open'] === 1);
    check('exc: leader was notified once', (int) dbGet("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'exception'", [$leader])['n'] === 1);
    check('exc: an open state row exists', (int) dbGet("SELECT COUNT(*) AS n FROM event_exception_state WHERE status = 'open'")['n'] === 1);

    $r2 = scanEventCriticalExceptions();
    check('exc: re-scan does not re-notify (deduped)', $r2['new'] === 0 && $r2['open'] === 1);
    check('exc: still only one notification', (int) dbGet("SELECT COUNT(*) AS n FROM notifications WHERE type = 'exception'")['n'] === 1);
    check('exc: open exceptions list surfaces it', count(eventOpenExceptions()) === 1);

    // Clear the blocker (return the kit) -> next scan resolves it silently.
    dbRun("UPDATE qm_bookings SET status = 'returned' WHERE id = ?", [$bk]);
    $r3 = scanEventCriticalExceptions();
    check('exc: cleared exception is resolved', $r3['resolved'] === 1 && $r3['open'] === 0);
    check('exc: no open exceptions remain', count(eventOpenExceptions()) === 0);
    check('exc: still no extra notification on resolve', (int) dbGet("SELECT COUNT(*) AS n FROM notifications WHERE type = 'exception'")['n'] === 1);

    // Recurrence: the blocker comes back -> notify again.
    dbRun("UPDATE qm_bookings SET status = 'collected' WHERE id = ?", [$bk]);
    $r4 = scanEventCriticalExceptions();
    check('exc: recurrence re-notifies', $r4['new'] === 1);
    check('exc: second notification recorded', (int) dbGet("SELECT COUNT(*) AS n FROM notifications WHERE type = 'exception'")['n'] === 2);

    // A muted leader is not notified (respects notification prefs).
    $muted = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role, account_status) VALUES ('local','Mu','Ted','section_leader','active')")['lastInsertId'];
    dbRun("INSERT INTO notification_prefs (user_id, muted_types) VALUES (?, ?)", [$muted, json_encode(['exception'])]);
    // Force a fresh exception by adding a second overdue booking on a new hub.
    $hub2 = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Autumn Camp','camp','draft')")['lastInsertId'];
    dbRun("INSERT INTO qm_bookings (requester_user_id, event_hub_id, status, return_at) VALUES (?, ?, 'collected', '2000-01-01')", [$leader, $hub2]);
    scanEventCriticalExceptions();
    check('exc: muted leader gets no exception notification', (int) dbGet("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'exception'", [$muted])['n'] === 0);
}

// Prepare Tonight (FRD-IA): the pure "which section is on tonight" classifier - maps
// each section's OSM meeting day to a distance from today and sorts soonest-first,
// with unknown meeting days last.
function scenario_logic_prepare_tonight(): void
{
    useDb(tmpDb('prep')); boot(); loadLibs();
    $secs = [
        ['sectionId' => '1', 'sectionName' => 'Beavers', 'meetingDay' => 'Monday', 'meetingTime' => '18:00'],
        ['sectionId' => '2', 'sectionName' => 'Cubs', 'meetingDay' => 'Wednesday'],
        ['sectionId' => '3', 'sectionName' => 'Scouts', 'meetingDay' => null],
        ['sectionId' => '4', 'sectionName' => 'Squirrels', 'meetingDay' => 'Tue'],
    ];
    // Pretend today is Monday (idx 1).
    $mon = prepareTonightSections($secs, 1);
    check('prep: Monday section is on tonight and sorts first', $mon[0]['sectionName'] === 'Beavers' && $mon[0]['meetsToday'] === true && $mon[0]['daysUntil'] === 0 && $mon[0]['nextMeetingLabel'] === 'Tonight');
    check('prep: abbreviated Tuesday is tomorrow', $mon[1]['sectionName'] === 'Squirrels' && $mon[1]['daysUntil'] === 1 && $mon[1]['nextMeetingLabel'] === 'Tomorrow');
    $cubs = array_values(array_filter($mon, fn($s) => $s['sectionName'] === 'Cubs'))[0];
    check('prep: Wednesday is two days out with weekday label', $cubs['daysUntil'] === 2 && $cubs['meetsToday'] === false && $cubs['nextMeetingLabel'] === 'Wednesday');
    check('prep: unknown meeting day sorts last with null distance', end($mon)['sectionName'] === 'Scouts' && end($mon)['daysUntil'] === null && end($mon)['nextMeetingLabel'] === null);

    // On Wednesday (idx 3) the on-tonight section changes to Cubs.
    $wed = prepareTonightSections($secs, 3);
    check('prep: Wednesday makes Cubs the tonight section', $wed[0]['sectionName'] === 'Cubs' && $wed[0]['meetsToday'] === true);
    // Weekday parsing helper.
    check('prep: weekday index parsing', prepareWeekdayIndex('Fridays') === 5 && prepareWeekdayIndex('sun') === 0 && prepareWeekdayIndex('') === null && prepareWeekdayIndex(null) === null);
}

// Event Command Centre finance area (FR-NOT / Command Centre). The rollup over claims
// tagged to an event moves none -> attention -> blocked -> ready by item state, and the
// area appears in the Command Centre only when finance is on and a claim is linked.
function scenario_logic_camp_finance(): void
{
    useDb(tmpDb('fin2')); boot(); loadLibs();
    $uid = dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Cam','Lead','group_leadership')")['lastInsertId'];
    $acct = dbRun("INSERT INTO expense_accounts (name) VALUES ('Camp budget')")['lastInsertId'];
    $hub = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Camp','camp','draft')")['lastInsertId'];

    check('fin: no claims linked -> none', eventCampFinance($hub)['status'] === 'none');

    $c1 = dbRun("INSERT INTO expense_claims (claim_number, claimant_user_id, title, status, event_hub_id) VALUES ('C1', ?, 'Food', 'submitted', ?)", [$uid, $hub])['lastInsertId'];
    dbRun("INSERT INTO expense_claim_items (claim_id, item_number, item_type, title, account_id, status, claimed_amount) VALUES (?, 1, 'receipt', 'Food', ?, 'submitted', 40.00)", [$c1, $acct]);
    $r = eventCampFinance($hub);
    check('fin: submitted item -> attention awaiting approval', $r['status'] === 'attention' && str_contains($r['summary'], 'awaiting approval') && abs($r['outstanding'] - 40.0) < 0.001);

    dbRun("UPDATE expense_claim_items SET status = 'more_info_requested' WHERE claim_id = ?", [$c1]);
    check('fin: more-info item -> blocked', eventCampFinance($hub)['status'] === 'blocked');

    dbRun("UPDATE expense_claim_items SET status = 'approved', approved_amount = 35.00 WHERE claim_id = ?", [$c1]);
    dbRun("UPDATE expense_claims SET status = 'approved' WHERE id = ?", [$c1]);
    $r2 = eventCampFinance($hub);
    check('fin: approved unpaid -> attention awaiting payment', $r2['status'] === 'attention' && str_contains($r2['summary'], 'awaiting payment') && abs($r2['outstanding'] - 35.0) < 0.001);

    dbRun("UPDATE expense_claim_items SET status = 'paid' WHERE claim_id = ?", [$c1]);
    dbRun("UPDATE expense_claims SET status = 'paid' WHERE id = ?", [$c1]);
    check('fin: all settled -> ready', eventCampFinance($hub)['status'] === 'ready');

    // Command Centre integration: finance area appears only with finance on + a link.
    dbRun("INSERT INTO settings (key, value) VALUES ('finance_enabled', 'true')");
    $keys = array_column(eventCommandCentre(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub])), 'key');
    check('fin: Command Centre shows finance area when a claim is linked', in_array('finance', $keys, true));
    $hub2 = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Trip','trip','draft')")['lastInsertId'];
    $keys2 = array_column(eventCommandCentre(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub2])), 'key');
    check('fin: no finance card on an event with nothing linked', !in_array('finance', $keys2, true));
}

// Feature availability matrix (FRD v1.3 wireframe s6). Rows mirror settings, and a
// module enabled while the module it depends on is off raises a dependency warning.
function scenario_logic_feature_matrix(): void
{
    useDb(tmpDb('feat')); boot(); loadLibs();
    $m = featureAvailabilityMatrix();
    check('feat: one row per catalogue entry', $m['total'] === count(FEATURE_CATALOGUE) && count($m['features']) === $m['total']);
    check('feat: fresh install has nothing enabled', $m['enabledCount'] === 0);
    $byFlag = array_column($m['features'], null, 'flag');
    check('feat: gallery row reflects disabled status', $byFlag['galleryEnabled']['enabled'] === false);

    // Enable QM bookings but NOT its equipment-register dependency -> warning.
    dbRun("INSERT INTO settings (key, value) VALUES ('qm_booking_enabled', 'true')");
    $m2 = array_column(featureAvailabilityMatrix()['features'], null, 'flag');
    check('feat: QM shows enabled', $m2['qmBookingEnabled']['enabled'] === true);
    check('feat: QM warns when its dependency is off', $m2['qmBookingEnabled']['dependencyWarning'] !== null);

    // Turn the dependency on -> warning clears.
    dbRun("INSERT INTO settings (key, value) VALUES ('equipment_register_enabled', 'true')");
    $m3 = array_column(featureAvailabilityMatrix()['features'], null, 'flag');
    check('feat: dependency warning clears once equipment is on', $m3['qmBookingEnabled']['dependencyWarning'] === null);
    check('feat: enabled count reflects two modules on', featureAvailabilityMatrix()['enabledCount'] === 2);

    // Last-changed is read from the settings audit trail.
    dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Ada','Admin','admin')");
    dbRun("INSERT INTO audit_log (user_id, action, details) VALUES (1, 'admin_update_settings', ?)", [json_encode(['galleryEnabled' => true])]);
    $last = featureLastChanged('galleryEnabled');
    check('feat: last-changed attributes the audited settings change', $last['at'] !== null && $last['by'] === 'Ada Admin');
    check('feat: last-changed is null for an untouched flag', featureLastChanged('calendarEnabled')['at'] === null);
}

// Event Command Centre attendance & safety areas (FR-NOT / Command Centre). Attendance
// registers taken for an event (source_type='event') and incident records tied to it
// roll up to their own areas, which appear only when their module is on and something
// is linked.
function scenario_logic_camp_attendance_safety(): void
{
    useDb(tmpDb('attsafe')); boot(); loadLibs();
    $hub = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Camp','camp','draft')")['lastInsertId'];

    // Attendance rollup.
    check('att: no registers -> none', eventCampAttendance($hub)['status'] === 'none');
    $reg = dbRun("INSERT INTO attendance_registers (osm_section_id, title, session_date, source_type, source_ref_id, status) VALUES ('123','Camp reg','2026-09-12','event', ?, 'open')", [$hub])['lastInsertId'];
    check('att: open event register -> attention', eventCampAttendance($hub)['status'] === 'attention');
    dbRun("UPDATE attendance_registers SET status = 'submitted' WHERE id = ?", [$reg]);
    check('att: all submitted -> ready', eventCampAttendance($hub)['status'] === 'ready');
    check('att: a register on another hub is ignored', eventCampAttendance(99999)['status'] === 'none');

    // Safety rollup (count-only; overdue open follow-up is a blocker).
    check('safe: no records -> none', eventCampSafety($hub)['status'] === 'none');
    $inc = dbRun("INSERT INTO incidents (record_type, sensitivity, summary, event_hub_id, status) VALUES ('near_miss','standard','Trip hazard', ?, 'open')", [$hub])['lastInsertId'];
    check('safe: open record -> attention', eventCampSafety($hub)['status'] === 'attention');
    dbRun("UPDATE incidents SET due_date = '2000-01-01' WHERE id = ?", [$inc]);
    check('safe: overdue follow-up -> blocked', eventCampSafety($hub)['status'] === 'blocked');
    dbRun("UPDATE incidents SET status = 'closed' WHERE id = ?", [$inc]);
    check('safe: all closed -> ready', eventCampSafety($hub)['status'] === 'ready');

    // Command Centre integration: areas appear only with the module on AND data linked.
    dbRun("INSERT INTO settings (key, value) VALUES ('attendance_enabled', 'true')");
    dbRun("INSERT INTO settings (key, value) VALUES ('incident_logging_enabled', 'true')");
    $keys = array_column(eventCommandCentre(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub])), 'key');
    check('cc: attendance area present when a register is linked', in_array('attendance', $keys, true));
    check('cc: safety area present when a record is linked', in_array('safety', $keys, true));
    $hub2 = dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Trip','trip','draft')")['lastInsertId'];
    $keys2 = array_column(eventCommandCentre(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub2])), 'key');
    check('cc: no attendance/safety cards when nothing is linked', !in_array('attendance', $keys2, true) && !in_array('safety', $keys2, true));
}

// Demo scenario launcher (Test Environment pack). Each scenario wipes and re-seeds a
// coherent world; camp_weekend populates the whole event Command Centre; re-applying
// never accumulates; unknown keys are rejected.
function scenario_logic_demo_scenarios(): void
{
    useDb(tmpDb('demo')); boot(); loadLibs();
    $uid = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Ada','Admin','admin')")['lastInsertId'];

    $list = demoScenarioList();
    check('demo: catalogue lists the scenarios', count($list) >= 3 && in_array('camp_weekend', array_column($list, 'key'), true));

    demoApplyScenario($uid, 'camp_weekend');
    check('demo: camp_weekend seeds one published hub', (int) dbGet("SELECT COUNT(*) n FROM event_hubs WHERE status = 'published'")['n'] === 1);
    $hub = (int) dbGet('SELECT id FROM event_hubs LIMIT 1')['id'];
    check('demo: an expense claim is linked to the camp', (int) dbGet('SELECT COUNT(*) n FROM expense_claims WHERE event_hub_id = ?', [$hub])['n'] === 1);
    check('demo: an event attendance register is linked', (int) dbGet("SELECT COUNT(*) n FROM attendance_registers WHERE source_type = 'event' AND source_ref_id = ?", [$hub])['n'] === 1);
    check('demo: a safety record is linked', (int) dbGet('SELECT COUNT(*) n FROM incidents WHERE event_hub_id = ?', [$hub])['n'] === 1);

    // With the modules on, the whole Command Centre lights up.
    foreach (['finance_enabled', 'attendance_enabled', 'incident_logging_enabled'] as $k) dbRun("INSERT INTO settings (key, value) VALUES (?, 'true')", [$k]);
    $keys = array_column(eventCommandCentre(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub])), 'key');
    check('demo: camp_weekend lights up finance/attendance/safety', in_array('finance', $keys, true) && in_array('attendance', $keys, true) && in_array('safety', $keys, true));

    // Re-applying wipes first, so it never duplicates.
    demoApplyScenario($uid, 'camp_weekend');
    check('demo: re-applying does not duplicate hubs', (int) dbGet('SELECT COUNT(*) n FROM event_hubs')['n'] === 1);

    // Finance backlog seeds several claims, no event hub.
    demoApplyScenario($uid, 'finance_backlog');
    check('demo: finance_backlog seeds several claims', (int) dbGet('SELECT COUNT(*) n FROM expense_claims')['n'] === 4);
    check('demo: finance_backlog leaves no event hub', (int) dbGet('SELECT COUNT(*) n FROM event_hubs')['n'] === 0);

    // Starter clears everything back to the minimal baseline.
    demoApplyScenario($uid, 'starter');
    check('demo: starter clears claims and hubs', (int) dbGet('SELECT COUNT(*) n FROM expense_claims')['n'] === 0 && (int) dbGet('SELECT COUNT(*) n FROM event_hubs')['n'] === 0);
    check('demo: starter seeds the Patrol Points league', (int) dbGet('SELECT COUNT(*) n FROM pp_competitions')['n'] === 1);

    // Unknown scenario is rejected.
    $threw = false;
    try { demoApplyScenario($uid, 'nope'); } catch (Throwable $e) { $threw = true; }
    check('demo: an unknown scenario throws', $threw);
}

// Personal iCal calendar feed (FR-CAL "iCal export"). Token lifecycle, plus the feed
// renders timed entries as date-times and all-day events as exclusive-end DATE values.
function scenario_logic_ical_feed(): void
{
    useDb(tmpDb('ical')); boot(); loadLibs();
    $uid = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Cam','Lead','group_leadership')")['lastInsertId'];

    $t1 = calendarFeedToken($uid);
    check('ical: token is 48 hex chars', preg_match('/^[a-f0-9]{48}$/', $t1) === 1);
    check('ical: token is stable across reads', calendarFeedToken($uid) === $t1);
    $t2 = calendarFeedToken($uid, true);
    check('ical: regenerate rotates the token', $t2 !== $t1 && preg_match('/^[a-f0-9]{48}$/', $t2) === 1);

    dbRun("INSERT INTO settings (key, value) VALUES ('calendar_enabled', 'true')");
    dbRun("INSERT INTO settings (key, value) VALUES ('event_hub_enabled', 'true')");
    dbRun("INSERT INTO calendar_entries (title, entry_type, scope, start_at, end_at, all_day, visibility, status, created_by) VALUES ('Pack night','activity','group','2026-09-15 18:00:00','2026-09-15 19:30:00',0,'leaders','published',?)", [$uid]);
    dbRun("INSERT INTO event_hubs (title, event_type, start_date, end_date, status) VALUES ('Autumn Camp','camp','2026-09-19','2026-09-21','published')");

    $ics = buildICalFeed(dbGet('SELECT * FROM users WHERE id = ?', [$uid]));
    check('ical: has the VCALENDAR envelope', str_contains($ics, 'BEGIN:VCALENDAR') && str_contains($ics, 'END:VCALENDAR'));
    check('ical: includes the timed entry summary', str_contains($ics, 'SUMMARY:Pack night'));
    check('ical: timed event uses a date-time DTSTART', str_contains($ics, 'DTSTART:20260915T180000'));
    check('ical: camp appears as an all-day DATE', str_contains($ics, 'DTSTART;VALUE=DATE:20260919'));
    check('ical: all-day end is exclusive (+1 day)', str_contains($ics, 'DTEND;VALUE=DATE:20260922'));
    check('ical: uses CRLF line endings', str_contains($ics, "\r\n"));
}

// Parent-safe search (v2). The parent search leans on eventHubVisibleToParent to gate
// events, and on the parent's own child links - so verify a parent can only ever reach
// published events for their section (or group-wide) and only their own children.
function scenario_logic_parent_search(): void
{
    useDb(tmpDb('psearch')); boot(); loadLibs();
    $parent = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Pat','Parent','parent')")['lastInsertId'];
    dbRun("INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, child_display_name) VALUES (?, 'm1', 'sectA', 'Beavers', 'Kit Parent')", [$parent]);
    $user = dbGet('SELECT * FROM users WHERE id = ?', [$parent]);
    $hub = fn($sql, $args = []) => dbGet('SELECT * FROM event_hubs WHERE id = ?', [dbRun($sql, $args)['lastInsertId']]);

    $draft = $hub("INSERT INTO event_hubs (title, event_type, status) VALUES ('Internal plan','camp','draft')");
    check('psearch: a draft hub is never visible to a parent', eventHubVisibleToParent($user, $draft) === false);
    $group = $hub("INSERT INTO event_hubs (title, event_type, status) VALUES ('Group fun day','event','published')");
    check('psearch: a published group-wide hub is visible', eventHubVisibleToParent($user, $group) === true);
    $secA = $hub("INSERT INTO event_hubs (title, event_type, osm_section_id, status) VALUES ('Beaver camp','camp','sectA','published')");
    check('psearch: a published hub for the child\'s section is visible', eventHubVisibleToParent($user, $secA) === true);
    $secB = $hub("INSERT INTO event_hubs (title, event_type, osm_section_id, status) VALUES ('Cub camp','camp','sectB','published')");
    check('psearch: a hub for another section is NOT visible', eventHubVisibleToParent($user, $secB) === false);

    // Another family's child never appears in this parent's child search.
    $other = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Other','Parent','parent')")['lastInsertId'];
    dbRun("INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, child_display_name) VALUES (?, 'm2', 'sectA', 'Beavers', 'Kit Other')", [$other]);
    $mine = dbAll("SELECT child_display_name FROM parent_child_links WHERE parent_user_id = ? AND child_display_name LIKE '%Kit%'", [$parent]);
    check('psearch: a parent finds only their own child', count($mine) === 1 && $mine[0]['child_display_name'] === 'Kit Parent');
}

// Equipment disposal approval (FR-QM). A QM requests, a GLV/Chair/Admin approves, and
// approval retires the asset. Approver role gating and the approver action item hold.
function scenario_logic_equipment_disposal(): void
{
    useDb(tmpDb('disp')); boot(); loadLibs();
    dbRun("INSERT INTO settings (key, value) VALUES ('equipment_register_enabled', 'true')");
    $qm = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Quinn','Master','quartermaster')")['lastInsertId'];
    $glv = dbGet('SELECT * FROM users WHERE id = ?', [dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Glen','Vee','group_leadership')")['lastInsertId']]);
    $qmUser = dbGet('SELECT * FROM users WHERE id = ?', [$qm]);
    $asset = (int) dbRun("INSERT INTO equipment_assets (name, value) VALUES ('Old tent', 120.00)")['lastInsertId'];

    check('disp: a QM cannot approve disposals', equipmentCanApproveDisposal($qmUser) === false);
    check('disp: a GLV can approve disposals', equipmentCanApproveDisposal($glv) === true);

    $did = (int) dbRun("INSERT INTO equipment_disposals (asset_id, quantity, method, reason, proposed_value, requested_by, requested_by_name) VALUES (?, 1, 'worn_out', 'End of life', 120.00, ?, 'Quinn Master')", [$asset, $qm])['lastInsertId'];
    $ser = serializeDisposal(dbGet("SELECT d.*, a.name AS asset_name FROM equipment_disposals d JOIN equipment_assets a ON a.id = d.asset_id WHERE d.id = ?", [$did]));
    check('disp: serialises with asset name + method label + value', $ser['assetName'] === 'Old tent' && $ser['methodLabel'] === 'Worn out / end of life' && $ser['status'] === 'pending' && $ser['proposedValue'] === 120.0);
    check('disp: requester id is captured (for withdraw gating)', $ser['requestedById'] === $qm);

    check('disp: a pending disposal shows in the approver Action Centre', count(equipmentDisposalActionItems($glv)) === 1);
    check('disp: the requester gets no approval action', count(equipmentDisposalActionItems($qmUser)) === 0);

    // Approval retires the asset (mirrors the route's two writes).
    dbRun("UPDATE equipment_disposals SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE id = ?", [$glv['id'], $did]);
    dbRun("UPDATE equipment_assets SET status = 'retired' WHERE id = ?", [$asset]);
    check('disp: approval retires the asset', dbGet('SELECT status FROM equipment_assets WHERE id = ?', [$asset])['status'] === 'retired');
    check('disp: no approval action remains once decided', count(equipmentDisposalActionItems($glv)) === 0);
}

// Weekly digest polish (FR-NOT): a managing leader's digest carries the open critical
// readiness exceptions; a parent's does not.
function scenario_logic_digest_exceptions(): void
{
    useDb(tmpDb('digest')); boot(); loadLibs();
    dbRun("INSERT INTO settings (key, value) VALUES ('event_hub_enabled', 'true')");
    $uid = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role, email) VALUES ('local','Cam','Lead','group_leadership','c@x.com')")['lastInsertId'];
    $hub = (int) dbRun("INSERT INTO event_hubs (title, event_type, status) VALUES ('Summer Camp','camp','draft')")['lastInsertId'];
    dbRun("INSERT INTO event_exception_state (hub_id, area_key, label, summary, status) VALUES (?, 'equipment', 'Equipment', '1 overdue to return', 'open')", [$hub]);

    $digest = buildWeeklyDigest(dbGet('SELECT * FROM users WHERE id = ?', [$uid]));
    check('digest: manager digest lists the critical exception', $digest !== null
        && str_contains($digest, 'Critical readiness exceptions')
        && str_contains($digest, 'Summer Camp')
        && str_contains($digest, '1 overdue to return'));

    // A parent (not a manager) never gets the exceptions block.
    $pid = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role, email) VALUES ('local','Pat','Parent','parent','p@x.com')")['lastInsertId'];
    $pdigest = buildWeeklyDigest(dbGet('SELECT * FROM users WHERE id = ?', [$pid]));
    check('digest: a parent digest has no exceptions block', $pdigest === null || !str_contains((string) $pdigest, 'Critical readiness exceptions'));

    // Once the exception clears, it drops out of the digest.
    dbRun("UPDATE event_exception_state SET status = 'resolved' WHERE hub_id = ?", [$hub]);
    $after = buildWeeklyDigest(dbGet('SELECT * FROM users WHERE id = ?', [$uid]));
    check('digest: a resolved exception no longer appears', $after === null || !str_contains((string) $after, 'Critical readiness exceptions'));
}

// QM per-instance allocation (FR-QM). Serialised lines carry specific instances;
// allocating reserves an instance and the booking lifecycle flips issued/available.
function scenario_logic_qm_instance_alloc(): void
{
    useDb(tmpDb('qmi')); boot(); loadLibs();
    $u = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Q','M','quartermaster')")['lastInsertId'];
    $asset = (int) dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Patrol Tent','serialised')")['lastInsertId'];
    $i1 = (int) dbRun("INSERT INTO equipment_asset_instances (asset_id, instance_ref, status) VALUES (?, 'Tent-01', 'available')", [$asset])['lastInsertId'];
    dbRun("INSERT INTO equipment_asset_instances (asset_id, instance_ref, status) VALUES (?, 'Tent-02', 'available')", [$asset]);
    $bk = (int) dbRun("INSERT INTO qm_bookings (requester_user_id, status) VALUES (?, 'approved')", [$u])['lastInsertId'];
    $line = (int) dbRun("INSERT INTO qm_booking_items (booking_id, equipment_asset_id, item_name, requested_qty, approved_qty, line_status) VALUES (?, ?, 'Patrol Tent', 2, 2, 'approved')", [$bk, $asset])['lastInsertId'];

    $itemRow = fn($id) => dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$id]);
    $ser = serializeQmBookingItem($itemRow($line));
    check('qmi: line is flagged serialised with nothing allocated', $ser['serialised'] === true && $ser['allocatedCount'] === 0);

    // Allocate Tent-01 (mirrors the route: link + reserve).
    dbRun("INSERT INTO qm_booking_item_instances (booking_item_id, instance_id, allocated_by) VALUES (?, ?, ?)", [$line, $i1, $u]);
    dbRun("UPDATE equipment_asset_instances SET status = 'reserved' WHERE id = ?", [$i1]);
    $ser2 = serializeQmBookingItem($itemRow($line));
    check('qmi: allocated instance shows on the line and is reserved',
        $ser2['allocatedCount'] === 1 && $ser2['allocatedInstances'][0]['ref'] === 'Tent-01'
        && dbGet('SELECT status FROM equipment_asset_instances WHERE id = ?', [$i1])['status'] === 'reserved');

    // Lifecycle: collect -> issued, return -> available.
    qmSetBookingInstancesStatus($bk, 'issued');
    check('qmi: collect issues the allocated instance', dbGet('SELECT status FROM equipment_asset_instances WHERE id = ?', [$i1])['status'] === 'issued');
    qmSetBookingInstancesStatus($bk, 'available');
    check('qmi: return frees the allocated instance', dbGet('SELECT status FROM equipment_asset_instances WHERE id = ?', [$i1])['status'] === 'available');

    // A bulk line never reports as serialised.
    $bulk = (int) dbRun("INSERT INTO equipment_assets (name, tracking_mode) VALUES ('Rope','bulk_reusable')")['lastInsertId'];
    $line2 = (int) dbRun("INSERT INTO qm_booking_items (booking_id, equipment_asset_id, item_name, requested_qty, line_status) VALUES (?, ?, 'Rope', 5, 'approved')", [$bk, $bulk])['lastInsertId'];
    $serBulk = serializeQmBookingItem($itemRow($line2));
    check('qmi: a bulk line is not serialised', $serBulk['itemName'] === 'Rope' && $serBulk['serialised'] === false);
}

// External DLV email approval (FR-AA-017..030): settings, pack versioning, token
// issue/void, block reasons, and the approve/reject vote driving the form state.
function scenario_logic_dlv_approval(): void
{
    useDb(tmpDb('dlv')); boot(); loadLibs();
    dlvSaveSettings(['email' => 'dlv@example.com', 'displayName' => 'DLV', 'voteDays' => 14]);
    $s = dlvSettings();
    check('dlv: settings save + configured', $s['configured'] === true && $s['email'] === 'dlv@example.com' && $s['voteDays'] === 14);

    $glv = dbGet('SELECT * FROM users WHERE id = ?', [dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Glen','Vee','group_leadership')")['lastInsertId']]);
    $creator = (int) dbRun("INSERT INTO users (auth_type, first_name, last_name, portal_role) VALUES ('local','Lee','Der','section_leader')")['lastInsertId'];
    $fid = (int) dbRun("INSERT INTO activity_forms (reference, created_by, activity_description, status, submitted_at) VALUES ('AAF-1', ?, 'Climbing day', 'awaiting_glv', datetime('now'))", [$creator])['lastInsertId'];
    $f = dbGet('SELECT * FROM activity_forms WHERE id = ?', [$fid]);

    $pack = dlvCreatePack($f, $glv, 'External provider - District approval');
    check('dlv: pack v1 preparing carries a frozen snapshot', (int) $pack['version'] === 1 && $pack['status'] === 'preparing' && str_contains($pack['snapshot_json'], 'Climbing day'));
    // The immutable pack renders to a structurally valid PDF straight from the snapshot.
    $pdf = pdfBuild(dlvPackBlocks(json_decode($pack['snapshot_json'], true)));
    check('dlv: pack renders a valid PDF', str_starts_with($pdf, '%PDF-1.') && str_contains($pdf, 'Climbing day') && str_contains($pdf, '%%EOF'));
    $tokens = dlvIssueTokens((int) $pack['id'], 14);
    check('dlv: two 64-hex voting tokens issued', preg_match('/^[a-f0-9]{64}$/', $tokens['approve']) === 1 && preg_match('/^[a-f0-9]{64}$/', $tokens['reject']) === 1);
    dbRun("UPDATE activity_dlv_packs SET status = 'awaiting' WHERE id = ?", [$pack['id']]);

    $look = dlvTokenLookup($tokens['approve']);
    check('dlv: approve token resolves and is votable', $look && dlvTokenBlockReason($look['token'], $look['pack']) === '');

    // A resend voids the earlier token.
    $tokens2 = dlvIssueTokens((int) $pack['id'], 14);
    $oldTok = dbGet('SELECT * FROM activity_dlv_tokens WHERE token = ?', [$tokens['approve']]);
    check('dlv: resend voids the earlier token', dlvTokenBlockReason($oldTok, dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack['id']])) === 'void');

    // Confirmed Approve -> form approved, pack approved, sibling reject token voided.
    dlvApplyVote(dlvTokenLookup($tokens2['approve'])['token'], dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack['id']]), 'Looks good');
    check('dlv: approve marks form + pack approved', dbGet('SELECT status FROM activity_forms WHERE id = ?', [$fid])['status'] === 'approved' && dbGet('SELECT decision FROM activity_dlv_packs WHERE id = ?', [$pack['id']])['decision'] === 'approve');
    $usedTok = dbGet('SELECT * FROM activity_dlv_tokens WHERE token = ?', [$tokens2['approve']]);
    check('dlv: the used token cannot vote again', dlvTokenBlockReason($usedTok, dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack['id']])) === 'used');

    // A fresh pack + confirmed Reject returns the form to the GLV/leader.
    $pack2 = dlvCreatePack($f, $glv, 'redo');
    check('dlv: revised submission gets pack v2', (int) $pack2['version'] === 2);
    $tk2 = dlvIssueTokens((int) $pack2['id'], 14);
    dbRun("UPDATE activity_dlv_packs SET status = 'awaiting' WHERE id = ?", [$pack2['id']]);
    dlvApplyVote(dlvTokenLookup($tk2['reject'])['token'], dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack2['id']]), 'Needs a risk assessment');
    check('dlv: reject returns the form to more_info', dbGet('SELECT status FROM activity_forms WHERE id = ?', [$fid])['status'] === 'more_info' && dbGet('SELECT dlv_stage FROM activity_forms WHERE id = ?', [$fid])['dlv_stage'] === 'rejected');

    // Email delivery: with no mail server configured (as in the test env) the request
    // stays awaiting with a note - not a hard failure.
    dlvSaveSettings(['maxAttachMb' => 20]);
    $pack3 = dlvCreatePack($f, $glv, 'send test');
    dlvRenderPackPdf($pack3);
    $tk3 = dlvIssueTokens((int) $pack3['id'], 14);
    $send = dlvSendPack(dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack3['id']]), $tk3);
    check('dlv: no mailer -> awaits with a note (not a failure)', $send['status'] === 'awaiting' && $send['sent'] === false
        && str_contains((string) dbGet('SELECT send_error FROM activity_dlv_packs WHERE id = ?', [$pack3['id']])['send_error'], 'not delivered'));
    // A supporting file whose disk copy is missing must FAIL the send - evidence is
    // never silently omitted (FR-AA-020).
    dbRun("INSERT INTO activity_form_files (form_id, doc_type, storage_key, ext, original_filename) VALUES (?, 'supporting', 'ghost-missing', 'pdf', 'Risk_Assessment.pdf')", [$fid]);
    $send2 = dlvSendPack(dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack3['id']]), $tk3);
    check('dlv: a missing evidence file fails the send', $send2['status'] === 'failed' && str_contains($send2['error'], 'Risk_Assessment.pdf'));
}

// QM kit completeness check: overall result derives from component statuses.
function scenario_logic_kit(): void
{
    useDb(tmpDb('kit')); boot(); loadLibs();
    check('kit: all present -> complete', kitCheckResult(['present', 'present']) === 'complete');
    check('kit: a missing -> incomplete', kitCheckResult(['present', 'missing']) === 'incomplete');
    check('kit: a damaged wins over missing -> damaged', kitCheckResult(['missing', 'damaged']) === 'damaged');
}

// QM equipment bundle: serializes with its items (FR-QM-ADV-014).
function scenario_logic_bundle(): void
{
    useDb(tmpDb('bun')); boot(); loadLibs();
    $bid = dbRun("INSERT INTO qm_bundles (name) VALUES ('Camping kit')")['lastInsertId'];
    dbRun('INSERT INTO qm_bundle_items (bundle_id, item_name, requested_qty) VALUES (?, ?, ?)', [$bid, 'Tent', 2]);
    dbRun('INSERT INTO qm_bundle_items (bundle_id, item_name, requested_qty) VALUES (?, ?, ?)', [$bid, 'Stove', 1]);
    $s = serializeQmBundle(dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$bid]));
    check('bundle: serializes with item count', $s['itemCount'] === 2 && $s['items'][0]['itemName'] === 'Tent' && $s['items'][0]['requestedQty'] === 2);
}

// Generic Forms: published-template audience, frozen snapshot, required-field validation,
// reference format, and the no-self-approval / no-leak permission rules (FR-FORM-003..008).
function scenario_logic_forms(): void
{
    useDb(tmpDb('forms')); boot(); loadLibs();
    dbRun("INSERT OR REPLACE INTO settings (key,value) VALUES ('forms_enabled','true')");
    $leaderId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','l@x.com','Lee','L','section_leader')")['lastInsertId'];
    $glvId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','g@x.com','Gwen','G','group_leadership')")['lastInsertId'];
    $adminId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','a@x.com','Ada','A','admin')")['lastInsertId'];
    $strangerId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','s@x.com','Sid','S','section_leader')")['lastInsertId'];
    demoSeedFormsTemplate($adminId);
    $leader = dbGet('SELECT * FROM users WHERE id=?', [$leaderId]);
    $glv = dbGet('SELECT * FROM users WHERE id=?', [$glvId]);
    $stranger = dbGet('SELECT * FROM users WHERE id=?', [$strangerId]);

    check('forms: module enabled', formsEnabled());
    $tpls = formPublishedTemplatesFor($leader);
    check('forms: leader sees the published template', count($tpls) === 1 && $tpls[0]['workflow'] === 'approval');

    $subId = formStartSubmission($leader, (int) $tpls[0]['id']);
    check('forms: started a draft submission', $subId > 0);
    $sub = dbGet('SELECT * FROM form_submissions WHERE id=?', [$subId]);
    check('forms: version schema frozen onto submission', str_contains($sub['schema_snapshot_json'], 'Your name'));
    check('forms: required fields missing before fill', count(formValidateSubmission($sub)) >= 3);

    dbRun("UPDATE form_submissions SET data_json=? WHERE id=?", [json_encode(['name' => 'Sam', 'email' => 's@x.com', 'section' => 'Cubs', 'availability' => 'Weekly', 'dbs' => true]), $subId]);
    $sub = dbGet('SELECT * FROM form_submissions WHERE id=?', [$subId]);
    check('forms: no missing once required fields filled', formValidateSubmission($sub) === []);

    // Editing an in-flight template must NOT change the frozen snapshot (immutability).
    $verId = (int) dbGet('SELECT current_version_id FROM form_templates LIMIT 1')['current_version_id'];
    dbRun("UPDATE form_template_versions SET schema_json = ? WHERE id = ?", [json_encode(['sections' => []]), $verId]);
    $sub = dbGet('SELECT * FROM form_submissions WHERE id=?', [$subId]);
    check('forms: submission snapshot survives a later template edit', str_contains($sub['schema_snapshot_json'], 'Your name'));

    dbRun("UPDATE form_submissions SET status='submitted', reference='FRM-TEST' WHERE id=?", [$subId]);
    $sub = dbGet('SELECT * FROM form_submissions WHERE id=?', [$subId]);
    check('forms: submitter cannot approve own submission', formCanApprove($leader, $sub) === false);
    check('forms: GLV can approve a submitted approval-workflow form', formCanApprove($glv, $sub) === true);
    check('forms: submitter can view own submission', formCanViewSubmission($leader, $sub) === true);
    check('forms: unrelated leader cannot view (no leak)', formCanViewSubmission($stranger, $sub) === false);
    check('forms: reference format is FRM-YYYY-000000', preg_match('/^FRM-\d{4}-\d{6}$/', formSubmissionReference()) === 1);
}

// Forms template administration: create -> build -> pre-publish validation -> publish ->
// edit-after-publish creates a new version while old submissions keep their snapshot.
function scenario_logic_forms_admin(): void
{
    useDb(tmpDb('formsadm')); boot(); loadLibs();
    dbRun("INSERT OR REPLACE INTO settings (key,value) VALUES ('forms_enabled','true')");
    $adminId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','a@x.com','Ada','A','admin')")['lastInsertId'];
    $leaderId = (int) dbRun("INSERT INTO users (auth_type,email,first_name,last_name,portal_role) VALUES ('local','l@x.com','Lee','L','section_leader')")['lastInsertId'];
    $admin = dbGet('SELECT * FROM users WHERE id=?', [$adminId]);
    $leader = dbGet('SELECT * FROM users WHERE id=?', [$leaderId]);

    $tid = formCreateTemplate($admin, ['title' => 'Trip interest', 'workflow' => 'record']);
    check('forms-admin: new template is a draft with an empty version', dbGet('SELECT status FROM form_templates WHERE id=?', [$tid])['status'] === 'draft' && formDraftVersion($tid) !== null);
    check('forms-admin: a draft-only template is not offered to completers', count(formPublishedTemplatesFor($leader)) === 0);

    // Pre-publish validation blocks an empty form.
    $pub = formPublishTemplate($tid);
    check('forms-admin: publishing an empty form is rejected', isset($pub['errors']) && count($pub['errors']) > 0);

    // Build a valid schema, then publish.
    formUpdateTemplate($tid, $admin, ['schema' => ['sections' => [['title' => 'You', 'fields' => [['id' => 'name', 'label' => 'Name', 'type' => 'text', 'required' => true]]]]]]);
    check('forms-admin: valid schema publishes', (formPublishTemplate($tid)['ok'] ?? false) === true);
    $tpl = dbGet('SELECT * FROM form_templates WHERE id=?', [$tid]);
    check('forms-admin: published template has a current version + is offered', $tpl['status'] === 'published' && $tpl['current_version_id'] && count(formPublishedTemplatesFor($leader)) === 1);
    $v1 = (int) $tpl['current_version_id'];

    // A submission started now freezes v1.
    $subId = formStartSubmission($leader, $tid);

    // Edit after publish -> a NEW draft version (v1 stays immutable).
    formUpdateTemplate($tid, $admin, ['schema' => ['sections' => [['title' => 'You', 'fields' => [['id' => 'name', 'label' => 'Full name', 'type' => 'text', 'required' => true], ['id' => 'phone', 'label' => 'Phone', 'type' => 'text', 'required' => false]]]]]]);
    $draft = formDraftVersion($tid);
    check('forms-admin: editing a published form creates a new draft version', $draft && (int) $draft['id'] !== $v1 && (int) $draft['version_no'] === 2);
    check('forms-admin: the published v1 schema is unchanged', str_contains(dbGet('SELECT schema_json FROM form_template_versions WHERE id=?', [$v1])['schema_json'], '"label":"Name"'));

    // Publish v2 -> current moves, v1 retired, but the in-flight submission keeps its v1 snapshot.
    formPublishTemplate($tid);
    $tpl = dbGet('SELECT * FROM form_templates WHERE id=?', [$tid]);
    check('forms-admin: publishing v2 supersedes v1', (int) $tpl['current_version_id'] === (int) $draft['id'] && dbGet('SELECT status FROM form_template_versions WHERE id=?', [$v1])['status'] === 'retired');
    check('forms-admin: an in-flight submission keeps its original v1 snapshot', dbGet('SELECT template_version_id FROM form_submissions WHERE id=?', [$subId])['template_version_id'] == $v1);

    // Schema validation catches duplicate ids and missing choice options.
    check('forms-admin: duplicate field ids are caught', count(formValidateSchema(['sections' => [['fields' => [['id' => 'a', 'label' => 'A', 'type' => 'text'], ['id' => 'a', 'label' => 'B', 'type' => 'text']]]]])) > 0);
    check('forms-admin: choice field without options is caught', count(formValidateSchema(['sections' => [['fields' => [['id' => 'a', 'label' => 'A', 'type' => 'select']]]]])) > 0);
}

// QM restricted-booking gate: a restricted line isn't cleared for approval until
// its permit is confirmed and a responsible adult is named (FR-QM-ADV-008).
function scenario_logic_qm_restricted(): void
{
    useDb(tmpDb('qm')); boot(); loadLibs();
    $bow = dbRun("INSERT INTO equipment_assets (name, restricted, restricted_category) VALUES ('Bow', 1, 'archery')")['lastInsertId'];
    $tent = dbRun("INSERT INTO equipment_assets (name) VALUES ('Tent')")['lastInsertId'];
    // a restricted line with no permit/responsible -> not satisfied
    $line1 = ['equipment_asset_id' => $bow, 'permit_confirmed' => 0, 'responsible_adult' => null];
    check('qm: restricted line without permit is NOT cleared', qmLineRestrictionSatisfied($line1) === false);
    // permit confirmed + responsible named -> satisfied
    $line2 = ['equipment_asset_id' => $bow, 'permit_confirmed' => 1, 'responsible_adult' => 'A. Leader'];
    check('qm: restricted line with permit + responsible IS cleared', qmLineRestrictionSatisfied($line2) === true);
    // permit but no responsible adult -> still not cleared
    $line3 = ['equipment_asset_id' => $bow, 'permit_confirmed' => 1, 'responsible_adult' => ''];
    check('qm: permit alone (no responsible adult) is NOT cleared', qmLineRestrictionSatisfied($line3) === false);
    // a non-restricted line is always cleared
    $line4 = ['equipment_asset_id' => $tent, 'permit_confirmed' => 0, 'responsible_adult' => null];
    check('qm: non-restricted line needs no permit', qmLineRestrictionSatisfied($line4) === true);
}

// ── child runner: run one scenario, print machine-readable results ────────────
if (in_array('--child', $argv, true)) {
    $name = $argv[array_search('--child', $argv, true) + 1] ?? '';
    $fn = 'scenario_' . $name;
    if (!function_exists($fn)) { fwrite(STDERR, "unknown scenario: $name\n"); exit(2); }
    try {
        $fn();
    } catch (Throwable $e) {
        echo "FAIL\t$name: uncaught\t" . $e->getMessage() . "\n";
        exit(1);
    }
    $failed = 0;
    foreach ($GLOBALS['__checks'] as [$n, $ok, $detail]) {
        echo ($ok ? 'PASS' : 'FAIL') . "\t$n" . ($detail !== '' ? "\t$detail" : '') . "\n";
        if (!$ok) $failed++;
    }
    exit($failed > 0 ? 1 : 0);
}

// ── orchestrator: run each scenario in a clean child process ──────────────────
$php = PHP_BINARY ?: 'php';
$self = __FILE__;
$total = 0; $failed = 0; $scenFailed = 0;
foreach (SCENARIOS as $name) {
    $cmd = escapeshellarg($php) . ' ' . escapeshellarg($self) . ' --child ' . escapeshellarg($name) . ' 2>&1';
    exec($cmd, $out, $code);
    $lines = $out; $out = [];
    echo "── $name ──\n";
    foreach ($lines as $line) {
        echo '  ' . $line . "\n";
        if (str_starts_with($line, 'PASS') || str_starts_with($line, 'FAIL')) {
            $total++;
            if (str_starts_with($line, 'FAIL')) $failed++;
        }
    }
    if ($code !== 0) $scenFailed++;
}
echo "\n" . ($failed === 0 && $scenFailed === 0 ? 'OK' : 'FAILURES') . ": $total checks, $failed failed across " . count(SCENARIOS) . " scenarios\n";
exit($failed === 0 && $scenFailed === 0 ? 0 : 1);
