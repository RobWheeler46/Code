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
    // Rare, but a hub created directly as published should still notify parents.
    if (($f['status'] ?? 'draft') === 'published') {
        eventHubNotifyPublished(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$result['lastInsertId']]));
    }
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
        // Adult rota is leader-only (FR-CAMP-OP: parents never see operational data).
        'rota' => $isLeaderView ? eventCampRota((int) $hub['id']) : null,
        // Command Centre: per-area readiness rollup so the event acts as the
        // operational spine - leader-only.
        'commandCentre' => $isLeaderView ? eventCommandCentre($hub) : null,
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
    // Notify parents on the draft -> published transition (FR-EVT-HUB).
    if ($f['status'] === 'published' && $hub['status'] !== 'published') {
        eventHubNotifyPublished(dbGet('SELECT * FROM event_hubs WHERE id = ?', [$hub['id']]));
    }
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
    dbRun('DELETE FROM camp_rota_entries WHERE hub_id = ?', [$hub['id']]);
    dbRun('DELETE FROM camp_rota_adults WHERE hub_id = ?', [$hub['id']]);
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

// ── Camp adult rota (FR-CAMP-OP-018..021) ───────────────────────────────────
function eventHubForManage($id): array
{
    $hub = dbGet('SELECT id FROM event_hubs WHERE id = ?', [$id]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    return $hub;
}

// -- Adult team --
$router->post('/api/events/:id/rota/adults', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = eventHubForManage($params['id']);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A name is required.'], 400);
    $result = dbRun('INSERT INTO camp_rota_adults (hub_id, name, is_driver, is_first_aider, skills) VALUES (?, ?, ?, ?, ?)',
        [$hub['id'], $name, !empty($b['isDriver']) ? 1 : 0, !empty($b['isFirstAider']) ? 1 : 0, trim((string) ($b['skills'] ?? '')) ?: null]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_rota_adult_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeRotaAdult(dbGet('SELECT * FROM camp_rota_adults WHERE id = ?', [$result['lastInsertId']])), 201);
});
$router->patch('/api/events/:id/rota/adults/:aid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $a = dbGet('SELECT * FROM camp_rota_adults WHERE id = ? AND hub_id = ?', [$params['aid'], $params['id']]);
    if (!$a) jsonResponse(['error' => 'Adult not found.'], 404);
    $b = requestBody();
    dbRun('UPDATE camp_rota_adults SET name = ?, is_driver = ?, is_first_aider = ?, skills = ? WHERE id = ?', [
        trim((string) ($b['name'] ?? $a['name'])) ?: $a['name'],
        array_key_exists('isDriver', $b) ? (!empty($b['isDriver']) ? 1 : 0) : $a['is_driver'],
        array_key_exists('isFirstAider', $b) ? (!empty($b['isFirstAider']) ? 1 : 0) : $a['is_first_aider'],
        array_key_exists('skills', $b) ? (trim((string) $b['skills']) ?: null) : $a['skills'], $a['id'],
    ]);
    jsonResponse(serializeRotaAdult(dbGet('SELECT * FROM camp_rota_adults WHERE id = ?', [$a['id']])));
});
$router->delete('/api/events/:id/rota/adults/:aid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $a = dbGet('SELECT * FROM camp_rota_adults WHERE id = ? AND hub_id = ?', [$params['aid'], $params['id']]);
    if (!$a) jsonResponse(['error' => 'Adult not found.'], 404);
    dbRun('DELETE FROM camp_rota_adults WHERE id = ?', [$a['id']]); // entries keep the slot, adult_id -> NULL (a gap)
    logAudit(['userId' => $user['id'], 'action' => 'camp_rota_adult_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// -- Rota entries --
function eventRotaEntryFields(array $b, array $existing = []): array
{
    return [
        'day_label' => trim((string) ($b['dayLabel'] ?? $existing['day_label'] ?? '')),
        'session' => array_key_exists($b['session'] ?? null, CAMP_ROTA_SESSIONS) ? $b['session'] : ($existing['session'] ?? 'am'),
        'role' => array_key_exists($b['role'] ?? null, CAMP_ROTA_ROLES) ? $b['role'] : ($existing['role'] ?? 'other'),
        'adult_id' => array_key_exists('adultId', $b) ? (!empty($b['adultId']) ? (int) $b['adultId'] : null) : ($existing['adult_id'] ?? null),
        'activity' => array_key_exists('activity', $b) ? (trim((string) $b['activity']) ?: null) : ($existing['activity'] ?? null),
        'notes' => array_key_exists('notes', $b) ? (trim((string) $b['notes']) ?: null) : ($existing['notes'] ?? null),
    ];
}
$router->post('/api/events/:id/rota/entries', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = eventHubForManage($params['id']);
    $f = eventRotaEntryFields(requestBody());
    if ($f['day_label'] === '') jsonResponse(['error' => 'A day is required.'], 400);
    // A chosen adult must belong to this hub's team.
    if ($f['adult_id'] !== null && !dbGet('SELECT 1 FROM camp_rota_adults WHERE id = ? AND hub_id = ?', [$f['adult_id'], $hub['id']])) jsonResponse(['error' => 'Unknown adult.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO camp_rota_entries (hub_id, ' . implode(',', $cols) . ') VALUES (?, ' . implode(',', array_fill(0, count($cols), '?')) . ')', [$hub['id'], ...array_values($f)]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_rota_entry_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp()]);
    $byId = []; foreach (dbAll('SELECT * FROM camp_rota_adults WHERE hub_id = ?', [$hub['id']]) as $a) $byId[(int) $a['id']] = $a;
    jsonResponse(serializeRotaEntry(dbGet('SELECT * FROM camp_rota_entries WHERE id = ?', [$result['lastInsertId']]), $byId), 201);
});
$router->patch('/api/events/:id/rota/entries/:eid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $e = dbGet('SELECT * FROM camp_rota_entries WHERE id = ? AND hub_id = ?', [$params['eid'], $params['id']]);
    if (!$e) jsonResponse(['error' => 'Entry not found.'], 404);
    $f = eventRotaEntryFields(requestBody(), $e);
    if ($f['day_label'] === '') jsonResponse(['error' => 'A day is required.'], 400);
    if ($f['adult_id'] !== null && !dbGet('SELECT 1 FROM camp_rota_adults WHERE id = ? AND hub_id = ?', [$f['adult_id'], $params['id']])) jsonResponse(['error' => 'Unknown adult.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE camp_rota_entries SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $e['id']]);
    $byId = []; foreach (dbAll('SELECT * FROM camp_rota_adults WHERE hub_id = ?', [$params['id']]) as $a) $byId[(int) $a['id']] = $a;
    jsonResponse(serializeRotaEntry(dbGet('SELECT * FROM camp_rota_entries WHERE id = ?', [$e['id']]), $byId));
});
$router->delete('/api/events/:id/rota/entries/:eid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $e = dbGet('SELECT * FROM camp_rota_entries WHERE id = ? AND hub_id = ?', [$params['eid'], $params['id']]);
    if (!$e) jsonResponse(['error' => 'Entry not found.'], 404);
    dbRun('DELETE FROM camp_rota_entries WHERE id = ?', [$e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_rota_entry_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
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
