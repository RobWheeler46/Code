<?php
// Ported from the Node version's src/routes/children.js.

const CHILDREN_OSM_LINK = 'https://www.onlinescoutmanager.co.uk/';

$router->get('/api/children/:linkId', function ($params) {
    $user = requireAuth();
    requireParent($user);

    $link = dbGet('SELECT * FROM parent_child_links WHERE id = ? AND parent_user_id = ?', [$params['linkId'], $user['id']]);
    if (!$link) jsonResponse(['error' => 'Child not found.'], 404);

    $result = osmDataReadTokenFor($user);
    if ($result['unavailable']) {
        jsonResponse(['osmUnavailable' => true, 'reason' => $result['reason'], 'name' => $link['child_display_name'], 'sectionName' => $link['osm_section_name'], 'osmLink' => CHILDREN_OSM_LINK]);
    }
    $token = $result['token'];
    logAudit(['userId' => $user['id'], 'action' => 'view_child_profile', 'entityType' => 'child', 'entityId' => $link['osm_member_id'], 'ipAddress' => clientIp()]);

    // Always available from the stored link, so the page never shows a scary
    // "could not be matched" warning.
    $out = [
        'name' => $link['child_display_name'] ?: 'Your child',
        'sectionName' => $link['osm_section_name'],
        'osmLink' => CHILDREN_OSM_LINK,
        'profileAvailable' => true,
        'dob' => null, 'patrol' => null,
        'programme' => [], 'programmeAvailable' => false,
        'events' => [], 'eventsAvailable' => false,
        'badges' => [], 'badgesAvailable' => false,
        // Live: OSM blocks server-side /ext/ programme/badge reads and a per-view
        // burst is what gets the IP blocked, so detail stays in OSM (link out).
        'detailInOsm' => $token !== 'demo',
    ];

    // Demo mode shows a rich preview from the fixtures (no real OSM call).
    if ($token === 'demo') {
        $sid = $link['osm_section_id'];
        foreach (OSM_DEMO_MEMBERS[$sid] ?? [] as $m) {
            if ($m['id'] === $link['osm_member_id']) { $out['dob'] = $m['dob'] ?? null; $out['patrol'] = $m['patrol'] ?? null; break; }
        }
        $out['programme'] = OSM_DEMO_PROGRAMME[$sid] ?? []; $out['programmeAvailable'] = true;
        $out['events'] = OSM_DEMO_EVENTS[$sid] ?? []; $out['eventsAvailable'] = true;
        $out['badges'] = OSM_DEMO_BADGES[$link['osm_member_id']] ?? []; $out['badgesAvailable'] = true;
    }

    jsonResponse($out);
});
