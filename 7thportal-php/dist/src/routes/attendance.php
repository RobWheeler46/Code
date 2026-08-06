<?php
// Section attendance registers API (FRD FR-SEC-ATT / FR-SEC-REG). Leader-only, and
// only for a leader's own section (or admin). Registers are pre-populated from the
// live OSM roster then owned locally. All mutations audited. Emergency contact
// drill-down (FR-SEC-EC) is intentionally NOT here. Optional module, off by default.

// Section display name for a section id from the user's OSM roles (fallback: body).
function attendanceSectionName(array $user, string $sectionId, ?string $fallback): ?string
{
    foreach (json_decode($user['osm_roles_json'] ?? '[]', true) ?: [] as $r) {
        if ((string) ($r['sectionid'] ?? '') === $sectionId) return $r['sectionname'] ?? $fallback;
    }
    return $fallback;
}

// Insert marks for roster members not already in the register (preserves existing
// marks + history). Returns the number added.
function attendanceAddRosterMembers(int $registerId, array $members): int
{
    $existing = array_column(dbAll('SELECT osm_member_id FROM attendance_marks WHERE register_id = ? AND osm_member_id IS NOT NULL', [$registerId]), 'osm_member_id');
    $existing = array_flip($existing);
    $added = 0;
    foreach ($members as $m) {
        $mid = $m['id'] ?? null;
        if ($mid !== null && isset($existing[$mid])) continue;
        $sortName = trim((string) (($m['lastName'] ?? '') . ' ' . ($m['name'] ?? '')));
        dbRun(
            'INSERT OR IGNORE INTO attendance_marks (register_id, osm_member_id, member_name, grouping, status, sort_name) VALUES (?, ?, ?, ?, \'unknown\', ?)',
            [$registerId, $mid, $m['name'] ?? 'Member', $m['patrol'] ?? null, $sortName ?: ($m['name'] ?? '')]
        );
        $added++;
    }
    return $added;
}

// ── List registers the user can manage ─────────────────────────────────────────
$router->get('/api/attendance/registers', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $where = []; $args = [];
    if (($sid = queryParam('sectionId'))) { $where[] = 'osm_section_id = ?'; $args[] = $sid; }
    if (($st = queryParam('status')) && in_array($st, ['open', 'submitted'], true)) { $where[] = 'status = ?'; $args[] = $st; }
    $sql = 'SELECT * FROM attendance_registers' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY session_date DESC, id DESC';
    $rows = array_filter(dbAll($sql, $args), fn($r) => attendanceCanManage($user, (string) $r['osm_section_id']));
    jsonResponse([
        'registers' => array_values(array_map(fn($r) => serializeRegister($r, true), $rows)),
        'meta' => ['statuses' => ATTENDANCE_STATUSES, 'sourceTypes' => ATTENDANCE_SOURCE_TYPES],
    ]);
});

// ── Create a register (pre-populated from the live roster) ──────────────────────
$router->post('/api/attendance/registers', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $body = requestBody();
    $sid = trim((string) ($body['sectionId'] ?? ''));
    if ($sid === '') jsonResponse(['error' => 'A section is required.'], 400);
    if (!attendanceCanManage($user, $sid)) jsonResponse(['error' => 'You cannot record attendance for this section.'], 403);

    $sessionDate = trim((string) ($body['sessionDate'] ?? ''));
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $sessionDate)) jsonResponse(['error' => 'A valid session date is required.'], 400);
    $sourceType = array_key_exists($body['sourceType'] ?? '', ATTENDANCE_SOURCE_TYPES) ? $body['sourceType'] : 'ad_hoc';
    $title = trim((string) ($body['title'] ?? '')) ?: (($sourceType === 'ad_hoc' ? 'Session' : 'Register') . ' ' . $sessionDate);
    $sectionName = attendanceSectionName($user, $sid, $body['sectionName'] ?? null);

    $result = dbRun(
        'INSERT INTO attendance_registers (osm_section_id, section_name, title, session_date, source_type, source_ref_id, source_label, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [$sid, $sectionName, $title, $sessionDate, $sourceType,
         !empty($body['sourceRefId']) ? (int) $body['sourceRefId'] : null,
         trim((string) ($body['sourceLabel'] ?? '')) ?: null, $user['id']]
    );
    $id = (int) $result['lastInsertId'];

    // Pre-populate from the live roster (fetch-only). If OSM blocks/fails we still
    // create the register so the leader can retry the roster sync or add guests.
    $roster = osmSectionRoster($user, $sid);
    $warning = null; $added = 0;
    if (!empty($roster['ok'])) $added = attendanceAddRosterMembers($id, $roster['members']);
    else $warning = ($roster['error'] ?? 'Could not load the roster') . ' - the register was created empty; use "Sync roster" to add members.';

    logAudit(['userId' => $user['id'], 'action' => 'attendance_create', 'entityType' => 'attendance_register', 'entityId' => (string) $id, 'ipAddress' => clientIp(), 'details' => ['section' => $sid, 'members' => $added]]);
    jsonResponse(['register' => serializeRegister(attendanceRegisterOr404($id), true), 'added' => $added, 'rosterWarning' => $warning], 201);
});

// ── Register detail (grouped marks) ─────────────────────────────────────────────
$router->get('/api/attendance/registers/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'You cannot view this register.'], 403);
    jsonResponse([
        'register' => serializeRegister($r, true),
        'groups' => attendanceGroupedMarks((int) $r['id']),
        'meta' => ['statuses' => ATTENDANCE_STATUSES, 'sourceTypes' => ATTENDANCE_SOURCE_TYPES, 'presentStatuses' => ATTENDANCE_PRESENT_STATUSES],
    ]);
});

// ── Update register header (while open) ─────────────────────────────────────────
$router->patch('/api/attendance/registers/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    if ($r['status'] !== 'open') jsonResponse(['error' => 'Reopen the register before editing it.'], 409);
    $body = requestBody();
    $title = array_key_exists('title', $body) ? (trim((string) $body['title']) ?: $r['title']) : $r['title'];
    $date = array_key_exists('sessionDate', $body) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $body['sessionDate']) ? $body['sessionDate'] : $r['session_date'];
    $notes = array_key_exists('notes', $body) ? (trim((string) $body['notes']) ?: null) : $r['notes'];
    dbRun("UPDATE attendance_registers SET title = ?, session_date = ?, notes = ?, updated_at = datetime('now') WHERE id = ?", [$title, $date, $notes, $r['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_update', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeRegister(attendanceRegisterOr404($r['id']), true));
});

// ── Set marks (array of {id, status, note}) ─────────────────────────────────────
$router->post('/api/attendance/registers/:id/marks', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    if ($r['status'] !== 'open') jsonResponse(['error' => 'Reopen the register before changing marks.'], 409);
    $marks = requestBody()['marks'] ?? [];
    if (!is_array($marks)) jsonResponse(['error' => 'Invalid marks payload.'], 400);
    foreach ($marks as $m) {
        $mid = (int) ($m['id'] ?? 0);
        if (!$mid) continue;
        $status = array_key_exists($m['status'] ?? '', ATTENDANCE_STATUSES) ? $m['status'] : null;
        if ($status === null) continue;
        $note = array_key_exists('note', $m) ? (trim((string) $m['note']) ?: null) : null;
        dbRun("UPDATE attendance_marks SET status = ?, note = ?, updated_at = datetime('now') WHERE id = ? AND register_id = ?", [$status, $note, $mid, $r['id']]);
    }
    dbRun("UPDATE attendance_registers SET updated_at = datetime('now') WHERE id = ?", [$r['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_marks_update', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp(), 'details' => ['marks' => count($marks)]]);
    jsonResponse(['ok' => true, 'register' => serializeRegister(attendanceRegisterOr404($r['id']), true), 'groups' => attendanceGroupedMarks((int) $r['id'])]);
});

// ── Bulk mark-all-present / clear ───────────────────────────────────────────────
$router->post('/api/attendance/registers/:id/bulk', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    if ($r['status'] !== 'open') jsonResponse(['error' => 'Reopen the register before changing marks.'], 409);
    $action = requestBody()['action'] ?? '';
    if ($action === 'all_present') dbRun("UPDATE attendance_marks SET status = 'present', updated_at = datetime('now') WHERE register_id = ? AND status != 'guest'", [$r['id']]);
    elseif ($action === 'clear') dbRun("UPDATE attendance_marks SET status = 'unknown', updated_at = datetime('now') WHERE register_id = ?", [$r['id']]);
    else jsonResponse(['error' => 'Unknown bulk action.'], 400);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_bulk', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp(), 'details' => ['action' => $action]]);
    jsonResponse(['ok' => true, 'register' => serializeRegister(attendanceRegisterOr404($r['id']), true), 'groups' => attendanceGroupedMarks((int) $r['id'])]);
});

// ── Add a guest (not on the OSM roster) ─────────────────────────────────────────
$router->post('/api/attendance/registers/:id/guest', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    $name = trim((string) (requestBody()['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A name is required.'], 400);
    dbRun("INSERT INTO attendance_marks (register_id, osm_member_id, member_name, grouping, status, sort_name) VALUES (?, NULL, ?, 'Guests', 'guest', ?)", [$r['id'], $name, $name]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_guest_add', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true, 'groups' => attendanceGroupedMarks((int) $r['id'])]);
});

// ── Sync roster: add any new OSM members, preserving existing marks (FR-SEC-REG-005)
$router->post('/api/attendance/registers/:id/sync-roster', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    $roster = osmSectionRoster($user, (string) $r['osm_section_id']);
    if (empty($roster['ok'])) jsonResponse(['error' => $roster['error'] ?? 'Could not load the roster.', 'blocked' => !empty($roster['blocked'])], !empty($roster['blocked']) ? 502 : 400);
    $added = attendanceAddRosterMembers((int) $r['id'], $roster['members']);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_sync_roster', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp(), 'details' => ['added' => $added]]);
    jsonResponse(['ok' => true, 'added' => $added, 'groups' => attendanceGroupedMarks((int) $r['id'])]);
});

// ── Submit / reopen ─────────────────────────────────────────────────────────────
$router->post('/api/attendance/registers/:id/submit', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    dbRun("UPDATE attendance_registers SET status = 'submitted', submitted_by = ?, submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $r['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_submit', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeRegister(attendanceRegisterOr404($r['id']), true));
});

$router->post('/api/attendance/registers/:id/reopen', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    dbRun("UPDATE attendance_registers SET status = 'open', updated_at = datetime('now') WHERE id = ?", [$r['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_reopen', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeRegister(attendanceRegisterOr404($r['id']), true));
});

// ── Delete ──────────────────────────────────────────────────────────────────────
$router->delete('/api/attendance/registers/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireAttendanceEnabled();
    $r = attendanceRegisterOr404($params['id']);
    if (!attendanceCanManage($user, (string) $r['osm_section_id'])) jsonResponse(['error' => 'Not permitted.'], 403);
    dbRun('DELETE FROM attendance_registers WHERE id = ?', [$r['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'attendance_delete', 'entityType' => 'attendance_register', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
