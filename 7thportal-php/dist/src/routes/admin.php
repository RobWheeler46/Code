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
    $admin = requireAuth();
    requireAdmin($admin);
    $service = getServiceAccount() ?? $admin;
    $result = osmDataReadTokenFor(array_merge($service, ['portal_role' => 'section_leader']));
    if ($result['unavailable']) jsonResponse(['available' => false, 'reason' => $result['reason'], 'members' => []]);
    $members = osmDataSectionMembers($result['token'], $params['sectionId']);
    // Named child/member drill-down is audited (FRD 6.1 / FR-OSM-CAP-011).
    logAudit(['userId' => $admin['id'], 'action' => 'admin_section_member_drilldown', 'entityType' => 'osm_section', 'entityId' => $params['sectionId'], 'ipAddress' => clientIp(), 'details' => ['count' => count($members['members'] ?? [])]]);
    jsonResponse($members);
});

// ── Section capacity tracker & movement trends (FRD 29) ────────────────────
// Aggregate counts only. Active is a REAL OSM member count per section (from
// cPanel, where OSM data reads are permitted), cached in osm_sections; named
// records are never stored. Capacity/thresholds/status/trend are local.

function capacityUtilStatus(?int $active, ?int $cap, int $amber, int $red): array
{
    if ($active === null || !$cap || $cap <= 0) return [null, 'unset'];
    $util = (int) round(($active / $cap) * 100);
    if ($active > $cap) return [$util, 'over'];
    if ($util >= $red) return [$util, 'full'];
    if ($util >= $amber) return [$util, 'watch'];
    return [$util, 'good'];
}

// Resolve the OSM sections the tracker covers plus a read token (or demo).
function capacityResolveSections(): array
{
    $service = getServiceAccount() ?? requireAuth();
    $result = osmDataReadTokenFor(array_merge($service, ['portal_role' => 'section_leader']));
    if ($result['unavailable']) return ['available' => false, 'reason' => $result['reason'], 'sections' => [], 'token' => null];
    if ($result['token'] === 'demo') {
        $sections = array_map(fn($s) => ['sectionId' => (string) $s['sectionid'], 'sectionName' => $s['sectionname'], 'sectionType' => $s['section']], array_values(OSM_DEMO_SECTIONS));
    } else {
        $roles = array_values(array_filter(json_decode($service['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
        $sections = array_map(fn($r) => ['sectionId' => (string) $r['sectionid'], 'sectionName' => $r['sectionname'], 'sectionType' => $r['section']], $roles);
    }
    return ['available' => true, 'sections' => $sections, 'token' => $result['token']];
}

// Build the aggregate per-section summary from cached osm_sections + local config.
function capacityBuildSummary(): array
{
    $today = gmdate('Y-m-d');
    $cfgAll = [];
    foreach (dbAll('SELECT * FROM section_capacity') as $c) $cfgAll[$c['osm_section_id']] = $c;
    $rows = dbAll('SELECT * FROM osm_sections ORDER BY section_name');

    $sections = [];
    $totalActive = 0; $availableSpaces = 0; $joiningTotal = 0; $nearCapacity = 0;
    foreach ($rows as $r) {
        $cfg = $cfgAll[$r['osm_section_id']] ?? [];
        $active = $r['active_count'] === null ? null : (int) $r['active_count'];
        $cap = isset($cfg['capacity']) && $cfg['capacity'] !== null ? (int) $cfg['capacity'] : null;
        $amber = (int) ($cfg['amber_pct'] ?? 85);
        $red = (int) ($cfg['red_pct'] ?? 95);
        $joining = isset($cfg['joining_count']) && $cfg['joining_count'] !== null ? (int) $cfg['joining_count'] : null;
        [$util, $status] = capacityUtilStatus($active, $cap, $amber, $red);
        $prev = dbGet('SELECT active_count FROM section_snapshots WHERE osm_section_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1', [$r['osm_section_id'], $today]);
        $trend = 'new';
        if ($prev && $prev['active_count'] !== null && $active !== null) {
            $p = (int) $prev['active_count'];
            $trend = $active > $p ? 'rising' : ($active < $p ? 'falling' : 'stable');
        }
        $sections[] = [
            'sectionId' => $r['osm_section_id'], 'sectionName' => $r['section_name'], 'sectionType' => $r['section_type'],
            'active' => $active, 'joining' => $joining, 'capacity' => $cap, 'utilisation' => $util, 'status' => $status,
            'trend' => $trend, 'amber' => $amber, 'red' => $red, 'owner' => $cfg['owner'] ?? null,
            'lastSync' => $r['last_synced_at'], 'syncStatus' => $r['sync_status'], 'syncError' => $r['sync_error'],
        ];
        if ($active !== null) $totalActive += $active;
        if ($cap) $availableSpaces += max($cap - ($active ?? 0), 0);
        if ($joining) $joiningTotal += $joining;
        if (in_array($status, ['watch', 'full', 'over'], true)) $nearCapacity++;
    }
    return ['sections' => $sections, 'totals' => [
        'totalActive' => $totalActive, 'availableSpaces' => $availableSpaces,
        'joiningTotal' => $joiningTotal, 'nearCapacity' => $nearCapacity,
    ]];
}

// Pull live section-member counts from OSM and cache them (aggregate only).
$router->post('/api/admin/sections/sync', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $resolved = capacityResolveSections();
    if (!$resolved['available']) jsonResponse(['error' => $resolved['reason'] ?: 'OSM is not available.'], 502);
    $token = $resolved['token'];
    $today = gmdate('Y-m-d');
    $synced = 0; $results = [];
    foreach ($resolved['sections'] as $s) {
        $mem = osmDataSectionMembers($token, $s['sectionId']);
        if (!empty($mem['available'])) {
            $count = count($mem['members']);
            dbRun(
                "INSERT INTO osm_sections (osm_section_id, section_name, section_type, active_count, last_synced_at, synced_by, sync_status, sync_error)
                 VALUES (?, ?, ?, ?, datetime('now'), ?, 'ok', NULL)
                 ON CONFLICT(osm_section_id) DO UPDATE SET section_name = excluded.section_name, section_type = excluded.section_type,
                   active_count = excluded.active_count, last_synced_at = excluded.last_synced_at, synced_by = excluded.synced_by,
                   sync_status = 'ok', sync_error = NULL",
                [$s['sectionId'], $s['sectionName'], $s['sectionType'], $count, $admin['id']]
            );
            dbRun('INSERT OR IGNORE INTO section_snapshots (osm_section_id, active_count, snapshot_date) VALUES (?, ?, ?)', [$s['sectionId'], $count, $today]);
            $synced++; $results[] = ['section' => $s['sectionName'], 'count' => $count];
        } else {
            dbRun(
                "INSERT INTO osm_sections (osm_section_id, section_name, section_type, active_count, last_synced_at, synced_by, sync_status, sync_error)
                 VALUES (?, ?, ?, NULL, datetime('now'), ?, 'error', ?)
                 ON CONFLICT(osm_section_id) DO UPDATE SET section_name = excluded.section_name, section_type = excluded.section_type,
                   last_synced_at = excluded.last_synced_at, synced_by = excluded.synced_by, sync_status = 'error', sync_error = excluded.sync_error",
                [$s['sectionId'], $s['sectionName'], $s['sectionType'], $admin['id'], substr($mem['reason'] ?? $mem['error'] ?? 'Member list unavailable', 0, 200)]
            );
            $results[] = ['section' => $s['sectionName'], 'error' => $mem['reason'] ?? 'unavailable'];
        }
    }
    logAudit(['userId' => $admin['id'], 'action' => 'admin_osm_section_sync', 'ipAddress' => clientIp(), 'details' => ['synced' => $synced, 'total' => count($resolved['sections'])]]);
    jsonResponse(['ok' => true, 'synced' => $synced, 'total' => count($resolved['sections']), 'sections' => $results]);
});

// One-shot diagnostic: try the likely member-list call shapes and report which
// OSM accepts (the current GET returns 405). Visit while signed in as admin.
$router->get('/api/admin/osm/member-probe', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $resolved = capacityResolveSections();
    if (!$resolved['available'] || !$resolved['sections']) jsonResponse(['error' => $resolved['reason'] ?? 'No OSM sections/token available.'], 502);
    $section = $resolved['sections'][0];
    $probe = osmProbeMembers($resolved['token'], (string) $section['sectionId']);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_osm_member_probe', 'ipAddress' => clientIp()]);
    jsonResponse(['section' => $section, 'probe' => $probe]);
});

$router->get('/api/admin/sections/capacity', function ($params) {
    requireAdmin(requireAuth());
    $summary = capacityBuildSummary();
    $last = dbGet("SELECT max(last_synced_at) AS last FROM osm_sections WHERE sync_status = 'ok'")['last'] ?? null;
    $anySync = (int) dbGet('SELECT COUNT(*) AS n FROM osm_sections')['n'] > 0;
    jsonResponse(array_merge($summary, ['osm' => ['configured' => osmIsConfigured(), 'synced' => $anySync, 'lastSyncedAt' => $last]]));
});

$router->get('/api/admin/sections/capacity/settings', function ($params) {
    requireAdmin(requireAuth());
    $configured = dbAll('SELECT * FROM section_capacity ORDER BY section_name');
    $known = dbAll('SELECT osm_section_id, section_name, section_type FROM osm_sections ORDER BY section_name');
    jsonResponse(['configured' => $configured, 'sections' => $known]);
});

$router->put('/api/admin/sections/capacity/settings', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    $sectionId = $body['sectionId'] ?? null;
    if (!$sectionId) jsonResponse(['error' => 'A section is required.'], 400);
    $amber = max(0, min(100, (int) ($body['amberPct'] ?? 85)));
    $red = max(0, min(100, (int) ($body['redPct'] ?? 95)));
    $capacity = ($body['capacity'] ?? '') === '' || $body['capacity'] === null ? null : max(0, (int) $body['capacity']);
    $joining = ($body['joiningCount'] ?? '') === '' || $body['joiningCount'] === null ? null : max(0, (int) $body['joiningCount']);
    dbRun(
        "INSERT INTO section_capacity (osm_section_id, section_name, capacity, amber_pct, red_pct, joining_count, owner, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(osm_section_id) DO UPDATE SET section_name = excluded.section_name, capacity = excluded.capacity,
           amber_pct = excluded.amber_pct, red_pct = excluded.red_pct, joining_count = excluded.joining_count,
           owner = excluded.owner, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        [$sectionId, $body['sectionName'] ?? null, $capacity, $amber, $red, $joining, $body['owner'] ?? null, $admin['id']]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_section_capacity_set', 'entityType' => 'osm_section', 'entityId' => (string) $sectionId, 'ipAddress' => clientIp(), 'details' => ['capacity' => $capacity, 'amber' => $amber, 'red' => $red]]);
    jsonResponse(['ok' => true]);
});

$router->get('/api/admin/sections/capacity/export', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $summary = capacityBuildSummary();
    $rows = [['Section', 'Active', 'Joining', 'Capacity', 'Utilisation %', 'Status', 'Trend', 'Owner', 'Last synced']];
    foreach ($summary['sections'] as $s) {
        $rows[] = [$s['sectionName'], $s['active'] ?? '', $s['joining'] ?? '', $s['capacity'] ?? '', $s['utilisation'] ?? '', $s['status'], $s['trend'], $s['owner'] ?? '', $s['lastSync'] ?? ''];
    }
    $csv = implode("\r\n", array_map(fn($r) => implode(',', array_map(fn($v) => '"' . str_replace('"', '""', (string) $v) . '"', $r)), $rows));
    logAudit(['userId' => $admin['id'], 'action' => 'admin_section_capacity_export', 'ipAddress' => clientIp()]);
    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename="section-capacity-summary.csv"');
    echo $csv;
    exit;
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
        'documentLibraryEnabled' => ($map['document_library_enabled'] ?? null) === 'true',
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
    if (array_key_exists('documentLibraryEnabled', $body)) $upsert('document_library_enabled', $body['documentLibraryEnabled'] ? 'true' : 'false');

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
