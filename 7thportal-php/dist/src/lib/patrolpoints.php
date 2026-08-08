<?php
// Patrol Points (FRD v2.1 s13). Competitions with named teams, scoring categories,
// comment-required score submissions (multi-team, approvable, no self-approval)
// and a derived tie-aware leaderboard. Optional module, off by default.
//
// Scope: team-level scoring with per-participant team membership (OSM-linked or
// manual, one active team per person per competition, membership locked once the
// competition is completed). 'free'/'fixed' category point types, a single
// per-competition approval mode. Submitters can withdraw or amend a pending/
// returned submission; approved scores are corrected via a revision that keeps
// the original effective until the revision is approved. Leader workspace only.
// Still deferred: per-submission membership snapshots, selectable/ranged point
// types, per-category approval rules, draft (unsubmitted) submissions, parent
// leaderboard, evidence attachments. See README follow-ups.

const PP_STATUSES = ['draft' => 'Draft', 'open' => 'Open', 'paused' => 'Paused', 'completed' => 'Completed', 'archived' => 'Archived'];
const PP_APPROVAL_MODES = ['immediate' => 'Immediate (scores count at once)', 'approval' => 'Requires approval'];
const PP_POINTS_TYPES = ['free' => 'Free entry', 'fixed' => 'Fixed value'];
// Quick Score defaults (FRD v2.4 s13.7) when a category has no custom config.
const PP_DEFAULT_REASONS = ['Great teamwork', 'Won challenge', 'Excellent effort', 'Bonus', 'Deduction', 'Other'];
// Positive-only by default; deductions are opt-in per competition (Module Design).
const PP_DEFAULT_BUTTONS = [1, 5, 10];
// Operational leaders who may run competitions (mirrors Activity Approval's group).
const PP_MANAGER_ROLES = ['section_leader', 'assistant_leader', 'group_leadership', 'admin'];

function patrolPointsEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'patrol_points_enabled'");
    return ($row['value'] ?? null) === 'true';
}
function requirePatrolPointsEnabled(): void
{
    if (!patrolPointsEnabled()) jsonResponse(['error' => 'Patrol Points is not enabled.'], 404);
}

// Who may create/configure competitions and submit scores.
function ppCanManage(array $user): bool
{
    return in_array($user['portal_role'], PP_MANAGER_ROLES, true);
}
// Who may approve a pending submission: a manager who is not the submitter
// (self-approval is blocked, FRD s13.2).
function ppCanApprove(array $user, array $submission): bool
{
    if ((int) $submission['submitted_by'] === (int) $user['id']) return false;
    return ppCanManage($user);
}

// Notify eligible approvers (managers) of a pending submission, excluding the
// submitter (who cannot approve their own). Honours per-user mute preferences.
function ppNotifyApprovers(int $excludeUserId, string $title, ?string $body, string $link): void
{
    $ph = implode(',', array_fill(0, count(PP_MANAGER_ROLES), '?'));
    foreach (dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role IN ($ph)", PP_MANAGER_ROLES) as $u) {
        if ((int) $u['id'] === $excludeUserId) continue;
        notify((int) $u['id'], 'patrol_points', $title, $body, $link);
    }
}

function ppCompetitionOr404($id): array
{
    $c = dbGet('SELECT * FROM pp_competitions WHERE id = ?', [(int) $id]);
    if (!$c) jsonResponse(['error' => 'Competition not found.'], 404);
    return $c;
}

// ── Serializers ─────────────────────────────────────────────────────────────────
function serializePpCompetition(array $c, bool $full = false): array
{
    $base = [
        'id' => (int) $c['id'], 'name' => $c['name'], 'status' => $c['status'],
        'statusLabel' => PP_STATUSES[$c['status']] ?? $c['status'],
        'approvalMode' => $c['approval_mode'], 'approvalModeLabel' => PP_APPROVAL_MODES[$c['approval_mode']] ?? $c['approval_mode'],
        'sectionName' => $c['section_name'], 'updatedAt' => $c['updated_at'],
    ];
    if (!$full) {
        $base['teamCount'] = (int) dbGet('SELECT COUNT(*) n FROM pp_teams WHERE competition_id = ?', [$c['id']])['n'];
        $base['pendingCount'] = (int) dbGet("SELECT COUNT(*) n FROM pp_submissions WHERE competition_id = ? AND status = 'pending' AND withdrawn = 0", [$c['id']])['n'];
        return $base;
    }
    return array_merge($base, [
        'description' => $c['description'], 'visibility' => $c['visibility'],
        'allowDeductions' => (bool) ($c['allow_deductions'] ?? 0),
        'osmSectionId' => $c['osm_section_id'], 'createdBy' => (int) $c['created_by'],
        'completedAt' => $c['completed_at'], 'createdAt' => $c['created_at'],
    ]);
}
function serializePpTeam(array $t): array
{
    return ['id' => (int) $t['id'], 'name' => $t['name'], 'sortOrder' => (int) $t['sort_order']];
}
function serializePpParticipant(array $p): array
{
    return [
        'id' => (int) $p['id'], 'teamId' => (int) $p['team_id'], 'name' => $p['display_name'],
        'source' => $p['source'], 'personRef' => $p['person_ref'], 'patrol' => $p['patrol'],
    ];
}
// The leader's own sections (id + name) from their OSM roles, for the roster picker.
function ppSectionsForUser(array $user): array
{
    $out = [];
    foreach (json_decode($user['osm_roles_json'] ?? '[]', true) ?: [] as $r) {
        if (!empty($r['sectionid'])) $out[] = ['id' => (string) $r['sectionid'], 'name' => $r['sectionname'] ?? ('Section ' . $r['sectionid'])];
    }
    return $out;
}
function serializePpCategory(array $c, bool $allowDeductions = true): array
{
    $buttons = !empty($c['point_buttons']) ? (json_decode($c['point_buttons'], true) ?: null) : null;
    if (!$buttons) $buttons = $c['points_type'] === 'fixed' ? [(int) $c['fixed_points']] : PP_DEFAULT_BUTTONS;
    $buttons = array_map('intval', $buttons);
    // Hide negative quick buttons unless the competition permits deductions.
    if (!$allowDeductions) $buttons = array_values(array_filter($buttons, fn($n) => $n >= 0));
    $reasons = !empty($c['reason_presets']) ? (json_decode($c['reason_presets'], true) ?: null) : null;
    if (!$reasons) $reasons = PP_DEFAULT_REASONS;
    return [
        'id' => (int) $c['id'], 'name' => $c['name'], 'pointsType' => $c['points_type'],
        'pointsTypeLabel' => PP_POINTS_TYPES[$c['points_type']] ?? $c['points_type'],
        'fixedPoints' => $c['fixed_points'] !== null ? (int) $c['fixed_points'] : null,
        'freeEntry' => $c['points_type'] === 'free',
        'pointButtons' => array_values(array_map('intval', $buttons)),
        'reasonPresets' => array_values(array_map('strval', $reasons)),
    ];
}
// An activity/station profile: a category plus its own Quick Score buttons/reasons
// and optional team scope. Falls back to the category's config where unset.
function serializePpActivity(array $a, array $cat, bool $allowDeductions): array
{
    $catSer = serializePpCategory($cat, $allowDeductions);
    $buttons = !empty($a['point_buttons']) ? (json_decode($a['point_buttons'], true) ?: null) : null;
    if ($buttons) {
        $buttons = array_map('intval', $buttons);
        if (!$allowDeductions) $buttons = array_values(array_filter($buttons, fn($n) => $n >= 0));
    } else {
        $buttons = $catSer['pointButtons'];
    }
    $reasons = !empty($a['reason_presets']) ? (json_decode($a['reason_presets'], true) ?: null) : null;
    if (!$reasons) $reasons = $catSer['reasonPresets'];
    $scope = !empty($a['team_scope']) ? (json_decode($a['team_scope'], true) ?: null) : null;
    return [
        'id' => (int) $a['id'], 'name' => $a['name'],
        'categoryId' => $catSer['id'], 'categoryName' => $catSer['name'],
        'pointsType' => $catSer['pointsType'], 'freeEntry' => $catSer['freeEntry'], 'fixedPoints' => $catSer['fixedPoints'],
        'pointButtons' => array_values(array_map('intval', $buttons)),
        'reasonPresets' => array_values(array_map('strval', $reasons)),
        'teamScope' => $scope ? array_values(array_map('intval', $scope)) : null,
    ];
}

// Parse Quick Score config from a request body into JSON columns (null = defaults).
function ppParseButtons($v): ?string
{
    if (!is_array($v)) return null;
    $nums = [];
    foreach ($v as $n) { if (is_numeric($n)) $nums[] = (int) $n; }
    return $nums ? json_encode(array_values(array_unique($nums))) : null;
}
function ppParseReasons($v): ?string
{
    if (!is_array($v)) return null;
    $out = [];
    foreach ($v as $s) { $s = trim((string) $s); if ($s !== '') $out[] = $s; }
    return $out ? json_encode(array_values(array_slice($out, 0, 12))) : null;
}
function serializePpSubmission(array $s, array $lines, array $teamNames, array $catNames, array $userNames): array
{
    // Display status folds the withdraw flag and supersession over the stored status.
    $status = !empty($s['withdrawn']) ? 'withdrawn' : (!empty($s['superseded_by']) ? 'superseded' : $s['status']);
    return [
        'id' => (int) $s['id'], 'categoryId' => (int) $s['category_id'], 'categoryName' => $catNames[(int) $s['category_id']] ?? '—',
        'comment' => $s['comment'], 'status' => $status,
        'isRevision' => $s['revises_id'] !== null, 'revisesId' => $s['revises_id'] !== null ? (int) $s['revises_id'] : null,
        'submittedBy' => $userNames[(int) $s['submitted_by']] ?? 'Leader', 'submittedById' => (int) $s['submitted_by'],
        'decidedBy' => $s['decided_by'] !== null ? ($userNames[(int) $s['decided_by']] ?? 'Leader') : null,
        'decisionComment' => $s['decision_comment'], 'createdAt' => $s['created_at'],
        'lines' => array_map(fn($l) => ['teamId' => (int) $l['team_id'], 'teamName' => $teamNames[(int) $l['team_id']] ?? '—', 'points' => (int) $l['points']], $lines),
    ];
}

// ── Leaderboard ─────────────────────────────────────────────────────────────────
// Derived from APPROVED score lines only; totals per team, tie-aware standard
// competition ranking (equal totals share a position, the next rank skips).
function ppLeaderboard(int $competitionId): array
{
    $teams = dbAll('SELECT * FROM pp_teams WHERE competition_id = ? ORDER BY sort_order, name', [$competitionId]);
    $totals = [];
    foreach ($teams as $t) $totals[(int) $t['id']] = 0;
    $rows = dbAll(
        "SELECT l.team_id, COALESCE(SUM(l.points), 0) AS total
         FROM pp_score_lines l JOIN pp_submissions s ON s.id = l.submission_id
         WHERE s.competition_id = ? AND s.status = 'approved' AND s.superseded_by IS NULL AND s.withdrawn = 0
         GROUP BY l.team_id",
        [$competitionId]
    );
    foreach ($rows as $r) $totals[(int) $r['team_id']] = (int) $r['total'];

    $board = [];
    foreach ($teams as $t) $board[] = ['teamId' => (int) $t['id'], 'teamName' => $t['name'], 'total' => $totals[(int) $t['id']] ?? 0];
    usort($board, fn($a, $b) => $b['total'] <=> $a['total']);
    $pos = 0; $prev = null; $seen = 0;
    foreach ($board as &$row) {
        $seen++;
        if ($prev === null || $row['total'] !== $prev) { $pos = $seen; $prev = $row['total']; }
        $row['position'] = $pos;
    }
    return $board;
}

// ── Action Centre: pending submissions awaiting a (non-conflicted) approver ──────
function patrolPointsActionItems(array $user): array
{
    if (!patrolPointsEnabled() || !ppCanManage($user)) return [];
    $items = [];
    $rows = dbAll(
        "SELECT s.id, s.competition_id, c.name AS comp_name
         FROM pp_submissions s JOIN pp_competitions c ON c.id = s.competition_id
         WHERE s.status = 'pending' AND s.withdrawn = 0 AND s.submitted_by != ? AND c.status IN ('open','paused')",
        [$user['id']]
    );
    foreach ($rows as $r) {
        $items[] = actionItem('pp-appr-' . $r['id'], 'High', 'Patrol Points', 'Score to approve: ' . $r['comp_name'], 'Leaders', 'Open', 'patrol-point.html?id=' . $r['competition_id']);
    }
    return $items;
}
