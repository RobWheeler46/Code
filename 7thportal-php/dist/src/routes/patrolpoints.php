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
        "INSERT INTO pp_competitions (name, description, approval_mode, visibility, osm_section_id, section_name, created_by)
         VALUES (?, ?, ?, 'leaders', ?, ?, ?)",
        [$name, trim((string) ($b['description'] ?? '')) ?: null, $mode, $b['sectionId'] ?? null, trim((string) ($b['sectionName'] ?? '')) ?: null, $user['id']]
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

    jsonResponse([
        'competition' => serializePpCompetition($c, true),
        'teams' => array_map('serializePpTeam', $teams),
        'categories' => array_map('serializePpCategory', $cats),
        'submissions' => $submissions,
        'leaderboard' => ppLeaderboard((int) $c['id']),
        'myActions' => [
            'canManage' => ppCanManage($user),
            'canSubmit' => ppCanManage($user) && $c['status'] === 'open' && $teams && $cats,
            'isCreator' => (int) $c['created_by'] === (int) $user['id'],
            'userId' => (int) $user['id'],
        ],
        'meta' => ['statuses' => PP_STATUSES, 'approvalModes' => PP_APPROVAL_MODES, 'pointsTypes' => PP_POINTS_TYPES, 'transitions' => PP_TRANSITIONS],
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
    dbRun("UPDATE pp_competitions SET name = ?, description = ?, approval_mode = ?, updated_at = datetime('now') WHERE id = ?", [$name, $desc, $mode, $c['id']]);
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
        $pending = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending'", [$c['id']])['n'];
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
    dbRun('DELETE FROM pp_teams WHERE id = ? AND competition_id = ?', [(int) $params['tid'], $c['id']]);
    jsonResponse(['ok' => true]);
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
    dbRun('INSERT INTO pp_categories (competition_id, name, points_type, fixed_points, sort_order) VALUES (?, ?, ?, ?, ?)', [$c['id'], $name, $type, $fixed, $next]);
    jsonResponse(['ok' => true], 201);
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
    $lines = is_array($b['lines'] ?? null) ? $b['lines'] : [];
    // Validate team ids and resolve points (fixed categories use the fixed value).
    $validTeams = [];
    foreach (dbAll('SELECT id FROM pp_teams WHERE competition_id = ?', [$c['id']]) as $t) $validTeams[(int) $t['id']] = true;
    $clean = [];
    foreach ($lines as $ln) {
        $tid = (int) ($ln['teamId'] ?? 0);
        if (!isset($validTeams[$tid])) continue;
        $pts = $cat['points_type'] === 'fixed' ? (int) $cat['fixed_points'] : (is_numeric($ln['points'] ?? null) ? (int) $ln['points'] : null);
        if ($pts === null) jsonResponse(['error' => 'Enter a points value for each selected team.'], 422);
        $clean[$tid] = $pts; // one line per team
    }
    if (!$clean) jsonResponse(['error' => 'Select at least one team to score.'], 422);

    $status = $c['approval_mode'] === 'approval' ? 'pending' : 'approved';
    $res = dbRun('INSERT INTO pp_submissions (competition_id, category_id, submitted_by, comment, status) VALUES (?, ?, ?, ?, ?)', [$c['id'], $cat['id'], $user['id'], $comment, $status]);
    $sid = (int) $res['lastInsertId'];
    foreach ($clean as $tid => $pts) dbRun('INSERT INTO pp_score_lines (submission_id, team_id, points) VALUES (?, ?, ?)', [$sid, $tid, $pts]);
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_create', 'entityType' => 'pp_submission', 'entityId' => (string) $sid, 'ipAddress' => clientIp(), 'details' => ['status' => $status]]);
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
    logAudit(['userId' => $user['id'], 'action' => 'pp_submission_' . $action, 'entityType' => 'pp_submission', 'entityId' => (string) $s['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
}
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/approve', fn($p) => ppDecide('approve', 'approved', $p));
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/reject', fn($p) => ppDecide('reject', 'rejected', $p));
$router->post('/api/patrol-points/competitions/:id/submissions/:sid/return', fn($p) => ppDecide('return', 'returned', $p));
