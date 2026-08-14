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
        'suitable_sections' => $val('suitableSections', 'suitable_sections'),
        'suitable_events' => $val('suitableEvents', 'suitable_events'),
        'max_group_size' => $intOrNull('maxGroupSize', 'max_group_size'),
        'setup_time_mins' => $intOrNull('setupTimeMins', 'setup_time_mins'),
        'vehicle_required' => $val('vehicleRequired', 'vehicle_required'),
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
        'trackingMode' => ['tracking mode', 'tracking'], 'unit' => ['unit', 'issue unit', 'quantity unit', 'uom'],
    ];
    $header = array_map(fn($h) => strtolower(trim((string) $h)), array_shift($rows));
    $col = [];
    foreach ($aliases as $field => $names) {
        foreach ($names as $n) { $i = array_search($n, $header, true); if ($i !== false) { $col[$field] = $i; break; } }
    }
    if (!isset($col['name'])) jsonResponse(['error' => 'The CSV needs a "Name" column.'], 422);

    $cell = fn($row, $field) => isset($col[$field]) ? trim((string) ($row[$col[$field]] ?? '')) : '';
    $normTrack = function ($v) {
        $v = strtolower(trim((string) $v));
        if ($v === '') return null;
        if (str_contains($v, 'serial')) return 'serialised';
        if (str_contains($v, 'consum')) return 'consumable';
        if (str_contains($v, 'bulk') || str_contains($v, 'reusable')) return 'bulk_reusable';
        return null; // unrecognised -> held for review
    };
    $ready = []; $errors = [];
    foreach ($rows as $n => $row) {
        $rowNo = $n + 2; // 1-based + header
        $name = $cell($row, 'name');
        if ($name === '') { $errors[] = ['row' => $rowNo, 'error' => 'Missing name']; continue; }
        $ready[] = [
            'row' => $rowNo, 'name' => $name,
            'category' => equipmentEnumFromInput($cell($row, 'category'), EQUIPMENT_CATEGORIES, 'general'),
            'location' => $cell($row, 'location') ?: null,
            'tracking_mode' => $normTrack($cell($row, 'trackingMode')),
            'issue_unit' => $cell($row, 'unit') ?: null,
            'opening_qty' => max(0, (int) ($cell($row, 'quantity') ?: 1)),
        ];
    }

    if ($dryRun) {
        jsonResponse(['dryRun' => true, 'readyCount' => count($ready), 'errors' => $errors, 'preview' => array_map(fn($r) => ['row' => $r['row'], 'name' => $r['name'], 'category' => $r['category'], 'quantity' => $r['opening_qty'], 'trackingMode' => $r['tracking_mode']], array_slice($ready, 0, 10))]);
    }

    // v2.4.3: stage into an import batch of review rows rather than creating live
    // assets. Rows without an explicit tracking mode (or otherwise incomplete) are
    // held in needs_review; only 'ready' rows can later be activated.
    if (!$ready) jsonResponse(['error' => 'No importable rows found.'], 422);
    $batchId = dbRun('INSERT INTO equipment_import_batches (created_by) VALUES (?)', [$user['id']])['lastInsertId'];
    foreach ($ready as $r) {
        $review = equipmentImportRowReview($r);
        dbRun('INSERT INTO equipment_import_rows (batch_id, source_row, name, category, location, tracking_mode, issue_unit, opening_qty, review_status, issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$batchId, $r['row'], $r['name'], $r['category'], $r['location'], $r['tracking_mode'], $r['issue_unit'], $r['opening_qty'], $review['status'], $review['issues'] ? json_encode($review['issues']) : null]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'equipment_import_stage', 'entityType' => 'equipment_import_batch', 'entityId' => (string) $batchId, 'ipAddress' => clientIp(), 'details' => ['rows' => count($ready), 'skipped' => count($errors)]]);
    jsonResponse(['ok' => true, 'batchId' => (int) $batchId, 'staged' => count($ready), 'skipped' => count($errors), 'errors' => $errors]);
});

// ── Import review (v2.4.3 Appendix I) ──────────────────────────────────────────
// Registered before /api/equipment/:id so these prefixes aren't captured as an id.

$router->get('/api/equipment/import-batches/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $b = dbGet('SELECT * FROM equipment_import_batches WHERE id = ?', [$params['id']]);
    if (!$b) jsonResponse(['error' => 'Import batch not found.'], 404);
    $names = [];
    foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $names[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    jsonResponse(array_merge(serializeImportBatch($b, $names), [
        'rows' => array_map('serializeImportRow', dbAll('SELECT * FROM equipment_import_rows WHERE batch_id = ? ORDER BY id', [$b['id']])),
        'meta' => ['categories' => EQUIPMENT_CATEGORIES, 'trackingModes' => EQUIPMENT_TRACKING_MODES],
    ]));
});

function equipmentImportRowOr404(array $user, $id): array
{
    requireLeader($user);
    requireEquipmentEnabled();
    $r = dbGet('SELECT * FROM equipment_import_rows WHERE id = ?', [$id]);
    if (!$r) jsonResponse(['error' => 'Row not found.'], 404);
    if ($r['review_status'] === 'activated') jsonResponse(['error' => 'This row has already been activated.'], 409);
    return $r;
}

$router->patch('/api/equipment/import-rows/:id', function ($params) {
    $user = requireAuth();
    $r = equipmentImportRowOr404($user, $params['id']);
    $b = requestBody();
    $tm = array_key_exists('trackingMode', $b) ? (array_key_exists($b['trackingMode'], EQUIPMENT_TRACKING_MODES) ? $b['trackingMode'] : null) : $r['tracking_mode'];
    $fields = [
        'name' => array_key_exists('name', $b) ? trim((string) $b['name']) : $r['name'],
        'category' => array_key_exists('category', $b) && array_key_exists($b['category'], EQUIPMENT_CATEGORIES) ? $b['category'] : $r['category'],
        'location' => array_key_exists('location', $b) ? (trim((string) $b['location']) ?: null) : $r['location'],
        'tracking_mode' => $tm,
        'issue_unit' => array_key_exists('issueUnit', $b) ? (trim((string) $b['issueUnit']) ?: null) : $r['issue_unit'],
        'opening_qty' => array_key_exists('openingQty', $b) ? max(0, (int) $b['openingQty']) : (int) $r['opening_qty'],
    ];
    $review = equipmentImportRowReview($fields);
    dbRun('UPDATE equipment_import_rows SET name = ?, category = ?, location = ?, tracking_mode = ?, issue_unit = ?, opening_qty = ?, review_status = ?, issues = ? WHERE id = ?',
        [$fields['name'], $fields['category'], $fields['location'], $fields['tracking_mode'], $fields['issue_unit'], $fields['opening_qty'], $review['status'], $review['issues'] ? json_encode($review['issues']) : null, $r['id']]);
    jsonResponse(serializeImportRow(dbGet('SELECT * FROM equipment_import_rows WHERE id = ?', [$r['id']])));
});

// Split a mixed row into two (e.g. reusable + consumable) so each has one
// unambiguous tracking mode; the QM then classifies each half.
$router->post('/api/equipment/import-rows/:id/split', function ($params) {
    $user = requireAuth();
    $r = equipmentImportRowOr404($user, $params['id']);
    dbRun('INSERT INTO equipment_import_rows (batch_id, source_row, name, category, location, tracking_mode, issue_unit, opening_qty, review_status, issues) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$r['batch_id'], $r['source_row'], $r['name'] . ' (split)', $r['category'], $r['location'], null, null, 0, 'needs_review', json_encode(['No explicit tracking mode'])]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_import_split', 'entityType' => 'equipment_import_row', 'entityId' => (string) $r['id'], 'ipAddress' => clientIp()]);
    jsonResponse(array_map('serializeImportRow', dbAll('SELECT * FROM equipment_import_rows WHERE batch_id = ? ORDER BY id', [$r['batch_id']])));
});

$router->post('/api/equipment/import-rows/:id/skip', function ($params) {
    $user = requireAuth();
    $r = equipmentImportRowOr404($user, $params['id']);
    dbRun("UPDATE equipment_import_rows SET review_status = 'skipped' WHERE id = ?", [$r['id']]);
    jsonResponse(serializeImportRow(dbGet('SELECT * FROM equipment_import_rows WHERE id = ?', [$r['id']])));
});

// Activate the validated ('ready') rows: create the live asset with its opening
// state (serialised -> instances; bulk/consumable -> opening ledger movement).
// Rows still in needs_review are left for the QM to resolve.
$router->post('/api/equipment/import-batches/:id/activate', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $b = dbGet('SELECT * FROM equipment_import_batches WHERE id = ?', [$params['id']]);
    if (!$b) jsonResponse(['error' => 'Import batch not found.'], 404);
    $activated = 0;
    foreach (dbAll("SELECT * FROM equipment_import_rows WHERE batch_id = ? AND review_status = 'ready'", [$b['id']]) as $r) {
        $itemType = $r['tracking_mode'] === 'consumable' ? 'consumable' : 'asset';
        $res = dbRun('INSERT INTO equipment_assets (name, category, location, tracking_mode, item_type, issue_unit, quantity, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$r['name'], $r['category'] ?: 'general', $r['location'], $r['tracking_mode'], $itemType, $r['issue_unit'], (int) $r['opening_qty'], $user['id']]);
        $assetId = (int) $res['lastInsertId'];
        if ($r['tracking_mode'] === 'serialised') {
            for ($k = 1; $k <= (int) $r['opening_qty']; $k++) {
                dbRun('INSERT INTO equipment_asset_instances (asset_id, instance_ref) VALUES (?, ?)', [$assetId, $r['name'] . ' #' . str_pad((string) $k, 2, '0', STR_PAD_LEFT)]);
            }
            equipmentSyncSerialisedQuantity($assetId);
        } else {
            equipmentPostStockMovement($assetId, 'opening', (int) $r['opening_qty'], 'Opening balance (import)', null, (int) $user['id']);
        }
        dbRun("UPDATE equipment_import_rows SET review_status = 'activated', created_asset_id = ? WHERE id = ?", [$assetId, $r['id']]);
        $activated++;
    }
    $remaining = (int) dbGet("SELECT COUNT(*) AS n FROM equipment_import_rows WHERE batch_id = ? AND review_status IN ('needs_review','ready')", [$b['id']])['n'];
    if ($remaining === 0) dbRun("UPDATE equipment_import_batches SET status = 'activated' WHERE id = ?", [$b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_import_activate', 'entityType' => 'equipment_import_batch', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['activated' => $activated]]);
    jsonResponse(['ok' => true, 'activated' => $activated, 'remaining' => $remaining]);
});

// ── Stocktake (v2.4.3 Appendix I 18.8) ─────────────────────────────────────────
// Registered before /api/equipment/:id so "stocktakes" isn't captured as an id.

$router->get('/api/equipment/stocktakes', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $names = [];
    foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $names[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    jsonResponse(array_map(fn($s) => serializeStocktake($s, $names), dbAll('SELECT * FROM equipment_stocktakes ORDER BY id DESC LIMIT 20')));
});

// Start a stocktake: snapshot the current balance of each in-scope bulk/consumable
// item into count lines (serialised items are reconciled via their unit panel).
$router->post('/api/equipment/stocktakes', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $b = requestBody();
    $where = ["tracking_mode IN ('bulk_reusable','consumable')", "status != 'retired'"]; $args = [];
    $scopeBits = [];
    if (($c = $b['category'] ?? null) && array_key_exists($c, EQUIPMENT_CATEGORIES)) { $where[] = 'category = ?'; $args[] = $c; $scopeBits[] = EQUIPMENT_CATEGORIES[$c]; }
    if (($loc = trim((string) ($b['location'] ?? ''))) !== '') { $where[] = '(location LIKE ? OR storage_area LIKE ?)'; $args[] = "%$loc%"; $args[] = "%$loc%"; $scopeBits[] = 'location ~ "' . $loc . '"'; }
    $assets = dbAll('SELECT id FROM equipment_assets WHERE ' . implode(' AND ', $where) . ' ORDER BY name', $args);
    if (!$assets) jsonResponse(['error' => 'No stock-tracked items match that scope.'], 400);
    $ref = 'STK-' . date('Y') . '-' . str_pad((string) ((int) (dbGet('SELECT COALESCE(MAX(id),0) AS n FROM equipment_stocktakes')['n']) + 1), 4, '0', STR_PAD_LEFT);
    $scope = $scopeBits ? implode(', ', $scopeBits) : 'All stock-tracked items';
    $stId = dbRun('INSERT INTO equipment_stocktakes (reference, scope, note, created_by) VALUES (?, ?, ?, ?)', [$ref, $scope, trim((string) ($b['note'] ?? '')) ?: null, $user['id']])['lastInsertId'];
    foreach ($assets as $a) {
        dbRun('INSERT INTO equipment_stocktake_lines (stocktake_id, asset_id, system_qty) VALUES (?, ?, ?)', [$stId, $a['id'], equipmentStockBalance((int) $a['id'])]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'equipment_stocktake_start', 'entityType' => 'equipment_stocktake', 'entityId' => (string) $stId, 'ipAddress' => clientIp(), 'details' => ['ref' => $ref, 'lines' => count($assets)]]);
    jsonResponse(['id' => (int) $stId, 'reference' => $ref], 201);
});

$router->get('/api/equipment/stocktakes/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $s = dbGet('SELECT * FROM equipment_stocktakes WHERE id = ?', [$params['id']]);
    if (!$s) jsonResponse(['error' => 'Stocktake not found.'], 404);
    $names = [];
    foreach (dbAll('SELECT id, first_name, last_name FROM users') as $u) $names[(int) $u['id']] = trim($u['first_name'] . ' ' . $u['last_name']);
    jsonResponse(array_merge(serializeStocktake($s, $names), [
        'lines' => array_map('serializeStocktakeLine', dbAll('SELECT * FROM equipment_stocktake_lines WHERE stocktake_id = ? ORDER BY id', [$s['id']])),
    ]));
});

$router->patch('/api/equipment/stocktakes/:id/lines/:lid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $s = dbGet('SELECT * FROM equipment_stocktakes WHERE id = ?', [$params['id']]);
    if (!$s) jsonResponse(['error' => 'Stocktake not found.'], 404);
    if ($s['status'] !== 'draft') jsonResponse(['error' => 'This stocktake has already been posted.'], 409);
    $line = dbGet('SELECT * FROM equipment_stocktake_lines WHERE id = ? AND stocktake_id = ?', [$params['lid'], $s['id']]);
    if (!$line) jsonResponse(['error' => 'Line not found.'], 404);
    $b = requestBody();
    $counted = (array_key_exists('countedQty', $b) && $b['countedQty'] !== '' && $b['countedQty'] !== null) ? max(0, (int) $b['countedQty']) : null;
    dbRun('UPDATE equipment_stocktake_lines SET counted_qty = ? WHERE id = ?', [$counted, $line['id']]);
    jsonResponse(serializeStocktakeLine(dbGet('SELECT * FROM equipment_stocktake_lines WHERE id = ?', [$line['id']])));
});

// Post the stocktake: each counted line that differs from the live balance gets a
// 'stocktake' ledger movement adjusting to the counted figure. A reason is required.
$router->post('/api/equipment/stocktakes/:id/post', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireEquipmentEnabled();
    $s = dbGet('SELECT * FROM equipment_stocktakes WHERE id = ?', [$params['id']]);
    if (!$s) jsonResponse(['error' => 'Stocktake not found.'], 404);
    if ($s['status'] !== 'draft') jsonResponse(['error' => 'This stocktake has already been posted.'], 409);
    $b = requestBody();
    $reason = trim((string) ($b['reason'] ?? ''));
    if ($reason === '') jsonResponse(['error' => 'A reason is required before posting a stocktake.'], 400);
    $adjusted = 0;
    foreach (dbAll('SELECT * FROM equipment_stocktake_lines WHERE stocktake_id = ? AND counted_qty IS NOT NULL', [$s['id']]) as $line) {
        $current = equipmentStockBalance((int) $line['asset_id']);
        $delta = (int) $line['counted_qty'] - $current;
        if ($delta === 0) { dbRun('UPDATE equipment_stocktake_lines SET posted_delta = 0 WHERE id = ?', [$line['id']]); continue; }
        equipmentPostStockMovement((int) $line['asset_id'], 'stocktake', $delta, 'Stocktake ' . $s['reference'] . ': ' . $reason, $s['reference'], (int) $user['id']);
        dbRun('UPDATE equipment_stocktake_lines SET posted_delta = ? WHERE id = ?', [$delta, $line['id']]);
        $adjusted++;
    }
    dbRun("UPDATE equipment_stocktakes SET status = 'posted', posted_at = datetime('now'), note = ? WHERE id = ?", [trim($reason), $s['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'equipment_stocktake_post', 'entityType' => 'equipment_stocktake', 'entityId' => (string) $s['id'], 'ipAddress' => clientIp(), 'details' => ['adjusted' => $adjusted]]);
    jsonResponse(['ok' => true, 'adjusted' => $adjusted]);
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
