<?php
// Ported from the Node version's src/routes/sections.js.

function sectionsUserSectionIds(array $user): array
{
    return array_values(array_filter(array_column(json_decode($user['osm_roles_json'] ?? '[]', true) ?: [], 'sectionid')));
}

// Trustee viewers get governance/reporting visibility, not member-level detail
// (FRD 6: "No default access to medical or detailed child records").
function sectionsCanViewMembers(array $user, string $sectionId): bool
{
    if ($user['portal_role'] === 'trustee_viewer') return false;
    if ($user['portal_role'] === 'admin') return true;
    return in_array($sectionId, sectionsUserSectionIds($user), true);
}

$router->get('/api/sections/:sectionId/members', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    if (!sectionsCanViewMembers($user, $params['sectionId'])) {
        jsonResponse(['error' => 'You do not have permission to view this section.'], 403);
    }
    // OSM blocks live /ext/ member reads from a server, so the portal keeps OSM to
    // sign-in only: show the children linked in the portal for this section and
    // hand off to OSM for the live roster (FRD "OSM remains system of record").
    $links = dbAll('SELECT child_display_name, osm_member_id, osm_section_name FROM parent_child_links WHERE osm_section_id = ? ORDER BY child_display_name', [$params['sectionId']]);
    logAudit(['userId' => $user['id'], 'action' => 'view_section_children', 'entityType' => 'section', 'entityId' => $params['sectionId'], 'ipAddress' => clientIp()]);
    jsonResponse([
        'source' => 'portal',
        'sectionName' => $links[0]['osm_section_name'] ?? null,
        'osmUrl' => 'https://www.onlinescoutmanager.co.uk/',
        'members' => array_map(fn($l) => ['id' => $l['osm_member_id'], 'name' => $l['child_display_name']], $links),
    ]);
});

// Live section roster (member names) fetched fresh from OSM on demand. Deliberately
// fetch-only: nothing is stored - named child data stays in OSM (the source of
// truth). Only a leader of THIS section (or an admin) may call it; trustees and
// parents cannot (sectionsCanViewMembers). Every access is audited (who viewed
// which section, and how many members - never the names). Same throttled, blocked-
// aware OSM handling as the count sync.
$router->get('/api/sections/:sectionId/roster', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    $sid = (string) $params['sectionId'];
    if (!sectionsCanViewMembers($user, $sid)) {
        jsonResponse(['error' => 'You do not have permission to view this section.'], 403);
    }
    $roster = osmSectionRoster($user, $sid);
    if (empty($roster['ok'])) {
        $blocked = !empty($roster['blocked']);
        $msg = $blocked
            ? 'OSM temporarily blocked the request. Wait a minute and try again - it rate-limits repeated reads.'
            : ($roster['error'] ?? 'Could not fetch members from OSM.');
        jsonResponse(['error' => $msg, 'blocked' => $blocked], $blocked ? 502 : 400);
    }
    // Audit the ACCESS, not the content - names are never logged or stored.
    logAudit(['userId' => $user['id'], 'action' => 'view_section_roster', 'entityType' => 'section', 'entityId' => $sid, 'ipAddress' => clientIp(), 'details' => ['source' => $roster['source'], 'count' => count($roster['members'])]]);
    $out = ['source' => $roster['source'], 'sectionId' => $sid, 'members' => $roster['members'], 'count' => count($roster['members']), 'fetchedAt' => gmdate('c')];
    // Admin-only: first row's column names, so the name-field mapping can be
    // confirmed against a real OSM response (no member values, just field names).
    if ($user['portal_role'] === 'admin') $out['columns'] = $roster['columns'] ?? [];
    jsonResponse($out);
});
