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
    // Managing leaders landing here is a natural, low-frequency touchpoint to refresh
    // the critical-exception notifications (debounced, so it runs at most every 10 min).
    if (eventHubCanManage($user)) maybeScanEventCriticalExceptions();
    $today = gmdate('Y-m-d');
    $rows = dbAll('SELECT * FROM event_hubs ORDER BY (status = \'archived\'), start_date IS NULL, start_date, id DESC');
    $out = [];
    foreach ($rows as $h) {
        if ($isLeaderView) {
            $r = eventHubReadiness($h);
            $item = array_merge(serializeHub($h), ['readiness' => $r]);
            // Camp Readiness checker: an operational rollup for events still ahead of
            // us (not archived), so leaders see which camps have blockers/gaps at a
            // glance without opening each one.
            if ($h['status'] !== 'archived' && (empty($h['start_date']) || $h['start_date'] >= $today)) {
                $item['rollup'] = eventReadinessRollup($h);
            }
            $out[] = $item;
        } elseif (eventHubVisibleToParent($user, $h)) {
            $out[] = serializeHub($h);
        }
    }
    jsonResponse([
        'events' => $out,
        'isLeaderView' => $isLeaderView,
        'canManage' => eventHubCanManage($user),
        // Open critical exceptions (blocked Command Centre areas on live events) for
        // the events-list banner - leader-only, mirrors what was pushed as notifications.
        'exceptions' => $isLeaderView ? eventOpenExceptions() : [],
        'meta' => ['types' => EVENT_TYPES, 'statuses' => EVENT_HUB_STATUSES, 'itemStatuses' => EVENT_ITEM_STATUSES, 'visibilities' => EVENT_ITEM_VISIBILITIES],
    ]);
});

// Admin / cron "check now": run the critical-exception scan on demand and report the
// counts. Suitable for a scheduled call as well as a manual admin trigger.
$router->post('/api/events/exceptions/scan', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $result = scanEventCriticalExceptions();
    logAudit(['userId' => $user['id'], 'action' => 'event_exception_scan', 'entityType' => 'event_hub', 'entityId' => null, 'ipAddress' => clientIp(), 'details' => $result]);
    jsonResponse(array_merge(['ok' => true], $result, ['exceptions' => eventOpenExceptions()]));
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
        // Transport & manifests - leader-only operational data.
        'transport' => $isLeaderView ? eventCampTransport((int) $hub['id']) : null,
        // Programme matrix & activity allocation - leader-only.
        'programme' => $isLeaderView ? eventCampProgramme((int) $hub['id']) : null,
        // Command Centre: per-area readiness rollup so the event acts as the
        // operational spine - leader-only.
        'commandCentre' => $isLeaderView ? eventCommandCentre($hub) : null,
        // Plan version history & acknowledgements (FRD-CAMP-010) - leader-only.
        'versions' => $isLeaderView ? eventCampVersions((int) $hub['id'], (int) $user['id']) : null,
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

// -- Transport & manifests (FR-CAMP-OP-023..028) --
function eventTransportVehicleFields(array $b, array $existing = []): array
{
    return [
        'name' => trim((string) ($b['name'] ?? $existing['name'] ?? '')),
        'vehicle_type' => array_key_exists($b['vehicleType'] ?? null, CAMP_TRANSPORT_TYPES) ? $b['vehicleType'] : ($existing['vehicle_type'] ?? 'car'),
        'driver_name' => array_key_exists('driverName', $b) ? (trim((string) $b['driverName']) ?: null) : ($existing['driver_name'] ?? null),
        'capacity' => array_key_exists('capacity', $b) ? (($b['capacity'] === '' || $b['capacity'] === null) ? null : max(0, (int) $b['capacity'])) : (isset($existing['capacity']) ? $existing['capacity'] : null),
        'depart_at' => array_key_exists('departAt', $b) ? (trim((string) $b['departAt']) ?: null) : ($existing['depart_at'] ?? null),
        'notes' => array_key_exists('notes', $b) ? (trim((string) $b['notes']) ?: null) : ($existing['notes'] ?? null),
    ];
}
$router->post('/api/events/:id/transport/vehicles', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = eventHubForManage($params['id']);
    $f = eventTransportVehicleFields(requestBody());
    if ($f['name'] === '') jsonResponse(['error' => 'A vehicle name is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO camp_transport_vehicles (hub_id, ' . implode(',', $cols) . ') VALUES (?, ' . implode(',', array_fill(0, count($cols), '?')) . ')', [$hub['id'], ...array_values($f)]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_transport_vehicle_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeTransportVehicle(dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ?', [$result['lastInsertId']]), []), 201);
});
$router->patch('/api/events/:id/transport/vehicles/:vid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $v = dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ? AND hub_id = ?', [$params['vid'], $params['id']]);
    if (!$v) jsonResponse(['error' => 'Vehicle not found.'], 404);
    $f = eventTransportVehicleFields(requestBody(), $v);
    if ($f['name'] === '') jsonResponse(['error' => 'A vehicle name is required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE camp_transport_vehicles SET $set WHERE id = ?", [...array_values($f), $v['id']]);
    $pax = dbAll('SELECT * FROM camp_transport_passengers WHERE vehicle_id = ? ORDER BY sort_order, id', [$v['id']]);
    jsonResponse(serializeTransportVehicle(dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ?', [$v['id']]), $pax));
});
$router->delete('/api/events/:id/transport/vehicles/:vid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $v = dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ? AND hub_id = ?', [$params['vid'], $params['id']]);
    if (!$v) jsonResponse(['error' => 'Vehicle not found.'], 404);
    dbRun('DELETE FROM camp_transport_vehicles WHERE id = ?', [$v['id']]); // passengers cascade
    logAudit(['userId' => $user['id'], 'action' => 'camp_transport_vehicle_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
$router->post('/api/events/:id/transport/vehicles/:vid/passengers', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $v = dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ? AND hub_id = ?', [$params['vid'], $params['id']]);
    if (!$v) jsonResponse(['error' => 'Vehicle not found.'], 404);
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A passenger name is required.'], 400);
    dbRun('INSERT INTO camp_transport_passengers (vehicle_id, hub_id, passenger_name, notes) VALUES (?, ?, ?, ?)',
        [$v['id'], $v['hub_id'], $name, trim((string) ($b['notes'] ?? '')) ?: null]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_transport_passenger_add', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    $pax = dbAll('SELECT * FROM camp_transport_passengers WHERE vehicle_id = ? ORDER BY sort_order, id', [$v['id']]);
    jsonResponse(serializeTransportVehicle(dbGet('SELECT * FROM camp_transport_vehicles WHERE id = ?', [$v['id']]), $pax), 201);
});
$router->delete('/api/events/:id/transport/passengers/:pid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $p = dbGet('SELECT * FROM camp_transport_passengers WHERE id = ? AND hub_id = ?', [$params['pid'], $params['id']]);
    if (!$p) jsonResponse(['error' => 'Passenger not found.'], 404);
    dbRun('DELETE FROM camp_transport_passengers WHERE id = ?', [$p['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_transport_passenger_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// -- Programme matrix & activity allocation (FR-CAMP-OP-009..017) --
function eventProgrammeSlotFields(array $b, array $existing = []): array
{
    return [
        'day_label' => trim((string) ($b['dayLabel'] ?? $existing['day_label'] ?? '')),
        'session' => array_key_exists($b['session'] ?? null, CAMP_ROTA_SESSIONS) ? $b['session'] : ($existing['session'] ?? 'am'),
        'activity' => trim((string) ($b['activity'] ?? $existing['activity'] ?? '')),
        'group_label' => array_key_exists('group', $b) ? (trim((string) $b['group']) ?: null) : ($existing['group_label'] ?? null),
        'location' => array_key_exists('location', $b) ? (trim((string) $b['location']) ?: null) : ($existing['location'] ?? null),
        'lead_name' => array_key_exists('lead', $b) ? (trim((string) $b['lead']) ?: null) : ($existing['lead_name'] ?? null),
        'notes' => array_key_exists('notes', $b) ? (trim((string) $b['notes']) ?: null) : ($existing['notes'] ?? null),
    ];
}
$router->post('/api/events/:id/programme', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = eventHubForManage($params['id']);
    $f = eventProgrammeSlotFields(requestBody());
    if ($f['day_label'] === '') jsonResponse(['error' => 'A day is required.'], 400);
    if ($f['activity'] === '') jsonResponse(['error' => 'An activity is required.'], 400);
    $cols = array_keys($f);
    $result = dbRun('INSERT INTO camp_programme_slots (hub_id, ' . implode(',', $cols) . ') VALUES (?, ' . implode(',', array_fill(0, count($cols), '?')) . ')', [$hub['id'], ...array_values($f)]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_programme_slot_add', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeProgrammeSlot(dbGet('SELECT * FROM camp_programme_slots WHERE id = ?', [$result['lastInsertId']])), 201);
});
$router->patch('/api/events/:id/programme/:sid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $s = dbGet('SELECT * FROM camp_programme_slots WHERE id = ? AND hub_id = ?', [$params['sid'], $params['id']]);
    if (!$s) jsonResponse(['error' => 'Activity not found.'], 404);
    $f = eventProgrammeSlotFields(requestBody(), $s);
    if ($f['day_label'] === '' || $f['activity'] === '') jsonResponse(['error' => 'A day and activity are required.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE camp_programme_slots SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $s['id']]);
    jsonResponse(serializeProgrammeSlot(dbGet('SELECT * FROM camp_programme_slots WHERE id = ?', [$s['id']])));
});
$router->delete('/api/events/:id/programme/:sid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $s = dbGet('SELECT * FROM camp_programme_slots WHERE id = ? AND hub_id = ?', [$params['sid'], $params['id']]);
    if (!$s) jsonResponse(['error' => 'Activity not found.'], 404);
    dbRun('DELETE FROM camp_programme_slots WHERE id = ?', [$s['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_programme_slot_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// Import a programme from a pasted spreadsheet/CSV (FR-CAMP-OP-029..030). Columns:
// Day, Session, Activity, Group, Location, Lead (case-insensitive, with aliases).
// dryRun previews without writing; clashes surface once imported (eventCampProgramme).
$router->post('/api/events/:id/programme/import', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = eventHubForManage($params['id']);
    $b = requestBody();
    $csv = trim((string) ($b['csv'] ?? ''));
    $dryRun = !empty($b['dryRun']);
    if ($csv === '') jsonResponse(['error' => 'Paste some spreadsheet rows first.'], 422);
    $lines = preg_split('/\r\n|\r|\n/', $csv);
    $rows = array_values(array_filter(array_map('str_getcsv', $lines), fn($r) => count(array_filter($r, fn($c) => trim((string) $c) !== '')) > 0));
    if (count($rows) < 2) jsonResponse(['error' => 'Needs a header row and at least one activity row.'], 422);
    $aliases = [
        'day' => ['day', 'date'], 'session' => ['session', 'time', 'slot'],
        'activity' => ['activity', 'session name', 'item', 'what'],
        'group' => ['group', 'patrol', 'team', 'section', 'six'],
        'location' => ['location', 'where', 'place'], 'lead' => ['lead', 'leader', 'adult', 'in charge'],
    ];
    $header = array_map(fn($h) => strtolower(trim((string) $h)), array_shift($rows));
    $col = [];
    foreach ($aliases as $f => $names) { foreach ($names as $n) { $i = array_search($n, $header, true); if ($i !== false) { $col[$f] = $i; break; } } }
    if (!isset($col['day']) || !isset($col['activity'])) jsonResponse(['error' => 'The sheet needs at least "Day" and "Activity" columns.'], 422);
    $cell = fn($row, $f) => isset($col[$f]) ? trim((string) ($row[$col[$f]] ?? '')) : '';
    $normSession = function ($v) {
        $v = strtolower(trim((string) $v));
        if ($v === '' || str_contains($v, 'morn') || $v === 'am') return 'am';
        if (str_contains($v, 'after') || $v === 'pm') return 'pm';
        if (str_contains($v, 'eve')) return 'evening';
        if (str_contains($v, 'night') || str_contains($v, 'overnight')) return 'night';
        if (str_contains($v, 'all')) return 'all_day';
        return 'am';
    };
    $ready = []; $errors = [];
    foreach ($rows as $n => $row) {
        $rowNo = $n + 2;
        $day = $cell($row, 'day'); $act = $cell($row, 'activity');
        if ($day === '' || $act === '') { $errors[] = ['row' => $rowNo, 'error' => 'Missing day or activity']; continue; }
        $ready[] = ['day_label' => $day, 'session' => $normSession($cell($row, 'session')), 'activity' => $act,
            'group_label' => $cell($row, 'group') ?: null, 'location' => $cell($row, 'location') ?: null, 'lead_name' => $cell($row, 'lead') ?: null];
    }
    if ($dryRun) {
        jsonResponse(['dryRun' => true, 'readyCount' => count($ready), 'errors' => $errors,
            'preview' => array_map(fn($r) => ['day' => $r['day_label'], 'session' => CAMP_ROTA_SESSIONS[$r['session']], 'activity' => $r['activity'], 'group' => $r['group_label']], array_slice($ready, 0, 15))]);
    }
    if (!$ready) jsonResponse(['error' => 'No importable activities found.'], 422);
    foreach ($ready as $r) {
        dbRun('INSERT INTO camp_programme_slots (hub_id, day_label, session, activity, group_label, location, lead_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$hub['id'], $r['day_label'], $r['session'], $r['activity'], $r['group_label'], $r['location'], $r['lead_name']]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'camp_programme_import', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp(), 'details' => ['added' => count($ready), 'skipped' => count($errors)]]);
    jsonResponse(['ok' => true, 'added' => count($ready), 'skipped' => count($errors), 'errors' => $errors]);
});

// ── Plan version history & acknowledgements (FRD-CAMP-010) ───────────────────
// Capture a snapshot of the plan's current shape as a numbered version. The snapshot
// freezes the counts/readiness at this moment so the history is an honest record.
// Capturing is a manage action; acknowledging is open to any leader who can view it.
$router->post('/api/events/:id/versions', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $hub = dbGet('SELECT * FROM event_hubs WHERE id = ?', [$params['id']]);
    if (!$hub) jsonResponse(['error' => 'Event not found.'], 404);
    $b = requestBody();
    $label = trim((string) ($b['label'] ?? ''));
    $summary = trim((string) ($b['summary'] ?? ''));
    if ($summary === '') jsonResponse(['error' => 'Add a short note on what changed in this version.'], 422);
    $next = (int) (dbGet('SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM camp_plan_versions WHERE hub_id = ?', [$hub['id']])['n']);
    $byName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: null;
    $result = dbRun(
        'INSERT INTO camp_plan_versions (hub_id, version_no, label, summary, snapshot_json, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$hub['id'], $next, $label ?: null, $summary, json_encode(campPlanSnapshot($hub)), $user['id'], $byName]
    );
    logAudit(['userId' => $user['id'], 'action' => 'camp_plan_version_capture', 'entityType' => 'event_hub', 'entityId' => (string) $hub['id'], 'ipAddress' => clientIp(), 'details' => ['versionNo' => $next]]);
    jsonResponse(eventCampVersions((int) $hub['id'], (int) $user['id']), 201);
});

// Acknowledge a version - any leader who can view the event may record that they've
// read it (INSERT OR IGNORE keeps it idempotent, so re-acknowledging is harmless).
$router->post('/api/events/:id/versions/:vid/ack', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!isLeaderRole($user['portal_role'])) jsonResponse(['error' => 'Not permitted.'], 403);
    $v = dbGet('SELECT * FROM camp_plan_versions WHERE id = ? AND hub_id = ?', [$params['vid'], $params['id']]);
    if (!$v) jsonResponse(['error' => 'Version not found.'], 404);
    $byName = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) ?: null;
    dbRun('INSERT OR IGNORE INTO camp_plan_acks (version_id, hub_id, user_id, user_name) VALUES (?, ?, ?, ?)', [$v['id'], $params['id'], $user['id'], $byName]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_plan_version_ack', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp(), 'details' => ['versionNo' => (int) $v['version_no']]]);
    jsonResponse(eventCampVersions((int) $params['id'], (int) $user['id']));
});

$router->delete('/api/events/:id/versions/:vid', function ($params) {
    $user = requireAuth();
    requireEventHubEnabled();
    if (!eventHubCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $v = dbGet('SELECT * FROM camp_plan_versions WHERE id = ? AND hub_id = ?', [$params['vid'], $params['id']]);
    if (!$v) jsonResponse(['error' => 'Version not found.'], 404);
    dbRun('DELETE FROM camp_plan_versions WHERE id = ?', [$v['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'camp_plan_version_delete', 'entityType' => 'event_hub', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp(), 'details' => ['versionNo' => (int) $v['version_no']]]);
    jsonResponse(eventCampVersions((int) $params['id'], (int) $user['id']));
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
