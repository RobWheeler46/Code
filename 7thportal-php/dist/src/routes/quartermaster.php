<?php
// Quartermaster Booking API (FRD FR-QM / backlog LATER-005). Leader-only area
// (parents blocked by requireLeader, FR-QM-024); QM decisions restricted to
// Quartermasters (Group Leadership Team + admins). All key actions audited
// (FR-QM-019). Optional module, off by default (requireQmBookingEnabled).

// Normalise a date or datetime string to 'YYYY-MM-DD HH:MM:SS'. A date-only value
// becomes 00:00:00 for a collection point or 23:59:59 for a return point, so a
// same-day return still holds the item for that whole day.
function qmNormalizeDateTime($raw, bool $isEnd): ?string
{
    if ($raw === null || trim((string) $raw) === '') return null;
    $s = str_replace('T', ' ', trim((string) $raw));
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s . ($isEnd ? ' 23:59:59' : ' 00:00:00');
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $s)) return $s . ':00';
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $s)) return $s;
    return null; // unrecognised -> treated as not provided by the caller
}

function qmBookingOr404($id): array
{
    $b = dbGet('SELECT * FROM qm_bookings WHERE id = ?', [$id]);
    if (!$b) jsonResponse(['error' => 'Booking not found.'], 404);
    return $b;
}

function qmBookingItems(int $bookingId): array
{
    // Carry the effective (substitute-aware) asset's tracking mode so the serializer
    // can flag serialised lines without a per-item lookup.
    return dbAll(
        "SELECT bi.*, (SELECT tracking_mode FROM equipment_assets WHERE id = COALESCE(bi.substitute_asset_id, bi.equipment_asset_id)) AS effective_tracking_mode
         FROM qm_booking_items bi WHERE bi.booking_id = ? ORDER BY bi.sort_order, bi.id",
        [$bookingId]
    );
}

function qmTouch(int $bookingId): void
{
    dbRun("UPDATE qm_bookings SET updated_at = datetime('now') WHERE id = ?", [$bookingId]);
}

// ── List ──────────────────────────────────────────────────────────────────────
$router->get('/api/qm/bookings', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (qmIsSummaryOnly($user)) jsonResponse(['error' => 'Trustee access is summary-only. See the reporting summary.'], 403);

    $where = []; $args = [];
    if (!qmCanApprove($user)) { $where[] = 'requester_user_id = ?'; $args[] = $user['id']; }
    elseif (queryParam('scope') === 'mine') { $where[] = 'requester_user_id = ?'; $args[] = $user['id']; }
    if (($s = queryParam('status')) && array_key_exists($s, QM_STATUSES)) { $where[] = 'status = ?'; $args[] = $s; }
    $sql = 'SELECT * FROM qm_bookings' . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY CASE status WHEN 'submitted' THEN 0 WHEN 'collected' THEN 1 ELSE 2 END, COALESCE(return_at, collect_at) IS NULL, return_at, id DESC";
    $bookings = array_map(fn($b) => serializeQmBooking($b), dbAll($sql, $args));

    jsonResponse([
        'bookings' => $bookings,
        'canApprove' => qmCanApprove($user),
        'meta' => ['statuses' => QM_STATUSES, 'lineStatuses' => QM_LINE_STATUSES],
    ]);
});

// ── Item catalogue with availability for a window ──────────────────────────────
$router->get('/api/qm/catalogue', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (qmIsSummaryOnly($user)) jsonResponse(['error' => 'Trustee access is summary-only.'], 403);

    $collectAt = qmNormalizeDateTime(queryParam('collectAt'), false);
    $returnAt = qmNormalizeDateTime(queryParam('returnAt'), true);
    $excludeBooking = queryParam('excludeBookingId') ? (int) queryParam('excludeBookingId') : null;

    // Items that are retired, missing, under repair or maintenance-locked are not offered.
    $where = ["status NOT IN ('retired','missing','under_repair')", 'maintenance_locked = 0']; $args = [];
    if (($q = queryParam('q'))) { $where[] = '(name LIKE ? OR location LIKE ?)'; $args[] = "%$q%"; $args[] = "%$q%"; }
    if (($c = queryParam('category')) && array_key_exists($c, EQUIPMENT_CATEGORIES)) { $where[] = 'category = ?'; $args[] = $c; }
    $assets = dbAll('SELECT * FROM equipment_assets WHERE ' . implode(' AND ', $where) . ' ORDER BY name', $args);

    $out = array_map(function ($a) use ($collectAt, $returnAt, $excludeBooking) {
        $owned = (int) $a['quantity'];
        $reserved = ($collectAt && $returnAt) ? qmAssetReservedQty((int) $a['id'], $collectAt, $returnAt, $excludeBooking) : 0;
        return [
            'id' => (int) $a['id'], 'name' => $a['name'], 'category' => $a['category'],
            'categoryLabel' => EQUIPMENT_CATEGORIES[$a['category']] ?? $a['category'],
            'condition' => $a['condition'], 'status' => $a['status'], 'location' => $a['location'],
            'owned' => $owned, 'reserved' => $reserved,
            'available' => max(0, $owned - $reserved),
            'windowKnown' => (bool) ($collectAt && $returnAt),
            'restricted' => (bool) ($a['restricted'] ?? 0),
            // Suitability (FR-QM-ADV-013) shown to help the requester choose well.
            'suitableSections' => $a['suitable_sections'] ?? null,
            'suitableEvents' => $a['suitable_events'] ?? null,
            'maxGroupSize' => $a['max_group_size'] !== null ? (int) $a['max_group_size'] : null,
            'setupTimeMins' => $a['setup_time_mins'] !== null ? (int) $a['setup_time_mins'] : null,
            'vehicleRequired' => $a['vehicle_required'] ?? null,
        ];
    }, $assets);

    jsonResponse(['items' => $out, 'meta' => ['categories' => EQUIPMENT_CATEGORIES]]);
});

// ── Create draft ───────────────────────────────────────────────────────────────
$router->post('/api/qm/bookings', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (qmIsSummaryOnly($user)) jsonResponse(['error' => 'Your role cannot raise bookings.'], 403);
    $body = requestBody();

    $eventHubId = !empty($body['eventHubId']) ? (int) $body['eventHubId'] : null;
    $eventName = null;
    if ($eventHubId) {
        $hub = dbGet('SELECT id, title FROM event_hubs WHERE id = ?', [$eventHubId]);
        if (!$hub) jsonResponse(['error' => 'Linked event not found.'], 400);
        $eventName = $hub['title'];
    }
    $result = dbRun(
        'INSERT INTO qm_bookings (requester_user_id, purpose, osm_section_id, section_name, event_hub_id, event_name, collect_at, return_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'draft\')',
        [
            $user['id'],
            trim((string) ($body['purpose'] ?? '')) ?: null,
            $body['sectionId'] ?? null,
            $body['sectionName'] ?? null,
            $eventHubId,
            $eventName,
            qmNormalizeDateTime($body['collectAt'] ?? null, false),
            qmNormalizeDateTime($body['returnAt'] ?? null, true),
        ]
    );
    $id = (int) $result['lastInsertId'];
    dbRun('UPDATE qm_bookings SET reference = ? WHERE id = ?', ['QM-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT), $id]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_create', 'entityType' => 'qm_booking', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
    jsonResponse(serializeQmBooking(qmBookingOr404($id), true), 201);
});

// The group's sections for the booking section picker (leader-readable).
$router->get('/api/qm/sections', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    jsonResponse(['sections' => qmSectionList()]);
});

// ── Equipment bundles (FR-QM-ADV-014) ──────────────────────────────────────────
// A Quartermaster curates reusable kit lists; any requester can spin one into a
// draft booking. Managing bundles needs QM rights; using one needs booking rights.

$router->get('/api/qm/bundles', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    jsonResponse(['bundles' => array_map('serializeQmBundle', dbAll('SELECT * FROM qm_bundles ORDER BY name')), 'canManage' => qmCanApprove($user)]);
});

$router->post('/api/qm/bundles', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required to manage bundles.'], 403);
    $body = requestBody();
    $name = trim((string) ($body['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A bundle name is required.'], 400);
    $id = dbRun('INSERT INTO qm_bundles (name, description, created_by) VALUES (?, ?, ?)', [$name, trim((string) ($body['description'] ?? '')) ?: null, $user['id']])['lastInsertId'];
    logAudit(['userId' => $user['id'], 'action' => 'qm_bundle_create', 'entityType' => 'qm_bundle', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
    jsonResponse(serializeQmBundle(dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$id])), 201);
});

$router->delete('/api/qm/bundles/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    dbRun('DELETE FROM qm_bundles WHERE id = ?', [$params['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_bundle_delete', 'entityType' => 'qm_bundle', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/qm/bundles/:id/items', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $bundle = dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$params['id']]);
    if (!$bundle) jsonResponse(['error' => 'Bundle not found.'], 404);
    $body = requestBody();
    $assetId = !empty($body['assetId']) ? (int) $body['assetId'] : null;
    $itemName = trim((string) ($body['itemName'] ?? ''));
    if ($assetId) {
        $asset = dbGet('SELECT name FROM equipment_assets WHERE id = ?', [$assetId]);
        if (!$asset) jsonResponse(['error' => 'Item not found in the register.'], 400);
        if ($itemName === '') $itemName = $asset['name'];
    }
    if ($itemName === '') jsonResponse(['error' => 'An item name is required.'], 400);
    $sort = (int) (dbGet('SELECT COALESCE(MAX(sort_order),0) AS m FROM qm_bundle_items WHERE bundle_id = ?', [$bundle['id']])['m']) + 1;
    dbRun('INSERT INTO qm_bundle_items (bundle_id, equipment_asset_id, item_name, requested_qty, sort_order) VALUES (?, ?, ?, ?, ?)', [$bundle['id'], $assetId, $itemName, max(1, (int) ($body['requestedQty'] ?? 1)), $sort]);
    jsonResponse(serializeQmBundle(dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$bundle['id']])));
});

$router->delete('/api/qm/bundles/:id/items/:iid', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    dbRun('DELETE FROM qm_bundle_items WHERE id = ? AND bundle_id = ?', [$params['iid'], $params['id']]);
    jsonResponse(serializeQmBundle(dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$params['id']]) ?: ['id' => $params['id'], 'name' => '', 'description' => null]));
});

// Spin a bundle into a fresh DRAFT booking for the requester (they then set dates
// and submit for QM review like any other booking).
$router->post('/api/qm/bundles/:id/create-booking', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (qmIsSummaryOnly($user)) jsonResponse(['error' => 'Your role cannot raise bookings.'], 403);
    $bundle = dbGet('SELECT * FROM qm_bundles WHERE id = ?', [$params['id']]);
    if (!$bundle) jsonResponse(['error' => 'Bundle not found.'], 404);
    $items = dbAll('SELECT * FROM qm_bundle_items WHERE bundle_id = ? ORDER BY sort_order, id', [$bundle['id']]);
    if (!$items) jsonResponse(['error' => 'This bundle has no items yet.'], 400);
    $bid = (int) dbRun("INSERT INTO qm_bookings (requester_user_id, purpose, status) VALUES (?, ?, 'draft')", [$user['id'], 'From bundle: ' . $bundle['name']])['lastInsertId'];
    dbRun('UPDATE qm_bookings SET reference = ? WHERE id = ?', ['QM-' . str_pad((string) $bid, 4, '0', STR_PAD_LEFT), $bid]);
    foreach ($items as $sortIdx => $it) {
        dbRun('INSERT INTO qm_booking_items (booking_id, equipment_asset_id, item_name, requested_qty, sort_order) VALUES (?, ?, ?, ?, ?)', [$bid, $it['equipment_asset_id'], $it['item_name'], (int) $it['requested_qty'], $sortIdx + 1]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'qm_bundle_create_booking', 'entityType' => 'qm_booking', 'entityId' => (string) $bid, 'ipAddress' => clientIp(), 'details' => ['bundleId' => (int) $bundle['id'], 'items' => count($items)]]);
    jsonResponse(['bookingId' => $bid], 201);
});

// ── Detail (booking + items) ───────────────────────────────────────────────────
$router->get('/api/qm/bookings/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if (!qmCanViewBooking($user, $b)) jsonResponse(['error' => 'You cannot view this booking.'], 403);
    jsonResponse([
        'booking' => serializeQmBooking($b, true),
        'items' => array_map('serializeQmBookingItem', qmBookingItems((int) $b['id'])),
        'canApprove' => qmCanApprove($user),
        'isOwner' => (int) $b['requester_user_id'] === (int) $user['id'],
        'meta' => ['statuses' => QM_STATUSES, 'lineStatuses' => QM_LINE_STATUSES],
    ]);
});

// ── Update draft header ────────────────────────────────────────────────────────
$router->patch('/api/qm/bookings/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    $isOwner = (int) $b['requester_user_id'] === (int) $user['id'];
    $body = requestBody();

    // Owner may edit the request header only while it is still a draft.
    if ($isOwner && $b['status'] === 'draft') {
        $fields = [];
        $args = [];
        $set = function ($col, $val) use (&$fields, &$args) { $fields[] = "$col = ?"; $args[] = $val; };
        if (array_key_exists('purpose', $body)) $set('purpose', trim((string) $body['purpose']) ?: null);
        // Multiple mandatory sections (validated at submit): replace the join rows
        // and keep section_name / osm_section_id as a display + legacy summary.
        if (array_key_exists('sections', $body) && is_array($body['sections'])) {
            dbRun('DELETE FROM qm_booking_sections WHERE booking_id = ?', [$b['id']]);
            $names = []; $firstId = null;
            foreach ($body['sections'] as $s) {
                $sid = trim((string) ($s['id'] ?? '')); $sname = trim((string) ($s['name'] ?? ''));
                if ($sid === '' || $sname === '') continue;
                dbRun('INSERT OR IGNORE INTO qm_booking_sections (booking_id, osm_section_id, section_name) VALUES (?, ?, ?)', [$b['id'], $sid, $sname]);
                $names[] = $sname; $firstId = $firstId ?? $sid;
            }
            $set('section_name', $names ? implode(', ', $names) : null);
            $set('osm_section_id', $firstId);
        }
        if (array_key_exists('sectionId', $body)) $set('osm_section_id', $body['sectionId'] ?: null);
        if (array_key_exists('sectionName', $body)) $set('section_name', $body['sectionName'] ?: null);
        if (array_key_exists('collectAt', $body)) $set('collect_at', qmNormalizeDateTime($body['collectAt'], false));
        if (array_key_exists('returnAt', $body)) $set('return_at', qmNormalizeDateTime($body['returnAt'], true));
        if (array_key_exists('eventHubId', $body)) {
            $eventHubId = !empty($body['eventHubId']) ? (int) $body['eventHubId'] : null;
            $eventName = null;
            if ($eventHubId) { $hub = dbGet('SELECT title FROM event_hubs WHERE id = ?', [$eventHubId]); $eventName = $hub['title'] ?? null; }
            $set('event_hub_id', $eventHubId); $set('event_name', $eventName);
        }
        if (!$fields) jsonResponse(['error' => 'Nothing to update.'], 400);
        $args[] = $b['id'];
        dbRun("UPDATE qm_bookings SET " . implode(', ', $fields) . ", updated_at = datetime('now') WHERE id = ?", $args);
        logAudit(['userId' => $user['id'], 'action' => 'qm_booking_update', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
        jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
    }
    jsonResponse(['error' => 'This booking can no longer be edited.'], 409);
});

// ── Delete draft ───────────────────────────────────────────────────────────────
$router->delete('/api/qm/bookings/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if ((int) $b['requester_user_id'] !== (int) $user['id'] && !qmCanApprove($user)) jsonResponse(['error' => 'You cannot delete this booking.'], 403);
    if ($b['status'] !== 'draft') jsonResponse(['error' => 'Only a draft booking can be deleted. Cancel it instead.'], 409);
    dbRun('DELETE FROM qm_bookings WHERE id = ?', [$b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_delete', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Add an item line to a draft ────────────────────────────────────────────────
$router->post('/api/qm/bookings/:id/items', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if ((int) $b['requester_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot edit this booking.'], 403);
    if ($b['status'] !== 'draft') jsonResponse(['error' => 'Items can only be changed while the booking is a draft.'], 409);
    $body = requestBody();

    $assetId = !empty($body['assetId']) ? (int) $body['assetId'] : null;
    $itemName = trim((string) ($body['itemName'] ?? ''));
    if ($assetId) {
        $asset = dbGet('SELECT id, name FROM equipment_assets WHERE id = ?', [$assetId]);
        if (!$asset) jsonResponse(['error' => 'Selected item not found in the register.'], 400);
        if ($itemName === '') $itemName = $asset['name'];
    }
    if ($itemName === '') jsonResponse(['error' => 'An item name is required.'], 400);
    $qty = max(1, (int) ($body['requestedQty'] ?? 1));
    $sort = (int) (dbGet('SELECT COALESCE(MAX(sort_order), 0) AS m FROM qm_booking_items WHERE booking_id = ?', [$b['id']])['m']) + 1;
    $permit = !empty($body['permitConfirmed']) ? 1 : 0;
    $responsible = trim((string) ($body['responsibleAdult'] ?? '')) ?: null;

    $result = dbRun(
        'INSERT INTO qm_booking_items (booking_id, equipment_asset_id, item_name, requested_qty, sort_order, permit_confirmed, responsible_adult) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$b['id'], $assetId, $itemName, $qty, $sort, $permit, $responsible]
    );
    qmTouch((int) $b['id']);
    logAudit(['userId' => $user['id'], 'action' => 'qm_item_add', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['item' => $itemName, 'qty' => $qty]]);
    jsonResponse(serializeQmBookingItem(dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$result['lastInsertId']])), 201);
});

// ── Edit an item line (owner, draft only) ──────────────────────────────────────
$router->patch('/api/qm/bookings/:id/items/:itemId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if ((int) $b['requester_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot edit this booking.'], 403);
    if ($b['status'] !== 'draft') jsonResponse(['error' => 'Items can only be changed while the booking is a draft.'], 409);
    $item = dbGet('SELECT * FROM qm_booking_items WHERE id = ? AND booking_id = ?', [$params['itemId'], $b['id']]);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    $body = requestBody();
    $name = array_key_exists('itemName', $body) ? (trim((string) $body['itemName']) ?: $item['item_name']) : $item['item_name'];
    $qty = array_key_exists('requestedQty', $body) ? max(1, (int) $body['requestedQty']) : (int) $item['requested_qty'];
    $permit = array_key_exists('permitConfirmed', $body) ? (!empty($body['permitConfirmed']) ? 1 : 0) : (int) ($item['permit_confirmed'] ?? 0);
    $responsible = array_key_exists('responsibleAdult', $body) ? (trim((string) $body['responsibleAdult']) ?: null) : ($item['responsible_adult'] ?? null);
    dbRun('UPDATE qm_booking_items SET item_name = ?, requested_qty = ?, permit_confirmed = ?, responsible_adult = ? WHERE id = ?', [$name, $qty, $permit, $responsible, $item['id']]);
    qmTouch((int) $b['id']);
    jsonResponse(serializeQmBookingItem(dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$item['id']])));
});

// ── Remove an item line (owner, draft only) ────────────────────────────────────
$router->delete('/api/qm/bookings/:id/items/:itemId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if ((int) $b['requester_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot edit this booking.'], 403);
    if ($b['status'] !== 'draft') jsonResponse(['error' => 'Items can only be changed while the booking is a draft.'], 409);
    $item = dbGet('SELECT * FROM qm_booking_items WHERE id = ? AND booking_id = ?', [$params['itemId'], $b['id']]);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    dbRun('DELETE FROM qm_booking_items WHERE id = ?', [$item['id']]);
    qmTouch((int) $b['id']);
    jsonResponse(['ok' => true]);
});

// ── Submit for QM review ───────────────────────────────────────────────────────
$router->post('/api/qm/bookings/:id/submit', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if ((int) $b['requester_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot submit this booking.'], 403);
    if ($b['status'] !== 'draft') jsonResponse(['error' => 'Only a draft can be submitted.'], 409);
    if (count(qmBookingSections((int) $b['id'])) === 0) jsonResponse(['error' => 'Choose at least one section before submitting.'], 400);
    if (!$b['collect_at'] || !$b['return_at']) jsonResponse(['error' => 'A collection date and a return date are required before submitting.'], 400);
    if ($b['return_at'] <= $b['collect_at']) jsonResponse(['error' => 'The return date must be after the collection date.'], 400);
    if (count(qmBookingItems((int) $b['id'])) === 0) jsonResponse(['error' => 'Add at least one item before submitting.'], 400);
    // Restricted-equipment gate (FR-QM-ADV-008): controlled kit needs a permit
    // confirmation + named responsible adult before the request can be submitted.
    foreach (dbAll('SELECT * FROM qm_booking_items WHERE booking_id = ?', [$b['id']]) as $it) {
        if (!qmLineRestrictionSatisfied($it)) {
            jsonResponse(['error' => "\"{$it['item_name']}\" is controlled equipment - tick the permit/qualification confirmation and name a responsible adult before submitting."], 400);
        }
    }

    dbRun("UPDATE qm_bookings SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_submit', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
    notifyRoles(['group_leadership', 'admin'], 'qm_booking', 'New equipment booking to review', $ref . ' has been submitted for Quartermaster review.', 'quartermaster.html?id=' . $b['id']);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── QM decision on a single item line ──────────────────────────────────────────
$router->post('/api/qm/bookings/:id/items/:itemId/decide', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if (!in_array($b['status'], ['submitted', 'approved', 'partially_approved'], true)) jsonResponse(['error' => 'This booking is not open for review decisions.'], 409);
    $item = dbGet('SELECT * FROM qm_booking_items WHERE id = ? AND booking_id = ?', [$params['itemId'], $b['id']]);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    $body = requestBody();
    $decision = $body['decision'] ?? '';
    if (!in_array($decision, ['approve', 'reject', 'substitute', 'more_info'], true)) jsonResponse(['error' => 'Invalid decision.'], 400);
    // A restricted line can't be approved/substituted until its permit + responsible
    // adult are recorded (FR-QM-ADV-008); rejecting or asking for more info is fine.
    if (in_array($decision, ['approve', 'substitute'], true) && !qmLineRestrictionSatisfied($item)) {
        jsonResponse(['error' => 'This is controlled equipment - it cannot be approved until the requester confirms the permit/qualification and names a responsible adult.'], 400);
    }
    $notes = array_key_exists('qmNotes', $body) ? (trim((string) $body['qmNotes']) ?: null) : $item['qm_notes'];

    $approvedQty = null; $lineStatus = 'requested'; $substituteAssetId = null; $substituteName = null;
    if ($decision === 'approve') {
        $lineStatus = 'approved';
        $approvedQty = array_key_exists('approvedQty', $body) ? max(1, (int) $body['approvedQty']) : (int) $item['requested_qty'];
    } elseif ($decision === 'reject') {
        $lineStatus = 'rejected'; $approvedQty = 0;
    } elseif ($decision === 'more_info') {
        $lineStatus = 'more_info';
    } elseif ($decision === 'substitute') {
        $lineStatus = 'substituted';
        $substituteAssetId = !empty($body['substituteAssetId']) ? (int) $body['substituteAssetId'] : null;
        $substituteName = trim((string) ($body['substituteName'] ?? ''));
        if ($substituteAssetId) {
            $sa = dbGet('SELECT name FROM equipment_assets WHERE id = ?', [$substituteAssetId]);
            if (!$sa) jsonResponse(['error' => 'Substitute item not found in the register.'], 400);
            if ($substituteName === '') $substituteName = $sa['name'];
        }
        if ($substituteName === '') jsonResponse(['error' => 'A substitute item is required.'], 400);
        $approvedQty = array_key_exists('approvedQty', $body) ? max(1, (int) $body['approvedQty']) : (int) $item['requested_qty'];
    }

    dbRun(
        'UPDATE qm_booking_items SET line_status = ?, approved_qty = ?, substitute_asset_id = ?, substitute_name = ?, qm_notes = ? WHERE id = ?',
        [$lineStatus, $approvedQty, $substituteAssetId, $substituteName, $notes, $item['id']]
    );
    qmTouch((int) $b['id']);
    logAudit(['userId' => $user['id'], 'action' => 'qm_item_decide', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['itemId' => (int) $item['id'], 'decision' => $decision]]);
    jsonResponse(serializeQmBookingItem(dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$item['id']])));
});

// ── Per-instance allocation for serialised lines (FR-QM) ────────────────────────
// Load a booking line whose effective asset is serialised, or fail with a clear error.
function qmSerialisedLineOr($bookingId, $itemId): array
{
    $item = dbGet('SELECT * FROM qm_booking_items WHERE id = ? AND booking_id = ?', [$itemId, $bookingId]);
    if (!$item) jsonResponse(['error' => 'Booking line not found.'], 404);
    $assetId = qmLineEffectiveAssetId($item);
    $asset = $assetId ? dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$assetId]) : null;
    if (!$asset || $asset['tracking_mode'] !== 'serialised') jsonResponse(['error' => 'This line is not a serialised asset, so there are no instances to allocate.'], 400);
    return [$item, (int) $assetId];
}

$router->get('/api/qm/bookings/:id/items/:itemId/allocatable', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    if (!qmCanViewBooking($user, $b)) jsonResponse(['error' => 'You cannot view this booking.'], 403);
    [$item, $assetId] = qmSerialisedLineOr($b['id'], $params['itemId']);
    $available = array_map(fn($r) => ['instanceId' => (int) $r['id'], 'ref' => $r['instance_ref'], 'condition' => $r['condition']],
        dbAll("SELECT id, instance_ref, condition FROM equipment_asset_instances WHERE asset_id = ? AND status = 'available' ORDER BY instance_ref", [$assetId]));
    jsonResponse([
        'allocated' => qmLineAllocatedInstances((int) $item['id']),
        'available' => $available,
        'cap' => (int) ($item['approved_qty'] ?? $item['requested_qty']),
        'canManage' => qmCanApprove($user),
    ]);
});

$router->post('/api/qm/bookings/:id/items/:itemId/instances', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required to allocate instances.'], 403);
    $b = qmBookingOr404($params['id']);
    if (in_array($b['status'], ['returned', 'closed', 'cancelled'], true)) jsonResponse(['error' => 'This booking is finalised.'], 409);
    [$item, $assetId] = qmSerialisedLineOr($b['id'], $params['itemId']);
    $instanceId = (int) (requestBody()['instanceId'] ?? 0);
    $inst = dbGet('SELECT * FROM equipment_asset_instances WHERE id = ? AND asset_id = ?', [$instanceId, $assetId]);
    if (!$inst) jsonResponse(['error' => 'That instance is not part of this asset.'], 404);
    if ($inst['status'] !== 'available') jsonResponse(['error' => 'Instance ' . $inst['instance_ref'] . ' is not available (' . $inst['status'] . ').'], 409);
    $cap = (int) ($item['approved_qty'] ?? $item['requested_qty']);
    if (count(qmLineAllocatedInstances((int) $item['id'])) >= $cap) jsonResponse(['error' => 'You have already allocated the approved quantity (' . $cap . ').'], 409);
    dbRun('INSERT OR IGNORE INTO qm_booking_item_instances (booking_item_id, instance_id, allocated_by) VALUES (?, ?, ?)', [$item['id'], $instanceId, $user['id']]);
    dbRun("UPDATE equipment_asset_instances SET status = 'reserved' WHERE id = ?", [$instanceId]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_instance_allocate', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['instanceRef' => $inst['instance_ref']]]);
    qmTouch((int) $b['id']);
    jsonResponse(serializeQmBookingItem(dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$item['id']])));
});

$router->delete('/api/qm/bookings/:id/items/:itemId/instances/:instanceId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    [$item] = qmSerialisedLineOr($b['id'], $params['itemId']);
    $link = dbGet('SELECT * FROM qm_booking_item_instances WHERE booking_item_id = ? AND instance_id = ?', [$item['id'], $params['instanceId']]);
    if (!$link) jsonResponse(['error' => 'That instance is not allocated to this line.'], 404);
    dbRun('DELETE FROM qm_booking_item_instances WHERE id = ?', [$link['id']]);
    // Only free an instance we were reserving - never clobber an issued/maintenance state.
    dbRun("UPDATE equipment_asset_instances SET status = 'available' WHERE id = ? AND status = 'reserved'", [$params['instanceId']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_instance_deallocate', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    qmTouch((int) $b['id']);
    jsonResponse(serializeQmBookingItem(dbGet('SELECT * FROM qm_booking_items WHERE id = ?', [$item['id']])));
});

// ── Finalise the review (compute booking status + reserve, clash-checked) ──────
$router->post('/api/qm/bookings/:id/finalise', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if (!in_array($b['status'], ['submitted', 'approved', 'partially_approved'], true)) jsonResponse(['error' => 'This booking is not open for finalising.'], 409);
    $body = requestBody();
    $override = !empty($body['override']);
    $overrideReason = trim((string) ($body['overrideReason'] ?? ''));

    $items = qmBookingItems((int) $b['id']);
    $decided = array_filter($items, fn($i) => $i['line_status'] !== 'requested');
    if (count($decided) === 0) jsonResponse(['error' => 'Make a decision on at least one item first.'], 400);
    if (count($decided) !== count($items)) jsonResponse(['error' => 'Every item needs a decision (approve, reject, substitute or more info) before finalising.'], 400);

    $anyMoreInfo = false; $approvedCount = 0; $rejectedCount = 0;
    // Double-booking check (FR-QM-012): each reserving line must fit available stock
    // for the loan window, ignoring this booking's own current reservation.
    $clashes = [];
    foreach ($items as $i) {
        if ($i['line_status'] === 'more_info') { $anyMoreInfo = true; continue; }
        if ($i['line_status'] === 'rejected') { $rejectedCount++; continue; }
        if (in_array($i['line_status'], ['approved', 'substituted'], true)) {
            $approvedCount++;
            $assetId = qmLineEffectiveAssetId($i);
            if ($assetId === null) continue; // free-text item, no stock to reserve against
            $asset = dbGet('SELECT * FROM equipment_assets WHERE id = ?', [$assetId]);
            if (!$asset) continue;
            $want = (int) ($i['approved_qty'] ?? $i['requested_qty']);
            $available = qmAssetAvailableQty($asset, $b['collect_at'], $b['return_at'], (int) $b['id']);
            if ($want > $available) $clashes[] = ['itemId' => (int) $i['id'], 'itemName' => $i['substitute_name'] ?: $i['item_name'], 'requested' => $want, 'available' => $available];
        }
    }
    if ($anyMoreInfo) jsonResponse(['error' => 'Resolve the "more info needed" items before finalising.'], 409);
    if ($approvedCount === 0) jsonResponse(['error' => 'No items are approved. Cancel the booking instead of finalising.'], 409);
    if ($clashes && !$override) jsonResponse(['error' => 'One or more items are not available for the requested dates.', 'clashes' => $clashes], 409);
    if ($clashes && $override && $overrideReason === '') jsonResponse(['error' => 'A reason is required to override a booking clash.'], 400);

    $newStatus = $rejectedCount > 0 ? 'partially_approved' : 'approved';
    dbRun("UPDATE qm_bookings SET status = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$newStatus, $user['id'], $b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_finalise', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['status' => $newStatus, 'override' => $override, 'overrideReason' => $override ? $overrideReason : null, 'clashes' => $clashes]]);
    $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
    notify((int) $b['requester_user_id'], 'qm_booking', 'Booking ' . QM_STATUSES[$newStatus], $ref . ' has been ' . strtolower(QM_STATUSES[$newStatus]) . ' by the Quartermaster.', 'quartermaster.html?id=' . $b['id']);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── QM confirms items are ready for collection ─────────────────────────────────
$router->post('/api/qm/bookings/:id/ready', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if (!in_array($b['status'], ['approved', 'partially_approved'], true)) jsonResponse(['error' => 'Only an approved booking can be marked ready for collection.'], 409);
    $body = requestBody();
    dbRun("UPDATE qm_bookings SET status = 'ready_for_collection', collection_details = ?, updated_at = datetime('now') WHERE id = ?", [trim((string) ($body['collectionDetails'] ?? '')) ?: $b['collection_details'], $b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_ready', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
    notify((int) $b['requester_user_id'], 'qm_booking', 'Equipment ready for collection', $ref . ' is ready to collect.', 'quartermaster.html?id=' . $b['id']);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── QM records collection / handover ───────────────────────────────────────────
$router->post('/api/qm/bookings/:id/collect', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if (!in_array($b['status'], ['ready_for_collection', 'approved', 'partially_approved'], true)) jsonResponse(['error' => 'This booking is not ready to be collected.'], 409);
    $body = requestBody();
    $issueCondition = trim((string) ($body['issueCondition'] ?? '')) ?: null;
    dbRun("UPDATE qm_bookings SET status = 'collected', collected_at = datetime('now'), collected_by_name = ?, updated_at = datetime('now') WHERE id = ?", [trim((string) ($body['collectedByName'] ?? '')) ?: null, $b['id']]);
    // Allocated serialised instances are now physically out with the borrower.
    qmSetBookingInstancesStatus((int) $b['id'], 'issued');
    if ($issueCondition !== null) {
        // Stamp the same handover condition on every reserving line as a baseline.
        dbRun("UPDATE qm_booking_items SET issue_condition = ? WHERE booking_id = ? AND line_status IN ('approved','substituted')", [$issueCondition, $b['id']]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_collect', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
    notify((int) $b['requester_user_id'], 'qm_booking', 'Equipment collected', 'Collection of ' . $ref . ' has been recorded. Please return by the agreed date.', 'quartermaster.html?id=' . $b['id']);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── QM records return + condition, optionally flags damage to the register ─────
$router->post('/api/qm/bookings/:id/return', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if ($b['status'] !== 'collected') jsonResponse(['error' => 'Only a collected booking can be returned.'], 409);
    $body = requestBody();
    $note = trim((string) ($body['returnConditionNote'] ?? '')) ?: null;
    dbRun("UPDATE qm_bookings SET status = 'returned', returned_at = datetime('now'), return_condition_note = ?, updated_at = datetime('now') WHERE id = ?", [$note, $b['id']]);
    // Allocated serialised instances are back on the shelf.
    qmSetBookingInstancesStatus((int) $b['id'], 'available');

    // Per-line condition + damage, and (FR-QM-017) push flagged assets to the register.
    $lines = is_array($body['lines'] ?? null) ? $body['lines'] : [];
    $flagged = [];
    foreach ($lines as $ln) {
        $itemId = (int) ($ln['itemId'] ?? 0);
        if (!$itemId) continue;
        $item = dbGet('SELECT * FROM qm_booking_items WHERE id = ? AND booking_id = ?', [$itemId, $b['id']]);
        if (!$item) continue;
        $cond = trim((string) ($ln['returnCondition'] ?? '')) ?: null;
        $damage = trim((string) ($ln['damageNotes'] ?? '')) ?: null;
        dbRun('UPDATE qm_booking_items SET return_condition = ?, damage_notes = ? WHERE id = ?', [$cond, $damage, $item['id']]);
        // Link damaged/missing returns to the equipment register maintenance state.
        $assetId = qmLineEffectiveAssetId($item);
        $flag = strtolower((string) ($ln['flag'] ?? '')); // '', 'damaged', 'missing'
        if ($assetId && in_array($flag, ['damaged', 'missing'], true)) {
            $newAssetStatus = $flag === 'missing' ? 'missing' : 'under_repair';
            $existingNotes = dbGet('SELECT notes FROM equipment_assets WHERE id = ?', [$assetId])['notes'] ?? '';
            $stamp = gmdate('Y-m-d') . ' QM ' . ($b['reference'] ?: ('QM-' . $b['id'])) . ': ' . $flag . ($damage ? ' - ' . $damage : '');
            dbRun("UPDATE equipment_assets SET status = ?, notes = ?, updated_at = datetime('now') WHERE id = ?", [$newAssetStatus, trim(($existingNotes ? $existingNotes . "\n" : '') . $stamp), $assetId]);
            $flagged[] = ['assetId' => $assetId, 'flag' => $flag];
        }
    }
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_return', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['flagged' => $flagged]]);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── QM closes the booking after condition check ────────────────────────────────
$router->post('/api/qm/bookings/:id/close', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user)) jsonResponse(['error' => 'Quartermaster access required.'], 403);
    $b = qmBookingOr404($params['id']);
    if ($b['status'] !== 'returned') jsonResponse(['error' => 'Only a returned booking can be closed.'], 409);
    dbRun("UPDATE qm_bookings SET status = 'closed', closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_close', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── Cancel (owner while draft/submitted, QM at any non-closed point) ────────────
$router->post('/api/qm/bookings/:id/cancel', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    $b = qmBookingOr404($params['id']);
    $isOwner = (int) $b['requester_user_id'] === (int) $user['id'];
    $isQm = qmCanApprove($user);
    if (!$isOwner && !$isQm) jsonResponse(['error' => 'You cannot cancel this booking.'], 403);
    if (in_array($b['status'], ['closed', 'cancelled'], true)) jsonResponse(['error' => 'This booking is already ' . $b['status'] . '.'], 409);
    if ($isOwner && !$isQm && !in_array($b['status'], ['draft', 'submitted'], true)) jsonResponse(['error' => 'Ask a Quartermaster to cancel a booking that is already approved.'], 409);
    $body = requestBody();
    $reason = trim((string) ($body['reason'] ?? '')) ?: null;
    dbRun("UPDATE qm_bookings SET status = 'cancelled', cancel_reason = ?, updated_at = datetime('now') WHERE id = ?", [$reason, $b['id']]);
    // Release any instances we were holding for this booking (reserved -> available).
    dbRun("UPDATE equipment_asset_instances SET status = 'available' WHERE status = 'reserved' AND id IN (
        SELECT bii.instance_id FROM qm_booking_item_instances bii JOIN qm_booking_items bi ON bi.id = bii.booking_item_id WHERE bi.booking_id = ?
    )", [$b['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'qm_booking_cancel', 'entityType' => 'qm_booking', 'entityId' => (string) $b['id'], 'ipAddress' => clientIp(), 'details' => ['reason' => $reason]]);
    $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
    // Tell the other party.
    if ($isQm && !$isOwner) notify((int) $b['requester_user_id'], 'qm_booking', 'Booking cancelled', $ref . ' was cancelled by the Quartermaster.' . ($reason ? ' Reason: ' . $reason : ''), 'quartermaster.html?id=' . $b['id']);
    elseif ($isOwner) notifyRoles(['group_leadership', 'admin'], 'qm_booking', 'Booking cancelled by requester', $ref . ' was cancelled by the requester.', 'quartermaster.html?id=' . $b['id']);
    jsonResponse(serializeQmBooking(qmBookingOr404($b['id']), true));
});

// ── Summary reporting (FR-QM-020). QMs, trustees, admins. Counts + light lists. ─
$router->get('/api/qm/summary', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireQmBookingEnabled();
    if (!qmCanApprove($user) && !isTrusteeDashboardRole($user['portal_role'])) jsonResponse(['error' => 'Not permitted.'], 403);
    $now = gmdate('Y-m-d H:i:s');
    $soon = gmdate('Y-m-d H:i:s', strtotime('+14 days'));
    $counts = [
        'pendingReview' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'submitted'")['n'],
        'onLoan' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'collected'")['n'],
        'overdue' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'collected' AND return_at IS NOT NULL AND return_at < ?", [$now])['n'],
        'upcoming' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status IN ('approved','partially_approved','ready_for_collection') AND collect_at IS NOT NULL AND collect_at <= ?", [$soon])['n'],
        'damagedItems' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_booking_items WHERE damage_notes IS NOT NULL AND damage_notes != ''")['n'],
    ];
    // Most-requested items (utilisation) across all non-cancelled bookings.
    $utilisation = dbAll(
        "SELECT item_name, COUNT(*) AS bookings, SUM(requested_qty) AS units
         FROM qm_booking_items i JOIN qm_bookings b ON b.id = i.booking_id
         WHERE b.status != 'cancelled' GROUP BY item_name ORDER BY bookings DESC, units DESC LIMIT 10"
    );
    jsonResponse([
        'counts' => $counts,
        'utilisation' => array_map(fn($r) => ['itemName' => $r['item_name'], 'bookings' => (int) $r['bookings'], 'units' => (int) $r['units']], $utilisation),
        'summaryOnly' => !qmCanApprove($user),
    ]);
});
