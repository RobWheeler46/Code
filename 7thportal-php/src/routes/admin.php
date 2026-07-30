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

// Deliberate one-off diagnostic: now that the app no longer floods OSM's /ext/
// endpoints, does OSM serve a single member count? Uses the admin's own live OSM
// token and a REAL term id, tries a few call shapes, stops at the first that works.
$router->get('/api/admin/osm/member-probe', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $me = dbGet('SELECT * FROM users WHERE id = ?', [$admin['id']]);
    try { $token = ensureFreshToken($me); } catch (Throwable $e) { jsonResponse(['error' => 'No usable OSM token - sign in with OSM (not local/demo), then run this.'], 400); }
    if ($token === 'demo') jsonResponse(['error' => 'Demo mode - the probe needs a live OSM sign-in.'], 400);
    $roles = array_values(array_filter(json_decode($me['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
    if (!$roles) jsonResponse(['error' => 'No OSM youth sections found for your account.'], 400);
    $sectionId = (string) $roles[0]['sectionid'];
    $term = osmCurrentTermFromData($me['osm_terms_json'] ?? '[]', $sectionId);
    $tid = $term && ($term['termId'] ?? '') !== '' ? $term['termId'] : null;
    $variants = osmProbeMembersOnce($token, $sectionId, $tid);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_osm_member_probe', 'ipAddress' => clientIp()]);
    jsonResponse(['section' => ['id' => $sectionId, 'name' => $roles[0]['sectionname']], 'termId' => $tid, 'termName' => $term['name'] ?? null, 'variants' => $variants]);
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
// Aggregate counts only, and fully local: "Active" is an admin-entered value or
// the portal's own linked-children count per section. No live OSM member reads -
// OSM blocks /ext/ data calls from a server, so the portal uses OSM for sign-in
// only. Capacity/thresholds/status/trend are local planning values.

function capacityUtilStatus(?int $active, ?int $cap, int $amber, int $red): array
{
    if ($active === null || !$cap || $cap <= 0) return [null, 'unset'];
    $util = (int) round(($active / $cap) * 100);
    if ($active > $cap) return [$util, 'over'];
    if ($util >= $red) return [$util, 'full'];
    if ($util >= $amber) return [$util, 'watch'];
    return [$util, 'good'];
}

// The sections the tracker covers, entirely from data already held locally - the
// signed-in admin's OSM roles captured at login (no live OSM call), plus any
// section that already has local capacity config or a trend snapshot.
function capacitySectionList(): array
{
    $sections = [];
    $add = function ($id, $name, $type) use (&$sections) {
        $id = (string) $id;
        if ($id === '' || isset($sections[$id])) return;
        $sections[$id] = ['sectionId' => $id, 'sectionName' => $name ?: ('Section ' . $id), 'sectionType' => $type];
    };
    $me = requireAuth();
    foreach (json_decode($me['osm_roles_json'] ?? '[]', true) ?: [] as $r) {
        if (in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)) $add($r['sectionid'] ?? '', $r['sectionname'] ?? '', $r['section'] ?? null);
    }
    foreach (dbAll('SELECT osm_section_id, section_name FROM section_capacity') as $c) $add($c['osm_section_id'], $c['section_name'], null);
    foreach (dbAll('SELECT osm_section_id, section_name, section_type FROM osm_sections') as $o) $add($o['osm_section_id'], $o['section_name'], $o['section_type']);
    return array_values($sections);
}

// Build the aggregate per-section summary. "Active" priority: an admin-entered
// value, else the last OSM-synced count for the section, else the portal's own
// linked-children count. No live OSM call here - the OSM count comes from a
// deliberate admin sync (see /api/admin/sections/sync).
function capacityBuildSummary(): array
{
    $today = gmdate('Y-m-d');
    $cfgAll = [];
    foreach (dbAll('SELECT * FROM section_capacity') as $c) $cfgAll[$c['osm_section_id']] = $c;
    $osmAll = [];
    foreach (dbAll("SELECT osm_section_id, active_count, last_synced_at FROM osm_sections WHERE sync_status = 'ok' AND active_count IS NOT NULL") as $o) $osmAll[$o['osm_section_id']] = $o;

    $sections = [];
    $totalActive = 0; $availableSpaces = 0; $joiningTotal = 0; $nearCapacity = 0;
    foreach (capacitySectionList() as $s) {
        $sid = $s['sectionId'];
        $cfg = $cfgAll[$sid] ?? [];
        $manual = isset($cfg['active_count']) && $cfg['active_count'] !== null ? (int) $cfg['active_count'] : null;
        $osm = isset($osmAll[$sid]) ? (int) $osmAll[$sid]['active_count'] : null;
        $local = (int) dbGet('SELECT count(*) AS n FROM parent_child_links WHERE osm_section_id = ?', [$sid])['n'];
        $active = $manual !== null ? $manual : ($osm !== null ? $osm : ($local > 0 ? $local : null));
        $source = $manual !== null ? 'manual' : ($osm !== null ? 'osm' : ($active !== null ? 'portal' : 'none'));
        $lastSync = $osmAll[$sid]['last_synced_at'] ?? null;
        $cap = isset($cfg['capacity']) && $cfg['capacity'] !== null ? (int) $cfg['capacity'] : null;
        $amber = (int) ($cfg['amber_pct'] ?? 85);
        $red = (int) ($cfg['red_pct'] ?? 95);
        $joining = isset($cfg['joining_count']) && $cfg['joining_count'] !== null ? (int) $cfg['joining_count'] : null;
        [$util, $status] = capacityUtilStatus($active, $cap, $amber, $red);
        dbRun('INSERT OR IGNORE INTO section_snapshots (osm_section_id, active_count, snapshot_date) VALUES (?, ?, ?)', [$sid, $active, $today]);
        $prev = dbGet('SELECT active_count FROM section_snapshots WHERE osm_section_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1', [$sid, $today]);
        $trend = 'new';
        if ($prev && $prev['active_count'] !== null && $active !== null) {
            $p = (int) $prev['active_count'];
            $trend = $active > $p ? 'rising' : ($active < $p ? 'falling' : 'stable');
        }
        $sections[] = [
            'sectionId' => $sid, 'sectionName' => $s['sectionName'], 'sectionType' => $s['sectionType'],
            'active' => $active, 'source' => $source, 'lastSync' => $lastSync, 'joining' => $joining, 'capacity' => $cap,
            'utilisation' => $util, 'status' => $status, 'trend' => $trend, 'amber' => $amber, 'red' => $red,
            'owner' => $cfg['owner'] ?? null,
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

$router->get('/api/admin/sections/capacity', function ($params) {
    $me = requireAuth();
    requireAdmin($me);
    $last = dbGet("SELECT max(last_synced_at) AS last FROM osm_sections WHERE sync_status = 'ok'")['last'] ?? null;
    // Sync is offered only to an admin who signed in through OSM (has a live token).
    $canSync = !empty($me['osm_access_token']) && $me['osm_access_token'] !== 'demo';
    jsonResponse(array_merge(capacityBuildSummary(), ['osm' => ['canSync' => $canSync, 'lastSyncedAt' => $last]]));
});

// Deliberate, admin-triggered, one-shot OSM member-count sync (FR-OSM-CAP-001).
// Uses the admin's own live OSM token + real terms, one POST per section, stops
// immediately if OSM blocks, and is throttled - the dashboards never call OSM.
$router->post('/api/admin/sections/sync', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $me = dbGet('SELECT * FROM users WHERE id = ?', [$admin['id']]);
    $last = dbGet("SELECT max(last_synced_at) AS last FROM osm_sections")['last'] ?? null;
    if ($last && (time() - strtotime($last . ' UTC')) < 60) jsonResponse(['error' => 'Just synced - wait a minute before syncing OSM again.'], 429);
    try { $token = ensureFreshToken($me); } catch (Throwable $e) { jsonResponse(['error' => 'No usable OSM token - sign in with OSM, then sync.'], 400); }
    if ($token === 'demo') jsonResponse(['error' => 'Demo mode - a live OSM sync needs a real OSM sign-in.'], 400);
    $roles = array_values(array_filter(json_decode($me['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
    $terms = json_decode($me['osm_terms_json'] ?? '[]', true) ?: [];
    $today = gmdate('Y-m-d'); $synced = 0; $results = [];
    foreach ($roles as $r) {
        $sid = (string) $r['sectionid'];
        $term = osmCurrentTermFromData($terms, $sid);
        $tid = $term && ($term['termId'] ?? '') !== '' ? $term['termId'] : null;
        $res = osmGridMemberCount($token, $sid, $tid);
        if (!empty($res['ok'])) {
            dbRun("INSERT INTO osm_sections (osm_section_id, section_name, section_type, active_count, last_synced_at, synced_by, sync_status, sync_error)
                   VALUES (?, ?, ?, ?, datetime('now'), ?, 'ok', NULL)
                   ON CONFLICT(osm_section_id) DO UPDATE SET section_name = excluded.section_name, section_type = excluded.section_type,
                     active_count = excluded.active_count, last_synced_at = excluded.last_synced_at, synced_by = excluded.synced_by, sync_status = 'ok', sync_error = NULL",
                [$sid, $r['sectionname'] ?? '', $r['section'] ?? null, $res['count'], $admin['id']]);
            dbRun('INSERT OR IGNORE INTO section_snapshots (osm_section_id, active_count, snapshot_date) VALUES (?, ?, ?)', [$sid, $res['count'], $today]);
            $synced++; $results[] = ['section' => $r['sectionname'] ?? $sid, 'count' => $res['count']];
        } else {
            dbRun("INSERT INTO osm_sections (osm_section_id, section_name, section_type, active_count, last_synced_at, synced_by, sync_status, sync_error)
                   VALUES (?, ?, ?, NULL, datetime('now'), ?, 'error', ?)
                   ON CONFLICT(osm_section_id) DO UPDATE SET last_synced_at = excluded.last_synced_at, synced_by = excluded.synced_by, sync_status = 'error', sync_error = excluded.sync_error",
                [$sid, $r['sectionname'] ?? '', $r['section'] ?? null, $admin['id'], substr($res['error'] ?? 'failed', 0, 200)]);
            $results[] = ['section' => $r['sectionname'] ?? $sid, 'error' => $res['error'] ?? 'failed'];
            if (!empty($res['blocked'])) break; // stop the moment OSM blocks - never hammer
        }
    }
    logAudit(['userId' => $admin['id'], 'action' => 'admin_osm_section_sync', 'ipAddress' => clientIp(), 'details' => ['synced' => $synced, 'total' => count($roles)]]);
    jsonResponse(['ok' => true, 'synced' => $synced, 'total' => count($roles), 'sections' => $results]);
});

$router->get('/api/admin/sections/capacity/settings', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(['configured' => dbAll('SELECT * FROM section_capacity ORDER BY section_name'), 'sections' => capacitySectionList()]);
});

$router->put('/api/admin/sections/capacity/settings', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    $sectionId = $body['sectionId'] ?? null;
    if (!$sectionId) jsonResponse(['error' => 'A section is required.'], 400);
    $numOrNull = fn($v) => ($v ?? '') === '' || $v === null ? null : max(0, (int) $v);
    $amber = max(0, min(100, (int) ($body['amberPct'] ?? 85)));
    $red = max(0, min(100, (int) ($body['redPct'] ?? 95)));
    dbRun(
        "INSERT INTO section_capacity (osm_section_id, section_name, capacity, amber_pct, red_pct, joining_count, active_count, owner, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(osm_section_id) DO UPDATE SET section_name = excluded.section_name, capacity = excluded.capacity,
           amber_pct = excluded.amber_pct, red_pct = excluded.red_pct, joining_count = excluded.joining_count,
           active_count = excluded.active_count, owner = excluded.owner, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        [$sectionId, $body['sectionName'] ?? null, $numOrNull($body['capacity'] ?? null), $amber, $red,
         $numOrNull($body['joiningCount'] ?? null), $numOrNull($body['activeCount'] ?? null), $body['owner'] ?? null, $admin['id']]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_section_capacity_set', 'entityType' => 'osm_section', 'entityId' => (string) $sectionId, 'ipAddress' => clientIp(), 'details' => ['capacity' => $numOrNull($body['capacity'] ?? null), 'active' => $numOrNull($body['activeCount'] ?? null)]]);
    jsonResponse(['ok' => true]);
});

// Named drill-down for a section - the portal's own linked children (not OSM).
$router->get('/api/admin/sections/:sectionId/children', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $kids = dbAll(
        'SELECT c.child_display_name, u.first_name, u.last_name, u.email FROM parent_child_links c
         JOIN users u ON u.id = c.parent_user_id WHERE c.osm_section_id = ? ORDER BY c.child_display_name',
        [$params['sectionId']]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_section_children_drilldown', 'entityType' => 'osm_section', 'entityId' => $params['sectionId'], 'ipAddress' => clientIp(), 'details' => ['count' => count($kids)]]);
    jsonResponse(['children' => array_map(fn($k) => [
        'name' => $k['child_display_name'] ?: 'Child',
        'parentName' => trim(($k['first_name'] ?? '') . ' ' . ($k['last_name'] ?? '')),
        'parentEmail' => $k['email'],
    ], $kids)]);
});

$router->get('/api/admin/sections/capacity/export', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $summary = capacityBuildSummary();
    $rows = [['Section', 'Active', 'Active source', 'Joining', 'Capacity', 'Utilisation %', 'Status', 'Trend', 'Owner']];
    foreach ($summary['sections'] as $s) {
        $rows[] = [$s['sectionName'], $s['active'] ?? '', $s['source'], $s['joining'] ?? '', $s['capacity'] ?? '', $s['utilisation'] ?? '', $s['status'], $s['trend'], $s['owner'] ?? ''];
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
        'equipmentRegisterEnabled' => ($map['equipment_register_enabled'] ?? null) === 'true',
        'qmBookingEnabled' => ($map['qm_booking_enabled'] ?? null) === 'true',
        'incidentLoggingEnabled' => ($map['incident_logging_enabled'] ?? null) === 'true',
        'eventHubEnabled' => ($map['event_hub_enabled'] ?? null) === 'true',
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
    if (array_key_exists('equipmentRegisterEnabled', $body)) $upsert('equipment_register_enabled', $body['equipmentRegisterEnabled'] ? 'true' : 'false');
    if (array_key_exists('qmBookingEnabled', $body)) $upsert('qm_booking_enabled', $body['qmBookingEnabled'] ? 'true' : 'false');
    if (array_key_exists('incidentLoggingEnabled', $body)) $upsert('incident_logging_enabled', $body['incidentLoggingEnabled'] ? 'true' : 'false');
    if (array_key_exists('eventHubEnabled', $body)) $upsert('event_hub_enabled', $body['eventHubEnabled'] ? 'true' : 'false');

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
