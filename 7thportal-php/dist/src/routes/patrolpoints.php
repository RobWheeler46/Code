<?php
// Patrol Points routes (FRD v2.1 s13). Competitions, teams, categories,
// comment-required multi-team score submissions with approval (no self-approval)
// and a derived leaderboard. Leader workspace only in this MVP.

// Allowed competition lifecycle transitions (FRD s13.2).
const PP_TRANSITIONS = [
    'draft' => ['open', 'archived'],
    'open' => ['paused', 'completed'],
    'paused' => ['open', 'completed'],
    'completed' => ['archived'],
    'archived' => [],
];

// ── List ────────────────────────────────────────────────────────────────────────
$router->get('/api/patrol-points/competitions', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $rows = dbAll('SELECT * FROM pp_competitions ORDER BY (status = \'archived\'), updated_at DESC');
    jsonResponse([
        'competitions' => array_map(fn($c) => serializePpCompetition($c), $rows),
        'canManage' => ppCanManage($user),
        'meta' => ['statuses' => PP_STATUSES, 'approvalModes' => PP_APPROVAL_MODES, 'pointsTypes' => PP_POINTS_TYPES, 'presets' => ppPresets()],
    ]);
});

// ── Parent-safe leaderboards (FRD v2.4: parents see standings only) ──────────────
// Any authenticated user; returns only parent-visible competitions and only
// position/team/total - never reasons, comments, submitters or young-person names.
$router->get('/api/patrol-points/parent/leaderboards', function ($params) {
    $user = requireAuth();
    requirePatrolPointsEnabled();
    $isLeader = isLeaderRole($user['portal_role']);
    $out = [];
    foreach (dbAll("SELECT * FROM pp_competitions WHERE visibility = 'parents' AND status IN ('open','paused','completed') ORDER BY (status = 'completed'), updated_at DESC") as $c) {
        // Section scope: group-wide, or the parent has a child in the section (leaders always allowed).
        if (!empty($c['osm_section_id']) && !$isLeader) {
            if (!dbGet('SELECT 1 FROM parent_child_links WHERE parent_user_id = ? AND osm_section_id = ? LIMIT 1', [$user['id'], $c['osm_section_id']])) continue;
        }
        $out[] = [
            'id' => (int) $c['id'], 'name' => $c['name'], 'sectionName' => $c['section_name'],
            'status' => $c['status'], 'statusLabel' => PP_STATUSES[$c['status']] ?? $c['status'],
            'leaderboard' => ppLeaderboard((int) $c['id']),
        ];
    }
    jsonResponse(['competitions' => $out]);
});

// ── Create ──────────────────────────────────────────────────────────────────────
$router->post('/api/patrol-points/competitions', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot create competitions.'], 403);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A competition name is required.'], 422);
    $mode = in_array($b['approvalMode'] ?? '', ['immediate', 'approval'], true) ? $b['approvalMode'] : 'immediate';
    $res = dbRun(
        "INSERT INTO pp_competitions (name, description, approval_mode, visibility, allow_deductions, osm_section_id, section_name, created_by)
         VALUES (?, ?, ?, 'leaders', ?, ?, ?, ?)",
        [$name, trim((string) ($b['description'] ?? '')) ?: null, $mode, !empty($b['allowDeductions']) ? 1 : 0, $b['sectionId'] ?? null, trim((string) ($b['sectionName'] ?? '')) ?: null, $user['id']]
    );
    $id = (int) $res['lastInsertId'];
    logAudit(['userId' => $user['id'], 'action' => 'pp_competition_create', 'entityType' => 'pp_competition', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
    jsonResponse(serializePpCompetition(ppCompetitionOr404($id), true), 201);
});

// Setup wizard (FRD s13.2, App. E): create a competition with its teams and scoring
// categories in one step, optionally opening it (Review & Start). Transactional so a
// half-built competition is never left behind.
$router->post('/api/patrol-points/competitions/wizard', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot create competitions.'], 403);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A competition name is required.'], 422);
    $mode = in_array($b['approvalMode'] ?? '', ['immediate', 'approval'], true) ? $b['approvalMode'] : 'immediate';
    $teams = array_values(array_filter(array_map(fn($t) => trim((string) $t), is_array($b['teams'] ?? null) ? $b['teams'] : []), fn($t) => $t !== ''));
    $cats = is_array($b['categories'] ?? null) ? $b['categories'] : [];
    foreach ($cats as $ct) {
        if (trim((string) ($ct['name'] ?? '')) === '') jsonResponse(['error' => 'Each scoring category needs a name.'], 422);
        if (($ct['pointsType'] ?? 'free') === 'fixed' && !is_numeric($ct['fixedPoints'] ?? null)) jsonResponse(['error' => 'A fixed-value category needs a points value.'], 422);
    }
    $start = !empty($b['start']);
    if ($start && (!$teams || !$cats)) jsonResponse(['error' => 'Add at least one team and one scoring category before starting.'], 422);

    try {
        $id = ppBuildCompetition((int) $user['id'], $b);
    } catch (Throwable $e) {
        jsonResponse(['error' => 'Could not create the competition.'], 500);
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_competition_wizard', 'entityType' => 'pp_competition', 'entityId' => (string) $id, 'ipAddress' => clientIp(), 'details' => ['teams' => count($teams), 'categories' => count($cats), 'started' => $start]]);
    jsonResponse(serializePpCompetition(ppCompetitionOr404($id), true), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────────
$router->get('/api/patrol-points/competitions/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    $teams = dbAll('SELECT * FROM pp_teams WHERE competition_id = ? ORDER BY sort_order, name', [$c['id']]);
    $cats = dbAll('SELECT * FROM pp_categories WHERE competition_id = ? ORDER BY sort_order, name', [$c['id']]);
    $subs = dbAll('SELECT * FROM pp_submissions WHERE competition_id = ? ORDER BY created_at DESC, id DESC', [$c['id']]);

    $teamNames = []; foreach ($teams as $t) $teamNames[(int) $t['id']] = $t['name'];
    $catNames = []; foreach ($cats as $ct) $catNames[(int) $ct['id']] = $ct['name'];
    $userNames = [];
    foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $userNames[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    $linesBySub = [];
    foreach (dbAll('SELECT l.* FROM pp_score_lines l JOIN pp_submissions s ON s.id = l.submission_id WHERE s.competition_id = ?', [$c['id']]) as $l) {
        $linesBySub[(int) $l['submission_id']][] = $l;
    }
    $submissions = array_map(function ($s) use ($linesBySub, $teamNames, $catNames, $userNames, $user) {
        $ser = serializePpSubmission($s, $linesBySub[(int) $s['id']] ?? [], $teamNames, $catNames, $userNames);
        // Per-viewer approve eligibility so the queue can group "unavailable to you" (s8).
        $ser['canApprove'] = ($s['status'] === 'pending' && empty($s['withdrawn'])) ? ppCanApprove($user, $s) : false;
        return $ser;
    }, $subs);

    $participants = array_map('serializePpParticipant', dbAll('SELECT * FROM pp_participants WHERE competition_id = ? ORDER BY display_name', [$c['id']]));
    $catsById = []; foreach ($cats as $ct) $catsById[(int) $ct['id']] = $ct;
    $activityRows = dbAll('SELECT * FROM pp_activities WHERE competition_id = ? ORDER BY sort_order, name', [$c['id']]);
    $activities = [];
    $actById = [];
    foreach ($activityRows as $a) {
        $actById[(int) $a['id']] = $a;
        $cr = $catsById[(int) $a['category_id']] ?? null;
        if ($cr) $activities[] = serializePpActivity($a, $cr, (bool) $c['allow_deductions']);
    }
    // Guest links (managers only, and only surfaced when guest entry is enabled).
    $guestLinks = [];
    if (ppCanManage($user) && ppGuestEnabled()) {
        foreach (dbAll('SELECT * FROM pp_guest_links WHERE competition_id = ? ORDER BY id DESC', [$c['id']]) as $gl) {
            $guestLinks[] = serializeGuestLink($gl, $actById[(int) $gl['activity_id']] ?? null);
        }
    }

    jsonResponse([
        'competition' => serializePpCompetition($c, true),
        'teams' => array_map('serializePpTeam', $teams),
        'categories' => array_map(fn($x) => serializePpCategory($x, (bool) $c['allow_deductions']), $cats),
        'activities' => $activities,
        'guestLinks' => $guestLinks,
        'participants' => $participants,
        'submissions' => $submissions,
        'leaderboard' => ppLeaderboard((int) $c['id']),
        'myActions' => [
            'canManage' => ppCanManage($user),
            'canSubmit' => (ppHasCapability($user, $c, 'submit') || ppHasCapability($user, $c, 'score_direct')) && $c['status'] === 'open' && $teams && $cats,
            'canManageAccess' => ppHasCapability($user, $c, 'manage_access'),
            'capabilities' => ppUserCapabilities($user, $c),
            'usesCapabilityModel' => (bool) $c['uses_capability_model'],
            'isCreator' => (int) $c['created_by'] === (int) $user['id'],
            'userId' => (int) $user['id'],
        ],
        'meta' => ['statuses' => PP_STATUSES, 'approvalModes' => PP_APPROVAL_MODES, 'pointsTypes' => PP_POINTS_TYPES, 'transitions' => PP_TRANSITIONS, 'sections' => ppSectionsForUser($user), 'guestEnabled' => ppGuestEnabled()],
    ]);
});

// ── Edit basic fields ───────────────────────────────────────────────────────────
$router->patch('/api/patrol-points/competitions/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot edit competitions.'], 403);
    $c = ppCompetitionOr404($params['id']);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'A completed competition can no longer be edited.'], 409);
    $b = requestBody();
    $name = array_key_exists('name', $b) ? (trim((string) $b['name']) ?: $c['name']) : $c['name'];
    $desc = array_key_exists('description', $b) ? (trim((string) $b['description']) ?: null) : $c['description'];
    $mode = in_array($b['approvalMode'] ?? $c['approval_mode'], ['immediate', 'approval'], true) ? ($b['approvalMode'] ?? $c['approval_mode']) : $c['approval_mode'];
    $allowDed = array_key_exists('allowDeductions', $b) ? (!empty($b['allowDeductions']) ? 1 : 0) : (int) $c['allow_deductions'];
    $visibility = array_key_exists('visibility', $b) ? (in_array($b['visibility'], ['leaders', 'parents'], true) ? $b['visibility'] : $c['visibility']) : $c['visibility'];
    dbRun("UPDATE pp_competitions SET name = ?, description = ?, approval_mode = ?, allow_deductions = ?, visibility = ?, updated_at = datetime('now') WHERE id = ?", [$name, $desc, $mode, $allowDed, $visibility, $c['id']]);
    jsonResponse(serializePpCompetition(ppCompetitionOr404($c['id']), true));
});

// ── Lifecycle status change ─────────────────────────────────────────────────────
$router->post('/api/patrol-points/competitions/:id/status', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot change competition status.'], 403);
    $c = ppCompetitionOr404($params['id']);
    $to = (string) (requestBody()['status'] ?? '');
    if (!in_array($to, PP_TRANSITIONS[$c['status']] ?? [], true)) jsonResponse(['error' => 'That status change is not allowed from ' . ($c['status']) . '.'], 409);
    if ($to === 'open' && !dbGet('SELECT 1 FROM pp_teams WHERE competition_id = ? LIMIT 1', [$c['id']])) {
        jsonResponse(['error' => 'Add at least one team before opening the competition.'], 422);
    }
    // AC24-07 / PP24-APR-003: cannot open with a pending-producing route and no approver.
    if ($to === 'open' && ($cov = ppApprovalCoverageError($c)) !== null) jsonResponse(['error' => $cov], 422);
    if ($to === 'completed') {
        // Completion readiness (FRD PP2.4 s10 / PP24-CLOSE-001): unresolved approvals and
        // revisions block; active Guest Quick Entry links are revoked automatically.
        $pending = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending' AND withdrawn = 0", [$c['id']])['n'];
        if ($pending > 0) jsonResponse(['error' => "Resolve the $pending item(s) still awaiting approval before completing."], 409);
    }
    $completedAt = $to === 'completed' ? "datetime('now')" : 'completed_at';
    dbRun("UPDATE pp_competitions SET status = ?, completed_at = $completedAt, updated_at = datetime('now') WHERE id = ?", [$to, $c['id']]);
    $revokedGuest = 0;
    if ($to === 'completed') {
        $revokedGuest = (int) (dbGet("SELECT COUNT(*) n FROM pp_guest_links WHERE competition_id = ? AND status = 'active'", [$c['id']])['n'] ?? 0);
        if ($revokedGuest > 0) dbRun("UPDATE pp_guest_links SET status = 'revoked' WHERE competition_id = ? AND status = 'active'", [$c['id']]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_competition_status', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp(), 'details' => ['to' => $to, 'revokedGuestLinks' => $revokedGuest]]);
    jsonResponse(serializePpCompetition(ppCompetitionOr404($c['id']), true));
});

// ── Completion readiness (FRD PP2.4 s10 / AC24-11): what must be resolved before a
// competition can be permanently completed, plus the final standings to confirm. ──
$router->get('/api/patrol-points/competitions/:id/completion-readiness', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Only a competition manager can complete a competition.'], 403);
    $c = ppCompetitionOr404($params['id']);
    $pendingApprovals = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending' AND withdrawn = 0 AND revises_id IS NULL", [$c['id']])['n'];
    $pendingRevisions = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending' AND withdrawn = 0 AND revises_id IS NOT NULL", [$c['id']])['n'];
    $activeGuest = (int) dbGet("SELECT COUNT(*) n FROM pp_guest_links WHERE competition_id = ? AND status = 'active'", [$c['id']])['n'];
    // Possible duplicates (FRD s10): the same team getting the same points in the same
    // category more than once, among live (approved/pending) submissions. A warning to
    // acknowledge, not a hard blocker.
    $possibleDuplicates = (int) (dbGet(
        "SELECT COUNT(*) n FROM (
           SELECT l.team_id, l.points, s.category_id
           FROM pp_score_lines l JOIN pp_submissions s ON s.id = l.submission_id
           WHERE s.competition_id = ? AND s.withdrawn = 0 AND s.superseded_by IS NULL AND s.status IN ('approved','pending')
           GROUP BY l.team_id, l.points, s.category_id HAVING COUNT(*) > 1)",
        [$c['id']]
    )['n'] ?? 0);
    $blockers = [];
    if ($pendingApprovals > 0) $blockers[] = $pendingApprovals . ' score' . ($pendingApprovals === 1 ? '' : 's') . ' still awaiting approval';
    if ($pendingRevisions > 0) $blockers[] = $pendingRevisions . ' correction' . ($pendingRevisions === 1 ? '' : 's') . ' still awaiting approval';
    $warnings = [];
    if ($possibleDuplicates > 0) $warnings[] = $possibleDuplicates . ' possible duplicate ' . ($possibleDuplicates === 1 ? 'award' : 'awards') . ' (same team, points and category)';
    jsonResponse([
        'pendingApprovals' => $pendingApprovals,
        'pendingRevisions' => $pendingRevisions,
        'activeGuestLinks' => $activeGuest,
        'possibleDuplicates' => $possibleDuplicates,
        'finalLeaderboard' => ppLeaderboard((int) $c['id']),
        'blockers' => $blockers,
        'warnings' => $warnings,
        'canComplete' => count($blockers) === 0 && in_array('completed', PP_TRANSITIONS[$c['status']] ?? [], true),
    ]);
});

// ── Presentation leaderboard (FRD PP2.4 s9 / AC24-10): viewer-safe fields only,
// effective scores only. Never names, comments, evidence or approval history. ──
$router->get('/api/patrol-points/competitions/:id/presentation', function ($params) {
    $user = requireAuth();
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if ($user['portal_role'] === 'parent') {
        if ($c['visibility'] !== 'parents') jsonResponse(['error' => 'This leaderboard is not shared.'], 403);
    } elseif (!isLeaderRole($user['portal_role'])) {
        jsonResponse(['error' => 'Not permitted.'], 403);
    }
    // Latest effective award: team + points only (no reason/comment, no person) - AC24-10.
    $latest = dbGet("SELECT id FROM pp_submissions WHERE competition_id = ? AND status = 'approved' AND superseded_by IS NULL AND withdrawn = 0 ORDER BY COALESCE(decided_at, created_at) DESC, id DESC LIMIT 1", [$c['id']]);
    $latestAward = null;
    if ($latest) {
        $line = dbGet('SELECT l.points, t.name FROM pp_score_lines l JOIN pp_teams t ON t.id = l.team_id WHERE l.submission_id = ? ORDER BY l.id LIMIT 1', [$latest['id']]);
        if ($line) $latestAward = ['teamName' => $line['name'], 'points' => (int) $line['points']];
    }
    jsonResponse([
        'name' => $c['name'],
        'status' => $c['status'],
        'statusLabel' => PP_STATUSES[$c['status']] ?? $c['status'],
        'final' => in_array($c['status'], ['completed', 'archived'], true),
        'leaderboard' => ppLeaderboard((int) $c['id']),
        'latestAward' => $latestAward,
    ]);
});

// ── Delete (draft only) ─────────────────────────────────────────────────────────
$router->delete('/api/patrol-points/competitions/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot delete competitions.'], 403);
    if ($c['status'] !== 'draft') jsonResponse(['error' => 'Only a draft competition can be deleted.'], 409);
    dbRun('DELETE FROM pp_competitions WHERE id = ?', [$c['id']]);
    jsonResponse(['ok' => true]);
});

// ── Access & approvals (FRD PP2.4 s5). Requires the Manage access capability. ────
$router->get('/api/patrol-points/competitions/:id/access', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if (!ppHasCapability($user, $c, 'manage_access')) jsonResponse(['error' => 'You do not have permission to manage access for this competition.'], 403);
    jsonResponse(ppAccessPayload($c));
});

$router->put('/api/patrol-points/competitions/:id/access', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if (!ppHasCapability($user, $c, 'manage_access')) jsonResponse(['error' => 'You do not have permission to manage access for this competition.'], 403);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'A completed competition can no longer be changed.'], 409);
    $b = requestBody();
    $mode = in_array($b['approvalMode'] ?? $c['approval_mode'], ['immediate', 'approval'], true) ? ($b['approvalMode'] ?? $c['approval_mode']) : $c['approval_mode'];
    $dedApp = array_key_exists('deductionsRequireApproval', $b) ? (!empty($b['deductionsRequireApproval']) ? 1 : 0) : (int) $c['deductions_require_approval'];
    $largeThr = array_key_exists('largeValueThreshold', $b)
        ? (is_numeric($b['largeValueThreshold']) ? (int) $b['largeValueThreshold'] : null)
        : ($c['large_value_threshold'] !== null ? (int) $c['large_value_threshold'] : null);
    $assignments = is_array($b['assignments'] ?? null) ? $b['assignments'] : null;

    // Enabling the capability model but naming no one who can submit would lock scoring.
    if ($assignments !== null && count($assignments) > 0) {
        $hasScorer = false;
        foreach ($assignments as $a) if (in_array($a['capability'] ?? '', ['submit', 'score_direct'], true)) { $hasScorer = true; break; }
        if (!$hasScorer) jsonResponse(['error' => 'Add at least one person or role who can submit or score, otherwise no one could enter scores.'], 422);
    }

    db()->beginTransaction();
    dbRun("UPDATE pp_competitions SET approval_mode = ?, deductions_require_approval = ?, large_value_threshold = ?, uses_capability_model = 1, updated_at = datetime('now') WHERE id = ?", [$mode, $dedApp, $largeThr, $c['id']]);
    if ($assignments !== null) {
        dbRun('DELETE FROM pp_access_assignments WHERE competition_id = ?', [$c['id']]);
        foreach ($assignments as $a) ppInsertAssignment((int) $c['id'], is_array($a) ? $a : [], (int) $user['id']);
    }
    // Coverage is validated against the just-written rows (same connection sees them).
    $fresh = dbGet('SELECT * FROM pp_competitions WHERE id = ?', [$c['id']]);
    $cov = ppApprovalCoverageError($fresh);
    if ($cov !== null) {
        db()->rollBack();
        jsonResponse(['error' => $cov, 'code' => 'no_approver'], 422);
    }
    db()->commit();
    logAudit(['userId' => $user['id'], 'action' => 'pp_access_changed', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp(), 'details' => ['approvalMode' => $mode, 'assignments' => $assignments !== null ? count($assignments) : null]]);
    jsonResponse(ppAccessPayload($fresh));
});

// ── Teams ───────────────────────────────────────────────────────────────────────
function ppRequireEditableComp(array $user, $id): array
{
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot configure competitions.'], 403);
    $c = ppCompetitionOr404($id);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'A completed competition can no longer be changed.'], 409);
    return $c;
}

// Validate/resolve submitted score lines against a category (fixed categories use
// the fixed value). Returns [teamId => points]; sends a 422 and exits on error.
function ppCleanLines(array $cat, array $comp, $lines): array
{
    $lines = is_array($lines) ? $lines : [];
    $allowDeductions = !empty($comp['allow_deductions']);
    $validTeams = [];
    foreach (dbAll('SELECT id FROM pp_teams WHERE competition_id = ?', [$comp['id']]) as $t) $validTeams[(int) $t['id']] = true;
    $clean = [];
    foreach ($lines as $ln) {
        $tid = (int) ($ln['teamId'] ?? 0);
        if (!isset($validTeams[$tid])) continue;
        $pts = $cat['points_type'] === 'fixed' ? (int) $cat['fixed_points'] : (is_numeric($ln['points'] ?? null) ? (int) $ln['points'] : null);
        if ($pts === null) jsonResponse(['error' => 'Enter a points value for each selected team.'], 422);
        if ($pts < 0 && !$allowDeductions) jsonResponse(['error' => 'Deductions are turned off for this competition.'], 422);
        $clean[$tid] = $pts;
    }
    if (!$clean) jsonResponse(['error' => 'Select at least one team to score.'], 422);
    return $clean;
}
$router->post('/api/patrol-points/competitions/:id/teams', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $name = trim((string) (requestBody()['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A team name is required.'], 422);
    $next = (int) dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pp_teams WHERE competition_id = ?', [$c['id']])['n'];
    dbRun('INSERT INTO pp_teams (competition_id, name, sort_order) VALUES (?, ?, ?)', [$c['id'], $name, $next]);
    jsonResponse(['ok' => true], 201);
});
$router->patch('/api/patrol-points/competitions/:id/teams/:tid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $name = trim((string) (requestBody()['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A team name is required.'], 422);
    dbRun('UPDATE pp_teams SET name = ? WHERE id = ? AND competition_id = ?', [$name, (int) $params['tid'], $c['id']]);
    jsonResponse(['ok' => true]);
});
$router->delete('/api/patrol-points/competitions/:id/teams/:tid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    if (dbGet('SELECT 1 FROM pp_score_lines l JOIN pp_submissions s ON s.id = l.submission_id WHERE l.team_id = ? AND s.competition_id = ? LIMIT 1', [(int) $params['tid'], $c['id']])) {
        jsonResponse(['error' => 'This team already has scores and cannot be removed.'], 409);
    }
    if (dbGet('SELECT 1 FROM pp_participants WHERE team_id = ? LIMIT 1', [(int) $params['tid']])) {
        jsonResponse(['error' => 'Remove this team\'s members before deleting it.'], 409);
    }
    dbRun('DELETE FROM pp_teams WHERE id = ? AND competition_id = ?', [(int) $params['tid'], $c['id']]);
    jsonResponse(['ok' => true]);
});

// ── Participants (team membership) ───────────────────────────────────────────────
// OSM roster for a section the leader leads, annotated with who is already in.
$router->get('/api/patrol-points/competitions/:id/roster', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    $sectionId = (string) queryParam('sectionId');
    if ($sectionId === '') jsonResponse(['error' => 'Choose a section.'], 422);
    if (!array_filter(ppSectionsForUser($user), fn($s) => $s['id'] === $sectionId)) jsonResponse(['error' => 'That is not one of your sections.'], 403);
    $roster = osmSectionRoster($user, $sectionId);
    if (empty($roster['ok'])) jsonResponse(['error' => $roster['error'] ?? 'Could not load the OSM roster.', 'blocked' => !empty($roster['blocked'])], 502);
    $inComp = [];
    foreach (dbAll('SELECT person_ref FROM pp_participants WHERE competition_id = ? AND person_ref IS NOT NULL', [$c['id']]) as $p) $inComp[(string) $p['person_ref']] = true;
    $members = array_map(fn($m) => [
        'id' => (string) $m['id'], 'name' => $m['name'], 'patrol' => $m['patrol'] ?? null,
        'alreadyIn' => isset($inComp[(string) $m['id']]),
    ], $roster['members']);
    jsonResponse(['source' => $roster['source'], 'members' => $members]);
});

// Add participant(s): a batch of OSM members, or a single manual entry.
$router->post('/api/patrol-points/competitions/:id/participants', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $b = requestBody();
    $team = dbGet('SELECT * FROM pp_teams WHERE id = ? AND competition_id = ?', [(int) ($b['teamId'] ?? 0), $c['id']]);
    if (!$team) jsonResponse(['error' => 'Choose a valid team.'], 422);
    // Who is already in this competition (any team), to enforce one team per person.
    $inComp = [];
    foreach (dbAll('SELECT person_ref FROM pp_participants WHERE competition_id = ? AND person_ref IS NOT NULL', [$c['id']]) as $p) $inComp[(string) $p['person_ref']] = true;

    $added = 0; $skipped = 0;
    if (is_array($b['members'] ?? null)) {
        foreach ($b['members'] as $m) {
            $ref = trim((string) ($m['personRef'] ?? ''));
            $name = trim((string) ($m['displayName'] ?? ''));
            if ($ref === '' || $name === '') { $skipped++; continue; }
            if (isset($inComp[$ref])) { $skipped++; continue; } // already in this competition
            dbRun('INSERT INTO pp_participants (competition_id, team_id, person_ref, display_name, source, patrol) VALUES (?, ?, ?, ?, \'osm\', ?)', [$c['id'], $team['id'], $ref, $name, trim((string) ($m['patrol'] ?? '')) ?: null]);
            $inComp[$ref] = true; $added++;
        }
    } else {
        $name = trim((string) ($b['displayName'] ?? ''));
        if ($name === '') jsonResponse(['error' => 'A participant name is required.'], 422);
        dbRun('INSERT INTO pp_participants (competition_id, team_id, display_name, source) VALUES (?, ?, ?, \'manual\')', [$c['id'], $team['id'], $name]);
        $added = 1;
    }
    jsonResponse(['ok' => true, 'added' => $added, 'skipped' => $skipped], 201);
});

// Move a participant to another team (still one team per person).
$router->patch('/api/patrol-points/competitions/:id/participants/:pid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $team = dbGet('SELECT * FROM pp_teams WHERE id = ? AND competition_id = ?', [(int) (requestBody()['teamId'] ?? 0), $c['id']]);
    if (!$team) jsonResponse(['error' => 'Choose a valid team.'], 422);
    dbRun('UPDATE pp_participants SET team_id = ? WHERE id = ? AND competition_id = ?', [$team['id'], (int) $params['pid'], $c['id']]);
    jsonResponse(['ok' => true]);
});

$router->delete('/api/patrol-points/competitions/:id/participants/:pid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    dbRun('DELETE FROM pp_participants WHERE id = ? AND competition_id = ?', [(int) $params['pid'], $c['id']]);
    jsonResponse(['ok' => true]);
});

// Auto-generate balanced teams from a section roster (editable + confirmed after).
$router->post('/api/patrol-points/competitions/:id/auto-teams', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $b = requestBody();
    $sectionId = (string) ($b['sectionId'] ?? '');
    $count = max(2, min(12, (int) ($b['teamCount'] ?? 0)));
    if (!array_filter(ppSectionsForUser($user), fn($s) => $s['id'] === $sectionId)) jsonResponse(['error' => 'That is not one of your sections.'], 403);
    $roster = osmSectionRoster($user, $sectionId);
    if (empty($roster['ok'])) jsonResponse(['error' => $roster['error'] ?? 'Could not load the OSM roster.'], 502);
    // Only members not already in the competition.
    $inComp = [];
    foreach (dbAll('SELECT person_ref FROM pp_participants WHERE competition_id = ? AND person_ref IS NOT NULL', [$c['id']]) as $p) $inComp[(string) $p['person_ref']] = true;
    $pool = array_values(array_filter($roster['members'], fn($m) => !isset($inComp[(string) $m['id']])));
    if (!$pool) jsonResponse(['error' => 'No new members to place — everyone is already in the competition.'], 422);

    // Create the teams, then round-robin the pool for balanced sizes.
    $teamIds = [];
    for ($i = 1; $i <= $count; $i++) {
        $res = dbRun('INSERT INTO pp_teams (competition_id, name, sort_order) VALUES (?, ?, ?)', [$c['id'], 'Team ' . $i, $i]);
        $teamIds[] = (int) $res['lastInsertId'];
    }
    $assigned = 0;
    foreach ($pool as $idx => $m) {
        $tid = $teamIds[$idx % $count];
        dbRun('INSERT INTO pp_participants (competition_id, team_id, person_ref, display_name, source, patrol) VALUES (?, ?, ?, ?, \'osm\', ?)', [$c['id'], $tid, (string) $m['id'], $m['name'], $m['patrol'] ?? null]);
        $assigned++;
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_auto_teams', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp(), 'details' => ['teams' => $count, 'assigned' => $assigned]]);
    jsonResponse(['ok' => true, 'teams' => $count, 'assigned' => $assigned], 201);
});

// ── Categories ──────────────────────────────────────────────────────────────────
$router->post('/api/patrol-points/competitions/:id/categories', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A category name is required.'], 422);
    $type = in_array($b['pointsType'] ?? '', ['free', 'fixed'], true) ? $b['pointsType'] : 'free';
    $fixed = null;
    if ($type === 'fixed') {
        if (!isset($b['fixedPoints']) || !is_numeric($b['fixedPoints'])) jsonResponse(['error' => 'A fixed-value category needs a points value.'], 422);
        $fixed = (int) $b['fixedPoints'];
    }
    $next = (int) dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pp_categories WHERE competition_id = ?', [$c['id']])['n'];
    dbRun('INSERT INTO pp_categories (competition_id, name, points_type, fixed_points, point_buttons, reason_presets, requires_approval, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [$c['id'], $name, $type, $fixed, ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), !empty($b['requiresApproval']) ? 1 : 0, $next]);
    jsonResponse(['ok' => true], 201);
});
// Update a category's Quick Score config (point buttons + reason presets).
$router->patch('/api/patrol-points/competitions/:id/categories/:cid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $cat = dbGet('SELECT * FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) $params['cid'], $c['id']]);
    if (!$cat) jsonResponse(['error' => 'Category not found.'], 404);
    $b = requestBody();
    $reqApp = array_key_exists('requiresApproval', $b) ? (!empty($b['requiresApproval']) ? 1 : 0) : (int) $cat['requires_approval'];
    dbRun('UPDATE pp_categories SET point_buttons = ?, reason_presets = ?, requires_approval = ? WHERE id = ?', [ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), $reqApp, $cat['id']]);
    jsonResponse(['ok' => true]);
});
$router->delete('/api/patrol-points/competitions/:id/categories/:cid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    if (dbGet('SELECT 1 FROM pp_submissions WHERE category_id = ? AND competition_id = ? LIMIT 1', [(int) $params['cid'], $c['id']])) {
        jsonResponse(['error' => 'This category already has submissions and cannot be removed.'], 409);
    }
    dbRun('DELETE FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) $params['cid'], $c['id']]);
    jsonResponse(['ok' => true]);
});

// ── Activity / station profiles (FRD v2.4 s13.11) ────────────────────────────────
// Validate an optional team_scope against the competition's teams.
function ppCleanTeamScope(array $c, $scope): ?string
{
    if (!is_array($scope) || !$scope) return null;
    $valid = [];
    foreach (dbAll('SELECT id FROM pp_teams WHERE competition_id = ?', [$c['id']]) as $t) $valid[(int) $t['id']] = true;
    $ids = array_values(array_filter(array_map('intval', $scope), fn($id) => isset($valid[$id])));
    return $ids ? json_encode($ids) : null;
}
$router->post('/api/patrol-points/competitions/:id/activities', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'An activity name is required.'], 422);
    $cat = dbGet('SELECT id FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) ($b['categoryId'] ?? 0), $c['id']]);
    if (!$cat) jsonResponse(['error' => 'Choose a scoring category for the activity.'], 422);
    $next = (int) dbGet('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM pp_activities WHERE competition_id = ?', [$c['id']])['n'];
    dbRun('INSERT INTO pp_activities (competition_id, category_id, name, point_buttons, reason_presets, team_scope, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$c['id'], $cat['id'], $name, ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), ppCleanTeamScope($c, $b['teamScope'] ?? null), $next]);
    jsonResponse(['ok' => true], 201);
});
$router->patch('/api/patrol-points/competitions/:id/activities/:aid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    $a = dbGet('SELECT * FROM pp_activities WHERE id = ? AND competition_id = ?', [(int) $params['aid'], $c['id']]);
    if (!$a) jsonResponse(['error' => 'Activity not found.'], 404);
    $b = requestBody();
    $name = array_key_exists('name', $b) ? (trim((string) $b['name']) ?: $a['name']) : $a['name'];
    $catId = $a['category_id'];
    if (array_key_exists('categoryId', $b)) {
        $cat = dbGet('SELECT id FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) $b['categoryId'], $c['id']]);
        if (!$cat) jsonResponse(['error' => 'Choose a valid scoring category.'], 422);
        $catId = $cat['id'];
    }
    dbRun('UPDATE pp_activities SET name = ?, category_id = ?, point_buttons = ?, reason_presets = ?, team_scope = ? WHERE id = ?',
        [$name, $catId, ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), ppCleanTeamScope($c, $b['teamScope'] ?? null), $a['id']]);
    jsonResponse(['ok' => true]);
});
$router->delete('/api/patrol-points/competitions/:id/activities/:aid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppRequireEditableComp($user, $params['id']);
    dbRun('DELETE FROM pp_activities WHERE id = ? AND competition_id = ?', [(int) $params['aid'], $c['id']]);
    jsonResponse(['ok' => true]);
});

// ── Guest Quick Entry links (managers; FRD v2.4 s13.8) ───────────────────────────
$router->post('/api/patrol-points/competitions/:id/guest-links', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot create guest links.'], 403);
    if (!ppGuestEnabled()) jsonResponse(['error' => 'Guest Quick Entry is disabled for the group.'], 403);
    $c = ppCompetitionOr404($params['id']);
    if ($c['approval_mode'] !== 'approval') jsonResponse(['error' => 'Guest entry needs the competition in approval mode, so every guest score is reviewed.'], 409);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'This competition can no longer be changed.'], 409);
    $b = requestBody();
    $act = dbGet('SELECT * FROM pp_activities WHERE id = ? AND competition_id = ?', [(int) ($b['activityId'] ?? 0), $c['id']]);
    if (!$act) jsonResponse(['error' => 'Choose an activity profile for the guest link.'], 422);
    $pinHash = null;
    if (!empty($b['pin'])) { $pin = preg_replace('/\D/', '', (string) $b['pin']); if (strlen($pin) >= 4) $pinHash = password_hash($pin, PASSWORD_DEFAULT); }
    $expires = null;
    if (!empty($b['expiresInDays']) && is_numeric($b['expiresInDays'])) { $d = max(1, min(120, (int) $b['expiresInDays'])); $expires = gmdate('Y-m-d H:i:s', time() + $d * 86400); }
    $token = bin2hex(random_bytes(24));
    $res = dbRun('INSERT INTO pp_guest_links (competition_id, activity_id, token, label, pin_hash, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$c['id'], $act['id'], $token, trim((string) ($b['label'] ?? '')) ?: null, $pinHash, $expires, $user['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_guest_link_create', 'entityType' => 'pp_guest_link', 'entityId' => (string) $res['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['activity' => (int) $act['id']]]);
    jsonResponse(serializeGuestLink(dbGet('SELECT * FROM pp_guest_links WHERE id = ?', [(int) $res['lastInsertId']]), $act), 201);
});
$router->post('/api/patrol-points/competitions/:id/guest-links/:lid/revoke', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot manage guest links.'], 403);
    $link = dbGet('SELECT * FROM pp_guest_links WHERE id = ? AND competition_id = ?', [(int) $params['lid'], (int) $params['id']]);
    if (!$link) jsonResponse(['error' => 'Guest link not found.'], 404);
    dbRun("UPDATE pp_guest_links SET status = 'revoked' WHERE id = ?", [$link['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_guest_link_revoke', 'entityType' => 'pp_guest_link', 'entityId' => (string) $link['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Public guest scoring (NO LOGIN). Everything is validated server-side against
// the link's activity profile; guest scores are always pending. ──────────────────
function ppGuestResolve(string $token): array
{
    if (!patrolPointsEnabled() || !ppGuestEnabled()) jsonResponse(['error' => 'Guest entry is not available.'], 404);
    $link = dbGet('SELECT * FROM pp_guest_links WHERE token = ?', [$token]);
    if (!$link || !ppGuestLinkActive($link)) jsonResponse(['error' => 'This guest link is not active.'], 410);
    $c = dbGet('SELECT * FROM pp_competitions WHERE id = ?', [$link['competition_id']]);
    if (!$c || $c['status'] !== 'open' || $c['approval_mode'] !== 'approval') jsonResponse(['error' => 'This competition is not accepting guest scores right now.'], 409);
    $a = dbGet('SELECT * FROM pp_activities WHERE id = ?', [$link['activity_id']]);
    if (!$a) jsonResponse(['error' => 'This guest link is no longer valid.'], 410);
    $prof = serializePpActivity($a, dbGet('SELECT * FROM pp_categories WHERE id = ?', [$a['category_id']]), (bool) $c['allow_deductions']);
    return [$link, $c, $a, $prof];
}
function ppGuestTeams(array $c, array $prof): array
{
    if ($prof['teamScope']) {
        $ph = implode(',', array_fill(0, count($prof['teamScope']), '?'));
        return dbAll("SELECT id, name FROM pp_teams WHERE competition_id = ? AND id IN ($ph) ORDER BY sort_order, name", array_merge([$c['id']], $prof['teamScope']));
    }
    return dbAll('SELECT id, name FROM pp_teams WHERE competition_id = ? ORDER BY sort_order, name', [$c['id']]);
}
// Minimal, safe scope for the guest screen. No young-person or member data.
$router->get('/api/guest/patrol/:token', function ($params) {
    [$link, $c, $a, $prof] = ppGuestResolve($params['token']);
    jsonResponse([
        'competition' => $c['name'], 'activity' => $a['name'], 'pinRequired' => !empty($link['pin_hash']),
        'teams' => array_map(fn($t) => ['id' => (int) $t['id'], 'name' => $t['name']], ppGuestTeams($c, $prof)),
        'pointButtons' => $prof['pointButtons'], 'reasonPresets' => $prof['reasonPresets'],
    ]);
});
$router->post('/api/guest/patrol/:token/submit', function ($params) {
    [$link, $c, $a, $prof] = ppGuestResolve($params['token']);
    $b = requestBody();
    if (!empty($link['pin_hash'])) {
        $pin = preg_replace('/\D/', '', (string) ($b['pin'] ?? ''));
        if ($pin === '' || !password_verify($pin, $link['pin_hash'])) jsonResponse(['error' => 'Incorrect PIN.'], 403);
    }
    $scorer = mb_substr(trim((string) ($b['scorerName'] ?? '')), 0, 60);
    if ($scorer === '') jsonResponse(['error' => 'Enter your name.'], 422);
    $allowed = array_map(fn($t) => (int) $t['id'], ppGuestTeams($c, $prof));
    $teamId = (int) ($b['teamId'] ?? 0);
    if (!in_array($teamId, $allowed, true)) jsonResponse(['error' => 'Choose a valid team.'], 422);
    $points = is_numeric($b['points'] ?? null) ? (int) $b['points'] : null;
    if ($points === null || !in_array($points, $prof['pointButtons'], true)) jsonResponse(['error' => 'Choose a valid points value.'], 422);
    $reason = mb_substr(trim((string) ($b['reason'] ?? '')), 0, 200);
    if ($reason === '') jsonResponse(['error' => 'Choose a reason.'], 422);
    // Rate limit: at most 30 guest scores per link per minute.
    if ((int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE guest_link_id = ? AND created_at >= datetime('now','-60 seconds')", [$link['id']])['n'] >= 30) {
        jsonResponse(['error' => 'Too many submissions just now — please wait a moment.'], 429);
    }
    // Duplicate within 15s -> idempotent success (double-tap / retry safe).
    $dup = dbGet("SELECT s.id FROM pp_submissions s JOIN pp_score_lines l ON l.submission_id = s.id
        WHERE s.guest_link_id = ? AND s.guest_name = ? AND l.team_id = ? AND l.points = ? AND s.comment = ? AND s.created_at >= datetime('now','-15 seconds') LIMIT 1",
        [$link['id'], $scorer, $teamId, $points, $reason]);
    if ($dup) jsonResponse(['ok' => true, 'status' => 'pending', 'duplicate' => true], 200);
    $gid = ppGuestUserId();
    $res = dbRun("INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status, guest_link_id, guest_name) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        [$c['id'], $a['category_id'], $gid, $reason, $link['id'], $scorer]);
    $sid = (int) $res['lastInsertId'];
    dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$sid, $teamId, $points]);
    logAudit(['userId' => $gid, 'action' => 'pp_guest_submit', 'entityType' => 'pp_submission', 'entityId' => (string) $sid, 'ipAddress' => clientIp(), 'details' => ['link' => (int) $link['id'], 'scorer' => $scorer]]);
    ppNotifyApprovers($gid, 'Guest score to approve: ' . $c['name'], $scorer . ' (guest) submitted a score in "' . $a['name'] . '".', 'patrol-point.html?id=' . $c['id']);
    jsonResponse(['ok' => true, 'status' => 'pending'], 201);
});

// ── Score submissions ───────────────────────────────────────────────────────────
$router->post('/api/patrol-points/competitions/:id/submissions', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if ($c['status'] !== 'open') jsonResponse(['error' => 'Scores can only be submitted while the competition is open.'], 409);
    if (!ppHasCapability($user, $c, 'submit') && !ppHasCapability($user, $c, 'score_direct')) jsonResponse(['error' => 'You do not have permission to submit scores in this competition.'], 403);
    $b = requestBody();
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'A comment is required for every score submission.'], 422);
    $cat = dbGet('SELECT * FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) ($b['categoryId'] ?? 0), $c['id']]);
    if (!$cat) jsonResponse(['error' => 'Choose a valid scoring category.'], 422);
    $clean = ppCleanLines($cat, $c, $b['lines'] ?? []);

    // Score disposition (FRD PP2.4 s4.1): the rule order decides effective vs pending.
    $disp = ppScoreDisposition($c, $user, $cat, array_values($clean));
    if ($disp['status'] === 'prohibited') jsonResponse(['error' => 'You do not have permission to submit scores in this competition.'], 403);
    $status = $disp['status'];
    $res = dbRun('INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status, disposition_reason) VALUES (?, ?, ?, ?, ?, ?)', [$c['id'], $cat['id'], $user['id'], $comment, $status, $disp['reason']]);
    $sid = (int) $res['lastInsertId'];
    foreach ($clean as $tid => $pts) dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$sid, $tid, $pts]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_create', 'entityType' => 'pp_submission', 'entityId' => (string) $sid, 'ipAddress' => clientIp(), 'details' => ['status' => $status, 'reason' => $disp['reason']]]);
    // Notify approvers when the score needs approval (PP-NOT-001).
    if ($status === 'pending') {
        $who = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: 'A leader';
        ppNotifyApprovers((int) $user['id'], 'Score to approve: ' . $c['name'], $who . ' submitted scores in "' . $cat['name'] . '" for approval.', 'patrol-point.html?id=' . $c['id']);
    }
    jsonResponse(['ok' => true, 'id' => $sid, 'status' => $status, 'reason' => $disp['reason']], 201);
});

// ── Approve / reject / return a pending submission (atomic) ──────────────────────
function ppDecide(string $action, string $newStatus, $params): void
{
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $s = dbGet('SELECT * FROM pp_submissions WHERE id = ?', [(int) $params['sid']]);
    if (!$s || (int) $s['competition_id'] !== (int) $params['id']) jsonResponse(['error' => 'Submission not found.'], 404);
    if ($s['status'] !== 'pending') jsonResponse(['error' => 'This submission has already been decided.'], 409);
    if (!ppCanApprove($user, $s)) jsonResponse(['error' => 'You cannot approve your own submission.'], 403);
    $comment = trim((string) (requestBody()['comment'] ?? '')) ?: null;
    if (in_array($action, ['reject', 'return'], true) && !$comment) jsonResponse(['error' => 'A comment is required to reject or return a submission.'], 422);
    dbRun("UPDATE pp_submissions SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_comment = ? WHERE id = ?", [$newStatus, $user['id'], $comment, $s['id']]);
    // Approving a revision supersedes the original it corrects, so the original's
    // score stops counting and the revision's values take over (PP-APR-007, BR-09).
    if ($action === 'approve' && $s['revises_id']) {
        dbRun('UPDATE pp_submissions SET superseded_by = ? WHERE id = ?', [$s['id'], (int) $s['revises_id']]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_' . $action, 'entityType' => 'pp_submission', 'entityId' => (string) $s['id'], 'ipAddress' => clientIp()]);
    // Notify the submitter of the outcome (PP-NOT-002).
    $compName = dbGet('SELECT name FROM pp_competitions WHERE id = ?', [$s['competition_id']])['name'] ?? 'a competition';
    $outcome = ['approve' => 'approved', 'reject' => 'rejected', 'return' => 'returned for amendment'][$action] ?? $action;
    notify((int) $s['submitted_by'], 'patrol_points', 'Score ' . $outcome, 'Your score submission in "' . $compName . '" was ' . $outcome . '.' . ($comment ? ' Comment: ' . $comment : ''), 'patrol-point.html?id=' . $s['competition_id']);
    jsonResponse(['ok' => true]);
}
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/approve', fn($p) => ppDecide('approve', 'approved', $p));
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/reject', fn($p) => ppDecide('reject', 'rejected', $p));
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/return', fn($p) => ppDecide('return', 'returned', $p));

// ── Withdraw / amend a pending-or-returned submission (submitter only) ───────────
function ppOwnOpenSubmission(array $user, $params): array
{
    $s = dbGet('SELECT * FROM pp_submissions WHERE id = ? AND competition_id = ?', [(int) $params['sid'], (int) $params['id']]);
    if (!$s) jsonResponse(['error' => 'Submission not found.'], 404);
    if ((int) $s['submitted_by'] !== (int) $user['id']) jsonResponse(['error' => 'Only the submitter can change this submission.'], 403);
    if (!empty($s['withdrawn']) || !in_array($s['status'], ['pending', 'returned'], true)) jsonResponse(['error' => 'Only a pending or returned submission can be changed.'], 409);
    return $s;
}
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/withdraw', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $s = ppOwnOpenSubmission($user, $params);
    dbRun('UPDATE pp_submissions SET withdrawn = 1 WHERE id = ?', [$s['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_withdraw', 'entityType' => 'pp_submission', 'entityId' => (string) $s['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
$router->patch('/api/patrol-points/competitions/:id/submissions/:sid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'This competition can no longer be changed.'], 409);
    $s = ppOwnOpenSubmission($user, $params);
    $b = requestBody();
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'A comment is required.'], 422);
    $cat = dbGet('SELECT * FROM pp_categories WHERE id = ?', [$s['category_id']]);
    $clean = ppCleanLines($cat, $c, $b['lines'] ?? []);
    dbRun('DELETE FROM pp_score_lines WHERE submission_id = ?', [$s['id']]);
    foreach ($clean as $tid => $pts) dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$s['id'], $tid, $pts]);
    // Amending sends it back to the approver (or keeps it pending) for a fresh decision.
    dbRun("UPDATE pp_submissions SET comment = ?, status = 'pending', decided_by = NULL, decided_at = NULL, decision_comment = NULL WHERE id = ?", [$comment, $s['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_amend', 'entityType' => 'pp_submission', 'entityId' => (string) $s['id'], 'ipAddress' => clientIp()]);
    $who = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: 'A leader';
    ppNotifyApprovers((int) $user['id'], 'Score to approve: ' . $c['name'], $who . ' amended a score in "' . $cat['name'] . '".', 'patrol-point.html?id=' . $c['id']);
    jsonResponse(['ok' => true]);
});

// ── Propose a correction to an approved score (creates a pending revision) ────────
// ── Reports & exports (server-side, managers only; PP-RPT-001..004, PP-NFR-10) ───
function ppCsv(array $rows): string
{
    $out = fopen('php://temp', 'r+');
    foreach ($rows as $r) fputcsv($out, $r);
    rewind($out);
    $csv = stream_get_contents($out);
    fclose($out);
    return $csv;
}
function ppSendCsv(string $filenameBase, string $csv): void
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . preg_replace('/[^\w.\-]/', '_', $filenameBase) . '.csv"');
    echo "\xEF\xBB\xBF" . $csv; // BOM so Excel reads UTF-8
    exit;
}
// Managers only - operational reports are not exposed to viewers (PP-RPT-002).
function ppRequireReport(array $user, $id): array
{
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'You cannot export Patrol Points reports.'], 403);
    return ppCompetitionOr404($id);
}
function ppExportLookups(array $c): array
{
    $teams = []; foreach (dbAll('SELECT id, name FROM pp_teams WHERE competition_id = ?', [$c['id']]) as $t) $teams[(int) $t['id']] = $t['name'];
    $cats = []; foreach (dbAll('SELECT id, name FROM pp_categories WHERE competition_id = ?', [$c['id']]) as $x) $cats[(int) $x['id']] = $x['name'];
    $users = []; foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $users[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    return [$teams, $cats, $users];
}
function ppSubDisplayStatus(array $s): string
{
    return !empty($s['withdrawn']) ? 'withdrawn' : (!empty($s['superseded_by']) ? 'superseded' : $s['status']);
}

// Points history: one row per team score line, with status + effective flag.
$router->get('/api/patrol-points/competitions/:id/export/points.csv', function ($params) {
    $user = requireAuth();
    $c = ppRequireReport($user, $params['id']);
    [$teams, $cats, $users] = ppExportLookups($c);
    $rows = [['Submission', 'Category', 'Team', 'Points', 'Status', 'Effective', 'Kind', 'Corrects submission', 'Submitter', 'Comment', 'Decided by', 'Decided at', 'Created at']];
    foreach (dbAll('SELECT * FROM pp_submissions WHERE competition_id = ? ORDER BY id', [$c['id']]) as $s) {
        $status = ppSubDisplayStatus($s);
        $effective = ($s['status'] === 'approved' && empty($s['superseded_by']) && empty($s['withdrawn'])) ? 'yes' : 'no';
        foreach (dbAll('SELECT * FROM pp_score_lines WHERE submission_id = ? ORDER BY id', [$s['id']]) as $l) {
            $rows[] = [
                (int) $s['id'], $cats[(int) $s['category_id']] ?? '', $teams[(int) $l['team_id']] ?? '', (int) $l['points'],
                $status, $effective, $s['revises_id'] ? 'correction' : 'original', $s['revises_id'] ?: '',
                $users[(int) $s['submitted_by']] ?? '', $s['comment'],
                $s['decided_by'] ? ($users[(int) $s['decided_by']] ?? '') : '', $s['decided_at'] ?: '', $s['created_at'],
            ];
        }
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_export_points', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp()]);
    ppSendCsv('patrol-points-' . $c['id'] . '-points', ppCsv($rows));
});

// Final result: leaderboard with competition/completion metadata (PP-RPT-004).
$router->get('/api/patrol-points/competitions/:id/export/results.csv', function ($params) {
    $user = requireAuth();
    $c = ppRequireReport($user, $params['id']);
    $rows = [
        ['Competition', $c['name']],
        ['Status', PP_STATUSES[$c['status']] ?? $c['status']],
        ['Completed at', $c['completed_at'] ?: ''],
        ['Exported at', gmdate('Y-m-d H:i') . ' UTC'],
        [],
        ['Position', 'Team', 'Total points'],
    ];
    foreach (ppLeaderboard((int) $c['id']) as $r) $rows[] = [$r['position'], $r['teamName'], $r['total']];
    logAudit(['userId' => $user['id'], 'action' => 'pp_export_results', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp()]);
    ppSendCsv('patrol-points-' . $c['id'] . '-results', ppCsv($rows));
});

// Approval activity: each submission with its decision, actor and timestamps.
$router->get('/api/patrol-points/competitions/:id/export/approvals.csv', function ($params) {
    $user = requireAuth();
    $c = ppRequireReport($user, $params['id']);
    [, $cats, $users] = ppExportLookups($c);
    $rows = [['Submission', 'Category', 'Kind', 'Submitter', 'Status', 'Decided by', 'Decided at', 'Decision comment']];
    foreach (dbAll('SELECT * FROM pp_submissions WHERE competition_id = ? ORDER BY COALESCE(decided_at, created_at), id', [$c['id']]) as $s) {
        $rows[] = [
            (int) $s['id'], $cats[(int) $s['category_id']] ?? '', $s['revises_id'] ? 'correction' : 'original',
            $users[(int) $s['submitted_by']] ?? '', ppSubDisplayStatus($s),
            $s['decided_by'] ? ($users[(int) $s['decided_by']] ?? '') : '', $s['decided_at'] ?: '', $s['decision_comment'] ?: '',
        ];
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_export_approvals', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp()]);
    ppSendCsv('patrol-points-' . $c['id'] . '-approvals', ppCsv($rows));
});

// Usage (RP-01): submission + outcome counts per guest station (no security telemetry).
$router->get('/api/patrol-points/competitions/:id/export/usage.csv', function ($params) {
    $user = requireAuth();
    $c = ppRequireReport($user, $params['id']);
    $labels = [];
    foreach (dbAll('SELECT g.id, g.label, a.name AS activity FROM pp_guest_links g LEFT JOIN pp_activities a ON a.id = g.activity_id WHERE g.competition_id = ?', [$c['id']]) as $g) {
        $labels[(int) $g['id']] = $g['label'] ?: ($g['activity'] ?? ('Guest link #' . $g['id']));
    }
    $stations = [];
    $leader = 0; $guest = 0;
    foreach (dbAll('SELECT * FROM pp_submissions WHERE competition_id = ?', [$c['id']]) as $s) {
        if (empty($s['guest_link_id'])) { $leader++; continue; }
        $guest++;
        $lid = (int) $s['guest_link_id'];
        $stations[$lid] = $stations[$lid] ?? ['total' => 0, 'pending' => 0, 'approved' => 0, 'rejected' => 0, 'returned' => 0, 'superseded' => 0, 'withdrawn' => 0];
        $stations[$lid]['total']++;
        $stations[$lid][ppSubDisplayStatus($s)]++;
    }
    $rows = [['Source', 'Count'], ['Leader-entered', $leader], ['Guest-entered', $guest], [], ['Guest station', 'Submitted', 'Pending', 'Approved', 'Rejected', 'Returned', 'Superseded', 'Withdrawn']];
    foreach ($stations as $lid => $st) {
        $rows[] = [$labels[$lid] ?? ('Guest link #' . $lid), $st['total'], $st['pending'], $st['approved'], $st['rejected'], $st['returned'], $st['superseded'], $st['withdrawn']];
    }
    logAudit(['userId' => $user['id'], 'action' => 'pp_export_usage', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp()]);
    ppSendCsv('patrol-points-' . $c['id'] . '-usage', ppCsv($rows));
});

$router->post('/api/patrol-points/competitions/:id/submissions/:sid/revise', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    $c = ppCompetitionOr404($params['id']);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'This competition can no longer be changed.'], 409);
    $orig = dbGet('SELECT * FROM pp_submissions WHERE id = ? AND competition_id = ?', [(int) $params['sid'], (int) $c['id']]);
    if (!$orig) jsonResponse(['error' => 'Submission not found.'], 404);
    // A correction may be proposed by a manager or by the scorer correcting their own score.
    if (!ppCanManage($user) && (int) $orig['submitted_by'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot propose a correction to this score.'], 403);
    if ($orig['status'] !== 'approved' || !empty($orig['superseded_by']) || !empty($orig['withdrawn'])) jsonResponse(['error' => 'Only an effective approved score can be corrected.'], 409);
    if (dbGet("SELECT 1 FROM pp_submissions WHERE revises_id = ? AND status = 'pending' AND withdrawn = 0 LIMIT 1", [$orig['id']])) jsonResponse(['error' => 'A correction is already pending for this score.'], 409);
    $b = requestBody();
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'A comment explaining the correction is required.'], 422);
    $cat = dbGet('SELECT * FROM pp_categories WHERE id = ?', [$orig['category_id']]);
    $clean = ppCleanLines($cat, $c, $b['lines'] ?? []);
    // Corrections always require approval, regardless of the competition mode (PP-APR-007).
    $res = dbRun("INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status, revises_id) VALUES (?, ?, ?, ?, 'pending', ?)", [$c['id'], $orig['category_id'], $user['id'], $comment, $orig['id']]);
    $sid = (int) $res['lastInsertId'];
    foreach ($clean as $tid => $pts) dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$sid, $tid, $pts]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_revise', 'entityType' => 'pp_submission', 'entityId' => (string) $sid, 'ipAddress' => clientIp(), 'details' => ['revises' => (int) $orig['id']]]);
    $who = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: 'A leader';
    ppNotifyApprovers((int) $user['id'], 'Correction to approve: ' . $c['name'], $who . ' proposed a correction to a score in "' . $cat['name'] . '".', 'patrol-point.html?id=' . $c['id']);
    jsonResponse(['ok' => true], 201);
});
