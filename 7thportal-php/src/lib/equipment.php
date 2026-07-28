<?php
// Equipment and asset register (FRD FR-EQP). Optional module, off by default.

const EQUIPMENT_CATEGORIES = ['camping' => 'Camping equipment', 'activity' => 'Activity kit', 'safety' => 'Safety equipment', 'general' => 'General equipment'];
const EQUIPMENT_CONDITIONS = ['new' => 'New', 'good' => 'Good', 'fair' => 'Fair', 'poor' => 'Poor', 'unserviceable' => 'Unserviceable'];
const EQUIPMENT_STATUSES = ['available' => 'Available', 'allocated' => 'Allocated', 'loaned' => 'Loaned', 'under_repair' => 'Under repair', 'retired' => 'Retired', 'missing' => 'Missing'];

function equipmentRegisterEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'equipment_register_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireEquipmentEnabled(): void
{
    if (!equipmentRegisterEnabled()) jsonResponse(['error' => 'The equipment register is not enabled.'], 404);
}

function serializeAsset(array $a): array
{
    return [
        'id' => (int) $a['id'], 'name' => $a['name'], 'category' => $a['category'], 'quantity' => (int) $a['quantity'],
        'condition' => $a['condition'], 'status' => $a['status'], 'owner' => $a['owner_name'],
        'sectionId' => $a['osm_section_id'], 'sectionName' => $a['section_name'], 'location' => $a['location'],
        'linkedEvent' => $a['linked_event'], 'purchaseDate' => $a['purchase_date'], 'value' => $a['value'] !== null ? (float) $a['value'] : null,
        'notes' => $a['notes'], 'nextInspectionDate' => $a['next_inspection_date'], 'replacementDueDate' => $a['replacement_due_date'],
        'loanDueDate' => $a['loan_due_date'], 'lastCheckedDate' => $a['last_checked_date'], 'updatedAt' => $a['updated_at'],
    ];
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
    return $items;
}
