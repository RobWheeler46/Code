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

    // Cached OSM section member counts (from the admin's deliberate sync) - read
    // from the DB only, so the dashboard itself never calls OSM.
    $osmCounts = [];
    foreach (dbAll("SELECT osm_section_id, active_count, last_synced_at FROM osm_sections WHERE sync_status = 'ok' AND active_count IS NOT NULL") as $o) {
        $osmCounts[$o['osm_section_id']] = $o;
    }

    // Child records are shown from the data captured when the child was linked -
    // no live OSM member fetch. OSM aggressively rate-limits/blocks /ext/ reads
    // from a server, so the portal keeps OSM to sign-in only and links out to OSM
    // for live detail.
    $children = array_map(function ($link) use ($osmCounts) {
        $count = $osmCounts[$link['osm_section_id']] ?? null;
        return [
            'linkId' => (int) $link['id'],
            'name' => $link['child_display_name'] ?: 'Your child',
            'sectionId' => $link['osm_section_id'],
            'sectionName' => $link['osm_section_name'],
            'status' => $link['osm_section_name'] ?: '',
            // Cached section member count + when it was last synced (no live OSM call).
            'sectionMemberCount' => $count ? (int) $count['active_count'] : null,
            'sectionMemberCountSyncedAt' => $count['last_synced_at'] ?? null,
        ];
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

    // Section list comes from the leader's OSM roles captured at login - we make
    // NO live /ext/ data calls here. OSM aggressively rate-limits/blocks those from
    // a server, and a per-section members+programme+events burst on every dashboard
    // load was the main trigger, so section detail is opened in OSM directly.
    $termsData = json_decode($user['osm_terms_json'] ?? '[]', true) ?: [];
    // Cached OSM member counts (from the admin's deliberate sync) - read from the
    // DB only, so the dashboard itself never calls OSM.
    $osmCounts = [];
    foreach (dbAll("SELECT osm_section_id, active_count, last_synced_at FROM osm_sections WHERE sync_status = 'ok' AND active_count IS NOT NULL") as $o) {
        $osmCounts[$o['osm_section_id']] = $o;
    }
    $sections = array_map(function ($role) use ($termsData, $osmCounts) {
        $sectionId = (string) $role['sectionid'];
        $meta = osmDataSectionMeta($sectionId);
        $term = osmCurrentTermFromData($termsData, $sectionId);
        $count = $osmCounts[$sectionId] ?? null;
        return [
            'sectionId' => $sectionId,
            'sectionName' => $role['sectionname'],
            'sectionType' => $role['section'],
            'meetingDay' => $meta['meetingDay'] ?? null,
            'meetingTime' => $meta['meetingTime'] ?? null,
            'location' => $meta['location'] ?? null,
            // Current-term context from OSM, captured at login (no live OSM call).
            'currentTerm' => $term ? ['name' => $term['name'], 'startDate' => $term['startDate'], 'endDate' => $term['endDate']] : null,
            // Cached OSM member count + when it was last synced (no live OSM call).
            'memberCount' => $count ? (int) $count['active_count'] : null,
            'memberCountSyncedAt' => $count['last_synced_at'] ?? null,
        ];
    }, $roles);

    $sectionIds = array_column($sections, 'sectionId');
    jsonResponse(['sections' => $sections, 'notices' => array_map('serializeNotice', listNoticesForUser($user, $sectionIds))]);
});
