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

    $membersData = osmDataSectionMembers($token, $link['osm_section_id']);
    $programme = osmDataSectionProgramme($token, $link['osm_section_id']);
    $events = osmDataSectionEvents($token, $link['osm_section_id']);
    $badges = osmDataMemberBadges($token, $link['osm_section_type'], $link['osm_section_id'], $link['osm_member_id']);

    $member = null;
    if ($membersData['available']) {
        foreach ($membersData['members'] as $m) { if ($m['id'] === $link['osm_member_id']) { $member = $m; break; } }
    }

    logAudit(['userId' => $user['id'], 'action' => 'view_child_profile', 'entityType' => 'child', 'entityId' => $link['osm_member_id'], 'ipAddress' => clientIp()]);

    jsonResponse([
        'name' => $link['child_display_name'] ?: ($member ? $member['firstName'] . ' ' . $member['lastName'] : 'Unknown'),
        'sectionName' => $link['osm_section_name'],
        'dob' => $member['dob'] ?? null,
        'patrol' => $member['patrol'] ?? null,
        'profileAvailable' => (bool) $member,
        'programme' => $programme['available'] ? $programme['items'] : [],
        'programmeAvailable' => $programme['available'],
        'events' => $events['available'] ? $events['items'] : [],
        'eventsAvailable' => $events['available'],
        'badges' => $badges['available'] ? $badges['badges'] : [],
        'badgesAvailable' => $badges['available'],
        'osmLink' => CHILDREN_OSM_LINK,
    ]);
});
