<?php
// Notifications API (FRD FR-NOT): in-portal list, read state, per-user preferences
// and an admin-triggered weekly digest send.

$router->get('/api/notifications', function ($params) {
    $user = requireAuth();
    $rows = notificationsForUser((int) $user['id']);
    jsonResponse([
        'unread' => unreadNotificationCount((int) $user['id']),
        'notifications' => array_map(fn($n) => [
            'id' => (int) $n['id'], 'type' => $n['type'], 'title' => $n['title'], 'body' => $n['body'],
            'link' => $n['link'], 'read' => $n['read_at'] !== null, 'createdAt' => $n['created_at'],
        ], $rows),
    ]);
});

$router->post('/api/notifications/:id/read', function ($params) {
    $user = requireAuth();
    dbRun("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ? AND read_at IS NULL", [$params['id'], $user['id']]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/notifications/read-all', function ($params) {
    $user = requireAuth();
    dbRun("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", [$user['id']]);
    jsonResponse(['ok' => true]);
});

$router->get('/api/notifications/preferences', function ($params) {
    $user = requireAuth();
    $prefs = notificationPrefs((int) $user['id']);
    $types = [];
    foreach (NOTIFICATION_TYPES as $key => $label) $types[] = ['key' => $key, 'label' => $label];
    jsonResponse(['types' => $types, 'mutedTypes' => $prefs['mutedTypes'], 'weeklyDigest' => $prefs['weeklyDigest']]);
});

$router->put('/api/notifications/preferences', function ($params) {
    $user = requireAuth();
    $body = requestBody();
    saveNotificationPrefs((int) $user['id'], is_array($body['mutedTypes'] ?? null) ? $body['mutedTypes'] : [], (bool) ($body['weeklyDigest'] ?? true));
    jsonResponse(['ok' => true]);
});

// Admin-triggered digest send (real weekly delivery is a cron calling this).
$router->post('/api/admin/notifications/send-digest', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $sent = sendWeeklyDigests();
    logAudit(['userId' => $admin['id'], 'action' => 'admin_send_digest', 'ipAddress' => clientIp(), 'details' => ['sent' => $sent]]);
    jsonResponse(['ok' => true, 'sent' => $sent]);
});
