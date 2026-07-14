<?php
// Thin layer over osm.php that resolves "which OSM token reads for this
// request" (own token for leaders/admins, the shared service account for
// parents - see helpers.php's getServiceAccount) and swaps in demo fixtures
// whenever the resolved token is the 'demo' sentinel. Every dashboard/child/
// section route goes through here so OSM-unavailable handling (FRD journey
// 7.4 / NFR-017) lives in one place.

function osmDataReadTokenFor(array $user): array
{
    try {
        if ($user['portal_role'] === 'parent') {
            $service = getServiceAccount();
            if ($service) return ['token' => ensureFreshToken($service), 'unavailable' => false];
            if (osmDemoModeAllowed()) return ['token' => 'demo', 'unavailable' => false];
            return ['unavailable' => true, 'reason' => 'No OSM service connection has been configured yet. Ask a Portal Administrator to connect OSM in Admin Settings.'];
        }
        return ['token' => ensureFreshToken($user), 'unavailable' => false];
    } catch (Throwable $e) {
        if (osmDemoModeAllowed()) return ['token' => 'demo', 'unavailable' => false];
        return ['unavailable' => true, 'reason' => 'Live OSM information cannot currently be loaded. Please try again shortly.'];
    }
}

function osmDataSectionMeta(string $sectionId): ?array
{
    return OSM_DEMO_SECTIONS[$sectionId] ?? null;
}

function osmDataSectionMembers(string $token, string $sectionId): array
{
    if ($token === 'demo') return ['available' => true, 'members' => OSM_DEMO_MEMBERS[$sectionId] ?? []];
    return osmGetSectionMembers($token, $sectionId);
}

function osmDataSectionProgramme(string $token, string $sectionId): array
{
    if ($token === 'demo') return ['available' => true, 'items' => OSM_DEMO_PROGRAMME[$sectionId] ?? []];
    return osmGetSectionProgramme($token, $sectionId);
}

function osmDataSectionEvents(string $token, string $sectionId): array
{
    if ($token === 'demo') return ['available' => true, 'items' => OSM_DEMO_EVENTS[$sectionId] ?? []];
    return osmGetSectionEvents($token, $sectionId);
}

function osmDataMemberBadges(string $token, ?string $sectionType, string $sectionId, string $memberId): array
{
    if ($token === 'demo') return ['available' => true, 'badges' => OSM_DEMO_BADGES[$memberId] ?? []];
    return osmGetMemberBadgeProgress($token, $sectionType, $sectionId, OSM_DEMO_TERM['termid'], $memberId);
}
