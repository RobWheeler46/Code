<?php
// Ported from the Node version's src/routes/notices.js.

function noticesActiveRaw(): array
{
    return dbAll("
        SELECT * FROM notices
        WHERE status = 'published' AND date(start_date) <= date('now')
          AND (end_date IS NULL OR date(end_date) >= date('now'))
        ORDER BY start_date DESC
    ");
}

function listNoticesForUser(array $user, array $sectionIds = []): array
{
    $leader = isLeaderRole($user['portal_role']);
    return array_values(array_filter(noticesActiveRaw(), function ($n) use ($user, $leader, $sectionIds) {
        if ($n['audience'] === 'all') return true;
        if ($n['audience'] === 'parents') return $user['portal_role'] === 'parent';
        if ($n['audience'] === 'leaders') return $leader;
        if ($n['audience'] === 'section') return in_array($n['osm_section_id'], $sectionIds, true);
        return false;
    }));
}

function serializeNotice(array $n): array
{
    return [
        'id' => (int) $n['id'], 'title' => $n['title'], 'body' => $n['body'], 'audience' => $n['audience'],
        'sectionName' => $n['section_name'], 'startDate' => $n['start_date'], 'endDate' => $n['end_date'], 'status' => $n['status'],
    ];
}

$router->get('/api/notices', function ($params) {
    $user = requireAuth();
    if ($user['portal_role'] === 'parent') {
        $sectionIds = array_column(dbAll('SELECT DISTINCT osm_section_id FROM parent_child_links WHERE parent_user_id = ?', [$user['id']]), 'osm_section_id');
    } else {
        $sectionIds = array_values(array_filter(array_column(json_decode($user['osm_roles_json'] ?? '[]', true) ?: [], 'sectionid')));
    }
    jsonResponse(array_map('serializeNotice', listNoticesForUser($user, $sectionIds)));
});

$router->get('/api/admin/notices', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    jsonResponse(array_map('serializeNotice', dbAll('SELECT * FROM notices ORDER BY created_at DESC')));
});

$router->post('/api/admin/notices', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $body = requestBody();
    $title = $body['title'] ?? null;
    $bodyText = $body['body'] ?? null;
    $startDate = $body['startDate'] ?? null;
    if (!$title || !$bodyText || !$startDate) jsonResponse(['error' => 'Title, body and start date are required.'], 400);
    $validAudiences = ['all', 'parents', 'leaders', 'section'];
    $aud = in_array($body['audience'] ?? null, $validAudiences, true) ? $body['audience'] : 'all';
    $result = dbRun(
        "INSERT INTO notices (title, body, audience, osm_section_id, section_name, start_date, end_date, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)",
        [$title, $bodyText, $aud, $aud === 'section' ? ($body['sectionId'] ?? null) : null, $aud === 'section' ? ($body['sectionName'] ?? null) : null,
         $startDate, $body['endDate'] ?? null, $user['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'admin_create_notice', 'entityType' => 'notice', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeNotice(dbGet('SELECT * FROM notices WHERE id = ?', [$result['lastInsertId']])));
});

$router->patch('/api/admin/notices/:id', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $notice = dbGet('SELECT * FROM notices WHERE id = ?', [$params['id']]);
    if (!$notice) jsonResponse(['error' => 'Notice not found.'], 404);
    $body = requestBody();
    $validAudiences = ['all', 'parents', 'leaders', 'section'];
    $aud = in_array($body['audience'] ?? null, $validAudiences, true) ? $body['audience'] : $notice['audience'];
    $status = in_array($body['status'] ?? null, ['draft', 'published'], true) ? $body['status'] : $notice['status'];
    dbRun(
        "UPDATE notices SET title = ?, body = ?, audience = ?, osm_section_id = ?, section_name = ?,
         start_date = ?, end_date = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['title'] ?? $notice['title'], $body['body'] ?? $notice['body'], $aud,
            $aud === 'section' ? ($body['sectionId'] ?? $notice['osm_section_id']) : null,
            $aud === 'section' ? ($body['sectionName'] ?? $notice['section_name']) : null,
            $body['startDate'] ?? $notice['start_date'],
            array_key_exists('endDate', $body) ? $body['endDate'] : $notice['end_date'],
            $status, $notice['id'],
        ]
    );
    logAudit(['userId' => $user['id'], 'action' => $status === 'published' ? 'admin_publish_notice' : 'admin_update_notice', 'entityType' => 'notice', 'entityId' => (string) $notice['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeNotice(dbGet('SELECT * FROM notices WHERE id = ?', [$notice['id']])));
});

$router->delete('/api/admin/notices/:id', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $notice = dbGet('SELECT * FROM notices WHERE id = ?', [$params['id']]);
    if (!$notice) jsonResponse(['error' => 'Notice not found.'], 404);
    dbRun('DELETE FROM notices WHERE id = ?', [$notice['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'admin_delete_notice', 'entityType' => 'notice', 'entityId' => (string) $notice['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
