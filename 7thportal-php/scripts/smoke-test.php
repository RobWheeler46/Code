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

const SCENARIOS = ['migrate_fresh', 'migrate_drift', 'logic_finance', 'logic_mileage', 'logic_incident', 'logic_events'];

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
    foreach (['helpers', 'notifications', 'finance', 'incidents', 'patrolpoints', 'events'] as $lib) {
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
