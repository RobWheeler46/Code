<?php
// Internal calendar API (FRD FR-CAL / backlog LATER-007). Read access for any
// authenticated user (parents get parent-safe items only); create/edit/publish/
// convert restricted to operational leaders + admins. All mutations audited
// (FR-CAL-015). Optional module, off by default.

function calendarEntryOr404($id): array
{
    $e = dbGet('SELECT * FROM calendar_entries WHERE id = ?', [$id]);
    if (!$e) jsonResponse(['error' => 'Calendar entry not found.'], 404);
    return $e;
}

// Writable fields from a request body, with fall-back to an existing row.
function calendarFieldsFromBody(array $body, array $existing = []): array
{
    $allDay = array_key_exists('allDay', $body) ? (bool) $body['allDay'] : (bool) ($existing['all_day'] ?? true);
    $val = function ($bodyKey, $existingKey) use ($body, $existing) {
        if (array_key_exists($bodyKey, $body)) return ($body[$bodyKey] === '' || $body[$bodyKey] === null) ? null : $body[$bodyKey];
        return $existing[$existingKey] ?? null;
    };
    $enum = function ($bodyKey, $existingKey, array $allowed, $default) use ($body, $existing) {
        $v = array_key_exists($bodyKey, $body) ? $body[$bodyKey] : ($existing[$existingKey] ?? $default);
        return array_key_exists($v, $allowed) ? $v : $default;
    };
    $scope = $enum('scope', 'scope', CALENDAR_SCOPES, 'group');
    return [
        'title' => trim((string) ($body['title'] ?? $existing['title'] ?? '')),
        'entry_type' => $enum('entryType', 'entry_type', CALENDAR_ENTRY_TYPES, 'placeholder'),
        'scope' => $scope,
        'osm_section_id' => $scope === 'section' ? $val('sectionId', 'osm_section_id') : null,
        'section_name' => $scope === 'section' ? $val('sectionName', 'section_name') : null,
        'start_at' => calendarNormalizeDateTime($body['startAt'] ?? ($existing['start_at'] ?? null), false, $allDay),
        'end_at' => calendarNormalizeDateTime($body['endAt'] ?? ($existing['end_at'] ?? null), true, $allDay),
        'all_day' => $allDay ? 1 : 0,
        'location' => $val('location', 'location'),
        'owner_name' => $val('ownerName', 'owner_name'),
        'notes' => $val('notes', 'notes'),
    ];
}

// ── Aggregated calendar feed ────────────────────────────────────────────────────
$router->get('/api/calendar', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    // Default to the current month if no window supplied.
    $from = queryParam('from') ? calendarNormalizeDateTime(queryParam('from'), false, true) : gmdate('Y-m-01 00:00:00');
    $to = queryParam('to') ? calendarNormalizeDateTime(queryParam('to'), true, true) : gmdate('Y-m-t 23:59:59');
    if (!$from || !$to) jsonResponse(['error' => 'Invalid date range.'], 400);
    jsonResponse([
        'items' => calendarCollect($user, $from, $to),
        'canManage' => calendarCanManage($user),
        'range' => ['from' => $from, 'to' => $to],
        'meta' => [
            'entryTypes' => CALENDAR_ENTRY_TYPES,
            'scopes' => CALENDAR_SCOPES,
            'convertTemplates' => CALENDAR_CONVERT_TEMPLATES,
            'eventHubEnabled' => function_exists('eventHubEnabled') && eventHubEnabled(),
            'qmBookingEnabled' => function_exists('qmBookingEnabled') && qmBookingEnabled(),
        ],
    ]);
});

// ── Personal iCal feed (FR-CAL "iCal export") ───────────────────────────────────
// The signed-in user fetches (or rotates) their private subscription link. The link
// itself is served unauthenticated below, using the token as the credential.
$router->get('/api/calendar/feed', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    $token = calendarFeedToken((int) $user['id']);
    jsonResponse(['token' => $token, 'path' => '/calendar/feed/' . $token . '.ics']);
});

$router->post('/api/calendar/feed/regenerate', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    $token = calendarFeedToken((int) $user['id'], true);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_feed_regenerate', 'ipAddress' => clientIp()]);
    jsonResponse(['token' => $token, 'path' => '/calendar/feed/' . $token . '.ics']);
});

// The .ics feed itself - NO session auth; the token in the URL is the credential, and
// the feed is scoped to what that user may see. A calendar app polls this on a timer.
$router->get('/calendar/feed/:token', function ($params) {
    $token = preg_replace('/\.ics$/', '', (string) $params['token']);
    if (!preg_match('/^[a-f0-9]{48}$/', $token)) { http_response_code(404); exit; }
    $user = dbGet('SELECT * FROM users WHERE ical_token = ?', [$token]);
    if (!$user || !calendarEnabled()) { http_response_code(404); exit; }
    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: inline; filename="7thportal.ics"');
    header('Cache-Control: private, max-age=300');
    echo buildICalFeed($user);
    exit;
});

// ── Single local entry ──────────────────────────────────────────────────────────
$router->get('/api/calendar/entries/:id', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    $e = calendarEntryOr404($params['id']);
    // Parents may only read an entry that is published parent-safe.
    if ($user['portal_role'] === 'parent' && !($e['status'] === 'published' && $e['visibility'] === 'parents')) {
        jsonResponse(['error' => 'Calendar entry not found.'], 404);
    }
    jsonResponse(['entry' => serializeCalendarEntry($e), 'canManage' => calendarCanManage($user)]);
});

// ── Create ──────────────────────────────────────────────────────────────────────
$router->post('/api/calendar/entries', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'You cannot create calendar entries.'], 403);
    $f = calendarFieldsFromBody(requestBody());
    if ($f['title'] === '') jsonResponse(['error' => 'A title is required.'], 400);
    if (!$f['start_at']) jsonResponse(['error' => 'A start date is required.'], 400);
    if ($f['end_at'] && $f['end_at'] < $f['start_at']) jsonResponse(['error' => 'The end date must be on or after the start date.'], 400);
    $cols = array_keys($f);
    $result = dbRun(
        'INSERT INTO calendar_entries (' . implode(',', $cols) . ', created_by) VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ', ?)',
        [...array_values($f), $user['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'calendar_create', 'entityType' => 'calendar_entry', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['title' => $f['title']]]);
    jsonResponse(serializeCalendarEntry(calendarEntryOr404($result['lastInsertId'])), 201);
});

// ── Update ──────────────────────────────────────────────────────────────────────
$router->patch('/api/calendar/entries/:id', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'You cannot edit calendar entries.'], 403);
    $e = calendarEntryOr404($params['id']);
    $f = calendarFieldsFromBody(requestBody(), $e);
    if ($f['title'] === '') jsonResponse(['error' => 'A title is required.'], 400);
    if (!$f['start_at']) jsonResponse(['error' => 'A start date is required.'], 400);
    if ($f['end_at'] && $f['end_at'] < $f['start_at']) jsonResponse(['error' => 'The end date must be on or after the start date.'], 400);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($f)));
    dbRun("UPDATE calendar_entries SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($f), $e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_update', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeCalendarEntry(calendarEntryOr404($e['id'])));
});

// ── Publish a parent-safe version ───────────────────────────────────────────────
$router->post('/api/calendar/entries/:id/publish', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'You cannot publish calendar entries.'], 403);
    $e = calendarEntryOr404($params['id']);
    if ($e['status'] === 'cancelled') jsonResponse(['error' => 'A cancelled entry cannot be published.'], 409);
    $body = requestBody();
    $safeTitle = trim((string) ($body['parentSafeTitle'] ?? $e['parent_safe_title'] ?? ''));
    if ($safeTitle === '') jsonResponse(['error' => 'A parent-safe title is required to publish to parents.'], 400);
    $safeDesc = array_key_exists('parentSafeDescription', $body) ? (trim((string) $body['parentSafeDescription']) ?: null) : $e['parent_safe_description'];
    dbRun("UPDATE calendar_entries SET status = 'published', visibility = 'parents', parent_safe_title = ?, parent_safe_description = ?, updated_at = datetime('now') WHERE id = ?", [$safeTitle, $safeDesc, $e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_publish', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeCalendarEntry(calendarEntryOr404($e['id'])));
});

// ── Unpublish (back to leader-only) ─────────────────────────────────────────────
$router->post('/api/calendar/entries/:id/unpublish', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $e = calendarEntryOr404($params['id']);
    dbRun("UPDATE calendar_entries SET status = 'draft', visibility = 'leaders', updated_at = datetime('now') WHERE id = ?", [$e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_unpublish', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeCalendarEntry(calendarEntryOr404($e['id'])));
});

// ── Cancel ──────────────────────────────────────────────────────────────────────
$router->post('/api/calendar/entries/:id/cancel', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $e = calendarEntryOr404($params['id']);
    dbRun("UPDATE calendar_entries SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?", [$e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_cancel', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeCalendarEntry(calendarEntryOr404($e['id'])));
});

// ── Delete ──────────────────────────────────────────────────────────────────────
$router->delete('/api/calendar/entries/:id', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $e = calendarEntryOr404($params['id']);
    dbRun('DELETE FROM calendar_entries WHERE id = ?', [$e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_delete', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp(), 'details' => ['title' => $e['title']]]);
    jsonResponse(['ok' => true]);
});

// ── Convert a placeholder into an Event & Camp Hub record (FR-CAL-008) ──────────
$router->post('/api/calendar/entries/:id/convert', function ($params) {
    $user = requireAuth();
    requireCalendarEnabled();
    if (!calendarCanManage($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    if (!(function_exists('eventHubEnabled') && eventHubEnabled())) jsonResponse(['error' => 'Enable the Event & Camp Hub first to convert a plan into an event.'], 409);
    $e = calendarEntryOr404($params['id']);
    if ($e['converted_event_hub_id']) jsonResponse(['error' => 'This entry has already been converted to an event.'], 409);
    $body = requestBody();
    $template = array_key_exists($body['template'] ?? '', CALENDAR_CONVERT_TEMPLATES) ? $body['template'] : 'event';

    $result = dbRun(
        "INSERT INTO event_hubs (title, event_type, osm_section_id, section_name, start_date, end_date, location, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
        [
            $e['title'], $template, $e['osm_section_id'], $e['section_name'],
            substr((string) $e['start_at'], 0, 10), $e['end_at'] ? substr((string) $e['end_at'], 0, 10) : null,
            $e['location'], $user['id'],
        ]
    );
    $eventId = (int) $result['lastInsertId'];
    dbRun("UPDATE calendar_entries SET converted_event_hub_id = ?, updated_at = datetime('now') WHERE id = ?", [$eventId, $e['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'calendar_convert', 'entityType' => 'calendar_entry', 'entityId' => (string) $e['id'], 'ipAddress' => clientIp(), 'details' => ['eventHubId' => $eventId, 'template' => $template]]);
    jsonResponse(['ok' => true, 'eventHubId' => $eventId]);
});
