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
