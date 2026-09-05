<?php
// Demo/UAT data reset (Test Environment pack DEMO-DATA-002/003). Clears the
// transactional module data and re-seeds a known baseline so every workshop
// starts from the same point. Demo mode only; user accounts, config, audit and
// tester feedback are preserved.

// Cleared in child -> parent order. Deliberately NOT cleared: users, settings,
// parent_child_links, osm_sections, section_capacity, expense_accounts,
// expense_categories, mileage_rates, notification_prefs, audit_log, demo_feedback.
const DEMO_WIPE_TABLES = [
    'pp_score_lines', 'pp_participants', 'pp_guest_links', 'pp_submissions', 'pp_activities', 'pp_categories', 'pp_teams', 'pp_competitions',
    'activity_form_files', 'activity_form_events', 'activity_forms',
    'form_submission_files', 'form_submissions', 'form_template_versions', 'form_templates',
    'camp_rota_entries', 'camp_rota_adults', 'event_locations', 'event_hub_items', 'event_hubs',
    'calendar_entries',
    'gallery_photos', 'gallery_album_parents', 'gallery_albums',
    'document_acknowledgements', 'document_versions', 'documents',
    'expense_payment_items', 'expense_payment_batches', 'expense_claim_item_receipts', 'expense_receipts', 'expense_mileage_details', 'expense_claim_items', 'expense_claims',
    'incidents', 'qm_booking_items', 'qm_bookings', 'equipment_assets',
    'attendance_marks', 'attendance_registers', 'section_snapshots',
    'notices', 'notifications', 'dismissed_actions',
];

// Demo scenario launcher (Test Environment pack): named starting points an admin can
// load with one click, each a coherent world for a particular demo. Every scenario
// clears the transactional tables first, then seeds its own data on the shared
// baseline, so switching scenarios is repeatable and never accumulates.
const DEMO_SCENARIOS = [
    ['key' => 'starter', 'name' => 'Starter baseline', 'description' => 'A clean, minimal set: welcome notices and a Patrol Points league with sample scores. The quickest way back to a tidy demo.'],
    ['key' => 'camp_weekend', 'name' => 'Camp weekend in full swing', 'description' => 'A published Autumn Adventure Camp with a parent pack, emergency contacts, an adult rota, transport, a programme, plus a linked expense claim, attendance register and a near-miss - so the whole event Command Centre lights up.'],
    ['key' => 'finance_backlog', 'name' => 'Finance backlog for the Treasurer', 'description' => 'Several expense claims spread across draft, submitted, approved-unpaid and paid - good for demoing the approver and Treasurer flows.'],
];

function demoScenarioList(): array
{
    return DEMO_SCENARIOS;
}

// Apply a named scenario: wipe the transactional tables, then seed. Throws on an
// unknown key so the route can turn it into a 400.
function demoApplyScenario(int $actorUserId, string $key): array
{
    $seeders = ['starter' => 'demoSeedBaseline', 'camp_weekend' => 'demoSeedCampWeekend', 'finance_backlog' => 'demoSeedFinanceBacklog'];
    if (!isset($seeders[$key])) throw new InvalidArgumentException('Unknown demo scenario: ' . $key);
    $cleared = 0;
    foreach (DEMO_WIPE_TABLES as $t) {
        if (dbGet("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [$t])) {
            dbRun("DELETE FROM $t");
            $cleared++;
        }
    }
    $seeders[$key]($actorUserId);
    $name = array_column(DEMO_SCENARIOS, 'name', 'key')[$key] ?? $key;
    return ['scenario' => $key, 'scenarioName' => $name, 'clearedTables' => $cleared];
}

// Backwards-compatible reset: the original "reset to baseline" button maps to the
// starter scenario.
function demoResetToBaseline(int $actorUserId): array
{
    return demoApplyScenario($actorUserId, 'starter');
}

// get-or-create an expense account by name (accounts survive demo wipes, so a claim
// seeder must not assume one exists on a fresh environment).
function demoAccount(string $name, string $code): int
{
    $row = dbGet('SELECT id FROM expense_accounts WHERE name = ?', [$name]);
    if ($row) return (int) $row['id'];
    return (int) dbRun('INSERT INTO expense_accounts (name, code) VALUES (?, ?)', [$name, $code])['lastInsertId'];
}

// A compact but coherent starter set. Extend here to seed more modules.
function demoSeedBaseline(int $actorUserId): void
{
    dbRun("INSERT INTO notices (title, body, audience, start_date, status) VALUES (?, ?, 'all', date('now'), 'published')",
        ['Welcome to the 7thPortal demo', 'This is a synthetic test environment — no real people or live systems. Explore any role from the persona switcher, leave feedback with the Feedback button, and reset the data any time from Admin › Settings.']);
    dbRun("INSERT INTO notices (title, body, audience, start_date, status) VALUES (?, ?, 'leaders', date('now'), 'published')",
        ['Summer Camp League is open', 'Leaders: the demo Summer Camp League is live in Patrol Points, with teams and sample scores.']);

    // Patrol Points: an open, parent-visible competition with teams + sample scores.
    $res = dbRun("INSERT INTO pp_competitions (name, description, status, approval_mode, visibility, allow_deductions, created_by) VALUES (?, 'Camp-wide demo competition', 'open', 'immediate', 'parents', 0, ?)",
        ['Summer Camp League', $actorUserId]);
    $cid = (int) $res['lastInsertId'];
    $teams = [];
    foreach (['Buffaloes', 'Hawks', 'Lions', 'Panthers', 'Ravens', 'Stags'] as $i => $name) {
        $r = dbRun('INSERT INTO pp_teams (competition_id, name, sort_order) VALUES (?, ?, ?)', [$cid, $name, $i]);
        $teams[$name] = (int) $r['lastInsertId'];
    }
    $catRes = dbRun("INSERT INTO pp_categories (competition_id, name, points_type, sort_order) VALUES (?, 'General points', 'free', 0)", [$cid]);
    $catId = (int) $catRes['lastInsertId'];
    // Ties (Hawks/Panthers) so the tie-aware leaderboard is visible in the demo.
    foreach (['Buffaloes' => 25, 'Hawks' => 40, 'Lions' => 15, 'Panthers' => 40, 'Ravens' => 10, 'Stags' => 30] as $team => $pts) {
        $s = dbRun("INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status) VALUES (?, ?, ?, 'Baseline demo score', 'approved')", [$cid, $catId, $actorUserId]);
        dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [(int) $s['lastInsertId'], $teams[$team], $pts]);
    }

    demoSeedFormsTemplate($actorUserId);
}

// A published Forms template so the generic Forms module is clickable in the demo: an
// adult-volunteer enquiry with a single GLV approval step. Wiped/reseeded each reset.
function demoSeedFormsTemplate(int $actorUserId): void
{
    $schema = json_encode(['sections' => [
        ['title' => 'About you', 'fields' => [
            ['id' => 'name', 'label' => 'Your name', 'type' => 'text', 'required' => true],
            ['id' => 'email', 'label' => 'Email address', 'type' => 'email', 'required' => true],
            ['id' => 'phone', 'label' => 'Phone (optional)', 'type' => 'text', 'required' => false],
        ]],
        ['title' => 'How you would like to help', 'fields' => [
            ['id' => 'section', 'label' => 'Which section interests you?', 'type' => 'select', 'required' => true, 'options' => ['Beavers', 'Cubs', 'Scouts', 'Any / not sure']],
            ['id' => 'availability', 'label' => 'Availability', 'type' => 'radio', 'required' => true, 'options' => ['Weekly', 'Occasional', 'One-off events']],
            ['id' => 'dbs', 'label' => 'I understand a DBS check will be needed', 'type' => 'checkbox', 'required' => true],
            ['id' => 'about', 'label' => 'Anything else you would like us to know', 'type' => 'textarea', 'required' => false],
        ]],
    ]]);
    $t = dbRun(
        "INSERT INTO form_templates (slug, title, description, category, status, workflow, created_by) VALUES ('volunteer-enquiry', ?, ?, 'Volunteering', 'published', 'approval', ?)",
        ['Adult volunteer enquiry', 'Register your interest in helping at 7th Swindon and tell us how to reach you.', $actorUserId]
    );
    $tid = (int) $t['lastInsertId'];
    $v = dbRun("INSERT INTO form_template_versions (template_id, version_no, schema_json, status, published_at, created_by) VALUES (?, 1, ?, 'published', datetime('now'), ?)", [$tid, $schema, $actorUserId]);
    dbRun('UPDATE form_templates SET current_version_id = ? WHERE id = ?', [(int) $v['lastInsertId'], $tid]);
}

// "Camp weekend in full swing": a published camp hub with every operational area
// populated, so the event Command Centre shows finance, attendance, transport,
// programme, rota, locations and safety all at once. Built on the starter baseline.
function demoSeedCampWeekend(int $actorUserId): void
{
    demoSeedBaseline($actorUserId);
    $start = gmdate('Y-m-d', strtotime('+14 days'));
    $end = gmdate('Y-m-d', strtotime('+16 days'));
    $hub = (int) dbRun(
        "INSERT INTO event_hubs (title, event_type, osm_section_id, section_name, start_date, end_date, status) VALUES ('Autumn Adventure Camp', 'camp', 'demo-cubs', 'Cubs', ?, ?, 'published')",
        [$start, $end]
    )['lastInsertId'];

    // Parent pack + a leader-only risk assessment.
    dbRun("INSERT INTO event_hub_items (hub_id, label, item_status, visibility, owner_name) VALUES (?, 'Kit list & what to bring', 'published', 'parents', 'Akela')", [$hub]);
    dbRun("INSERT INTO event_hub_items (hub_id, label, item_status, visibility, owner_name) VALUES (?, 'Risk assessment', 'published', 'leaders', 'Akela')", [$hub]);

    // Locations, including an emergency contact so that area reads ready.
    dbRun("INSERT INTO event_locations (hub_id, location_type, name, visibility) VALUES (?, 'campsite', 'Ferny Crofts Scout Activity Centre', 'parents')", [$hub]);
    dbRun("INSERT INTO event_locations (hub_id, location_type, name, visibility) VALUES (?, 'hospital', 'Southampton General Hospital', 'emergency')", [$hub]);

    // Adult rota (two adults, a couple of duty entries).
    $a1 = (int) dbRun("INSERT INTO camp_rota_adults (hub_id, name, is_driver, is_first_aider) VALUES (?, 'Akela', 1, 1)", [$hub])['lastInsertId'];
    $a2 = (int) dbRun("INSERT INTO camp_rota_adults (hub_id, name, is_driver, is_first_aider) VALUES (?, 'Bagheera', 1, 0)", [$hub])['lastInsertId'];
    dbRun("INSERT INTO camp_rota_entries (hub_id, day_label, session, role, adult_id) VALUES (?, 'Saturday', 'am', 'first_aid', ?)", [$hub, $a1]);
    dbRun("INSERT INTO camp_rota_entries (hub_id, day_label, session, role, adult_id) VALUES (?, 'Saturday', 'pm', 'driver', ?)", [$hub, $a2]);

    // Transport with a passenger manifest.
    $v = (int) dbRun("INSERT INTO camp_transport_vehicles (hub_id, name, vehicle_type, driver_name, capacity) VALUES (?, 'Minibus 1', 'minibus', 'Bagheera', 12)", [$hub])['lastInsertId'];
    foreach (['Alex', 'Sam', 'Jo', 'Charlie'] as $p) {
        dbRun("INSERT INTO camp_transport_passengers (vehicle_id, hub_id, passenger_name) VALUES (?, ?, ?)", [$v, $hub, $p]);
    }

    // Programme.
    dbRun("INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label, location) VALUES (?, 'Saturday', 'am', 'Climbing tower', 'Reds', 'Tower')", [$hub]);
    dbRun("INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label, location) VALUES (?, 'Saturday', 'pm', 'Canoeing', 'Blues', 'Lake')", [$hub]);

    // Finance: an event-linked expense claim awaiting approval.
    $acct = demoAccount('Camp Account', 'CAMP');
    $claim = (int) dbRun(
        "INSERT INTO expense_claims (claim_number, claimant_user_id, title, status, event_hub_id) VALUES (?, ?, 'Camp catering shop', 'submitted', ?)",
        [generateClaimNumber(), $actorUserId, $hub]
    )['lastInsertId'];
    dbRun("INSERT INTO expense_claim_items (claim_id, item_number, item_type, title, account_id, status, claimed_amount, submitted_at) VALUES (?, 1, 'receipt', 'Bulk catering', ?, 'submitted', 86.40, datetime('now'))", [$claim, $acct]);

    // Attendance: an open register taken for the camp.
    dbRun(
        "INSERT INTO attendance_registers (osm_section_id, section_name, title, session_date, source_type, source_ref_id, source_label, status) VALUES ('demo-cubs', 'Cubs', 'Camp register', ?, 'event', ?, 'Autumn Adventure Camp', 'open')",
        [$start, $hub]
    );

    // Safety: an open near-miss tied to the camp.
    dbRun("INSERT INTO incidents (record_type, sensitivity, summary, event_hub_id, section_name, status, occurred_at) VALUES ('near_miss', 'standard', 'Wet decking by the washrooms', ?, 'Cubs', 'open', datetime('now'))", [$hub]);
}

// "Finance backlog": a spread of expense claims across the workflow, for demoing the
// approver and Treasurer views. Built on the starter baseline.
function demoSeedFinanceBacklog(int $actorUserId): void
{
    demoSeedBaseline($actorUserId);
    $acct = demoAccount('Main Account', 'MAIN');
    $mk = function (string $title, string $claimStatus, string $itemStatus, float $amt) use ($actorUserId, $acct) {
        $c = (int) dbRun("INSERT INTO expense_claims (claim_number, claimant_user_id, title, status) VALUES (?, ?, ?, ?)", [generateClaimNumber(), $actorUserId, $title, $claimStatus])['lastInsertId'];
        $approved = in_array($itemStatus, ['approved', 'ready_for_payment', 'paid'], true) ? $amt : null;
        dbRun(
            "INSERT INTO expense_claim_items (claim_id, item_number, item_type, title, account_id, status, claimed_amount, approved_amount, submitted_at) VALUES (?, 1, 'receipt', ?, ?, ?, ?, ?, datetime('now'))",
            [$c, $title, $acct, $itemStatus, $amt, $approved]
        );
    };
    $mk('Badges & awards order', 'submitted', 'submitted', 24.50);
    $mk('Hall hire - autumn term', 'approved', 'approved', 120.00);
    $mk('Craft supplies', 'paid', 'paid', 31.75);
    $mk('Minibus fuel', 'draft', 'draft', 18.00);
}
