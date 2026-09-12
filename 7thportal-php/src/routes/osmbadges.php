<?php
// Badges Awarded summary routes. Viewing is open to any leader/leadership/trustee role
// (Tier A aggregate counts only); refreshing from OSM is Portal-Administrator only, since
// it spends rate-limit budget. See src/lib/osmbadges.php and DECISIONS-osm-integration.md.

$router->get('/api/osm/badges', function ($params) {
    $user = requireAuth();
    if (!osmBadgesCanView($user)) jsonResponse(['error' => 'You do not have permission to view the badges summary.'], 403);
    jsonResponse([
        'canRefresh' => osmBadgesCanRefresh($user),
        'summary' => osmBadgesSummaryData(),
    ]);
});

$router->post('/api/osm/badges/refresh', function ($params) {
    $user = requireAuth();
    if (!osmBadgesCanRefresh($user)) jsonResponse(['error' => 'You do not have permission to refresh the badges summary.'], 403);
    try {
        $result = osmBadgesRefresh($user);
    } catch (RuntimeException $e) {
        jsonResponse(['error' => $e->getMessage()], 409);
    }
    jsonResponse(['ok' => true, 'result' => $result, 'summary' => osmBadgesSummaryData()], 201);
});

// Admin-only diagnostic: reports the SHAPE of the live getAvailableBadges response for
// one section, so the aggregate award/completed fields can be mapped from real evidence
// when a refresh comes back flagged for verification. Catalogue data only, no members.
$router->get('/api/osm/badges/diagnose', function ($params) {
    $user = requireAuth();
    if (!osmBadgesCanRefresh($user)) jsonResponse(['error' => 'You do not have permission to run the badge diagnostic.'], 403);
    try {
        jsonResponse(['ok' => true, 'diagnostic' => osmBadgesDiagnose($user)]);
    } catch (RuntimeException $e) {
        jsonResponse(['error' => $e->getMessage()], 409);
    }
});
