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
        'tracking_mode' => $enum('trackingMode', 'tracking_mode', EQUIPMENT_TRACKING_MODES, 'bulk_reusable'),
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
            'itemTypes' => EQUIPMENT_ITEM_TYPES, 'restrictedCategories' => EQUIPMENT_RESTRICTED_CATEGORIES, 'locationConfidence' => EQUIPMENT_LOCATION_CONFIDENCE,
            'trackingModes' => EQUIPMENT_TRACKING_MODES],
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
    // v2.4.3: seed the opening state. Serialised assets get one instance per opening
    // unit (a qty>1 master row is not a valid live identity record); bulk/consumable
    // seed an opening ledger movement so the balance is reproducible from movements.
    $newId = (int) $result['lastInsertId'];
    if ($f['tracking_mode'] === 'serialised') {
        $n = max(0, (int) $f['quantity']);
        for ($k = 1; $k <= $n; $k++) {
            dbRun('INSERT INTO equipment_asset_instances (asset_id, instance_ref, condition, location) VALUES (?, ?, ?, ?)',
                [$newId, $f['name'] . ' #' . str_pad((string) $k, 2, '0', STR_PAD_LEFT), $f['condition'], $f['location']]);
        }
        equipmentSyncSerialisedQuantity($newId);
    } else {
        equipmentPostStockMovement($newId, 'opening', (int) $f['quantity'], 'Opening balance', null, (int) $user['id']);
    }
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
        $res = dbRun('INSERT INTO equipment_assets (' . implode(',', $cols) . ', created_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)', [...array_values($f), $user['id']]);
        // v2.4.3: the imported quantity is an opening balance, posted to the ledger.
        equipmentPostStockMovement((int) $res['lastInsertId'], 'opening', (int) ($f['quantity'] ?? 0), 'Opening balance (import)', null, (int) $user['id']);
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
    $isKit = ($a['item_type'] ?? 'asset') === 'kit';
    jsonResponse([
        'asset' => serializeAsset($a),
        'inspections' => array_map(fn($r) => serializeInspection($r, $userNames), dbAll('SELECT * FROM equipment_inspections WHERE asset_id = ? ORDER BY id DESC', [$a['id']])),
        'repairs' => array_map(fn($r) => serializeRepair($r, $userNames), dbAll("SELECT * FROM equipment_repairs WHERE asset_id = ? ORDER BY (status='resolved'), id DESC", [$a['id']])),
        'isKit' => $isKit,
        'kitComponents' => $isKit ? array_map('serializeKitComponent', kitComponentsFor((int) $a['id'])) : [],
        'kitChecks' => $isKit ? array_map(fn($r) => serializeKitCheck($r, $userNames), dbAll('SELECT * FROM equipment_kit_checks WHERE kit_asset_id = ? ORDER BY id DESC LIMIT 10', [$a['id']])) : [],
        'stockBalance' => ($a['tracking_mode'] ?? '') === 'serialised' ? equipmentInstanceCounts((int) $a['id'])['active'] : equipmentStockBalance((int) $a['id']),
        'stockLedger' => array_map(fn($m) => serializeStockMovement($m, $userNames), dbAll('SELECT * FROM equipment_stock_ledger WHERE asset_id = ? ORDER BY id DESC LIMIT 30', [$a['id']])),
        'isSerialised' => ($a['tracking_mode'] ?? '') === 'serialised',
        'instances' => ($a['tracking_mode'] ?? '') === 'serialised' ? array_map('serializeAssetInstance', equipmentInstances((int) $a['id'])) : [],
        'meta' => ['outcomes' => EQUIPMENT_INSPECTION_OUTCOMES, 'conditions' => EQUIPMENT_CONDITIONS, 'kitCheckTypes' => EQUIPMENT_KIT_CHECK_TYPES, 'kitComponentStatuses' => EQUIPMENT_KIT_COMPONENT_STATUSES, 'stockMovements' => EQUIPMENT_STOCK_MOVEMENTS, 'instanceStatuses' => EQUIPMENT_INSTANCE_STATUSES],
    ]);
});

// ── Kit contents checklist + completeness checks (FR-QM-ADV-002/003) ───────────

function equipmentKitOr404(array $user, $id): array
{
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$id]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    if (($a['item_type'] ?? 'asset') !== 'kit') jsonResponse(['error' => 'This item is not a kit. Set its type to "Kit" first.'], 400);
    return $a;
}

$router->post('/api/equipment/:id/kit-components', function ($params) {
    $user = requireAuth();
    $a = equipmentKitOr404($user, $params['id']);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A component name is required.'], 400);
    $qty = max(1, (int) ($b['expectedQty'] ?? 1));
    $sort = (int) (dbGet('SELECT COALESCE(MAX(sort_order),0) AS m FROM equipment_kit_components WHERE kit_asset_id = ?', [$a['id']])['m']) + 1;
    dbRun('INSERT INTO equipment_kit_components (kit_asset_id, name, expected_qty, sort_order) VALUES (?, ?, ?, ?)', [$a['id'], $name, $qty, $sort]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_kit_component_add', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['name' => $name]]);
    jsonResponse(array_map('serializeKitComponent', kitComponentsFor((int) $a['id'])));
});

$router->delete('/api/equipment/:id/kit-components/:cid', function ($params) {
    $user = requireAuth();
    $a = equipmentKitOr404($user, $params['id']);
    dbRun('DELETE FROM equipment_kit_components WHERE id = ? AND kit_asset_id = ?', [$params['cid'], $a['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_kit_component_remove', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['componentId' => (int) $params['cid']]]);
    jsonResponse(array_map('serializeKitComponent', kitComponentsFor((int) $a['id'])));
});

// Record a completeness check: a per-component status list; the overall result is
// derived (damaged/incomplete/complete). A damaged/incomplete check opens a repair
// task and locks the kit, mirroring an inspection failure.
$router->post('/api/equipment/:id/kit-checks', function ($params) {
    $user = requireAuth();
    $a = equipmentKitOr404($user, $params['id']);
    $b = requestBody();
    $type = array_key_exists($b['checkType'] ?? null, EQUIPMENT_KIT_CHECK_TYPES) ? $b['checkType'] : 'routine';
    $components = kitComponentsFor((int) $a['id']);
    if (!$components) jsonResponse(['error' => 'Add the expected contents before recording a check.'], 400);
    $statusMap = is_array($b['statuses'] ?? null) ? $b['statuses'] : [];
    $rows = []; $statuses = [];
    foreach ($components as $c) {
        $st = $statusMap[(string) $c['id']] ?? $statusMap[(int) $c['id']] ?? 'present';
        if (!array_key_exists($st, EQUIPMENT_KIT_COMPONENT_STATUSES)) $st = 'present';
        $rows[] = ['name' => $c['name'], 'status' => $st];
        $statuses[] = $st;
    }
    $result = kitCheckResult($statuses);
    $note = trim((string) ($b['note'] ?? '')) ?: null;
    $bookingId = !empty($b['bookingId']) ? (int) $b['bookingId'] : null;
    $checkId = dbRun('INSERT INTO equipment_kit_checks (kit_asset_id, check_type, result, note, booking_id, checked_by) VALUES (?, ?, ?, ?, ?, ?)', [$a['id'], $type, $result, $note, $bookingId, $user['id']])['lastInsertId'];
    foreach ($rows as $r) {
        dbRun('INSERT INTO equipment_kit_check_items (check_id, component_name, status) VALUES (?, ?, ?)', [$checkId, $r['name'], $r['status']]);
    }
    // An incomplete/damaged kit is locked and gets a repair task, like a failed inspection.
    if ($result !== 'complete') {
        dbRun("UPDATE equipment_assets SET maintenance_locked = 1, status = 'under_repair', updated_at = datetime('now') WHERE id = ?", [$a['id']]);
        dbRun('INSERT INTO equipment_repairs (asset_id, description, opened_by) VALUES (?, ?, ?)', [$a['id'], 'Kit check: ' . $result . ($note ? ' - ' . $note : ''), $user['id']]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'equipment_kit_check', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['type' => $type, 'result' => $result]]);
    jsonResponse(['result' => $result, 'checkId' => (int) $checkId]);
});

// ── Stock administration (v2.4.3 Appendix I 18.8) ──────────────────────────────
// Post an attributable stock movement. This is the ONLY way to change a balance -
// there is no set-current-quantity operation. Purchase adds; issue/loss/disposal
// subtract; a manual correction moves the balance to a stated target (a reason is
// mandatory). Every movement records delta, before/after, actor, reason and source.
$router->post('/api/equipment/:id/stock', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$params['id']]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    $b = requestBody();
    $type = $b['movementType'] ?? '';
    if (!array_key_exists($type, EQUIPMENT_STOCK_MOVEMENTS)) jsonResponse(['error' => 'Choose a valid stock movement.'], 400);
    $reason = trim((string) ($b['reason'] ?? '')) ?: null;
    $sourceRef = trim((string) ($b['sourceRef'] ?? '')) ?: null;
    $current = equipmentStockBalance((int) $a['id']);

    if ($type === 'correction') {
        if (!array_key_exists('targetBalance', $b) || !is_numeric($b['targetBalance'])) jsonResponse(['error' => 'A target balance is required for a correction.'], 400);
        if ($reason === null) jsonResponse(['error' => 'A reason is required for a manual correction.'], 400);
        $delta = max(0, (int) $b['targetBalance']) - $current;
        if ($delta === 0) jsonResponse(['error' => 'The target matches the current balance - nothing to correct.'], 400);
    } else {
        $qty = (int) ($b['quantity'] ?? 0);
        if ($qty < 1) jsonResponse(['error' => 'Enter a quantity of at least 1.'], 400);
        if (in_array($type, ['loss', 'disposal'], true) && $reason === null) jsonResponse(['error' => 'A reason is required for a loss or disposal.'], 400);
        $delta = $type === 'purchase' ? $qty : -$qty;
        if ($delta < 0 && $qty > $current) jsonResponse(['error' => "Only {$current} in stock - cannot remove {$qty}."], 400);
    }
    $after = equipmentPostStockMovement((int) $a['id'], $type, $delta, $reason, $sourceRef, (int) $user['id']);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_stock_' . $type, 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['delta' => $delta, 'after' => $after]]);
    jsonResponse(['balance' => $after]);
});

// ── Serialised asset instances (v2.4.3 18.4) ───────────────────────────────────

function equipmentSerialisedOr404(array $user, $id): array
{
    requireLeader($user);
    requireEquipmentEnabled();
    $a = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$id]);
    if (!$a) jsonResponse(['error' => 'Asset not found.'], 404);
    if (($a['tracking_mode'] ?? '') !== 'serialised') jsonResponse(['error' => 'This asset is not serialised. Set its tracking mode to "Serialised asset" first.'], 400);
    return $a;
}

$router->post('/api/equipment/:id/instances', function ($params) {
    $user = requireAuth();
    $a = equipmentSerialisedOr404($user, $params['id']);
    $b = requestBody();
    $ref = trim((string) ($b['ref'] ?? ''));
    if ($ref === '') jsonResponse(['error' => 'A unique reference / asset ID is required.'], 400);
    if (dbGet('SELECT 1 FROM equipment_asset_instances WHERE asset_id = ? AND instance_ref = ?', [$a['id'], $ref])) {
        jsonResponse(['error' => 'That reference is already used on this asset.'], 400);
    }
    $condition = array_key_exists($b['condition'] ?? null, EQUIPMENT_CONDITIONS) ? $b['condition'] : 'good';
    dbRun('INSERT INTO equipment_asset_instances (asset_id, instance_ref, condition, location, barcode, notes) VALUES (?, ?, ?, ?, ?, ?)',
        [$a['id'], $ref, $condition, trim((string) ($b['location'] ?? '')) ?: null, trim((string) ($b['barcode'] ?? '')) ?: null, trim((string) ($b['notes'] ?? '')) ?: null]);
    equipmentSyncSerialisedQuantity((int) $a['id']);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_instance_add', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['ref' => $ref]]);
    jsonResponse(array_map('serializeAssetInstance', equipmentInstances((int) $a['id'])));
});

$router->patch('/api/equipment/:id/instances/:iid', function ($params) {
    $user = requireAuth();
    $a = equipmentSerialisedOr404($user, $params['id']);
    $inst = dbGet('SELECT * FROM equipment_asset_instances WHERE id = ? AND asset_id = ?', [$params['iid'], $a['id']]);
    if (!$inst) jsonResponse(['error' => 'Instance not found.'], 404);
    $b = requestBody();
    $status = array_key_exists($b['status'] ?? null, EQUIPMENT_INSTANCE_STATUSES) ? $b['status'] : $inst['status'];
    $condition = array_key_exists($b['condition'] ?? null, EQUIPMENT_CONDITIONS) ? $b['condition'] : $inst['condition'];
    $retiredAt = in_array($status, ['retired', 'disposed'], true) ? ($inst['retired_at'] ?: gmdate('Y-m-d H:i:s')) : null;
    dbRun('UPDATE equipment_asset_instances SET status = ?, condition = ?, location = ?, barcode = ?, notes = ?, retired_at = ? WHERE id = ?',
        [$status, $condition,
         array_key_exists('location', $b) ? (trim((string) $b['location']) ?: null) : $inst['location'],
         array_key_exists('barcode', $b) ? (trim((string) $b['barcode']) ?: null) : $inst['barcode'],
         array_key_exists('notes', $b) ? (trim((string) $b['notes']) ?: null) : $inst['notes'],
         $retiredAt, $inst['id']]);
    equipmentSyncSerialisedQuantity((int) $a['id']);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_instance_update', 'entityType' => 'equipment', 'entityId' => (string) $a['id'], 'ipAddress' => clientIp(), 'details' => ['instanceId' => (int) $inst['id'], 'status' => $status]]);
    jsonResponse(array_map('serializeAssetInstance', equipmentInstances((int) $a['id'])));
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
    // v2.4.3 18.8: stock balance is never set directly - it moves only via the stock
    // ledger. Drop quantity/stock_level from an edit so the register form can't
    // overwrite the balance; use the stock-administration endpoint instead.
    unset($f['quantity'], $f['stock_level']);
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
