<?php
// Ported from the Node version's src/routes/dashboard.js.

function ageFromDob(?string $dob): ?int
{
    if (!$dob) return null;
    $ts = strtotime($dob);
    if ($ts === false) return null;
    return (int) floor((time() - $ts) / (365.25 * 24 * 3600));
}

$router->get('/api/parent/dashboard', function ($params) {
    $user = requireAuth();
    requireParent($user);

    $links = dbAll('SELECT * FROM parent_child_links WHERE parent_user_id = ? ORDER BY child_display_name', [$user['id']]);
    if (count($links) === 0) {
        jsonResponse(['noLinkedChildren' => true, 'children' => [], 'notices' => []]);
    }

    $result = osmDataReadTokenFor($user);
    if ($result['unavailable']) {
        logAudit(['userId' => $user['id'], 'action' => 'osm_unavailable', 'entityType' => 'dashboard']);
        jsonResponse([
            'osmUnavailable' => true, 'reason' => $result['reason'],
            'children' => array_map(fn($l) => ['linkId' => (int) $l['id'], 'name' => $l['child_display_name'], 'sectionName' => $l['osm_section_name']], $links),
            'notices' => [],
        ]);
    }
    $token = $result['token'];

    $bySection = [];
    foreach ($links as $link) {
        if (!isset($bySection[$link['osm_section_id']])) {
            $bySection[$link['osm_section_id']] = osmDataSectionMembers($token, $link['osm_section_id']);
        }
    }

    $children = array_map(function ($link) use ($bySection) {
        $sectionData = $bySection[$link['osm_section_id']];
        $member = null;
        if ($sectionData['available']) {
            foreach ($sectionData['members'] as $m) { if ($m['id'] === $link['osm_member_id']) { $member = $m; break; } }
        }
        $name = $link['child_display_name'] ?: ($member ? $member['firstName'] . ' ' . $member['lastName'] : 'Unknown');
        $status = $member
            ? $link['osm_section_name'] . ($member['dob'] ? ' • Age ' . ageFromDob($member['dob']) : '')
            : 'Details unavailable from OSM right now';
        return ['linkId' => (int) $link['id'], 'name' => $name, 'sectionId' => $link['osm_section_id'], 'sectionName' => $link['osm_section_name'], 'status' => $status];
    }, $links);

    $sectionIds = array_values(array_unique(array_column($links, 'osm_section_id')));
    jsonResponse(['children' => $children, 'notices' => array_map('serializeNotice', listNoticesForUser($user, $sectionIds))]);
});

$router->get('/api/leader/dashboard', function ($params) {
    $user = requireAuth();
    requireLeader($user);

    $roles = array_values(array_filter(json_decode($user['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
    $visible = getVisibleSectionIds();
    if ($visible !== null) {
        $roles = array_values(array_filter($roles, fn($r) => in_array($r['sectionid'], $visible, true)));
    }

    if (count($roles) === 0) {
        jsonResponse(['sections' => [], 'notices' => array_map('serializeNotice', listNoticesForUser($user, []))]);
    }

    $result = osmDataReadTokenFor($user);
    if ($result['unavailable']) {
        logAudit(['userId' => $user['id'], 'action' => 'osm_unavailable', 'entityType' => 'leader_dashboard']);
        jsonResponse([
            'osmUnavailable' => true, 'reason' => $result['reason'],
            'sections' => array_map(fn($r) => ['sectionId' => $r['sectionid'], 'sectionName' => $r['sectionname']], $roles),
            'notices' => [],
        ]);
    }
    $token = $result['token'];

    $sections = array_map(function ($role) use ($token) {
        $sectionId = $role['sectionid'];
        $members = osmDataSectionMembers($token, $sectionId);
        $programme = osmDataSectionProgramme($token, $sectionId);
        $events = osmDataSectionEvents($token, $sectionId);
        $meta = osmDataSectionMeta($sectionId);
        return [
            'sectionId' => $sectionId,
            'sectionName' => $role['sectionname'],
            'sectionType' => $role['section'],
            'meetingDay' => $meta['meetingDay'] ?? null,
            'meetingTime' => $meta['meetingTime'] ?? null,
            'location' => $meta['location'] ?? null,
            'memberCount' => $members['available'] ? count($members['members']) : null,
            'membersAvailable' => $members['available'],
            'nextProgrammeItem' => ($programme['available'] && !empty($programme['items'])) ? $programme['items'][0] : null,
            'nextEvent' => ($events['available'] && !empty($events['items'])) ? $events['items'][0] : null,
        ];
    }, $roles);

    $sectionIds = array_column($sections, 'sectionId');
    jsonResponse(['sections' => $sections, 'notices' => array_map('serializeNotice', listNoticesForUser($user, $sectionIds))]);
});
