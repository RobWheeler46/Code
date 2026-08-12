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

    // Optional enum: the body value if it's an allowed key, empty clears to null,
    // otherwise keep existing. Used for fields that may legitimately be unset.
    $nenum = function ($bodyKey, $existingKey, array $allowed) use ($body, $existing) {
        if (array_key_exists($bodyKey, $body)) {
            $v = $body[$bodyKey];
            if ($v === '' || $v === null) return null;
            return array_key_exists($v, $allowed) ? $v : ($existing[$existingKey] ?? null);
        }
        return $existing[$existingKey] ?? null;
    };
    $intOrNull = function ($bodyKey, $existingKey) use ($body, $existing) {
        if (array_key_exists($bodyKey, $body)) return ($body[$bodyKey] === '' || $body[$bodyKey] === null) ? null : (int) $body[$bodyKey];
        return isset($existing[$existingKey]) && $existing[$existingKey] !== null ? (int) $existing[$existingKey] : null;
    };
    $bool = fn($bodyKey, $existingKey) => array_key_exists($bodyKey, $body) ? (!empty($body[$bodyKey]) ? 1 : 0) : (int) ($existing[$existingKey] ?? 0);

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
        // QM Advanced Controls richer inventory model.
        'item_type' => $enum('itemType', 'item_type', EQUIPMENT_ITEM_TYPES, 'asset'),
        'parent_kit_id' => $intOrNull('parentKitId', 'parent_kit_id'),
        'restricted' => $bool('restricted', 'restricted'),
        'restricted_category' => $nenum('restrictedCategory', 'restricted_category', EQUIPMENT_RESTRICTED_CATEGORIES),
        'storage_area' => $val('storageArea', 'storage_area'),
        'location_code' => $val('locationCode', 'location_code'),
        'location_confidence' => $nenum('locationConfidence', 'location_confidence', EQUIPMENT_LOCATION_CONFIDENCE),
        'stock_level' => $intOrNull('stockLevel', 'stock_level'),
        'reorder_threshold' => $intOrNull('reorderThreshold', 'reorder_threshold'),
        'issue_unit' => $val('issueUnit', 'issue_unit'),
        'replacement_value' => array_key_exists('replacementValue', $body) ? (($body['replacementValue'] === '' || $body['replacementValue'] === null) ? null : (float) $body['replacementValue']) : (isset($existing['replacement_value']) && $existing['replacement_value'] !== null ? (float) $existing['replacement_value'] : null),
        'supplier' => $val('supplier', 'supplier'),
        'warranty_expiry' => $val('warrantyExpiry', 'warranty_expiry'),
        'serial_number' => $val('serialNumber', 'serial_number'),
        'insurance_relevant' => $bool('insuranceRelevant', 'insurance_relevant'),
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
            'lowStock' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE item_type = 'consumable' AND stock_level IS NOT NULL AND reorder_threshold IS NOT NULL AND stock_level <= reorder_threshold")['n'],
            'restricted' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE restricted = 1 AND status != 'retired'")['n'],
            'unknownLocation' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND location_confidence = 'unknown'")['n'],
        ],
        'meta' => ['categories' => EQUIPMENT_CATEGORIES, 'conditions' => EQUIPMENT_CONDITIONS, 'statuses' => EQUIPMENT_STATUSES,
            'itemTypes' => EQUIPMENT_ITEM_TYPES, 'restrictedCategories' => EQUIPMENT_RESTRICTED_CATEGORIES, 'locationConfidence' => EQUIPMENT_LOCATION_CONFIDENCE],
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

// A ready-to-fill CSV template for bulk import (one asset per row).
$router->get('/api/equipment/import-template.csv', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $header = ['Name', 'Category', 'Quantity', 'Condition', 'Status', 'Owner', 'Location', 'Section', 'Value', 'Purchase date', 'Next inspection date', 'Replacement due date', 'Notes'];
    $example = ['3-person tent', 'camping', '4', 'good', 'available', 'Quartermaster', 'Store room, shelf B', '', '120', '', '2027-05-01', '', 'Blue bags'];
    $out = fopen('php://temp', 'r+');
    fputcsv($out, $header);
    fputcsv($out, $example);
    rewind($out);
    $csv = stream_get_contents($out);
    fclose($out);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="7thportal-equipment-import-template.csv"');
    echo "\xEF\xBB\xBF" . $csv;
    exit;
});

// Export the whole register as CSV (stock-take / insurance schedule / backup).
// Honours the same q/category/status filters as the list, so a filtered view can
// be exported too. Columns are import-compatible - the extra read-only columns
// (Asset code, Last checked, Loan due, Maintenance locked) are simply ignored on
// re-import, so a file exported here round-trips back through the importer.
$router->get('/api/equipment/export.csv', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $where = []; $args = [];
    if (($q = queryParam('q'))) { $where[] = '(name LIKE ? OR location LIKE ? OR owner_name LIKE ?)'; $args[] = "%$q%"; $args[] = "%$q%"; $args[] = "%$q%"; }
    if (($c = queryParam('category')) && array_key_exists($c, EQUIPMENT_CATEGORIES)) { $where[] = 'category = ?'; $args[] = $c; }
    if (($s = queryParam('status')) && array_key_exists($s, EQUIPMENT_STATUSES)) { $where[] = 'status = ?'; $args[] = $s; }
    $sql = 'SELECT * FROM equipment_assets' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY name';

    $out = fopen('php://temp', 'r+');
    fputcsv($out, ['Asset code', 'Name', 'Category', 'Quantity', 'Condition', 'Status', 'Owner', 'Location', 'Section', 'Value', 'Purchase date', 'Next inspection date', 'Replacement due date', 'Last checked date', 'Loan due date', 'Maintenance locked', 'Notes']);
    foreach (dbAll($sql, $args) as $a) {
        fputcsv($out, [
            'EQP-' . str_pad((string) $a['id'], 4, '0', STR_PAD_LEFT),
            $a['name'], $a['category'], (int) $a['quantity'], $a['condition'], $a['status'],
            $a['owner_name'], $a['location'], $a['section_name'],
            $a['value'] !== null ? (float) $a['value'] : '',
            $a['purchase_date'], $a['next_inspection_date'], $a['replacement_due_date'],
            $a['last_checked_date'], $a['loan_due_date'],
            !empty($a['maintenance_locked']) ? 'yes' : 'no', $a['notes'],
        ]);
    }
    rewind($out);
    $csv = stream_get_contents($out);
    fclose($out);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_export', 'entityType' => 'equipment', 'ipAddress' => clientIp()]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="7thportal-equipment-register-' . gmdate('Y-m-d') . '.csv"');
    echo "\xEF\xBB\xBF" . $csv;
    exit;
});

// Bulk import assets from CSV text. dryRun previews the result without writing.
$router->post('/api/equipment/import', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $b = requestBody();
    $csv = trim((string) ($b['csv'] ?? ''));
    $dryRun = !empty($b['dryRun']);
    if ($csv === '') jsonResponse(['error' => 'No CSV content was provided.'], 422);
    $lines = preg_split('/\r\n|\r|\n/', $csv);
    $rows = array_values(array_filter(array_map('str_getcsv', $lines), fn($r) => count(array_filter($r, fn($c) => trim((string) $c) !== '')) > 0));
    if (count($rows) < 2) jsonResponse(['error' => 'The CSV needs a header row and at least one data row.'], 422);

    // Map header names (case-insensitive, with common aliases) to column indexes.
    $aliases = [
        'name' => ['name', 'asset name', 'item', 'equipment', 'asset'],
        'category' => ['category'], 'quantity' => ['quantity', 'qty'],
        'condition' => ['condition'], 'status' => ['status'],
        'owner' => ['owner', 'owner name', 'responsible'], 'location' => ['location', 'storage location', 'storage'],
        'section' => ['section', 'section name'], 'value' => ['value', 'value (£)', 'cost'],
        'purchaseDate' => ['purchase date', 'purchased'], 'nextInspectionDate' => ['next inspection date', 'next inspection', 'next check'],
        'replacementDueDate' => ['replacement due date', 'replacement due'], 'notes' => ['notes', 'note'],
    ];
    $header = array_map(fn($h) => strtolower(trim((string) $h)), array_shift($rows));
    $col = [];
    foreach ($aliases as $field => $names) {
        foreach ($names as $n) { $i = array_search($n, $header, true); if ($i !== false) { $col[$field] = $i; break; } }
    }
    if (!isset($col['name'])) jsonResponse(['error' => 'The CSV needs a "Name" column.'], 422);

    $cell = fn($row, $field) => isset($col[$field]) ? trim((string) ($row[$col[$field]] ?? '')) : '';
    $ready = []; $errors = [];
    foreach ($rows as $n => $row) {
        $rowNo = $n + 2; // 1-based + header
        $name = $cell($row, 'name');
        if ($name === '') { $errors[] = ['row' => $rowNo, 'error' => 'Missing name']; continue; }
        $ready[] = [
            'row' => $rowNo,
            'fields' => [
                'name' => $name,
                'category' => equipmentEnumFromInput($cell($row, 'category'), EQUIPMENT_CATEGORIES, 'general'),
                'quantity' => max(0, (int) ($cell($row, 'quantity') ?: 1)),
                'condition' => equipmentEnumFromInput($cell($row, 'condition'), EQUIPMENT_CONDITIONS, 'good'),
                'status' => equipmentEnumFromInput($cell($row, 'status'), EQUIPMENT_STATUSES, 'available'),
                'owner_name' => $cell($row, 'owner') ?: null,
                'location' => $cell($row, 'location') ?: null,
                'section_name' => $cell($row, 'section') ?: null,
                'value' => is_numeric($cell($row, 'value')) ? (float) $cell($row, 'value') : null,
                'purchase_date' => $cell($row, 'purchaseDate') ?: null,
                'next_inspection_date' => $cell($row, 'nextInspectionDate') ?: null,
                'replacement_due_date' => $cell($row, 'replacementDueDate') ?: null,
                'notes' => $cell($row, 'notes') ?: null,
            ],
        ];
    }

    if ($dryRun) {
        jsonResponse(['dryRun' => true, 'readyCount' => count($ready), 'errors' => $errors, 'preview' => array_map(fn($r) => ['row' => $r['row'], 'name' => $r['fields']['name'], 'category' => $r['fields']['category'], 'quantity' => $r['fields']['quantity']], array_slice($ready, 0, 10))]);
    }

    $imported = 0;
    foreach ($ready as $r) {
        $f = $r['fields'];
        $cols = array_keys($f);
        dbRun('INSERT INTO equipment_assets (' . implode(',', $cols) . ', created_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)', [...array_values($f), $user['id']]);
        $imported++;
    }
    logAudit(['userId' => $user['id'], 'action' => 'equipment_import', 'entityType' => 'equipment', 'ipAddress' => clientIp(), 'details' => ['imported' => $imported, 'skipped' => count($errors)]]);
    jsonResponse(['ok' => true, 'imported' => $imported, 'skipped' => count($errors), 'errors' => $errors]);
});

$router->get('/api/equipment/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    $userNames = [];
    foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $userNames[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    jsonResponse([
        'asset' => serializeAsset($a),
        'inspections' => array_map(fn($r) => serializeInspection($r, $userNames), dbAll('SELECT * FROM equipment_inspections WHERE asset_id = ? ORDER BY id DESC', [$a['id']])),
        'repairs' => array_map(fn($r) => serializeRepair($r, $userNames), dbAll("SELECT * FROM equipment_repairs WHERE asset_id = ? ORDER BY (status='resolved'), id DESC", [$a['id']])),
        'meta' => ['outcomes' => EQUIPMENT_INSPECTION_OUTCOMES, 'conditions' => EQUIPMENT_CONDITIONS],
    ]);
});

// Record an inspection: applies the outcome (condition/lock/repair/retire) and
// logs it to the asset history (QM Maintenance & Inspection Workflow).
$router->post('/api/equipment/:id/inspections', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    $b = requestBody();
    $outcome = $b['outcome'] ?? '';
    if (!array_key_exists($outcome, EQUIPMENT_INSPECTION_OUTCOMES)) jsonResponse(['error' => 'Choose an inspection outcome.'], 422);
    if (in_array($outcome, ['fail', 'repair', 'unable'], true) && trim((string) ($b['note'] ?? '')) === '') {
        jsonResponse(['error' => 'A note is required for this outcome.'], 422);
    }
    $asset = equipmentApplyInspection($a, $outcome, $b, (int) $user['id']);
    jsonResponse(serializeAsset($asset));
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
