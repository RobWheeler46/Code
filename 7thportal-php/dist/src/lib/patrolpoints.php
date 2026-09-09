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
// types, per-category approval rules, draft (unsubmitted) submissions, evidence
// attachments. See README follow-ups.

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
// ── Patrol Points v2.4 capability & approval model (FRD PP2.4 s3/s4) ─────────────
// Access is expressed as separate capabilities. Platform role is the hard ceiling;
// a competition can only narrow or assign within it. Legacy competitions (before the
// capability model was switched on) keep the v2.3 role behaviour untouched.
const PP_CAPABILITIES = ['view', 'view_detail', 'view_history', 'submit', 'score_direct', 'approve', 'manage', 'manage_access'];

// What a user is eligible to hold at platform level (the ceiling; not an automatic grant).
function ppPlatformCeiling(array $user): array
{
    $role = $user['portal_role'];
    if ($role === 'admin') return PP_CAPABILITIES;
    if ($role === 'parent') return ['view'];
    if (!isLeaderRole($role)) return [];
    $caps = ['view', 'view_detail', 'view_history', 'submit'];
    if (in_array($role, PP_MANAGER_ROLES, true)) $caps = array_merge($caps, ['score_direct', 'approve', 'manage', 'manage_access']);
    return array_values(array_unique($caps));
}

// Capabilities granted to a user by this competition's access assignments (user / role /
// section subjects; group and section-approver resolution is deferred to a later slice).
function ppAssignmentCapsForUser(array $user, array $comp): array
{
    $caps = [];
    $sectionIds = function_exists('sectionsUserSectionIds') ? sectionsUserSectionIds($user) : [];
    foreach (dbAll('SELECT * FROM pp_access_assignments WHERE competition_id = ?', [$comp['id']]) as $a) {
        $m = ($a['subject_kind'] === 'user' && (int) $a['subject_value'] === (int) $user['id'])
            || ($a['subject_kind'] === 'role' && $a['subject_value'] === $user['portal_role'])
            || ($a['subject_kind'] === 'section' && in_array($a['subject_value'], $sectionIds, true));
        if ($m) $caps[] = $a['capability'];
    }
    return $caps;
}

// The user's effective capabilities on a competition (assignments intersected with the
// platform ceiling). Managing a competition never implies Approve or Score Directly.
function ppUserCapabilities(array $user, array $comp): array
{
    $ceiling = ppPlatformCeiling($user);
    if (!$ceiling) return [];
    if (empty($comp['uses_capability_model'])) {
        if ($user['portal_role'] === 'parent') return array_values(array_intersect(['view'], $ceiling));
        $caps = ['view', 'view_detail', 'view_history'];
        if (ppCanManage($user)) $caps = array_merge($caps, ['submit', 'score_direct', 'approve', 'manage', 'manage_access']);
        return array_values(array_unique(array_intersect($caps, $ceiling)));
    }
    $caps = ['view'];
    if ((int) $comp['created_by'] === (int) $user['id']) $caps = array_merge($caps, ['view_detail', 'view_history', 'manage', 'manage_access']);
    if (ppCanManage($user)) $caps = array_merge($caps, ['view_detail', 'view_history', 'manage']);
    $caps = array_merge($caps, ppAssignmentCapsForUser($user, $comp));
    return array_values(array_unique(array_intersect($caps, $ceiling)));
}
function ppHasCapability(array $user, array $comp, string $cap): bool
{
    return in_array($cap, ppUserCapabilities($user, $comp), true);
}

// Score disposition decision (FRD PP2.4 s4.1), evaluated in strict rule order. Returns
// ['status' => 'approved'|'pending'|'prohibited', 'reason' => <ScoreDisposition audit>].
function ppScoreDisposition(array $comp, array $user, array $cat, array $lineValues, bool $isGuest = false): array
{
    if ($isGuest) return ['status' => 'pending', 'reason' => 'guest'];
    if (($comp['approval_mode'] ?? '') === 'approval') return ['status' => 'pending', 'reason' => 'all_approval'];
    if (!empty($cat['requires_approval'])) return ['status' => 'pending', 'reason' => 'category'];
    $hasDeduction = false;
    $maxAbs = 0;
    foreach ($lineValues as $p) { $p = (int) $p; if ($p < 0) $hasDeduction = true; if (abs($p) > $maxAbs) $maxAbs = abs($p); }
    if ($hasDeduction && !empty($comp['deductions_require_approval'])) return ['status' => 'pending', 'reason' => 'deduction'];
    $thr = $comp['large_value_threshold'] ?? null;
    if ($thr !== null && $thr !== '' && $maxAbs > (int) $thr) return ['status' => 'pending', 'reason' => 'large_value'];
    $caps = ppUserCapabilities($user, $comp);
    if (in_array('score_direct', $caps, true)) return ['status' => 'approved', 'reason' => 'score_directly'];
    if (in_array('submit', $caps, true)) return ['status' => 'pending', 'reason' => 'submit_only'];
    return ['status' => 'prohibited', 'reason' => 'no_capability'];
}

// Resolve an approver assignment subject to concrete user ids (user + role for now).
function ppResolveSubjectUserIds(array $a): array
{
    if ($a['subject_kind'] === 'user') return [(int) $a['subject_value']];
    if ($a['subject_kind'] === 'role') return array_map(fn($u) => (int) $u['id'], dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role = ?", [$a['subject_value']]));
    return [];
}

// User ids eligible to approve in this competition, optionally excluding one (a submitter,
// so self-approval never counts toward coverage). Legacy competitions fall back to managers.
function ppEligibleApproverIds(array $comp, ?int $excludeUserId = null): array
{
    $ids = [];
    if (empty($comp['uses_capability_model'])) {
        $ph = implode(',', array_fill(0, count(PP_MANAGER_ROLES), '?'));
        foreach (dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role IN ($ph)", PP_MANAGER_ROLES) as $u) $ids[(int) $u['id']] = true;
    } else {
        foreach (dbAll("SELECT * FROM pp_access_assignments WHERE competition_id = ? AND capability = 'approve'", [$comp['id']]) as $a) {
            foreach (ppResolveSubjectUserIds($a) as $uid) $ids[$uid] = true;
        }
    }
    if ($excludeUserId !== null) unset($ids[$excludeUserId]);
    return array_keys($ids);
}

// Does any permitted scoring route on this competition produce Pending Approval?
function ppPendingRouteExists(array $comp): bool
{
    if (($comp['approval_mode'] ?? '') === 'approval') return true;
    if (!empty($comp['allow_deductions']) && !empty($comp['deductions_require_approval'])) return true;
    if (($comp['large_value_threshold'] ?? null) !== null && $comp['large_value_threshold'] !== '') return true;
    if (!empty($comp['uses_capability_model'])) {
        $hasSubmit = dbGet("SELECT 1 FROM pp_access_assignments WHERE competition_id = ? AND capability = 'submit' LIMIT 1", [$comp['id']]);
        $hasDirect = dbGet("SELECT 1 FROM pp_access_assignments WHERE competition_id = ? AND capability = 'score_direct' LIMIT 1", [$comp['id']]);
        if ($hasSubmit && !$hasDirect) return true;
    }
    return false;
}

// AC24-07 / PP24-APR-003: a competition may not start (or save an access change) when a
// pending-producing route has no eligible approver. Returns an error string, or null.
function ppApprovalCoverageError(array $comp): ?string
{
    if (!ppPendingRouteExists($comp)) return null;
    if (count(ppEligibleApproverIds($comp)) === 0) {
        return 'This competition can produce scores that need approval, but no eligible approver is assigned. Add an approver under Access and approvals first.';
    }
    return null;
}

// Who may approve a pending submission: holds Approve in scope and is not the submitter
// (self-approval is prohibited, FRD PP2.4 s4.2 / PP24-APR-002).
function ppCanApprove(array $user, array $submission): bool
{
    if ((int) $submission['submitted_by'] === (int) $user['id']) return false;
    $comp = dbGet('SELECT * FROM pp_competitions WHERE id = ?', [$submission['competition_id']]);
    if (!$comp) return false;
    if (empty($comp['uses_capability_model'])) return ppCanManage($user);
    return ppHasCapability($user, $comp, 'approve');
}

// Human label for an assignment subject (for the Access and approvals surface).
function ppSubjectLabel(array $a): string
{
    if ($a['subject_kind'] === 'user') {
        $u = dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$a['subject_value']]);
        return $u ? trim($u['first_name'] . ' ' . $u['last_name']) : ('User ' . $a['subject_value']);
    }
    if ($a['subject_kind'] === 'role') return roleLabel($a['subject_value']);
    return (string) $a['subject_value'];
}

// Insert one validated access assignment. Silently ignores an invalid row.
function ppInsertAssignment(int $compId, array $a, int $userId): void
{
    $kind = in_array($a['subjectKind'] ?? '', ['user', 'role', 'section', 'group'], true) ? $a['subjectKind'] : null;
    $cap = in_array($a['capability'] ?? '', PP_CAPABILITIES, true) ? $a['capability'] : null;
    $val = trim((string) ($a['subjectValue'] ?? ''));
    if (!$kind || !$cap || $val === '') return;
    dbRun('INSERT INTO pp_access_assignments (competition_id, subject_kind, subject_value, capability, scope_activity_id, scope_category_id, scope_section, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$compId, $kind, $val, $cap, $a['scopeActivityId'] ?? null, $a['scopeCategoryId'] ?? null, $a['scopeSection'] ?? null, $userId]);
}

// The Access and approvals surface payload: policy, current assignments, the people who
// could be named as approvers/scorers, coverage status and the capability labels.
function ppAccessPayload(array $c): array
{
    $assignments = array_map(fn($a) => [
        'id' => (int) $a['id'], 'subjectKind' => $a['subject_kind'], 'subjectValue' => $a['subject_value'],
        'capability' => $a['capability'], 'subjectLabel' => ppSubjectLabel($a),
    ], dbAll('SELECT * FROM pp_access_assignments WHERE competition_id = ? ORDER BY capability, id', [$c['id']]));
    $cands = array_map(fn($u) => ['id' => (int) $u['id'], 'name' => trim($u['first_name'] . ' ' . $u['last_name']), 'role' => $u['portal_role']],
        dbAll("SELECT id, first_name, last_name, portal_role FROM users WHERE account_status = 'active' AND portal_role IN ('section_leader','assistant_leader','group_leadership','chair','admin') ORDER BY first_name, last_name"));
    return [
        'usesCapabilityModel' => (bool) $c['uses_capability_model'],
        'policy' => [
            'approvalMode' => $c['approval_mode'],
            'deductionsRequireApproval' => (bool) $c['deductions_require_approval'],
            'largeValueThreshold' => $c['large_value_threshold'] !== null ? (int) $c['large_value_threshold'] : null,
            'allowDeductions' => (bool) $c['allow_deductions'],
        ],
        'assignments' => $assignments,
        'approverCandidates' => $cands,
        'roleOptions' => ['section_leader' => 'Section Leaders', 'assistant_leader' => 'Assistant Leaders', 'group_leadership' => 'Group Leadership', 'chair' => 'Chair'],
        'capabilityLabels' => ['submit' => 'Submit points', 'score_direct' => 'Score directly', 'approve' => 'Approve points', 'view_detail' => 'View detail', 'manage' => 'Manage competition', 'manage_access' => 'Manage access'],
        'pendingRouteExists' => ppPendingRouteExists($c),
        'coverageError' => ppApprovalCoverageError($c),
    ];
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
        'requiresApproval' => (bool) ($c['requires_approval'] ?? 0),
        'pointButtons' => array_values(array_map('intval', $buttons)),
        'reasonPresets' => array_values(array_map('strval', $reasons)),
    ];
}
// Approval-triage classification (FRD PP2.4 s8 / PP24-APR-004). Flags the exceptions an
// approver must look at individually; anything with no flag is "straightforward".
const PP_TRIAGE_LABELS = ['guest' => 'Guest entry', 'deduction' => 'Deduction', 'large_value' => 'Large value', 'revision' => 'Correction', 'returned' => 'Returned then resubmitted', 'category' => 'Approval-only category'];
function ppTriageFlags(array $s, array $lines): array
{
    $flags = [];
    if (!empty($s['guest_link_id'])) $flags[] = 'guest';
    if ($s['revises_id'] !== null) $flags[] = 'revision';
    foreach ($lines as $l) if ((int) ($l['points'] ?? 0) < 0) { $flags[] = 'deduction'; break; }
    $maxAbs = 0;
    foreach ($lines as $l) { $a = abs((int) ($l['points'] ?? 0)); if ($a > $maxAbs) $maxAbs = $a; }
    if ($maxAbs >= 50) $flags[] = 'large_value';
    if (in_array($s['disposition_reason'] ?? '', ['category', 'large_value'], true) && !in_array('large_value', $flags, true) && ($s['disposition_reason'] ?? '') === 'category') $flags[] = 'category';
    return array_values(array_unique($flags));
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
// Build a competition with its teams + scoring categories in one transaction, from
// already-validated wizard input (FRD s13.2). Optionally opens it. Returns the new id.
function ppBuildCompetition(int $creatorId, array $b): int
{
    $mode = in_array($b['approvalMode'] ?? '', ['immediate', 'approval'], true) ? $b['approvalMode'] : 'immediate';
    $teams = array_values(array_filter(array_map(fn($t) => trim((string) $t), is_array($b['teams'] ?? null) ? $b['teams'] : []), fn($t) => $t !== ''));
    $cats = is_array($b['categories'] ?? null) ? $b['categories'] : [];
    $start = !empty($b['start']) && $teams && $cats;
    db()->beginTransaction();
    try {
        $id = (int) dbRun(
            "INSERT INTO pp_competitions (name, description, approval_mode, visibility, allow_deductions, osm_section_id, section_name, created_by) VALUES (?, ?, ?, 'leaders', ?, ?, ?, ?)",
            [trim((string) $b['name']), trim((string) ($b['description'] ?? '')) ?: null, $mode, !empty($b['allowDeductions']) ? 1 : 0, $b['sectionId'] ?? null, trim((string) ($b['sectionName'] ?? '')) ?: null, $creatorId]
        )['lastInsertId'];
        $so = 0;
        foreach ($teams as $tn) dbRun('INSERT INTO pp_teams (competition_id, name, sort_order) VALUES (?, ?, ?)', [$id, $tn, ++$so]);
        $cso = 0;
        foreach ($cats as $ct) {
            $type = in_array($ct['pointsType'] ?? '', ['free', 'fixed'], true) ? $ct['pointsType'] : 'free';
            dbRun('INSERT INTO pp_categories (competition_id, name, points_type, fixed_points, point_buttons, reason_presets, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$id, trim((string) $ct['name']), $type, $type === 'fixed' ? (int) $ct['fixedPoints'] : null, ppParseButtons($ct['pointButtons'] ?? null), ppParseReasons($ct['reasonPresets'] ?? null), ++$cso]);
        }
        if ($start) dbRun("UPDATE pp_competitions SET status = 'open', updated_at = datetime('now') WHERE id = ?", [$id]);
        db()->commit();
        return $id;
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }
}
function serializePpSubmission(array $s, array $lines, array $teamNames, array $catNames, array $userNames): array
{
    // Display status folds the withdraw flag and supersession over the stored status.
    $status = !empty($s['withdrawn']) ? 'withdrawn' : (!empty($s['superseded_by']) ? 'superseded' : $s['status']);
    $isGuest = !empty($s['guest_link_id']);
    return [
        'id' => (int) $s['id'], 'categoryId' => (int) $s['category_id'], 'categoryName' => $catNames[(int) $s['category_id']] ?? '—',
        'comment' => $s['comment'], 'status' => $status,
        'isRevision' => $s['revises_id'] !== null, 'revisesId' => $s['revises_id'] !== null ? (int) $s['revises_id'] : null,
        'isGuest' => $isGuest, 'guestName' => $isGuest ? ($s['guest_name'] ?? 'Guest') : null,
        'guestLinkId' => $isGuest ? (int) $s['guest_link_id'] : null,
        'submittedBy' => $isGuest ? ('Guest Quick Entry: ' . ($s['guest_name'] ?? 'guest')) : ($userNames[(int) $s['submitted_by']] ?? 'Leader'), 'submittedById' => (int) $s['submitted_by'],
        'decidedBy' => $s['decided_by'] !== null ? ($userNames[(int) $s['decided_by']] ?? 'Leader') : null,
        'decisionComment' => $s['decision_comment'], 'createdAt' => $s['created_at'],
        'dispositionReason' => $s['disposition_reason'] ?? null,
        'triage' => (($s['status'] === 'pending' && empty($s['withdrawn'])) ? ['bucket' => (ppTriageFlags($s, $lines) ? 'needs_attention' : 'straightforward'), 'flags' => ppTriageFlags($s, $lines)] : null),
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

// ── Guest Quick Entry (FRD v2.4 s13.8) ──────────────────────────────────────────
// Global on/off for no-login guest scoring (admin governed, default off).
function ppGuestEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'pp_guest_enabled'");
    return ($row['value'] ?? null) === 'true';
}
// A single non-login service user that owns guest submissions, so no real leader
// is treated as their submitter (keeps no-self-approval correct for all approvers).
function ppGuestUserId(): int
{
    $u = dbGet("SELECT id FROM users WHERE auth_type = 'local' AND email = 'guest.quickentry@patrolpoints.local'");
    if ($u) return (int) $u['id'];
    $r = dbRun("INSERT INTO users (auth_type, email, first_name, last_name, portal_role, account_status) VALUES ('local', 'guest.quickentry@patrolpoints.local', 'Guest', 'Quick Entry', 'parent', 'suspended')");
    return (int) $r['lastInsertId'];
}
function ppGuestUrl(string $token): string
{
    $scheme = (($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['SERVER_PORT'] ?? '') == 443) ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host . '/patrol-guest.html?t=' . $token;
}
function ppGuestLinkActive(array $link): bool
{
    if ($link['status'] !== 'active') return false;
    if (!empty($link['expires_at']) && strtotime($link['expires_at']) < time()) return false;
    return true;
}
function serializeGuestLink(array $link, ?array $activity): array
{
    return [
        'id' => (int) $link['id'], 'label' => $link['label'], 'activityId' => (int) $link['activity_id'],
        'activityName' => $activity['name'] ?? '—', 'status' => $link['status'],
        'active' => ppGuestLinkActive($link), 'pinRequired' => !empty($link['pin_hash']),
        'expiresAt' => $link['expires_at'], 'url' => ppGuestUrl($link['token']),
    ];
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
