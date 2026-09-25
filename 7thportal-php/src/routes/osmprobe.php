<?php
// Admin/leader read probe for programme + events (src/lib/osmprobe.php). Reports the shape
// of what the current OSM connection returns, to confirm readability before wiring a sync.

$router->get('/api/osm/probe/programme-events', function ($params) {
    $user = requireAuth();
    $tokenSource = in_array(queryParam('tokenSource') ?: 'service', ['service', 'me'], true) ? (queryParam('tokenSource') ?: 'service') : 'service';
    if (!osmProbeCanRun($user, $tokenSource)) jsonResponse(['error' => 'You do not have permission to run this probe.'], 403);
    try {
        jsonResponse(['ok' => true, 'probe' => osmProbeProgrammeEvents($user, $tokenSource)]);
    } catch (RuntimeException $e) {
        jsonResponse(['error' => $e->getMessage()], 409);
    }
});
