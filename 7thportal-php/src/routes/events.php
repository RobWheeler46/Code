<?php
// Event and Camp Hub API (FRD FR-EVT-HUB). Leaders manage hubs; parents get a
// safe view of published hubs (parent-visible items only). All mutations audited.

function eventHubFieldsFromBody(array $body, array $existing = []): array
{
    $val = function ($bk, $ek) use ($body, $existing) {
        if (array_key_exists($bk, $body)) return ($body[$bk] === '' || $body[$bk] === null) ? null : $body[$bk];
        return $existing[$ek] ?? null;
    };
    $type = array_key_exists($body['eventType'] ?? null, EVENT_TYPES) ? $body['eventType'] : ($existing['event_type'] ?? 'event');
    $status = array_key_exists($body['status'] ?? null, EVENT_HUB_STATUSES) ? $body['status'] : ($existing['status'] ?? 'draft');
    return [
        'title' => trim((string) ($body['title'] ?? $existing['title'] ?? '')),
        'event_type' => $type,
        'osm_section_id' => $val('sectionId', 'osm_section_id'),
        'section_name' => $val('sectionName', 'section_name'),
        'start_date' => $val('startDate', 'start_date'),
        'end_date' => $val('endDate', 'end_date'),
        'location' => $val('location', 'location'),
        'key_information' => $val('keyInformation', 'key_information'),
        'what_to_bring' => $val('whatToBring', 'what_to_bring'),
        'programme_highlights' => $val('programmeHighlights', 'programme_highlights'),
        'osm_event_url' => $val('osmEventUrl', 'osm_event_url'),
        'status' => $status,
    ];
}

$router->get('/api/events', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    $isLeaderView = isLeaderRole($user['portal_role']);
    $rows = dbAll('SELECT * FROM event_hubs ORDER BY (status = \'archived\'), start_date IS NULL, start_date, id DESC');
    $out = [];
    foreach ($rows as $h) {
        if ($isLeaderView) {
            $r = eventHubReadiness($h);
            $out[] = array_merge(serializeHub($h), ['readiness' => $r]);
        } elseif (eventHubVisibleToParent($user, $h)) {
            $out[] = serializeHub($h);
        }
    }
    jsonResponse([
        'events' => $out,
        'isLeaderView' => $isLeaderView,
        'canManage' => eventHubCanManage($user),
        'meta' => ['types' => EVENT_TYPES, 'statuses' => EVENT_HUB_STATUSES, 'itemStatuses' => EVENT_ITEM_STATUSES, 'visibilities' => EVENT_ITEM_VISIBILITIES],
    ]);
});

$router->post('/api/events', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'You do not have permission to create events.'], 403);
    $f = eventHubFieldsFromBody(requestBody());
    if ($f['title'] === '') jsonResponse(['error' => 'A title is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO event_hubs (' . implode(',', $cols) . ', created_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)', [...array_values($f), $user['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'event_hub_create', 'entityType' => 'event_hub', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['title' => $f['title']]]);
    jsonResponse(serializeHub(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$result['lastInsertId']]), true), 201);
});

$router->get('/api/events/:id', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    $isLeaderView = isLeaderRole($user['portal_role']);
    if (!$isLeaderView && !eventHubVisibleToParent($user, $hub)) jsonResponse(['error' => 'Event not found.'], 404);

    $allItems = dbAll('SELECT * FROM event_hub_items WHERE hub_id = ? ORDER BY sort_order, id', [$hub['id']]);
    // Parents never see leader-only items (FR-EVT-HUB-005 / FR-EVT-HUB-008).
    $items = $isLeaderView ? $allItems : array_values(array_filter($allItems, fn($i) => $i['visibility'] === 'parents'));

    // Location & emergency directory. Parents only ever see parent-visible locations
    // (FR-CAMP-OP-007); leader-only and emergency locations stay leader-side.
    $allLocs = dbAll('SELECT * FROM event_locations WHERE hub_id = ? ORDER BY sort_order, id', [$hub['id']]);
    $locs = $isLeaderView ? $allLocs : array_values(array_filter($allLocs, fn($l) => $l['visibility'] === 'parents'));

    jsonResponse(array_merge(serializeHub($hub, true), [
        'isLeaderView' => $isLeaderView,
        'canManage' => eventHubCanManage($user),
        'items' => array_map('serializeHubItem', $items),
        'locations' => array_map('serializeLocation', $locs),
        'readiness' => $isLeaderView ? eventHubReadiness($hub) : null,
        'overview' => $isLeaderView ? eventCampOverview($hub) : null,
        'locationMeta' => ['types' => EVENT_LOCATION_TYPES, 'visibilities' => EVENT_LOCATION_VISIBILITIES],
    ]));
});

$router->patch('/api/events/:id', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    $f = eventHubFieldsFromBody(requestBody(), $hub);
    if ($f['title'] === '') jsonResponse(['error' => 'A title is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE event_hubs SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $hub['id']]);
    logAudit(['userId' => $user['id'], 'action' => $f['status'] !== $hub['status'] ? 'event_hub_status_change' : 'event_hub_update', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeHub(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub['id']]), true));
});

$router->delete('/api/events/:id', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    dbRun('DELETE FROM event_hub_items WHERE hub_id = ?', [$hub['id']]);
    dbRun('DELETE FROM event_locations WHERE hub_id = ?', [$hub['id']]);
    dbRun('DELETE FROM event_hubs WHERE id = ?', [$hub['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'event_hub_delete', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp(), 'details' => ['title' => $hub['title']]]);
    jsonResponse(['ok' => true]);
});

// ── Camp locations (FR-CAMP-OP-004..008) ────────────────────────────────────
function eventLocationFieldsFromBody(array $body, array $existing = []): array
{
    $val = function ($bk, $ek) use ($body, $existing) {
        if (array_key_exists($bk, $body)) return ($body[$bk] === '' || $body[$bk] === null) ? null : $body[$bk];
        return $existing[$ek] ?? null;
    };
    return [
        'location_type' => array_key_exists($body['type'] ?? null, EVENT_LOCATION_TYPES) ? $body['type'] : ($existing['location_type'] ?? 'other'),
        'name' => trim((string) ($body['name'] ?? $existing['name'] ?? '')),
        'address' => $val('address', 'address'),
        'phone' => $val('phone', 'phone'),
        'opening_times' => $val('openingTimes', 'opening_times'),
        'notes' => $val('notes', 'notes'),
        'map_url' => $val('mapUrl', 'map_url'),
        'visibility' => array_key_exists($body['visibility'] ?? null, EVENT_LOCATION_VISIBILITIES) ? $body['visibility'] : ($existing['visibility'] ?? 'leaders'),
        'sort_order' => (int) ($body['sortOrder'] ?? $existing['sort_order'] ?? 0),
    ];
}

$router->post('/api/events/:id/locations', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = dbGet('SELECT id FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    $f = eventLocationFieldsFromBody(requestBody());
    if ($f['name'] === '') jsonResponse(['error' => 'A location name is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO event_locations (hub_id, ' . implode(',', $cols) . ') VALUES (?, ' . implode(',', array_fill(0, count($cols), '?')) . ')', [$hub['id'], ...array_values($f)]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_location_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp(), 'details' => ['name' => $f['name'], 'type' => $f['location_type']]]);
    jsonResponse(serializeLocation(dbGet('SELECT * FROM event_locations WHERE id = ?', [$result['lastInsertId']])), 201);
});

$router->patch('/api/events/:id/locations/:locId', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $loc = dbGet('SELECT * FROM event_locations WHERE id = ? AND hub_id = ?', [$params['locId'], $params['id']]);
    if (!$loc) jsonResponse(['error' => 'Location not found.'], 404);
    $f = eventLocationFieldsFromBody(requestBody(), $loc);
    if ($f['name'] === '') jsonResponse(['error' => 'A location name is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE event_locations SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $loc['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_location_update', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeLocation(dbGet('SELECT * FROM event_locations WHERE id = ?', [$loc['id']])));
});

$router->delete('/api/events/:id/locations/:locId', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $loc = dbGet('SELECT * FROM event_locations WHERE id = ? AND hub_id = ?', [$params['locId'], $params['id']]);
    if (!$loc) jsonResponse(['error' => 'Location not found.'], 404);
    dbRun('DELETE FROM event_locations WHERE id = ?', [$loc['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_location_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Hub items ──────────────────────────────────────────────────────────────
function eventItemFieldsFromBody(array $body, array $existing = []): array
{
    $val = function ($bk, $ek) use ($body, $existing) {
        if (array_key_exists($bk, $body)) return ($body[$bk] === '' || $body[$bk] === null) ? null : $body[$bk];
        return $existing[$ek] ?? null;
    };
    return [
        'label' => trim((string) ($body['label'] ?? $existing['label'] ?? '')),
        'item_status' => array_key_exists($body['itemStatus'] ?? null, EVENT_ITEM_STATUSES) ? $body['itemStatus'] : ($existing['item_status'] ?? 'draft'),
        'visibility' => array_key_exists($body['visibility'] ?? null, EVENT_ITEM_VISIBILITIES) ? $body['visibility'] : ($existing['visibility'] ?? 'parents'),
        'owner_name' => $val('owner', 'owner_name'),
        'link_url' => $val('linkUrl', 'link_url'),
        'notes' => $val('notes', 'notes'),
        'sort_order' => (int) ($body['sortOrder'] ?? $existing['sort_order'] ?? 0),
    ];
}

$router->post('/api/events/:id/items', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = dbGet('SELECT id FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    $f = eventItemFieldsFromBody(requestBody());
    if ($f['label'] === '') jsonResponse(['error' => 'An item label is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO event_hub_items (hub_id, ' . implode(',', $cols) . ') VALUES (?, ' . implode(',', array_fill(0, count($cols), '?')) . ')', [$hub['id'], ...array_values($f)]);
    logAudit(['userId' => $user['id'], 'action' => 'event_hub_item_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp(), 'details' => ['label' => $f['label']]]);
    jsonResponse(serializeHubItem(dbGet('SELECT * FROM event_hub_items WHERE id = ?', [$result['lastInsertId']])), 201);
});

$router->patch('/api/events/:id/items/:itemId', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $item = dbGet('SELECT * FROM event_hub_items WHERE id = ? AND hub_id = ?', [$params['itemId'], $params['id']]);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    $f = eventItemFieldsFromBody(requestBody(), $item);
    if ($f['label'] === '') jsonResponse(['error' => 'An item label is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE event_hub_items SET $set WHERE id = ?", [...array_values($f), $item['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'event_hub_item_update', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeHubItem(dbGet('SELECT * FROM event_hub_items WHERE id = ?', [$item['id']])));
});

$router->delete('/api/events/:id/items/:itemId', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $item = dbGet('SELECT * FROM event_hub_items WHERE id = ? AND hub_id = ?', [$params['itemId'], $params['id']]);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    dbRun('DELETE FROM event_hub_items WHERE id = ?', [$item['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'event_hub_item_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
