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
    // The waiting list is itself an OSM section (type 'waiting'); grab its id to read it.
    $waitSid = null;
    foreach ($startup['sections'] as $id => $name) {
        if (($startup['sectionTypes'][$id] ?? '') === 'waiting') { $waitSid = (string) $id; break; }
    }

    $candidates = [
        ['label' => 'programme /ext getProgrammeSummary', 'method' => 'GET', 'path' => '/ext/programme/',        'query' => ['action' => 'getProgrammeSummary', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'programme /v3 summary',              'method' => 'GET', 'path' => '/v3/programme/summary',   'query' => ['section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /ext get',                    'method' => 'GET', 'path' => '/ext/events/summary/',    'query' => ['action' => 'get', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /ext getEvents',              'method' => 'GET', 'path' => '/ext/events/summary/',    'query' => ['action' => 'getEvents', 'section_id' => $sid, 'term_id' => $termId]],
        ['label' => 'events /v3 list',                    'method' => 'GET', 'path' => '/v3/events/',             'query' => ['section_id' => $sid, 'term_id' => $termId]],
    ];
    // The waiting list is an OSM section (type 'waiting'), so read it like any other roster
    // via the proven POST members grid - not a bespoke endpoint. Prospective members, so
    // PII: key names only (pii flag suppresses values).
    if ($waitSid !== null) {
        $wt = osmCurrentTermIdForSection($token, $waitSid);
        $candidates[] = ['label' => 'waitinglist members grid (POST)', 'method' => 'POST', 'path' => '/ext/members/contact/grid/', 'query' => ['action' => 'getMembers'], 'body' => ['section_id' => $waitSid, 'term_id' => $wt], 'pii' => true];
        $candidates[] = ['label' => 'waitinglist members list (GET)',  'method' => 'GET',  'path' => '/ext/members/contact/',      'query' => ['action' => 'getListOfMembers', 'section_id' => $waitSid, 'term_id' => $wt], 'pii' => true];
    }
    $results = [];
    foreach ($candidates as $c) {
        $r = osmRawData($c['method'], $token, $c['path'], $c['query'], $c['body'] ?? []);
        $payload = $r['payload'] ?? null;
        $firstItem = is_array($r['items'] ?? null) ? (array_values($r['items'])[0] ?? null) : null; // grid rows are keyed by scout id, not a list
        $results[$c['label']] = [
            'path' => $c['path'],
            'status' => $r['status'],
            'itemsFound' => $r['count'],
            'payloadKeys' => (is_array($payload) && !array_is_list($payload)) ? array_slice(array_keys($payload), 0, 25) : (is_array($payload) ? ['(list)'] : []),
            'sampleItemKeys' => is_array($firstItem) ? array_slice(array_keys($firstItem), 0, 40) : [],
            // PII candidates: key names only, never values (a waiting-list row is a child + parent).
            'sampleItem' => (!empty($c['pii']) || !is_array($firstItem)) ? null : array_map(fn($v) => is_scalar($v) ? $v : ('[' . gettype($v) . ']'), $firstItem),
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
