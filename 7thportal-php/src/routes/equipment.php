<?php
// Equipment and asset register API (FRD FR-EQP). Leaders and admins only, and
// only when the module is enabled. All mutations are audited (FR-EQP-009).

// Pull the writable asset fields from a request body (camelCase) with fall-back to
// the existing row (snake_case), validated against the allowed enum keys. An empty
// string in the body clears the field; a field absent from the body is preserved.
function equipmentFieldsFromBody(array $body, array $existing = []): array
{
    // Text value: body wins (empty -> null), else keep existing.
    $val = function ($bodyKey, $existingKey) use ($body, $existing) {
        if (array_key_exists($bodyKey, $body)) return ($body[$bodyKey] === '' || $body[$bodyKey] === null) ? null : $body[$bodyKey];
        return $existing[$existingKey] ?? null;
    };
    $enum = function ($bodyKey, $existingKey, array $allowed, $default) use ($body, $existing) {
        $v = array_key_exists($bodyKey, $body) ? $body[$bodyKey] : ($existing[$existingKey] ?? $default);
        return array_key_exists($v, $allowed) ? $v : $default;
    };
    $value = null;
    if (array_key_exists('value', $body)) $value = ($body['value'] === '' || $body['value'] === null) ? null : (float) $body['value'];
    elseif (isset($existing['value'])) $value = $existing['value'] === null ? null : (float) $existing['value'];

    return [
        'name' => trim((string) ($body['name'] ?? $existing['name'] ?? '')),
        'category' => $enum('category', 'category', EQUIPMENT_CATEGORIES, 'general'),
        'quantity' => max(0, (int) ($body['quantity'] ?? $existing['quantity'] ?? 1)),
        'condition' => $enum('condition', 'condition', EQUIPMENT_CONDITIONS, 'good'),
        'status' => $enum('status', 'status', EQUIPMENT_STATUSES, 'available'),
        'owner_name' => $val('owner', 'owner_name'),
        'osm_section_id' => $val('sectionId', 'osm_section_id'),
        'section_name' => $val('sectionName', 'section_name'),
        'location' => $val('location', 'location'),
        'linked_event' => $val('linkedEvent', 'linked_event'),
        'purchase_date' => $val('purchaseDate', 'purchase_date'),
        'value' => $value,
        'notes' => $val('notes', 'notes'),
        'next_inspection_date' => $val('nextInspectionDate', 'next_inspection_date'),
        'replacement_due_date' => $val('replacementDueDate', 'replacement_due_date'),
        'loan_due_date' => $val('loanDueDate', 'loan_due_date'),
        'last_checked_date' => $val('lastCheckedDate', 'last_checked_date'),
    ];
}

$router->get('/api/equipment', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $where = []; $args = [];
    if (($q = queryParam('q'))) { $where[] = '(name LIKE ? OR location LIKE ? OR owner_name LIKE ?)'; $args[] = "%$q%"; $args[] = "%$q%"; $args[] = "%$q%"; }
    if (($c = queryParam('category')) && array_key_exists($c, EQUIPMENT_CATEGORIES)) { $where[] = 'category = ?'; $args[] = $c; }
    if (($s = queryParam('status')) && array_key_exists($s, EQUIPMENT_STATUSES)) { $where[] = 'status = ?'; $args[] = $s; }
    $sql = 'SELECT * FROM equipment_assets' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY name';
    $assets = array_map('serializeAsset', dbAll($sql, $args));

    $today = gmdate('Y-m-d');
    $in30 = gmdate('Y-m-d', strtotime('+30 days'));
    jsonResponse([
        'assets' => $assets,
        'summary' => [
            'total' => (int) dbGet('SELECT COUNT(*) AS n FROM equipment_assets')['n'],
            'checksDue' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND next_inspection_date IS NOT NULL AND next_inspection_date <= ?", [$in30])['n'],
            'replacementRisk' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND (condition IN ('poor','unserviceable') OR (replacement_due_date IS NOT NULL AND replacement_due_date < ?))", [$today])['n'],
            'onLoan' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status = 'loaned'")['n'],
        ],
        'meta' => ['categories' => EQUIPMENT_CATEGORIES, 'conditions' => EQUIPMENT_CONDITIONS, 'statuses' => EQUIPMENT_STATUSES],
    ]);
});

$router->post('/api/equipment', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $f = equipmentFieldsFromBody(requestBody());
    if ($f['name'] === '') jsonResponse(['error' => 'An asset name is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun(
        'INSERT INTO equipment_assets (' . implode(',', $cols) . ', created_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)',
        [...array_values($f), $user['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'equipment_create', 'entityType' => 'equipment', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['name' => $f['name']]]);
    jsonResponse(serializeAsset(dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$result['lastInsertId']])), 201);
});

$router->get('/api/equipment/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    jsonResponse(serializeAsset($a));
});

$router->patch('/api/equipment/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $existing = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$existing) jsonResponse(['error' => 'Asset not found.'], 404);
    $f = equipmentFieldsFromBody(requestBody(), $existing);
    if ($f['name'] === '') jsonResponse(['error' => 'An asset name is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE equipment_assets SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $existing['id']]);
    $statusChanged = $f['status'] !== $existing['status'];
    logAudit(['userId' => $user['id'], 'action' => $statusChanged ? 'equipment_status_change' : 'equipment_update', 'entityType' => 'equipment', 'entityId' => (string) $existing['id'], 'ipAddress' => clientIp(), 'details' => $statusChanged ? ['from' => $existing['status'], 'to' => $f['status']] : null]);
    jsonResponse(serializeAsset(dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$existing['id']])));
});

$router->delete('/api/equipment/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    dbRun('DELETE FROM equipment_assets WHERE id = ?', [$a['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_delete', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['name' => $a['name']]]);
    jsonResponse(['ok' => true]);
});
