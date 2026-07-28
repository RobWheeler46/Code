<?php
// Incident and near-miss logging API (FRD FR-INC). Leaders only, module-gated,
// with row-level restriction on sensitive records and a full audit trail.

function incidentCanEdit(array $user, array $inc): bool
{
    $role = $user['portal_role'];
    if ($role === 'admin' || $role === 'group_leadership') return true;
    if ((int) ($inc['reported_by'] ?? 0) === (int) $user['id']) return true;
    return !empty($inc['assigned_to']) && (int) $inc['assigned_to'] === (int) $user['id'];
}

function incidentFieldsFromBody(array $body, array $existing = []): array
{
    $val = function ($bk, $ek) use ($body, $existing) {
        if (array_key_exists($bk, $body)) return ($body[$bk] === '' || $body[$bk] === null) ? null : $body[$bk];
        return $existing[$ek] ?? null;
    };
    $type = array_key_exists($body['recordType'] ?? null, INCIDENT_TYPES) ? $body['recordType'] : ($existing['record_type'] ?? 'near_miss');
    $status = array_key_exists($body['status'] ?? null, INCIDENT_STATUSES) ? $body['status'] : ($existing['status'] ?? 'open');
    $assignedTo = null;
    if (array_key_exists('assignedTo', $body)) {
        $assignedTo = $body['assignedTo'] ? (int) $body['assignedTo'] : null;
        if ($assignedTo && !dbGet("SELECT id FROM users WHERE id = ? AND portal_role != 'parent'", [$assignedTo])) $assignedTo = null;
    } else {
        $assignedTo = $existing['assigned_to'] ?? null;
    }
    return [
        'record_type' => $type,
        'sensitivity' => incidentSensitivityForType($type),
        'summary' => trim((string) ($body['summary'] ?? $existing['summary'] ?? '')),
        'osm_section_id' => $val('sectionId', 'osm_section_id'),
        'section_name' => $val('sectionName', 'section_name'),
        'event_name' => $val('eventName', 'event_name'),
        'occurred_at' => $val('occurredAt', 'occurred_at'),
        'location' => $val('location', 'location'),
        'what_happened' => $val('whatHappened', 'what_happened'),
        'immediate_action' => $val('immediateAction', 'immediate_action'),
        'follow_up_actions' => $val('followUpActions', 'follow_up_actions'),
        'assigned_to' => $assignedTo,
        'due_date' => $val('dueDate', 'due_date'),
        'status' => $status,
        'closed_note' => $val('closedNote', 'closed_note'),
    ];
}

$router->get('/api/incidents', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireIncidentLoggingEnabled();
    $all = dbAll("SELECT * FROM incidents ORDER BY (status = 'closed'), due_date IS NULL, due_date, id DESC");
    // Governance-only roles get counts, never sensitive detail rows (FR-INC-009).
    $governanceOnly = in_array($user['portal_role'], ['trustee_viewer', 'chair', 'treasurer'], true);
    $countSet = $governanceOnly ? $all : array_values(array_filter($all, fn($i) => incidentCanViewDetail($user, $i)));
    $rows = $governanceOnly ? [] : $countSet;

    // Apply list filters to the visible rows.
    if (($st = queryParam('status')) && array_key_exists($st, INCIDENT_STATUSES)) $rows = array_values(array_filter($rows, fn($i) => $i['status'] === $st));
    if (($ty = queryParam('type')) && array_key_exists($ty, INCIDENT_TYPES)) $rows = array_values(array_filter($rows, fn($i) => $i['record_type'] === $ty));

    $today = gmdate('Y-m-d');
    $month = gmdate('Y-m');
    $byType = [];
    foreach ($countSet as $i) { if (str_starts_with((string) $i['created_at'], $month)) $byType[$i['record_type']] = ($byType[$i['record_type']] ?? 0) + 1; }

    jsonResponse([
        'incidents' => array_map(fn($i) => serializeIncident($i, false), $rows),
        'summary' => [
            'openRecords' => count(array_filter($countSet, fn($i) => $i['status'] !== 'closed')),
            'overdueActions' => count(array_filter($countSet, fn($i) => $i['status'] !== 'closed' && $i['due_date'] && $i['due_date'] < $today)),
            'thisMonthByType' => $byType,
            'safeguardingVisible' => count(array_filter($rows, fn($i) => $i['record_type'] === 'safeguarding_signpost')),
            'countsOnly' => $governanceOnly,
        ],
        'meta' => ['types' => INCIDENT_TYPES, 'statuses' => INCIDENT_STATUSES, 'restrictedTypes' => INCIDENT_RESTRICTED_TYPES],
        'safeguarding' => INCIDENT_SAFEGUARDING,
        'canCreate' => incidentCanCreate($user),
        'leaders' => array_map(fn($u) => ['id' => (int) $u['id'], 'name' => $u['first_name'] . ' ' . $u['last_name']], dbAll("SELECT id, first_name, last_name FROM users WHERE portal_role != 'parent' AND account_status = 'active' ORDER BY first_name")),
    ]);
});

$router->post('/api/incidents', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireIncidentLoggingEnabled();
    if (!incidentCanCreate($user)) jsonResponse(['error' => 'You do not have permission to create incident records.'], 403);
    $f = incidentFieldsFromBody(requestBody());
    if ($f['summary'] === '') jsonResponse(['error' => 'A short summary is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun(
        'INSERT INTO incidents (' . implode(',', $cols) . ', reported_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)',
        [...array_values($f), $user['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'incident_create', 'entityType' => 'incident', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['type' => $f['record_type'], 'sensitivity' => $f['sensitivity']]]);
    jsonResponse(serializeIncident(dbGet('SELECT * FROM incidents WHERE id = ?', [$result['lastInsertId']])), 201);
});

$router->get('/api/incidents/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireIncidentLoggingEnabled();
    $inc = dbGet('SELECT * FROM incidents WHERE id = ?', [$params['id']]);
    if (!$inc || !incidentCanViewDetail($user, $inc)) jsonResponse(['error' => 'Incident not found.'], 404);
    // Auditing every view of a restricted record (FR-INC-005 / FR-INC-008).
    if ($inc['sensitivity'] === 'restricted') logAudit(['userId' => $user['id'], 'action' => 'incident_view', 'entityType' => 'incident', 'entityId' => (string) $inc['id'], 'ipAddress' => clientIp()]);
    jsonResponse(array_merge(serializeIncident($inc), ['canEdit' => incidentCanEdit($user, $inc)]));
});

$router->patch('/api/incidents/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireIncidentLoggingEnabled();
    $inc = dbGet('SELECT * FROM incidents WHERE id = ?', [$params['id']]);
    if (!$inc || !incidentCanViewDetail($user, $inc)) jsonResponse(['error' => 'Incident not found.'], 404);
    if (!incidentCanEdit($user, $inc)) jsonResponse(['error' => 'You do not have permission to edit this record.'], 403);
    $f = incidentFieldsFromBody(requestBody(), $inc);
    if ($f['summary'] === '') jsonResponse(['error' => 'A short summary is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE incidents SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $inc['id']]);
    $closed = $f['status'] === 'closed' && $inc['status'] !== 'closed';
    logAudit(['userId' => $user['id'], 'action' => $closed ? 'incident_close' : 'incident_update', 'entityType' => 'incident', 'entityId' => (string) $inc['id'], 'ipAddress' => clientIp()]);
    jsonResponse(array_merge(serializeIncident(dbGet('SELECT * FROM incidents WHERE id = ?', [$inc['id']])), ['canEdit' => true]));
});

// Aggregate CSV export (admin/GLV only) - counts/status fields, no sensitive
// free-text - audited (FR-INC-008/009).
$router->get('/api/incidents/export', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireIncidentLoggingEnabled();
    if (!in_array($user['portal_role'], ['admin', 'group_leadership'], true)) jsonResponse(['error' => 'Not permitted.'], 403);
    $rows = [['ID', 'Type', 'Section', 'Status', 'Due', 'Created']];
    foreach (dbAll('SELECT * FROM incidents ORDER BY id') as $i) {
        $rows[] = [$i['id'], INCIDENT_TYPES[$i['record_type']] ?? $i['record_type'], $i['section_name'] ?? '', INCIDENT_STATUSES[$i['status']] ?? $i['status'], $i['due_date'] ?? '', substr((string) $i['created_at'], 0, 10)];
    }
    $csv = implode("\r\n", array_map(fn($r) => implode(',', array_map(fn($v) => '"' . str_replace('"', '""', (string) $v) . '"', $r)), $rows));
    logAudit(['userId' => $user['id'], 'action' => 'incident_export', 'ipAddress' => clientIp()]);
    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename="incident-summary.csv"');
    echo $csv;
    exit;
});
