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
    $result = osmDataReadTokenFor($user);
    if ($result['unavailable']) jsonResponse(['osmUnavailable' => true, 'reason' => $result['reason'], 'members' => []]);

    $membersData = osmDataSectionMembers($result['token'], $params['sectionId']);
    $stripSensitive = $user['portal_role'] === 'group_leadership';
    logAudit(['userId' => $user['id'], 'action' => 'view_member_list', 'entityType' => 'section', 'entityId' => $params['sectionId'], 'ipAddress' => clientIp()]);
    jsonResponse([
        'available' => $membersData['available'],
        'members' => $membersData['available'] ? array_map(fn($m) => [
            'id' => $m['id'], 'firstName' => $m['firstName'], 'lastName' => $m['lastName'], 'patrol' => $m['patrol'],
            'dob' => $stripSensitive ? null : $m['dob'],
        ], $membersData['members']) : [],
    ]);
});

$router->get('/api/sections/:sectionId/members/:memberId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    if (!sectionsCanViewMembers($user, $params['sectionId'])) {
        jsonResponse(['error' => 'You do not have permission to view this member.'], 403);
    }
    $result = osmDataReadTokenFor($user);
    if ($result['unavailable']) jsonResponse(['osmUnavailable' => true, 'reason' => $result['reason']]);
    $token = $result['token'];

    $roles = json_decode($user['osm_roles_json'] ?? '[]', true) ?: [];
    $role = null;
    foreach ($roles as $r) { if (($r['sectionid'] ?? null) === $params['sectionId']) { $role = $r; break; } }

    $membersData = osmDataSectionMembers($token, $params['sectionId']);
    $badges = osmDataMemberBadges($token, $role['section'] ?? null, $params['sectionId'], $params['memberId']);
    $member = null;
    if ($membersData['available']) {
        foreach ($membersData['members'] as $m) { if ($m['id'] === $params['memberId']) { $member = $m; break; } }
    }
    if (!$member) jsonResponse(['error' => 'Member not found.'], 404);

    logAudit(['userId' => $user['id'], 'action' => 'view_member_summary', 'entityType' => 'member', 'entityId' => $params['memberId'], 'ipAddress' => clientIp()]);
    $stripSensitive = $user['portal_role'] === 'group_leadership';
    jsonResponse([
        'firstName' => $member['firstName'], 'lastName' => $member['lastName'], 'patrol' => $member['patrol'],
        'dob' => $stripSensitive ? null : $member['dob'],
        'badges' => $badges['available'] ? $badges['badges'] : [],
        'badgesAvailable' => $badges['available'],
    ]);
});
