<?php
// One-section read probe for programme and events, mirroring the badge diagnostic.
// Reports the STATUS and SHAPE of each candidate endpoint (the /ext readers the app
// already has, plus the newer /v3 variants from the developer guide) so we can confirm
// what the CURRENT connection actually returns before wiring a sync. Programme and event
// summary data is not personal (meeting titles/dates, event name/date/location), so unlike
// the badge probe this may show sample field values - useful for mapping. Attendee lists
// (which would be personal) are deliberately not requested here.

function osmProbeCanRun(array $user, string $tokenSource): bool
{
    return $tokenSource === 'me' ? userHasLeaderAccess($user) : isAdminRole($user['portal_role'] ?? '');
}

function osmProbeProgrammeEvents(array $actor, string $tokenSource = 'service'): array
{
    $tokenSource = in_array($tokenSource, ['service', 'me'], true) ? $tokenSource : 'service';
    if (!osmProbeCanRun($actor, $tokenSource)) throw new RuntimeException('You do not have permission to run this probe.');
    if (osmDemoModeAllowed()) throw new RuntimeException('This is running in demo mode, so there is no live OSM response to inspect. Run it on the live server.');

    if ($tokenSource === 'me') {
        $tok = osmDataReadTokenFor($actor);
    } else {
        $svc = function_exists('getServiceAccount') ? getServiceAccount() : null;
        $tok = $svc ? osmDataReadTokenFor($svc) : ['unavailable' => true];
    }
    if (!empty($tok['unavailable'])) throw new RuntimeException($tok['reason'] ?? 'No usable OSM connection to read from.');
    $token = $tok['token'];

    $startup = osmdFetchStartupWith($token);
    if (empty($startup['ok']) || empty($startup['sections'])) throw new RuntimeException('Could not read any sections from the OSM startup context.');
    // Prefer a youth section (programme/events live there); fall back to the first.
    $sid = null;
    foreach ($startup['sections'] as $id => $name) {
        if (in_array($startup['sectionTypes'][$id] ?? '', OSM_YOUTH_SECTION_TYPES, true)) { $sid = (string) $id; break; }
    }
    if ($sid === null) $sid = (string) array_key_first($startup['sections']);
    $type = $startup['sectionTypes'][$sid] ?? null;
    $termId = osmCurrentTermIdForSection($token, $sid);

    $candidates = [
        ['label' => 'programme /ext getProgrammeSummary', 'method' => 'GET', 'path' => '/ext/programme/',        'query' => ['action' => 'getProgrammeSummary', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'programme /v3 summary',              'method' => 'GET', 'path' => '/v3/programme/summary',   'query' => ['section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /ext get',                    'method' => 'GET', 'path' => '/ext/events/summary/',    'query' => ['action' => 'get', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /ext getEvents',              'method' => 'GET', 'path' => '/ext/events/summary/',    'query' => ['action' => 'getEvents', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /v3 list',                    'method' => 'GET', 'path' => '/v3/events/',             'query' => ['section_id' => $sid, 'term_id' => $termId]],
    ];
    $results = [];
    foreach ($candidates as $c) {
        $r = osmRawData($c['method'], $token, $c['path'], $c['query'], []);
        $payload = $r['payload'] ?? null;
        $firstItem = is_array($r['items'] ?? null) ? ($r['items'][0] ?? null) : null;
        $results[$c['label']] = [
            'path' => $c['path'],
            'status' => $r['status'],
            'itemsFound' => $r['count'],
            'payloadKeys' => (is_array($payload) && !array_is_list($payload)) ? array_slice(array_keys($payload), 0, 25) : (is_array($payload) ? ['(list)'] : []),
            'sampleItemKeys' => is_array($firstItem) ? array_slice(array_keys($firstItem), 0, 40) : [],
            'sampleItem' => is_array($firstItem) ? array_map(fn($v) => is_scalar($v) ? $v : ('[' . gettype($v) . ']'), $firstItem) : null,
            'error' => $r['error'] ?? null,
        ];
    }

    if (function_exists('logAudit')) {
        logAudit(['userId' => $actor['id'], 'action' => 'osm_probe_programme_events', 'entityType' => 'osm_section', 'entityId' => $sid, 'ipAddress' => function_exists('clientIp') ? clientIp() : null]);
    }
    return [
        'tokenSource' => $tokenSource,
        'section' => $startup['sections'][$sid], 'sectionId' => $sid, 'sectionType' => $type, 'termId' => $termId,
        'candidates' => $results,
    ];
}
