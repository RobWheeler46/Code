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
        'meta' => ['statuses' => PP_STATUSES, 'approvalModes' => PP_APPROVAL_MODES, 'pointsTypes' => PP_POINTS_TYPES],
    ]);
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
    $submissions = array_map(fn($s) => serializePpSubmission($s, $linesBySub[(int) $s['id']] ?? [], $teamNames, $catNames, $userNames), $subs);

    $participants = array_map('serializePpParticipant', dbAll('SELECT * FROM pp_participants WHERE competition_id = ? ORDER BY display_name', [$c['id']]));

    jsonResponse([
        'competition' => serializePpCompetition($c, true),
        'teams' => array_map('serializePpTeam', $teams),
        'categories' => array_map(fn($x) => serializePpCategory($x, (bool) $c['allow_deductions']), $cats),
        'participants' => $participants,
        'submissions' => $submissions,
        'leaderboard' => ppLeaderboard((int) $c['id']),
        'myActions' => [
            'canManage' => ppCanManage($user),
            'canSubmit' => ppCanManage($user) && $c['status'] === 'open' && $teams && $cats,
            'isCreator' => (int) $c['created_by'] === (int) $user['id'],
            'userId' => (int) $user['id'],
        ],
        'meta' => ['statuses' => PP_STATUSES, 'approvalModes' => PP_APPROVAL_MODES, 'pointsTypes' => PP_POINTS_TYPES, 'transitions' => PP_TRANSITIONS, 'sections' => ppSectionsForUser($user)],
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
    dbRun("UPDATE pp_competitions SET name = ?, description = ?, approval_mode = ?, allow_deductions = ?, updated_at = datetime('now') WHERE id = ?", [$name, $desc, $mode, $allowDed, $c['id']]);
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
    if ($to === 'completed') {
        $pending = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending' AND withdrawn = 0", [$c['id']])['n'];
        if ($pending > 0) jsonResponse(['error' => "Resolve the $pending pending submission(s) before completing."], 409);
    }
    $completedAt = $to === 'completed' ? "datetime('now')" : 'completed_at';
    dbRun("UPDATE pp_competitions SET status = ?, completed_at = $completedAt, updated_at = datetime('now') WHERE id = ?", [$to, $c['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_competition_status', 'entityType' => 'pp_competition', 'entityId' => (string) $c['id'], 'ipAddress' => clientIp(), 'details' => ['to' => $to]]);
    jsonResponse(serializePpCompetition(ppCompetitionOr404($c['id']), true));
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
    dbRun('INSERT INTO pp_categories (competition_id, name, points_type, fixed_points, point_buttons, reason_presets, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)', [$c['id'], $name, $type, $fixed, ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), $next]);
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
    dbRun('UPDATE pp_categories SET point_buttons = ?, reason_presets = ? WHERE id = ?', [ppParseButtons($b['pointButtons'] ?? null), ppParseReasons($b['reasonPresets'] ?? null), $cat['id']]);
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

// ── Score submissions ───────────────────────────────────────────────────────────
$router->post('/api/patrol-points/competitions/:id/submissions', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot submit scores.'], 403);
    $c = ppCompetitionOr404($params['id']);
    if ($c['status'] !== 'open') jsonResponse(['error' => 'Scores can only be submitted while the competition is open.'], 409);
    $b = requestBody();
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'A comment is required for every score submission.'], 422);
    $cat = dbGet('SELECT * FROM pp_categories WHERE id = ? AND competition_id = ?', [(int) ($b['categoryId'] ?? 0), $c['id']]);
    if (!$cat) jsonResponse(['error' => 'Choose a valid scoring category.'], 422);
    $clean = ppCleanLines($cat, $c, $b['lines'] ?? []);

    $status = $c['approval_mode'] === 'approval' ? 'pending' : 'approved';
    $res = dbRun('INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status) VALUES (?, ?, ?, ?, ?)', [$c['id'], $cat['id'], $user['id'], $comment, $status]);
    $sid = (int) $res['lastInsertId'];
    foreach ($clean as $tid => $pts) dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$sid, $tid, $pts]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_create', 'entityType' => 'pp_submission', 'entityId' => (string) $sid, 'ipAddress' => clientIp(), 'details' => ['status' => $status]]);
    // Notify approvers when the score needs approval (PP-NOT-001).
    if ($status === 'pending') {
        $who = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: 'A leader';
        ppNotifyApprovers((int) $user['id'], 'Score to approve: ' . $c['name'], $who . ' submitted scores in "' . $cat['name'] . '" for approval.', 'patrol-point.html?id=' . $c['id']);
    }
    jsonResponse(['ok' => true, 'status' => $status], 201);
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

$router->post('/api/patrol-points/competitions/:id/submissions/:sid/revise', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requirePatrolPointsEnabled();
    if (!ppCanManage($user)) jsonResponse(['error' => 'Your role cannot propose corrections.'], 403);
    $c = ppCompetitionOr404($params['id']);
    if (in_array($c['status'], ['completed', 'archived'], true)) jsonResponse(['error' => 'This competition can no longer be changed.'], 409);
    $orig = dbGet('SELECT * FROM pp_submissions WHERE id = ? AND competition_id = ?', [(int) $params['sid'], (int) $c['id']]);
    if (!$orig) jsonResponse(['error' => 'Submission not found.'], 404);
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
