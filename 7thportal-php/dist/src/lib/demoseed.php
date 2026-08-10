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
    'camp_rota_entries', 'camp_rota_adults', 'event_locations', 'event_hub_items', 'event_hubs',
    'calendar_entries',
    'gallery_photos', 'gallery_album_parents', 'gallery_albums',
    'document_acknowledgements', 'document_versions', 'documents',
    'expense_payment_items', 'expense_payment_batches', 'expense_claim_item_receipts', 'expense_receipts', 'expense_mileage_details', 'expense_claim_items', 'expense_claims',
    'incidents', 'qm_booking_items', 'qm_bookings', 'equipment_assets',
    'attendance_marks', 'attendance_registers', 'section_snapshots',
    'notices', 'notifications', 'dismissed_actions',
];

function demoResetToBaseline(int $actorUserId): array
{
    $cleared = 0;
    foreach (DEMO_WIPE_TABLES as $t) {
        if (dbGet("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?", [$t])) {
            dbRun("DELETE FROM $t");
            $cleared++;
        }
    }
    demoSeedBaseline($actorUserId);
    return ['clearedTables' => $cleared];
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
}
