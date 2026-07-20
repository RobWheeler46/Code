<?php
// Ported from the Node version's src/routes/admin.js. Node used a blanket
// router.use('/api/admin', requireAuth, requireAdmin) middleware; here each
// handler just calls requireAuth()/requireAdmin() itself at the top,
// matching the pattern used throughout this port.

function requestOrigin(): string
{
    $scheme = (($_SERVER['HTTPS'] ?? '') === 'on' || ($_SERVER['SERVER_PORT'] ?? '') === '443') ? 'https' : 'http';
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost');
}

// ── Integration health ────────────────────────────────────────────────────
$router->get('/api/admin/integration-health', function ($params) {
    requireAdmin(requireAuth());
    $service = getServiceAccount();
    jsonResponse([
        'osmConfigured' => osmIsConfigured(),
        'demoModeAllowed' => osmDemoModeAllowed(),
        'serviceAccount' => $service ? [
            'name' => $service['first_name'] . ' ' . $service['last_name'],
            'connected' => $service['osm_access_token'] === 'demo' ? 'demo' : 'live',
            'lastLoginAt' => $service['last_login_at'],
        ] : null,
        'osmUserCount' => (int) dbGet("SELECT COUNT(*) AS n FROM users WHERE auth_type = 'osm'")['n'],
    ]);
});

$router->get('/api/admin/osm/sections', function ($params) {
    requireAdmin(requireAuth());
    $service = getServiceAccount() ?? requireAuth();
    $result = osmDataReadTokenFor(array_merge($service, ['portal_role' => 'section_leader']));
    if ($result['unavailable']) jsonResponse(['available' => false, 'reason' => $result['reason'], 'sections' => []]);

    if ($result['token'] === 'demo') {
        $sections = array_map(fn($s) => ['sectionId' => $s['sectionid'], 'sectionName' => $s['sectionname'], 'sectionType' => $s['section']], array_values(OSM_DEMO_SECTIONS));
    } else {
        $roles = array_values(array_filter(json_decode($service['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
        $sections = array_map(fn($r) => ['sectionId' => $r['sectionid'], 'sectionName' => $r['sectionname'], 'sectionType' => $r['section']], $roles);
    }
    jsonResponse(['available' => true, 'sections' => $sections, 'visibleSectionIds' => getVisibleSectionIds()]);
});

$router->get('/api/admin/osm/sections/:sectionId/members', function ($params) {
    requireAdmin(requireAuth());
    $service = getServiceAccount() ?? requireAuth();
    $result = osmDataReadTokenFor(array_merge($service, ['portal_role' => 'section_leader']));
    if ($result['unavailable']) jsonResponse(['available' => false, 'reason' => $result['reason'], 'members' => []]);
    jsonResponse(osmDataSectionMembers($result['token'], $params['sectionId']));
});

$router->get('/api/admin/settings', function ($params) {
    requireAdmin(requireAuth());
    $map = [];
    foreach (dbAll('SELECT * FROM settings') as $row) { $map[$row['key']] = $row['value']; }
    jsonResponse([
        'sessionTimeoutMinutes' => (int) ($map['session_timeout_minutes'] ?? 720),
        'auditRetentionDays' => (int) ($map['audit_retention_days'] ?? 365),
        'visibleSectionIds' => !empty($map['visible_sections']) ? json_decode($map['visible_sections'], true) : null,
        'galleryEnabled' => ($map['gallery_enabled'] ?? null) === 'true',
        'galleryWatermarkDefault' => ($map['gallery_watermark_default'] ?? null) === 'true',
        'galleryRetentionDays' => (int) ($map['gallery_retention_days'] ?? 365),
        'financeEnabled' => ($map['finance_enabled'] ?? null) === 'true',
        'financeThresholdTier1' => (float) ($map['finance_threshold_tier1'] ?? 50),
        'financeThresholdTier2' => (float) ($map['finance_threshold_tier2'] ?? 250),
        'financeRetentionDays' => (int) ($map['finance_retention_days'] ?? 730),
    ]);
});

$router->put('/api/admin/settings', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $body = requestBody();
    $upsert = fn($key, $value) => dbRun('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [$key, $value]);

    if (!empty($body['sessionTimeoutMinutes'])) $upsert('session_timeout_minutes', (string) $body['sessionTimeoutMinutes']);
    if (!empty($body['auditRetentionDays'])) $upsert('audit_retention_days', (string) $body['auditRetentionDays']);
    if (array_key_exists('visibleSectionIds', $body)) $upsert('visible_sections', $body['visibleSectionIds'] === null ? '' : json_encode($body['visibleSectionIds']));
    if (array_key_exists('galleryEnabled', $body)) $upsert('gallery_enabled', $body['galleryEnabled'] ? 'true' : 'false');
    if (array_key_exists('galleryWatermarkDefault', $body)) $upsert('gallery_watermark_default', $body['galleryWatermarkDefault'] ? 'true' : 'false');
    if (!empty($body['galleryRetentionDays'])) $upsert('gallery_retention_days', (string) $body['galleryRetentionDays']);
    if (array_key_exists('financeEnabled', $body)) {
        $upsert('finance_enabled', $body['financeEnabled'] ? 'true' : 'false');
        if ($body['financeEnabled']) financeSeedDemoDataIfMissing();
    }
    if (!empty($body['financeThresholdTier1'])) $upsert('finance_threshold_tier1', (string) $body['financeThresholdTier1']);
    if (!empty($body['financeThresholdTier2'])) $upsert('finance_threshold_tier2', (string) $body['financeThresholdTier2']);
    if (!empty($body['financeRetentionDays'])) $upsert('finance_retention_days', (string) $body['financeRetentionDays']);

    logAudit(['userId' => $user['id'], 'action' => array_key_exists('galleryEnabled', $body) ? 'admin_toggle_gallery' : (array_key_exists('financeEnabled', $body) ? 'admin_toggle_finance' : 'admin_update_settings'), 'ipAddress' => clientIp(), 'details' => $body]);
    jsonResponse(['ok' => true]);
});

// ── Users and roles (FR-056, FR-061) ──────────────────────────────────────
$router->get('/api/admin/users', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map(fn($u) => [
        'id' => (int) $u['id'], 'firstName' => $u['first_name'], 'lastName' => $u['last_name'], 'email' => $u['email'],
        'authType' => $u['auth_type'], 'role' => $u['portal_role'], 'roleLabel' => roleLabel($u['portal_role']),
        'status' => $u['account_status'], 'isServiceAccount' => (bool) $u['is_osm_service_account'], 'lastLoginAt' => $u['last_login_at'],
    ], dbAll('SELECT * FROM users ORDER BY created_at DESC')));
});

$router->get('/api/admin/roles', function ($params) {
    requireAdmin(requireAuth());
    $out = [];
    foreach (ROLE_LABELS as $value => $label) { $out[] = ['value' => $value, 'label' => $label]; }
    jsonResponse($out);
});

$router->patch('/api/admin/users/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $user = dbGet('SELECT * FROM users WHERE id = ?', [$params['id']]);
    if (!$user) jsonResponse(['error' => 'User not found.'], 404);
    $body = requestBody();
    $role = $body['role'] ?? null;
    $status = $body['status'] ?? null;

    if ($role && !array_key_exists($role, ROLE_LABELS)) jsonResponse(['error' => 'Unknown role.'], 400);
    if ($user['portal_role'] === 'admin' && $role && $role !== 'admin') {
        $otherAdmins = (int) dbGet("SELECT COUNT(*) AS n FROM users WHERE portal_role = 'admin' AND id != ? AND account_status = 'active'", [$user['id']])['n'];
        if ($otherAdmins === 0) jsonResponse(['error' => 'At least one active Portal Administrator is required.'], 400);
    }
    if ($user['portal_role'] === 'admin' && $status && $status !== 'active') {
        $otherAdmins = (int) dbGet("SELECT COUNT(*) AS n FROM users WHERE portal_role = 'admin' AND id != ? AND account_status = 'active'", [$user['id']])['n'];
        if ($otherAdmins === 0) jsonResponse(['error' => 'At least one active Portal Administrator is required.'], 400);
    }

    dbRun("UPDATE users SET portal_role = ?, account_status = ?, updated_at = datetime('now') WHERE id = ?", [$role ?: $user['portal_role'], $status ?: $user['account_status'], $user['id']]);
    logAudit(['userId' => $admin['id'], 'action' => ($status && $status !== 'active') ? 'admin_disable_user' : 'admin_change_role', 'entityType' => 'user', 'entityId' => (string) $user['id'], 'ipAddress' => clientIp(), 'details' => ['role' => $role, 'status' => $status]]);
    jsonResponse(['ok' => true]);
});

// ── Parent accounts and child links ───────────────────────────────────────
$router->get('/api/admin/parents', function ($params) {
    requireAdmin(requireAuth());
    $parents = dbAll("SELECT * FROM users WHERE portal_role = 'parent' ORDER BY created_at DESC");
    $links = dbAll('SELECT * FROM parent_child_links');
    jsonResponse(array_map(function ($p) use ($links) {
        $children = array_values(array_map(
            fn($l) => ['linkId' => (int) $l['id'], 'name' => $l['child_display_name'], 'sectionName' => $l['osm_section_name']],
            array_filter($links, fn($l) => (int) $l['parent_user_id'] === (int) $p['id'])
        ));
        return [
            'id' => (int) $p['id'], 'firstName' => $p['first_name'], 'lastName' => $p['last_name'], 'email' => $p['email'],
            'status' => $p['account_status'], 'hasSetPassword' => !empty($p['password_hash']), 'lastLoginAt' => $p['last_login_at'],
            'children' => $children,
        ];
    }, $parents));
});

$router->post('/api/admin/parents', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    $firstName = $body['firstName'] ?? null;
    $lastName = $body['lastName'] ?? null;
    $email = $body['email'] ?? null;
    if (!$firstName || !$lastName || !$email) jsonResponse(['error' => 'First name, last name and email are required.'], 400);
    $normalizedEmail = strtolower(trim($email));
    if (dbGet('SELECT id FROM users WHERE email = ?', [$normalizedEmail])) {
        jsonResponse(['error' => 'A user with this email already exists.'], 409);
    }
    $inviteToken = bin2hex(random_bytes(24));
    $expires = gmdate('Y-m-d\TH:i:s\Z', time() + 7 * 24 * 3600);
    $result = dbRun(
        "INSERT INTO users (auth_type, email, first_name, last_name, portal_role, invite_token, invite_expires_at) VALUES ('local', ?, ?, ?, 'parent', ?, ?)",
        [$normalizedEmail, $firstName, $lastName, $inviteToken, $expires]
    );

    $setupUrl = requestOrigin() . '/set-password.html?token=' . $inviteToken;
    try {
        $emailed = sendInviteEmail($normalizedEmail, $firstName, $setupUrl);
    } catch (Throwable $e) {
        $emailed = false;
    }
    logAudit(['userId' => $admin['id'], 'action' => 'admin_create_parent', 'entityType' => 'user', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(['id' => $result['lastInsertId'], 'setupUrl' => $setupUrl, 'emailed' => $emailed]);
});

$router->post('/api/admin/parents/:id/children', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $parent = dbGet("SELECT * FROM users WHERE id = ? AND portal_role = 'parent'", [$params['id']]);
    if (!$parent) jsonResponse(['error' => 'Parent account not found.'], 404);
    $body = requestBody();
    $osmMemberId = $body['osmMemberId'] ?? null;
    $childDisplayName = $body['childDisplayName'] ?? null;
    if (!$osmMemberId || !$childDisplayName) jsonResponse(['error' => 'osmMemberId and childDisplayName are required.'], 400);
    try {
        $result = dbRun(
            "INSERT INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name, linked_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$parent['id'], $osmMemberId, $body['osmSectionId'] ?? null, $body['osmSectionName'] ?? null, $body['osmSectionType'] ?? null, $childDisplayName, $admin['id']]
        );
        logAudit(['userId' => $admin['id'], 'action' => 'admin_link_child', 'entityType' => 'parent_child_link', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
        jsonResponse(['ok' => true, 'linkId' => $result['lastInsertId']]);
    } catch (Throwable $e) {
        jsonResponse(['error' => 'This child is already linked to this parent account.'], 409);
    }
});

$router->delete('/api/admin/parents/:parentId/children/:linkId', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $link = dbGet('SELECT * FROM parent_child_links WHERE id = ? AND parent_user_id = ?', [$params['linkId'], $params['parentId']]);
    if (!$link) jsonResponse(['error' => 'Link not found.'], 404);
    dbRun('DELETE FROM parent_child_links WHERE id = ?', [$link['id']]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_unlink_child', 'entityType' => 'parent_child_link', 'entityId' => (string) $link['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Audit log (FR-059) ─────────────────────────────────────────────────────
$router->get('/api/admin/audit-log', function ($params) {
    requireAdmin(requireAuth());
    $limit = min((int) (queryParam('limit') ?: 100), 500);
    $rows = dbAll(
        "SELECT a.*, u.first_name, u.last_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT $limit"
    );
    jsonResponse(array_map(fn($r) => [
        'id' => (int) $r['id'], 'action' => $r['action'], 'entityType' => $r['entity_type'], 'entityId' => $r['entity_id'],
        'userName' => $r['user_id'] ? $r['first_name'] . ' ' . $r['last_name'] : 'Unknown/anonymous',
        'ipAddress' => $r['ip_address'], 'details' => $r['details'] ? json_decode($r['details'], true) : null, 'createdAt' => $r['created_at'],
    ], $rows));
});
