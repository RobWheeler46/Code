<?php
// Equipment and asset register (FRD FR-EQP). Optional module, off by default.

const EQUIPMENT_CATEGORIES = ['camping' => 'Camping equipment', 'activity' => 'Activity kit', 'safety' => 'Safety equipment', 'general' => 'General equipment'];
const EQUIPMENT_CONDITIONS = ['new' => 'New', 'good' => 'Good', 'fair' => 'Fair', 'poor' => 'Poor', 'unserviceable' => 'Unserviceable'];
const EQUIPMENT_STATUSES = ['available' => 'Available', 'allocated' => 'Allocated', 'loaned' => 'Loaned', 'under_repair' => 'Under repair', 'retired' => 'Retired', 'missing' => 'Missing'];
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
