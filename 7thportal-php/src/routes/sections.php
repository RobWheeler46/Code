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
    $me = dbGet('SELECT * FROM users WHERE id = ?', [$user['id']]);

    try { $token = ensureFreshToken($me); }
    catch (Throwable $e) { jsonResponse(['error' => 'Live member names need an OSM sign-in. Sign in with OSM, then try again.'], 400); }

    // Demo mode: serve the deterministic demo roster so the flow is usable offline.
    if ($token === 'demo') {
        $members = osmDemoRosterForSection($sid);
        logAudit(['userId' => $user['id'], 'action' => 'view_section_roster', 'entityType' => 'section', 'entityId' => $sid, 'ipAddress' => clientIp(), 'details' => ['source' => 'demo', 'count' => count($members)]]);
        jsonResponse(['source' => 'demo', 'sectionId' => $sid, 'members' => $members, 'count' => count($members), 'fetchedAt' => gmdate('c')]);
    }

    // Live fetch using the leader's own token + the section's current term.
    $terms = json_decode($me['osm_terms_json'] ?? '[]', true) ?: [];
    $term = osmCurrentTermFromData($terms, $sid);
    $tid = $term && ($term['termId'] ?? '') !== '' ? $term['termId'] : null;
    $res = osmGridMembers($token, $sid, $tid);
    if (empty($res['ok'])) {
        $msg = !empty($res['blocked'])
            ? 'OSM temporarily blocked the request. Wait a minute and try again - it rate-limits repeated reads.'
            : ($res['error'] ?? 'Could not fetch members from OSM.');
        jsonResponse(['error' => $msg, 'blocked' => !empty($res['blocked'])], 502);
    }
    // Audit the ACCESS, not the content - names are never logged or stored.
    logAudit(['userId' => $user['id'], 'action' => 'view_section_roster', 'entityType' => 'section', 'entityId' => $sid, 'ipAddress' => clientIp(), 'details' => ['source' => 'osm', 'count' => $res['count']]]);
    $out = ['source' => 'osm', 'sectionId' => $sid, 'members' => $res['members'], 'count' => $res['count'], 'fetchedAt' => gmdate('c')];
    // Admin-only: first row's column names, so the name-field mapping can be
    // confirmed against a real OSM response (no member values, just field names).
    if ($user['portal_role'] === 'admin') $out['columns'] = $res['columns'];
    jsonResponse($out);
});
