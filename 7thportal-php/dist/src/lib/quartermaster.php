<?php
// Quartermaster Booking (FRD FR-QM / backlog LATER-005). Optional module, off by
// default. Leaders raise requests; Quartermasters (Group Leadership Team + admins,
// see isQuartermasterRole) approve at item-line level and run the collection/return
// workflow. Nothing is reserved until a QM approves (FR-QM design principle).

const QM_STATUSES = [
    'draft' => 'Draft',
    'submitted' => 'Pending QM review',
    'approved' => 'Approved',
    'partially_approved' => 'Partially approved',
    'ready_for_collection' => 'Ready for collection',
    'collected' => 'Collected',
    'returned' => 'Returned',
    'closed' => 'Closed',
    'cancelled' => 'Cancelled',
];
const QM_LINE_STATUSES = [
    'requested' => 'Requested',
    'approved' => 'Approved',
    'rejected' => 'Rejected',
    'substituted' => 'Substituted',
    'more_info' => 'More info needed',
];
// Booking states that hold a live reservation against stock. Used for availability
// and double-booking prevention (FR-QM-006, FR-QM-012).
const QM_RESERVING_STATUSES = ['approved', 'partially_approved', 'ready_for_collection', 'collected'];
// Line states that actually hold stock within a reserving booking.
const QM_RESERVING_LINE_STATUSES = ['approved', 'substituted'];

function qmBookingEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'qm_booking_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireQmBookingEnabled(): void
{
    if (!qmBookingEnabled()) jsonResponse(['error' => 'Quartermaster booking is not enabled.'], 404);
}

// Who acts as a Quartermaster (approve, substitute, handover, return, close).
function qmCanApprove(array $user): bool
{
    return isQuartermasterRole($user['portal_role']);
}

// Trustee viewers get summary counts only (FR-QM-006 reporting / roles table).
function qmIsSummaryOnly(array $user): bool
{
    return in_array($user['portal_role'], ['trustee_viewer', 'chair'], true);
}

// A leader may see a booking if they raised it, or if they can approve (QM/admin).
function qmCanViewBooking(array $user, array $b): bool
{
    if (qmCanApprove($user)) return true;
    return (int) $b['requester_user_id'] === (int) $user['id'];
}

// Effective asset a line reserves: the substitute when substituted, else the request.
function qmLineEffectiveAssetId(array $item): ?int
{
    if ($item['line_status'] === 'substituted' && $item['substitute_asset_id'] !== null) return (int) $item['substitute_asset_id'];
    return $item['equipment_asset_id'] !== null ? (int) $item['equipment_asset_id'] : null;
}

// Quantity currently reserved for an asset across bookings whose loan window overlaps
// [$collectAt, $returnAt). Excludes a booking id (so a booking never clashes with
// itself) and only counts reserving bookings/lines. Half-open overlap: A starts
// before B ends AND A ends after B starts.
function qmAssetReservedQty(int $assetId, ?string $collectAt, ?string $returnAt, ?int $excludeBookingId = null): int
{
    // Without a window we cannot reason about overlap; treat as no reservation.
    if (!$collectAt || !$returnAt) return 0;
    $reserving = "'" . implode("','", QM_RESERVING_STATUSES) . "'";
    $lineStates = "'" . implode("','", QM_RESERVING_LINE_STATUSES) . "'";
    $sql = "
        SELECT i.equipment_asset_id, i.substitute_asset_id, i.substitute_asset_id IS NOT NULL AND i.line_status = 'substituted' AS use_sub,
               COALESCE(i.approved_qty, i.requested_qty) AS qty
        FROM qm_booking_items i
        JOIN qm_bookings b ON b.id = i.booking_id
        WHERE b.status IN ($reserving)
          AND i.line_status IN ($lineStates)
          AND b.collect_at IS NOT NULL AND b.return_at IS NOT NULL
          AND b.collect_at < ? AND b.return_at > ?
          " . ($excludeBookingId !== null ? 'AND b.id != ?' : '');
    $args = [$returnAt, $collectAt];
    if ($excludeBookingId !== null) $args[] = $excludeBookingId;
    $total = 0;
    foreach (dbAll($sql, $args) as $row) {
        $effective = ((int) $row['use_sub'] === 1 && $row['substitute_asset_id'] !== null) ? (int) $row['substitute_asset_id'] : (int) $row['equipment_asset_id'];
        if ($effective === $assetId) $total += (int) $row['qty'];
    }
    return $total;
}

// Units of an asset free to book over the given window (owned minus reserved).
function qmAssetAvailableQty(array $asset, ?string $collectAt, ?string $returnAt, ?int $excludeBookingId = null): int
{
    $owned = (int) $asset['quantity'];
    return max(0, $owned - qmAssetReservedQty((int) $asset['id'], $collectAt, $returnAt, $excludeBookingId));
}

// Derived loan state for a collected booking: overdue once past return_at, else on-loan.
function qmDerivedState(array $b): ?string
{
    if ($b['status'] !== 'collected') return null;
    if (!empty($b['return_at']) && $b['return_at'] < gmdate('Y-m-d H:i:s')) return 'overdue';
    return 'due_back';
}

function serializeQmBooking(array $b, bool $full = false): array
{
    $derived = qmDerivedState($b);
    $base = [
        'id' => (int) $b['id'],
        'reference' => $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT)),
        'requesterUserId' => (int) $b['requester_user_id'],
        'purpose' => $b['purpose'],
        'sectionId' => $b['osm_section_id'],
        'sectionName' => $b['section_name'],
        'eventHubId' => $b['event_hub_id'] !== null ? (int) $b['event_hub_id'] : null,
        'eventName' => $b['event_name'],
        'collectAt' => $b['collect_at'],
        'returnAt' => $b['return_at'],
        'status' => $b['status'],
        'statusLabel' => QM_STATUSES[$b['status']] ?? $b['status'],
        'derivedState' => $derived, // 'overdue' | 'due_back' | null
        'overdue' => $derived === 'overdue',
        'submittedAt' => $b['submitted_at'],
        'createdAt' => $b['created_at'],
        'updatedAt' => $b['updated_at'],
    ];
    if (!$full) return $base;
    return array_merge($base, [
        'collectionDetails' => $b['collection_details'],
        'returnDetails' => $b['return_details'],
        'cancelReason' => $b['cancel_reason'],
        'decidedAt' => $b['decided_at'],
        'collectedAt' => $b['collected_at'],
        'collectedByName' => $b['collected_by_name'],
        'returnedAt' => $b['returned_at'],
        'returnConditionNote' => $b['return_condition_note'],
        'closedAt' => $b['closed_at'],
    ]);
}

function serializeQmBookingItem(array $i): array
{
    [$restricted, $restrictedCategory] = qmLineRestriction($i);
    return [
        'id' => (int) $i['id'],
        'bookingId' => (int) $i['booking_id'],
        'assetId' => $i['equipment_asset_id'] !== null ? (int) $i['equipment_asset_id'] : null,
        'itemName' => $i['item_name'],
        'requestedQty' => (int) $i['requested_qty'],
        'approvedQty' => $i['approved_qty'] !== null ? (int) $i['approved_qty'] : null,
        'substituteAssetId' => $i['substitute_asset_id'] !== null ? (int) $i['substitute_asset_id'] : null,
        'substituteName' => $i['substitute_name'],
        'lineStatus' => $i['line_status'],
        'lineStatusLabel' => QM_LINE_STATUSES[$i['line_status']] ?? $i['line_status'],
        'qmNotes' => $i['qm_notes'],
        'issueCondition' => $i['issue_condition'],
        'returnCondition' => $i['return_condition'],
        'damageNotes' => $i['damage_notes'],
        // Restricted-equipment gate (FR-QM-ADV-008): a register-linked restricted
        // item needs a permit confirmation + named responsible adult before approval.
        'restricted' => $restricted,
        'restrictedCategory' => $restrictedCategory,
        'permitConfirmed' => (bool) ($i['permit_confirmed'] ?? 0),
        'responsibleAdult' => $i['responsible_adult'] ?? null,
    ];
}

// Is a booking line a register-linked restricted item? Returns [bool, ?category].
function qmLineRestriction(array $item): array
{
    if ($item['equipment_asset_id'] === null) return [false, null];
    $a = dbGet('SELECT restricted, restricted_category FROM equipment_assets WHERE id = ?', [$item['equipment_asset_id']]);
    return $a ? [(bool) $a['restricted'], $a['restricted_category']] : [false, null];
}

// A restricted line is only cleared for approval once the permit is confirmed and
// a responsible adult is named (FR-QM-ADV-008).
function qmLineRestrictionSatisfied(array $item): bool
{
    [$restricted] = qmLineRestriction($item);
    if (!$restricted) return true;
    return !empty($item['permit_confirmed']) && trim((string) ($item['responsible_adult'] ?? '')) !== '';
}

// QM equipment bundles (FR-QM-ADV-014).
function serializeQmBundleItem(array $i): array
{
    return ['id' => (int) $i['id'], 'assetId' => $i['equipment_asset_id'] !== null ? (int) $i['equipment_asset_id'] : null, 'itemName' => $i['item_name'], 'requestedQty' => (int) $i['requested_qty']];
}
function serializeQmBundle(array $b): array
{
    $items = dbAll('SELECT * FROM qm_bundle_items WHERE bundle_id = ? ORDER BY sort_order, id', [$b['id']]);
    return [
        'id' => (int) $b['id'], 'name' => $b['name'], 'description' => $b['description'],
        'items' => array_map('serializeQmBundleItem', $items), 'itemCount' => count($items),
    ];
}

// Action Centre items (FR-QM-015/016): pending requests for QMs, overdue returns for
// QMs and the borrowing leader, and "more info needed" prompts for the requester.
function qmActionItems(array $user): array
{
    if (!qmBookingEnabled()) return [];
    $items = [];
    $isQm = qmCanApprove($user);
    if ($isQm) {
        foreach (dbAll("SELECT id, reference FROM qm_bookings WHERE status = 'submitted'") as $b) {
            $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
            $items[] = actionItem('qm-review-' . $b['id'], 'Medium', 'Quartermaster', 'Booking request awaiting review: ' . $ref, 'Quartermaster', 'Open', 'quartermaster.html?id=' . $b['id']);
        }
    }
    $now = gmdate('Y-m-d H:i:s');
    $overdueSql = "SELECT id, reference, requester_user_id FROM qm_bookings WHERE status = 'collected' AND return_at IS NOT NULL AND return_at < ?";
    foreach (dbAll($overdueSql, [$now]) as $b) {
        if (!$isQm && (int) $b['requester_user_id'] !== (int) $user['id']) continue;
        $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
        $items[] = actionItem('qm-overdue-' . $b['id'], 'High', 'Quartermaster', 'Equipment overdue for return: ' . $ref, 'Quartermaster', 'Open', 'quartermaster.html?id=' . $b['id']);
    }
    // Requester follow-ups: a booking with any line marked "more info needed".
    $mineSql = "SELECT DISTINCT b.id, b.reference FROM qm_bookings b JOIN qm_booking_items i ON i.booking_id = b.id
                WHERE b.requester_user_id = ? AND i.line_status = 'more_info' AND b.status IN ('submitted','partially_approved')";
    foreach (dbAll($mineSql, [$user['id']]) as $b) {
        $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
        $items[] = actionItem('qm-moreinfo-' . $b['id'], 'Medium', 'Quartermaster', 'More information needed on booking: ' . $ref, 'You', 'Open', 'quartermaster.html?id=' . $b['id']);
    }
    return $items;
}
