<?php
// Shared admin-defined access groups (FRD PP2.5 s17.3 / FR-PP-018/022). A reusable
// access primitive under Admin > Access > Groups. Management is a privileged, audited
// administrator action; membership is identity-based and never changes portal roles.

function requireGroupAdmin(): array
{
    $user = requireAuth();
    requireAdmin($user);
    return $user;
}

$router->get('/api/access/groups', function ($params) {
    requireGroupAdmin();
    jsonResponse([
        'groups' => array_map(fn($g) => serializeAccessGroup($g), dbAll('SELECT * FROM access_groups ORDER BY retired, name')),
        'people' => array_map(fn($u) => ['id' => (int) $u['id'], 'name' => trim($u['first_name'] . ' ' . $u['last_name']), 'role' => $u['portal_role']],
            dbAll("SELECT id, first_name, last_name, portal_role FROM users WHERE account_status = 'active' ORDER BY first_name, last_name")),
    ]);
});

$router->post('/api/access/groups', function ($params) {
    $user = requireGroupAdmin();
    $b = requestBody();
    $name = trim((string) ($b['name'] ?? ''));
    if ($name === '') jsonResponse(['error' => 'A group name is required.'], 422);
    if (dbGet('SELECT 1 FROM access_groups WHERE name = ?', [$name])) jsonResponse(['error' => 'A group with that name already exists.'], 409);
    $id = (int) dbRun('INSERT INTO access_groups (name, description, expires_at, created_by) VALUES (?, ?, ?, ?)',
        [$name, trim((string) ($b['description'] ?? '')) ?: null, ppNormExpiry($b['expiresAt'] ?? null), $user['id']])['lastInsertId'];
    logAudit(['userId' => $user['id'], 'action' => 'access_group_create', 'entityType' => 'access_group', 'entityId' => (string) $id, 'ipAddress' => clientIp(), 'details' => ['name' => $name]]);
    jsonResponse(serializeAccessGroup(dbGet('SELECT * FROM access_groups WHERE id = ?', [$id]), true), 201);
});

$router->get('/api/access/groups/:id', function ($params) {
    requireGroupAdmin();
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$params['id']]);
    if (!$g) jsonResponse(['error' => 'Group not found.'], 404);
    jsonResponse(serializeAccessGroup($g, true));
});

$router->put('/api/access/groups/:id', function ($params) {
    $user = requireGroupAdmin();
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$params['id']]);
    if (!$g) jsonResponse(['error' => 'Group not found.'], 404);
    $b = requestBody();
    $before = ['name' => $g['name'], 'expiresAt' => $g['expires_at']];
    if (array_key_exists('name', $b)) {
        $name = trim((string) $b['name']);
        if ($name === '') jsonResponse(['error' => 'A group name is required.'], 422);
        if (dbGet('SELECT 1 FROM access_groups WHERE name = ? AND id != ?', [$name, $g['id']])) jsonResponse(['error' => 'Another group already has that name.'], 409);
        dbRun('UPDATE access_groups SET name = ? WHERE id = ?', [$name, $g['id']]);
    }
    if (array_key_exists('description', $b)) dbRun('UPDATE access_groups SET description = ? WHERE id = ?', [trim((string) $b['description']) ?: null, $g['id']]);
    if (array_key_exists('expiresAt', $b)) dbRun('UPDATE access_groups SET expires_at = ? WHERE id = ?', [ppNormExpiry($b['expiresAt']), $g['id']]);
    dbRun("UPDATE access_groups SET updated_at = datetime('now') WHERE id = ?", [$g['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'access_group_update', 'entityType' => 'access_group', 'entityId' => (string) $g['id'], 'ipAddress' => clientIp(), 'details' => ['before' => $before, 'after' => array_intersect_key($b, array_flip(['name', 'description', 'expiresAt']))]]);
    jsonResponse(serializeAccessGroup(dbGet('SELECT * FROM access_groups WHERE id = ?', [$g['id']]), true));
});

$router->post('/api/access/groups/:id/members', function ($params) {
    $user = requireGroupAdmin();
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$params['id']]);
    if (!$g) jsonResponse(['error' => 'Group not found.'], 404);
    $uid = (int) (requestBody()['userId'] ?? 0);
    if (!dbGet('SELECT 1 FROM users WHERE id = ?', [$uid])) jsonResponse(['error' => 'Choose a valid person.'], 422);
    dbRun('INSERT OR IGNORE INTO access_group_members (group_id, user_id) VALUES (?, ?)', [$g['id'], $uid]);
    logAudit(['userId' => $user['id'], 'action' => 'access_group_member_add', 'entityType' => 'access_group', 'entityId' => (string) $g['id'], 'ipAddress' => clientIp(), 'details' => ['userId' => $uid]]);
    jsonResponse(serializeAccessGroup(dbGet('SELECT * FROM access_groups WHERE id = ?', [$g['id']]), true));
});

$router->delete('/api/access/groups/:id/members/:uid', function ($params) {
    $user = requireGroupAdmin();
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$params['id']]);
    if (!$g) jsonResponse(['error' => 'Group not found.'], 404);
    dbRun('DELETE FROM access_group_members WHERE group_id = ? AND user_id = ?', [$g['id'], (int) $params['uid']]);
    logAudit(['userId' => $user['id'], 'action' => 'access_group_member_remove', 'entityType' => 'access_group', 'entityId' => (string) $g['id'], 'ipAddress' => clientIp(), 'details' => ['userId' => (int) $params['uid']]]);
    jsonResponse(serializeAccessGroup(dbGet('SELECT * FROM access_groups WHERE id = ?', [$g['id']]), true));
});

// Retire (never hard-delete a group in use): preserves historical assignment/audit refs.
$router->post('/api/access/groups/:id/retire', function ($params) {
    $user = requireGroupAdmin();
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$params['id']]);
    if (!$g) jsonResponse(['error' => 'Group not found.'], 404);
    dbRun("UPDATE access_groups SET retired = 1, updated_at = datetime('now') WHERE id = ?", [$g['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'access_group_retire', 'entityType' => 'access_group', 'entityId' => (string) $g['id'], 'ipAddress' => clientIp(), 'details' => ['usageCount' => accessGroupUsageCount((int) $g['id'])]]);
    jsonResponse(serializeAccessGroup(dbGet('SELECT * FROM access_groups WHERE id = ?', [$g['id']]), true));
});
