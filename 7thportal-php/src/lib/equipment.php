<?php
// Equipment and asset register (FRD FR-EQP). Optional module, off by default.

const EQUIPMENT_CATEGORIES = ['camping' => 'Camping equipment', 'activity' => 'Activity kit', 'safety' => 'Safety equipment', 'general' => 'General equipment'];
const EQUIPMENT_CONDITIONS = ['new' => 'New', 'good' => 'Good', 'fair' => 'Fair', 'poor' => 'Poor', 'unserviceable' => 'Unserviceable'];
const EQUIPMENT_STATUSES = ['available' => 'Available', 'allocated' => 'Allocated', 'loaned' => 'Loaned', 'under_repair' => 'Under repair', 'retired' => 'Retired', 'missing' => 'Missing'];
// QM v2.4.3 tracking modes (Appendix I 18.4).
const EQUIPMENT_TRACKING_MODES = ['serialised' => 'Serialised asset', 'bulk_reusable' => 'Bulk reusable', 'consumable' => 'Consumable'];
// Stock-administration movement types a user can post (opening/return are posted by
// system flows; stocktake is posted by the stocktake flow).
const EQUIPMENT_STOCK_MOVEMENTS = ['purchase' => 'Purchase / receipt', 'issue' => 'Issue / consume', 'loss' => 'Loss / missing', 'disposal' => 'Disposal / retire', 'correction' => 'Manual correction'];

// Current ledger-derived balance for an asset - the sum of every attributable
// movement (v2.4.3 18.8). This is the authoritative quantity; the cached
// quantity/stock_level column is only ever written by equipmentPostStockMovement.
function equipmentStockBalance(int $assetId): int
{
    return (int) (dbGet('SELECT COALESCE(SUM(delta), 0) AS b FROM equipment_stock_ledger WHERE asset_id = ?', [$assetId])['b'] ?? 0);
}

// Post an attributable stock movement and refresh the cached balance column. There
// is deliberately NO direct set-quantity path anywhere else. A decrement is clamped
// so the balance never goes negative. Returns the new balance.
function equipmentPostStockMovement(int $assetId, string $type, int $delta, ?string $reason, ?string $sourceRef, int $actorUserId): int
{
    $asset = dbGet('SELECT tracking_mode, item_type FROM equipment_assets WHERE id = ?', [$assetId]);
    $current = equipmentStockBalance($assetId);
    $after = max(0, $current + $delta);
    $applied = $after - $current;
    dbRun('INSERT INTO equipment_stock_ledger (asset_id, movement_type, delta, balance_after, reason, source_ref, actor_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$assetId, $type, $applied, $after, $reason, $sourceRef, $actorUserId ?: null]);
    // Keep the legacy column in sync so date-aware availability keeps working; a
    // consumable's balance lives in stock_level, everything else in quantity.
    $col = (($asset['tracking_mode'] ?? '') === 'consumable' || ($asset['item_type'] ?? '') === 'consumable') ? 'stock_level' : 'quantity';
    dbRun("UPDATE equipment_assets SET $col = ?, updated_at = datetime('now') WHERE id = ?", [$after, $assetId]);
    return $after;
}
// QM v2.4.3 serialised asset instance lifecycle (Appendix I 18.4).
const EQUIPMENT_INSTANCE_STATUSES = ['available' => 'Available', 'reserved' => 'Reserved', 'issued' => 'Issued', 'maintenance' => 'Maintenance', 'quarantine' => 'Quarantine', 'retired' => 'Retired', 'disposed' => 'Disposed'];

function equipmentInstances(int $assetId): array
{
    return dbAll('SELECT * FROM equipment_asset_instances WHERE asset_id = ? ORDER BY instance_ref, id', [$assetId]);
}
// Active = still owned (not retired/disposed); available = ready to book.
function equipmentInstanceCounts(int $assetId): array
{
    $active = (int) dbGet("SELECT COUNT(*) AS n FROM equipment_asset_instances WHERE asset_id = ? AND status NOT IN ('retired','disposed')", [$assetId])['n'];
    $available = (int) dbGet("SELECT COUNT(*) AS n FROM equipment_asset_instances WHERE asset_id = ? AND status = 'available'", [$assetId])['n'];
    return ['active' => $active, 'available' => $available];
}
// v2.4.4 (AC-126): a record has operational history once stock has moved beyond
// its opening balance, a serialised unit has left the shelf, it has been booked,
// or it has an inspection/repair trail. Tracking mode locks on the normal Edit
// form once this is true - a change then requires the controlled migration, not a
// master-data edit. (A just-created record has none of this, so a QM can still fix
// a mistaken tracking choice immediately after creating it.)
function equipmentHasHistory(int $assetId): bool
{
    if ((int) dbGet("SELECT COUNT(*) AS n FROM equipment_stock_ledger WHERE asset_id = ? AND movement_type != 'opening'", [$assetId])['n'] > 0) return true;
    if ((int) dbGet("SELECT COUNT(*) AS n FROM equipment_asset_instances WHERE asset_id = ? AND status != 'available'", [$assetId])['n'] > 0) return true;
    if ((int) dbGet('SELECT COUNT(*) AS n FROM qm_booking_items WHERE equipment_asset_id = ?', [$assetId])['n'] > 0) return true;
    if ((int) dbGet('SELECT COUNT(*) AS n FROM equipment_inspections WHERE asset_id = ?', [$assetId])['n'] > 0) return true;
    if ((int) dbGet('SELECT COUNT(*) AS n FROM equipment_repairs WHERE asset_id = ?', [$assetId])['n'] > 0) return true;
    return false;
}
// Keep the cached quantity column = active instance count so the existing
// date-aware booking availability keeps working for serialised assets too.
function equipmentSyncSerialisedQuantity(int $assetId): int
{
    $active = equipmentInstanceCounts($assetId)['active'];
    dbRun("UPDATE equipment_assets SET quantity = ?, updated_at = datetime('now') WHERE id = ?", [$active, $assetId]);
    return $active;
}
function serializeAssetInstance(array $i): array
{
    return [
        'id' => (int) $i['id'], 'ref' => $i['instance_ref'],
        'status' => $i['status'], 'statusLabel' => EQUIPMENT_INSTANCE_STATUSES[$i['status']] ?? $i['status'],
        'condition' => $i['condition'], 'location' => $i['location'], 'barcode' => $i['barcode'], 'notes' => $i['notes'],
        'active' => !in_array($i['status'], ['retired', 'disposed'], true),
    ];
}

// QM v2.4.3 import review (Appendix I). A row is 'ready' only once it has a name,
// an explicit valid tracking mode, and (for consumables) a unit; otherwise it stays
// in needs_review with the blocking issues listed.
function equipmentImportRowReview(array $r): array
{
    $issues = [];
    if (trim((string) ($r['name'] ?? '')) === '') $issues[] = 'Missing name';
    if (!array_key_exists($r['tracking_mode'] ?? '', EQUIPMENT_TRACKING_MODES)) $issues[] = 'No explicit tracking mode';
    if (($r['tracking_mode'] ?? '') === 'consumable' && trim((string) ($r['issue_unit'] ?? '')) === '') $issues[] = 'Consumable needs a unit';
    return ['status' => $issues ? 'needs_review' : 'ready', 'issues' => $issues];
}
function serializeImportRow(array $r): array
{
    return [
        'id' => (int) $r['id'], 'sourceRow' => $r['source_row'] !== null ? (int) $r['source_row'] : null,
        'name' => $r['name'], 'category' => $r['category'], 'location' => $r['location'],
        'trackingMode' => $r['tracking_mode'], 'issueUnit' => $r['issue_unit'], 'openingQty' => (int) $r['opening_qty'],
        'reviewStatus' => $r['review_status'], 'issues' => !empty($r['issues']) ? json_decode($r['issues'], true) : [],
        'createdAssetId' => $r['created_asset_id'] !== null ? (int) $r['created_asset_id'] : null,
    ];
}
function serializeImportBatch(array $b, array $userNames): array
{
    $counts = [];
    foreach (dbAll('SELECT review_status, COUNT(*) AS n FROM equipment_import_rows WHERE batch_id = ? GROUP BY review_status', [$b['id']]) as $row) {
        $counts[$row['review_status']] = (int) $row['n'];
    }
    return [
        'id' => (int) $b['id'], 'status' => $b['status'],
        'by' => $userNames[(int) $b['created_by']] ?? 'Leader', 'at' => $b['created_at'],
        'counts' => $counts, 'total' => array_sum($counts),
    ];
}

function serializeStocktakeLine(array $l): array
{
    $a = dbGet('SELECT name, issue_unit FROM equipment_assets WHERE id = ?', [$l['asset_id']]);
    $counted = $l['counted_qty'] !== null ? (int) $l['counted_qty'] : null;
    return [
        'id' => (int) $l['id'], 'assetId' => (int) $l['asset_id'], 'name' => $a['name'] ?? '(deleted)', 'issueUnit' => $a['issue_unit'] ?? null,
        'systemQty' => (int) $l['system_qty'], 'countedQty' => $counted,
        'variance' => $counted !== null ? $counted - (int) $l['system_qty'] : null,
        'postedDelta' => $l['posted_delta'] !== null ? (int) $l['posted_delta'] : null,
    ];
}
function serializeStocktake(array $s, array $userNames): array
{
    return [
        'id' => (int) $s['id'], 'reference' => $s['reference'], 'scope' => $s['scope'], 'status' => $s['status'], 'note' => $s['note'],
        'by' => $userNames[(int) $s['created_by']] ?? 'Leader', 'at' => $s['created_at'], 'postedAt' => $s['posted_at'],
    ];
}

function serializeStockMovement(array $m, array $userNames): array
{
    return [
        'id' => (int) $m['id'], 'movementType' => $m['movement_type'],
        'movementLabel' => (EQUIPMENT_STOCK_MOVEMENTS[$m['movement_type']] ?? ucfirst($m['movement_type'])),
        'delta' => (int) $m['delta'], 'balanceAfter' => (int) $m['balance_after'],
        'reason' => $m['reason'], 'sourceRef' => $m['source_ref'],
        'by' => $userNames[(int) $m['actor_user_id']] ?? 'System', 'at' => $m['created_at'],
    ];
}

// QM Advanced Controls (FRD FR-QM-ADV-001 / INV): an item is a single asset, a kit
// (container with expected components), a component of a kit, or a consumable
// (stock-tracked with a reorder threshold).
const EQUIPMENT_ITEM_TYPES = ['asset' => 'Asset', 'kit' => 'Kit', 'kit_component' => 'Kit component', 'consumable' => 'Consumable'];
// Controlled/restricted equipment categories (FR-QM-INV-009 / ADV-008): booking
// these requires a permit/qualification confirmation and a named responsible adult.
const EQUIPMENT_RESTRICTED_CATEGORIES = ['archery' => 'Archery', 'shooting' => 'Shooting', 'bladed' => 'Bladed tools (knife/axe/saw/tomahawk)', 'gas' => 'Gas / stoves', 'fire' => 'Fire / pyrotechnics', 'climbing' => 'Climbing / heights', 'chemical' => 'Chemical / fuel', 'other' => 'Other controlled'];
const EQUIPMENT_LOCATION_CONFIDENCE = ['confirmed' => 'Confirmed', 'probable' => 'Probable', 'unknown' => 'Unknown'];
// Inspection outcomes (QM Maintenance & Inspection Workflow s3). Each drives a
// defined system action when an inspection is recorded.
const EQUIPMENT_INSPECTION_OUTCOMES = [
    'pass' => 'Pass', 'advisory' => 'Pass with advisory', 'fail' => 'Fail & lock',
    'repair' => 'Repair required', 'retire' => 'Retire', 'unable' => 'Unable to inspect',
];

function equipmentRegisterEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'equipment_register_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireEquipmentEnabled(): void
{
    if (!equipmentRegisterEnabled()) jsonResponse(['error' => 'The equipment register is not enabled.'], 404);
}

// Resolve a spreadsheet cell to an enum key: matches a key or a label
// (case-insensitive), else the default. Used by the CSV import.
function equipmentEnumFromInput($value, array $map, string $default): string
{
    $v = strtolower(trim((string) $value));
    if ($v === '') return $default;
    if (array_key_exists($v, $map)) return $v;
    foreach ($map as $k => $label) {
        if (strtolower($label) === $v) return $k;
    }
    return $default;
}

function serializeAsset(array $a): array
{
    return [
        'id' => (int) $a['id'], 'name' => $a['name'], 'category' => $a['category'], 'quantity' => (int) $a['quantity'],
        'condition' => $a['condition'], 'status' => $a['status'], 'owner' => $a['owner_name'],
        'sectionId' => $a['osm_section_id'], 'sectionName' => $a['section_name'], 'location' => $a['location'],
        'linkedEvent' => $a['linked_event'], 'purchaseDate' => $a['purchase_date'], 'value' => $a['value'] !== null ? (float) $a['value'] : null,
        'notes' => $a['notes'], 'nextInspectionDate' => $a['next_inspection_date'], 'replacementDueDate' => $a['replacement_due_date'],
        'loanDueDate' => $a['loan_due_date'], 'lastCheckedDate' => $a['last_checked_date'],
        'maintenanceLocked' => (bool) ($a['maintenance_locked'] ?? 0),
        // QM Advanced Controls richer inventory model.
        'itemType' => $a['item_type'] ?? 'asset',
        'trackingMode' => $a['tracking_mode'] ?? 'bulk_reusable',
        // Serialised balance comes from instance lifecycle (18.8); bulk/consumable
        // from the stock ledger.
        'stockBalance' => ($a['tracking_mode'] ?? '') === 'serialised' ? equipmentInstanceCounts((int) $a['id'])['active'] : equipmentStockBalance((int) $a['id']),
        'instanceCounts' => ($a['tracking_mode'] ?? '') === 'serialised' ? equipmentInstanceCounts((int) $a['id']) : null,
        'parentKitId' => isset($a['parent_kit_id']) && $a['parent_kit_id'] !== null ? (int) $a['parent_kit_id'] : null,
        'restricted' => (bool) ($a['restricted'] ?? 0),
        'restrictedCategory' => $a['restricted_category'] ?? null,
        'storageArea' => $a['storage_area'] ?? null,
        'locationCode' => $a['location_code'] ?? null,
        'locationConfidence' => $a['location_confidence'] ?? null,
        'stockLevel' => isset($a['stock_level']) && $a['stock_level'] !== null ? (int) $a['stock_level'] : null,
        'reorderThreshold' => isset($a['reorder_threshold']) && $a['reorder_threshold'] !== null ? (int) $a['reorder_threshold'] : null,
        'issueUnit' => $a['issue_unit'] ?? null,
        'belowReorder' => ($a['item_type'] ?? 'asset') === 'consumable' && $a['stock_level'] !== null && $a['reorder_threshold'] !== null && (int) $a['stock_level'] <= (int) $a['reorder_threshold'],
        'replacementValue' => isset($a['replacement_value']) && $a['replacement_value'] !== null ? (float) $a['replacement_value'] : null,
        'supplier' => $a['supplier'] ?? null,
        'warrantyExpiry' => $a['warranty_expiry'] ?? null,
        'serialNumber' => $a['serial_number'] ?? null,
        'insuranceRelevant' => (bool) ($a['insurance_relevant'] ?? 0),
        // Suitability rules (FR-QM-ADV-013).
        'suitableSections' => $a['suitable_sections'] ?? null,
        'suitableEvents' => $a['suitable_events'] ?? null,
        'maxGroupSize' => isset($a['max_group_size']) && $a['max_group_size'] !== null ? (int) $a['max_group_size'] : null,
        'setupTimeMins' => isset($a['setup_time_mins']) && $a['setup_time_mins'] !== null ? (int) $a['setup_time_mins'] : null,
        'vehicleRequired' => $a['vehicle_required'] ?? null,
        'updatedAt' => $a['updated_at'],
    ];
}
function serializeInspection(array $r, array $userNames): array
{
    return [
        'id' => (int) $r['id'], 'outcome' => $r['outcome'], 'outcomeLabel' => EQUIPMENT_INSPECTION_OUTCOMES[$r['outcome']] ?? $r['outcome'],
        'conditionSet' => $r['condition_set'], 'nextInspectionDate' => $r['next_inspection_date'], 'note' => $r['note'],
        'locked' => (bool) $r['locked'], 'by' => $userNames[(int) $r['inspected_by']] ?? 'Leader', 'at' => $r['created_at'],
    ];
}
function serializeRepair(array $r, array $userNames): array
{
    return [
        'id' => (int) $r['id'], 'description' => $r['description'], 'status' => $r['status'],
        'openedBy' => $userNames[(int) $r['opened_by']] ?? 'Leader', 'openedAt' => $r['opened_at'],
        'resolvedBy' => $r['resolved_by'] !== null ? ($userNames[(int) $r['resolved_by']] ?? 'Leader') : null, 'resolvedAt' => $r['resolved_at'],
    ];
}

// QM Advanced Controls kits (FR-QM-ADV-002/003).
const EQUIPMENT_KIT_CHECK_TYPES = ['pre_loan' => 'Pre-loan', 'post_return' => 'Post-return', 'routine' => 'Routine'];
const EQUIPMENT_KIT_COMPONENT_STATUSES = ['present' => 'Present', 'missing' => 'Missing', 'damaged' => 'Damaged'];

// Overall result of a completeness check from its per-component statuses: any
// damaged -> damaged; else any missing -> incomplete; else complete.
function kitCheckResult(array $statuses): string
{
    if (in_array('damaged', $statuses, true)) return 'damaged';
    if (in_array('missing', $statuses, true)) return 'incomplete';
    return 'complete';
}
function kitComponentsFor(int $kitAssetId): array
{
    return dbAll('SELECT * FROM equipment_kit_components WHERE kit_asset_id = ? ORDER BY sort_order, id', [$kitAssetId]);
}
function serializeKitComponent(array $c): array
{
    return ['id' => (int) $c['id'], 'name' => $c['name'], 'expectedQty' => (int) $c['expected_qty']];
}
function serializeKitCheck(array $r, array $userNames): array
{
    $items = dbAll('SELECT * FROM equipment_kit_check_items WHERE check_id = ? ORDER BY id', [$r['id']]);
    return [
        'id' => (int) $r['id'],
        'checkType' => $r['check_type'], 'checkTypeLabel' => EQUIPMENT_KIT_CHECK_TYPES[$r['check_type']] ?? $r['check_type'],
        'result' => $r['result'], 'note' => $r['note'],
        'by' => $userNames[(int) $r['checked_by']] ?? 'Leader', 'at' => $r['created_at'],
        'items' => array_map(fn($i) => ['name' => $i['component_name'], 'status' => $i['status'], 'statusLabel' => EQUIPMENT_KIT_COMPONENT_STATUSES[$i['status']] ?? $i['status'], 'note' => $i['note']], $items),
    ];
}

// Apply an inspection outcome to an asset: sets condition/status, the maintenance
// lock, opens/resolves repair tasks, records the inspection in history, and alerts
// the owners of active bookings that include a newly-locked asset.
function equipmentApplyInspection(array $asset, string $outcome, array $b, int $userId): array
{
    $aid = (int) $asset['id'];
    $condition = array_key_exists($b['condition'] ?? '', EQUIPMENT_CONDITIONS) ? $b['condition'] : null;
    $note = trim((string) ($b['note'] ?? '')) ?: null;
    $nextDate = trim((string) ($b['nextInspectionDate'] ?? '')) ?: null;
    $today = gmdate('Y-m-d');
    $lock = 0;
    $sets = ['last_checked_date' => $today];

    switch ($outcome) {
        case 'pass':
        case 'advisory':
            $lock = 0;
            $sets['maintenance_locked'] = 0;
            $sets['condition'] = $condition ?? 'good';
            $sets['next_inspection_date'] = $nextDate;
            if ($asset['status'] === 'under_repair') $sets['status'] = 'available';
            // Return to service: close any open repair tasks.
            dbRun("UPDATE equipment_repairs SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE asset_id = ? AND status = 'open'", [$userId, $aid]);
            break;
        case 'fail':
            $lock = 1;
            $sets['maintenance_locked'] = 1;
            $sets['status'] = 'under_repair';
            $sets['condition'] = $condition ?? 'unserviceable';
            break;
        case 'repair':
            $lock = 1;
            $sets['maintenance_locked'] = 1;
            $sets['status'] = 'under_repair';
            $sets['condition'] = $condition ?? 'poor';
            dbRun('INSERT INTO equipment_repairs (asset_id, description, opened_by) VALUES (?, ?, ?)', [$aid, $note ?? 'Repair required', $userId]);
            break;
        case 'retire':
            $sets['maintenance_locked'] = 0;
            $sets['status'] = 'retired';
            if ($condition) $sets['condition'] = $condition;
            dbRun("UPDATE equipment_repairs SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE asset_id = ? AND status = 'open'", [$userId, $aid]);
            break;
        case 'unable':
            $lock = !empty($b['lock']) ? 1 : 0;
            if ($lock) $sets['maintenance_locked'] = 1;
            break;
    }
    $cols = implode(', ', array_map(fn($c) => "$c = ?", array_keys($sets)));
    dbRun("UPDATE equipment_assets SET $cols, updated_at = datetime('now') WHERE id = ?", [...array_values($sets), $aid]);
    dbRun('INSERT INTO equipment_inspections (asset_id, outcome, condition_set, next_inspection_date, note, locked, inspected_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$aid, $outcome, $sets['condition'] ?? null, $nextDate, $note, $lock, $userId]);
    logAudit(['userId' => $userId, 'action' => 'equipment_inspection', 'entityType' => 'equipment', 'entityId' => (string) $aid, 'ipAddress' => clientIp(), 'details' => ['outcome' => $outcome, 'locked' => $lock]]);

    // Alert owners of active bookings that include this asset once it is locked.
    if ($lock) {
        $rows = dbAll(
            "SELECT DISTINCT b.requester_user_id FROM qm_bookings b JOIN qm_booking_items i ON i.booking_id = b.id
             WHERE b.status NOT IN ('closed','cancelled','returned') AND (i.equipment_asset_id = ? OR i.substitute_asset_id = ?)",
            [$aid, $aid]
        );
        foreach ($rows as $r) {
            notify((int) $r['requester_user_id'], 'equipment', 'Booked equipment locked', '"' . $asset['name'] . '" failed inspection and is unavailable. Please review your booking.', 'quartermaster.html');
        }
    }
    return dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$aid]);
}

// Action Centre items for overdue inspections, overdue loan returns and assets
// flagged for replacement review (FR-EQP-006). Called from buildActionCentre.
function equipmentActionItems(): array
{
    if (!equipmentRegisterEnabled()) return [];
    $today = gmdate('Y-m-d');
    $items = [];
    foreach (dbAll("SELECT id, name FROM equipment_assets WHERE status != 'retired' AND next_inspection_date IS NOT NULL AND next_inspection_date < ?", [$today]) as $a) {
        $items[] = actionItem('eqp-insp-' . $a['id'], 'Medium', 'Equipment', 'Inspection overdue: ' . $a['name'], 'Quartermaster', 'Open', 'equipment.html');
    }
    foreach (dbAll("SELECT id, name FROM equipment_assets WHERE status = 'loaned' AND loan_due_date IS NOT NULL AND loan_due_date < ?", [$today]) as $a) {
        $items[] = actionItem('eqp-loan-' . $a['id'], 'High', 'Equipment', 'Overdue for return: ' . $a['name'], 'Quartermaster', 'Open', 'equipment.html');
    }
    foreach (dbAll("SELECT id, name FROM equipment_assets WHERE status != 'retired' AND ((replacement_due_date IS NOT NULL AND replacement_due_date < ?) OR condition IN ('poor','unserviceable'))", [$today]) as $a) {
        $items[] = actionItem('eqp-repl-' . $a['id'], 'Low', 'Equipment', 'Replacement review: ' . $a['name'], 'Quartermaster', 'Open', 'equipment.html');
    }
    foreach (dbAll("SELECT a.id, a.name FROM equipment_repairs r JOIN equipment_assets a ON a.id = r.asset_id WHERE r.status = 'open' GROUP BY a.id, a.name") as $a) {
        $items[] = actionItem('eqp-repair-' . $a['id'], 'High', 'Equipment', 'Repair open (locked): ' . $a['name'], 'Quartermaster', 'Open', 'equipment.html');
    }
    // QM Advanced Controls (FR-QM-ADV-019): replenishment + location review, as
    // single aggregate tasks so a big register doesn't flood the Action Centre.
    $lowStock = (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE item_type = 'consumable' AND stock_level IS NOT NULL AND reorder_threshold IS NOT NULL AND stock_level <= reorder_threshold")['n'];
    if ($lowStock > 0) {
        $items[] = actionItem('eqp-lowstock', 'Medium', 'Equipment', $lowStock . ' consumable' . ($lowStock === 1 ? '' : 's') . ' at or below reorder level', 'Quartermaster', 'Open', 'equipment.html');
    }
    $unknownLoc = (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND location_confidence = 'unknown'")['n'];
    if ($unknownLoc > 0) {
        $items[] = actionItem('eqp-unknownloc', 'Low', 'Equipment', $unknownLoc . ' item' . ($unknownLoc === 1 ? '' : 's') . ' with an unconfirmed storage location', 'Quartermaster', 'Open', 'equipment.html');
    }
    return $items;
}
