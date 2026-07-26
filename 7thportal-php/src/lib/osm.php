<?php
// OSM OAuth2 + "ext" API client - ported from the Node version's
// src/lib/osm.js. See that file's original header comment (and this
// project's README) for the reasoning behind the auth model: OSM only
// offers OAuth for leaders' section-scoped access, not for parents, and the
// member/programme/event "ext" endpoints beyond roles+terms+badges are
// best-effort based on community documentation, not an official spec -
// every call degrades to "data not available" on failure (NFR-017) rather
// than breaking a page.
//
// One deliberate simplification vs the Node version: badge lookups are done
// sequentially here rather than with bounded-concurrency workers. Node used
// concurrent fetches for speed; PHP's curl_multi_* would replicate that, but
// this is a low-traffic app and a straightforward foreach is far simpler to
// get right. Slower per-request, not less correct.

const OSM_BASE = 'https://www.onlinescoutmanager.co.uk';
const OSM_SCOPES = 'section:member:read section:programme:read section:event:read section:badge:read';
const OSM_YOUTH_SECTION_TYPES = ['squirrels', 'beavers', 'cubs', 'scouts', 'explorers'];
const OSM_BADGE_TYPE_NAMES = [1 => 'Challenge', 2 => 'Activity', 3 => 'Staged', 4 => 'Core'];

function osmIsConfigured(): bool
{
    return (bool) (env('OSM_CLIENT_ID') && env('OSM_CLIENT_SECRET') && env('OSM_REDIRECT_URI'));
}

function osmDemoModeAllowed(): bool
{
    return env('ALLOW_DEMO_MODE') === 'true' || !osmIsConfigured();
}

function osmRandomState(): string
{
    return bin2hex(random_bytes(16));
}

function osmBasicAuthHeader(): string
{
    return 'Basic ' . base64_encode(env('OSM_CLIENT_ID') . ':' . env('OSM_CLIENT_SECRET'));
}

function osmBuildAuthorizeUrl(string $state): string
{
    $params = [
        'client_id' => env('OSM_CLIENT_ID'),
        'redirect_uri' => env('OSM_REDIRECT_URI'),
        'response_type' => 'code',
        'scope' => OSM_SCOPES,
        'state' => $state,
    ];
    return OSM_BASE . '/oauth/authorize?' . http_build_query($params);
}

function osmTokenRequest(array $formParams): array
{
    loginLog('POST /oauth/token', [
        'grant_type' => $formParams['grant_type'] ?? null,
        'clientIdPrefix' => substr((string) env('OSM_CLIENT_ID', ''), 0, 6) . '...',
        'redirectUri' => env('OSM_REDIRECT_URI'),
    ]);
    $ch = curl_init(OSM_BASE . '/oauth/token');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => http_build_query($formParams),
        CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Authorization: ' . osmBasicAuthHeader()],
        CURLOPT_TIMEOUT => 20,
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);
        // A curl-level failure (not an HTTP error response) usually means outbound
        // requests are blocked or misconfigured on this host - common on locked-down
        // shared hosting (curl disabled, outbound firewall, missing CA bundle for TLS).
        loginLog('curl request to OSM FAILED (no HTTP response at all)', ['curlErrno' => $errno, 'curlError' => $err]);
        throw new Exception("OSM token request failed: $err");
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status < 200 || $status >= 300) {
        loginLog('Token request FAILED', ['status' => $status, 'body' => substr($body, 0, 1000)]);
        throw new Exception("OSM token request failed: $status $body");
    }
    loginLog('Token request OK', ['status' => $status]);
    $data = json_decode($body, true);
    return is_array($data) ? $data : [];
}

function osmExchangeCodeForToken(string $code): array
{
    $data = osmTokenRequest(['grant_type' => 'authorization_code', 'code' => $code, 'redirect_uri' => env('OSM_REDIRECT_URI')]);
    if (empty($data['access_token'])) {
        // OSM returns HTTP 200 with no token (and often no error field) when it
        // rate-limits repeated sign-ins for a user who already has an active
        // token. Surface a clear reason instead of a null-token crash downstream.
        loginLog('Token endpoint returned no access_token', ['responseKeys' => array_keys($data), 'error' => $data['error'] ?? null, 'errorDescription' => $data['error_description'] ?? null]);
        throw new Exception('OSM did not return an access token - it is usually rate-limiting repeated sign-ins. Wait a few minutes, then sign in once.');
    }
    return [
        'accessToken' => $data['access_token'],
        'refreshToken' => $data['refresh_token'] ?? null,
        'expiresAt' => nowMs() + ((($data['expires_in'] ?? 3600) - 30) * 1000),
    ];
}

function osmRefreshAccessToken(string $refreshToken): array
{
    $data = osmTokenRequest(['grant_type' => 'refresh_token', 'refresh_token' => $refreshToken]);
    if (empty($data['access_token'])) {
        loginLog('Refresh endpoint returned no access_token', ['responseKeys' => array_keys($data), 'error' => $data['error'] ?? null]);
        throw new Exception('OSM did not return a refreshed access token.');
    }
    return [
        'accessToken' => $data['access_token'],
        'refreshToken' => $data['refresh_token'] ?? $refreshToken,
        'expiresAt' => nowMs() + ((($data['expires_in'] ?? 3600) - 30) * 1000),
    ];
}

function osmGet(string $accessToken, string $pathname, array $params = []): array
{
    $url = OSM_BASE . $pathname . '?' . http_build_query($params);
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer $accessToken"],
        CURLOPT_TIMEOUT => 20,
    ]);
    $body = curl_exec($ch);
    if ($body === false) {
        $err = curl_error($ch);
        curl_close($ch);
        loginLog('curl GET FAILED (no HTTP response)', ['pathname' => $pathname, 'curlError' => $err]);
        throw new Exception("OSM API error on $pathname: $err");
    }
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($status < 200 || $status >= 300) {
        loginLog('GET FAILED', ['pathname' => $pathname, 'status' => $status, 'body' => substr($body, 0, 500)]);
        throw new Exception("OSM API error $status on $pathname");
    }
    $data = json_decode($body, true);
    return is_array($data) ? $data : [];
}

function osmGetStartupData(string $accessToken): array
{
    $data = osmGet($accessToken, '/ext/generic/startup/', ['action' => 'getDataPayload']);
    loginLog('startup payload received', ['topLevelKeys' => array_keys($data), 'globalsKeys' => array_keys($data['data']['globals'] ?? [])]);
    return $data;
}

// Best-effort identity extraction - OSM's public OAuth token response carries
// no user identifier, so the startup payload is the only source. Field paths
// vary across community write-ups; try the likely candidates and fail loudly
// (server-side log) rather than silently mis-attributing an account.
function osmExtractIdentity(array $startup): array
{
    $g = $startup['data']['globals'] ?? [];
    $roles = $g['roles'] ?? [];
    $userId = $g['user_id'] ?? $g['userid'] ?? $g['userId'] ?? ($roles[0]['userid'] ?? null);
    $firstName = $g['firstname'] ?? $g['firstName'] ?? ($g['user']['firstname'] ?? null) ?? 'OSM';
    $lastName = $g['lastname'] ?? $g['lastName'] ?? ($g['user']['lastname'] ?? null) ?? 'User';
    $email = $g['email'] ?? ($g['user']['email'] ?? null);
    if (!$userId) {
        loginLog('extractIdentity FAILED - no userId found. Full globals object for debugging', substr(json_encode($g), 0, 2000));
        throw new Exception('Could not determine OSM user identity from startup payload - see README OSM integration notes.');
    }
    loginLog('extractIdentity OK', ['userId' => $userId, 'firstName' => $firstName, 'lastName' => $lastName, 'hasEmail' => !empty($email), 'roleCount' => count($roles)]);
    return ['osmUserId' => (string) $userId, 'firstName' => $firstName, 'lastName' => $lastName, 'email' => $email, 'roles' => $roles, 'terms' => $g['terms'] ?? []];
}

function osmPluckItemsList($resp): array
{
    if (is_array($resp) && isset($resp['items']) && is_array($resp['items']) && array_is_list($resp['items'])) return $resp['items'];
    if (is_array($resp) && array_is_list($resp)) return $resp;
    return [];
}

// Resolve the current OSM term id for a section. OSM rejects term_id=-1 with a
// 405 "Invalid parameter", so a real term is required. Terms come from the
// startup payload (section_id -> list of terms with start/end dates); the current
// term is the one spanning today, else the most recent. Cached per request so a
// multi-section sync only fetches the startup payload once.
function osmCurrentTermIdForSection(string $accessToken, string $sectionId): ?string
{
    static $termsBySection = null;
    if ($termsBySection === null) {
        try {
            $startup = osmGetStartupData($accessToken);
            $termsBySection = $startup['data']['globals']['terms'] ?? [];
        } catch (Throwable $e) {
            $termsBySection = [];
        }
        if (!is_array($termsBySection)) $termsBySection = [];
    }
    $terms = $termsBySection[$sectionId] ?? [];
    if (!is_array($terms) || !$terms) return null;
    $today = date('Y-m-d');
    $current = null;
    foreach ($terms as $t) {
        if (!is_array($t)) continue;
        $start = $t['startdate'] ?? null;
        $end = $t['enddate'] ?? null;
        if ($start && $end && $start <= $today && $today <= $end) { $current = $t; break; }
    }
    if ($current === null) {
        $sorted = array_values(array_filter($terms, 'is_array'));
        usort($sorted, fn($a, $b) => strcmp((string) ($b['startdate'] ?? ''), (string) ($a['startdate'] ?? '')));
        $current = $sorted[0] ?? null;
    }
    $id = $current['termid'] ?? $current['term_id'] ?? $current['id'] ?? null;
    return $id !== null && $id !== '' ? (string) $id : null;
}

function osmGetSectionMembers(string $accessToken, string $sectionId, $termId = null): array
{
    try {
        $termId = $termId ?: osmCurrentTermIdForSection($accessToken, $sectionId);
        if (!$termId) return ['available' => false, 'members' => [], 'error' => 'No current OSM term found for this section.'];
        $resp = osmGet($accessToken, '/ext/members/contact/', ['action' => 'getListOfMembers', 'sort' => 'dob', 'section_id' => $sectionId, 'term_id' => $termId]);
        $items = array_is_list($resp) ? $resp : array_values($resp['items'] ?? $resp ?? []);
        $members = array_map(fn($m) => [
            'id' => (string) ($m['scoutid'] ?? $m['member_id'] ?? $m['id'] ?? ''),
            'firstName' => $m['firstname'] ?? $m['first_name'] ?? '',
            'lastName' => $m['lastname'] ?? $m['last_name'] ?? '',
            'dob' => $m['dob'] ?? null,
            'patrol' => $m['patrol'] ?? $m['patrolname'] ?? null,
        ], $items);
        return ['available' => true, 'members' => $members];
    } catch (Throwable $e) {
        return ['available' => false, 'members' => [], 'error' => $e->getMessage()];
    }
}

// Raw OSM data request (GET or POST) that never throws - returns status, whether
// a member/item list came back, and the count or error. Used by the member probe
// to discover the call shape OSM actually accepts (the documented GET returns 405).
function osmRawData(string $method, string $accessToken, string $pathname, array $query = [], array $body = []): array
{
    $url = OSM_BASE . $pathname . ($query ? ('?' . http_build_query($query)) : '');
    $ch = curl_init($url);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ["Authorization: Bearer $accessToken", 'Content-Type: application/x-www-form-urlencoded'],
        CURLOPT_TIMEOUT => 20,
    ];
    if ($method === 'POST') { $opts[CURLOPT_POST] = true; $opts[CURLOPT_POSTFIELDS] = http_build_query($body); }
    curl_setopt_array($ch, $opts);
    $raw = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $raw, true);
    $items = null;
    if (is_array($data)) {
        if (isset($data['items']) && is_array($data['items'])) $items = $data['items'];
        elseif (isset($data['data']) && is_array($data['data']) && $data['data']) $items = $data['data'];
        elseif (array_is_list($data)) $items = $data;
    }
    $err = null;
    if (is_array($data) && isset($data['error'])) {
        $err = is_array($data['error']) ? ($data['error']['message'] ?? json_encode($data['error'])) : (string) $data['error'];
    }
    return [
        'status' => $status,
        'ok' => $status >= 200 && $status < 300 && is_array($items),
        'count' => is_array($items) ? count($items) : null,
        'error' => $err,
        'bodySnippet' => is_array($data) ? null : substr((string) $raw, 0, 160),
    ];
}

// Try the likely member-list call shapes against one section and report which
// OSM accepts, so the working variant can be wired in without further guessing.
function osmProbeMembers(string $accessToken, string $sectionId): array
{
    $t = osmCurrentTermIdForSection($accessToken, $sectionId);
    $variants = [
        ['label' => 'GET section_id/term_id (current)', 'method' => 'GET', 'path' => '/ext/members/contact/', 'query' => ['action' => 'getListOfMembers', 'sort' => 'dob', 'section_id' => $sectionId, 'term_id' => $t], 'body' => []],
        ['label' => 'GET sectionid/termid', 'method' => 'GET', 'path' => '/ext/members/contact/', 'query' => ['action' => 'getListOfMembers', 'sort' => 'dob', 'sectionid' => $sectionId, 'termid' => $t], 'body' => []],
        ['label' => 'POST grid getMembers', 'method' => 'POST', 'path' => '/ext/members/contact/grid/', 'query' => ['action' => 'getMembers'], 'body' => ['section_id' => $sectionId, 'term_id' => $t]],
        ['label' => 'POST getListOfMembers', 'method' => 'POST', 'path' => '/ext/members/contact/', 'query' => ['action' => 'getListOfMembers'], 'body' => ['section_id' => $sectionId, 'term_id' => $t, 'sort' => 'dob']],
    ];
    $results = [];
    foreach ($variants as $v) {
        $r = osmRawData($v['method'], $accessToken, $v['path'], $v['query'], $v['body']);
        $results[] = ['label' => $v['label'], 'method' => $v['method'], 'path' => $v['path']] + $r;
        if ($r['ok']) break; // stop at the first shape that returns members
    }
    return ['sectionId' => $sectionId, 'termId' => $t, 'variants' => $results];
}

function osmGetSectionProgramme(string $accessToken, string $sectionId, $termId = null): array
{
    try {
        $termId = $termId ?: osmCurrentTermIdForSection($accessToken, $sectionId);
        if (!$termId) return ['available' => true, 'items' => []];
        $resp = osmGet($accessToken, '/ext/programme/', ['action' => 'getProgrammeSummary', 'section_id' => $sectionId, 'term_id' => $termId]);
        $items = osmPluckItemsList($resp);
        $mapped = array_map(fn($p) => [
            'date' => $p['meetingdate'] ?? $p['date'] ?? null,
            'title' => $p['title'] ?? $p['meeting_title'] ?? 'Meeting',
            'notes' => $p['notesforparents'] ?? $p['notes'] ?? null,
        ], $items);
        return ['available' => true, 'items' => $mapped];
    } catch (Throwable $e) {
        return ['available' => false, 'items' => [], 'error' => $e->getMessage()];
    }
}

function osmGetSectionEvents(string $accessToken, string $sectionId): array
{
    try {
        $resp = osmGet($accessToken, '/ext/events/summary/', ['action' => 'get', 'section_id' => $sectionId]);
        $items = osmPluckItemsList($resp);
        $mapped = array_map(fn($e) => [
            'id' => (string) ($e['eventid'] ?? $e['id'] ?? ''),
            'name' => $e['name'] ?? 'Event',
            'date' => $e['startdate'] ?? $e['date'] ?? null,
            'location' => $e['location'] ?? null,
        ], $items);
        return ['available' => true, 'items' => $mapped];
    } catch (Throwable $e) {
        return ['available' => false, 'items' => [], 'error' => $e->getMessage()];
    }
}

function osmGetMemberBadgeProgress(string $accessToken, ?string $sectionType, string $sectionId, $termId, string $memberId): array
{
    try {
        $allBadges = [];
        foreach ([1, 2, 3, 4] as $typeId) {
            $resp = osmGet($accessToken, '/ext/badges/records/', [
                'action' => 'getAvailableBadges', 'section' => $sectionType, 'section_id' => $sectionId,
                'term_id' => $termId, 'type_id' => (string) $typeId, 'context' => 'none',
            ]);
            foreach (($resp['data'] ?? []) as $b) { $b['typeId'] = $typeId; $allBadges[] = $b; }
        }
        $results = [];
        foreach ($allBadges as $badge) {
            $resp = osmGet($accessToken, '/ext/badges/records/', [
                'action' => 'getBadgeRecords', 'section' => $sectionType, 'section_id' => $sectionId, 'term_id' => $termId,
                'type_id' => (string) $badge['typeId'], 'badge_id' => (string) $badge['badge_id'], 'badge_version' => (string) ($badge['badge_version'] ?? 0),
            ]);
            $record = null;
            foreach (($resp['data'] ?? []) as $r) {
                if ((string) ($r['scoutid'] ?? '') === (string) $memberId) { $record = $r; break; }
            }
            if (!$record) continue;
            $awarded = ($record['awarded'] ?? null) === '1' || ($record['awarded'] ?? null) === 1;
            $results[] = ['badgeName' => $badge['name'] ?? ($badge['badge'] ?? ''), 'type' => OSM_BADGE_TYPE_NAMES[$badge['typeId']] ?? null, 'completed' => $awarded];
        }
        return ['available' => true, 'badges' => $results];
    } catch (Throwable $e) {
        return ['available' => false, 'badges' => [], 'error' => $e->getMessage()];
    }
}

// ── Demo mode - deterministic fake OSM data so the app is fully clickable
// without live credentials. Never used once a real osm_access_token is set.
const OSM_DEMO_TERM = ['termid' => 'demo-term', 'name' => 'Autumn Term', 'startdate' => '2026-09-01', 'enddate' => '2026-12-15'];
const OSM_DEMO_SECTIONS = [
    's101' => ['sectionid' => 's101', 'sectionname' => 'Cubs', 'section' => 'cubs', 'meetingDay' => 'Tuesday', 'meetingTime' => '18:15 - 19:30', 'location' => '7th Swindon Scout Hut'],
    's102' => ['sectionid' => 's102', 'sectionname' => 'Scouts', 'section' => 'scouts', 'meetingDay' => 'Thursday', 'meetingTime' => '19:30 - 21:00', 'location' => '7th Swindon Scout Hut'],
];
const OSM_DEMO_MEMBERS = [
    's101' => [
        ['id' => 'm201', 'firstName' => 'Amelia', 'lastName' => 'Turner', 'dob' => '2016-03-14', 'patrol' => 'Blue Six'],
        ['id' => 'm202', 'firstName' => 'Jack', 'lastName' => 'Ellis', 'dob' => '2016-07-02', 'patrol' => 'Red Six'],
    ],
    's102' => [
        ['id' => 'm203', 'firstName' => 'Freddie', 'lastName' => 'Brown', 'dob' => '2013-11-20', 'patrol' => 'Kestrel Patrol'],
    ],
];
const OSM_DEMO_PROGRAMME = [
    's101' => [
        ['date' => '2026-07-14', 'title' => 'Pioneering skills', 'notes' => 'Bring old bedsheets for shelter building.'],
        ['date' => '2026-07-21', 'title' => 'Nature trail and badge work', 'notes' => null],
    ],
    's102' => [
        ['date' => '2026-07-16', 'title' => 'Map and compass night', 'notes' => 'Meet in the main hall, not the field.'],
    ],
];
const OSM_DEMO_EVENTS = [
    's101' => [['id' => 'e301', 'name' => 'Summer Camp 2026', 'date' => '2026-08-08', 'location' => 'Youlbury Scout Camp']],
    's102' => [['id' => 'e302', 'name' => 'Night Hike', 'date' => '2026-07-25', 'location' => 'Barbury Castle']],
];
const OSM_DEMO_BADGES = [
    'm201' => [
        ['badgeName' => 'Outdoor Adventurer', 'type' => 'Activity', 'completed' => true],
        ['badgeName' => 'Nights Away', 'type' => 'Staged', 'completed' => false],
    ],
    'm202' => [['badgeName' => 'Chef', 'type' => 'Activity', 'completed' => true]],
    'm203' => [
        ['badgeName' => 'Hikes Away', 'type' => 'Staged', 'completed' => false],
        ['badgeName' => 'Navigator', 'type' => 'Activity', 'completed' => true],
    ],
];

function osmDemoStartupForRole(string $role): array
{
    $roles = $role === 'parent' ? [] : [
        ['sectionid' => 's101', 'sectionname' => 'Cubs', 'section' => 'cubs', 'userid' => 'demo-osm-user'],
    ];
    return ['data' => ['globals' => [
        'user_id' => 'demo-osm-user',
        'firstname' => 'Demo',
        'lastname' => $role === 'admin' ? 'Administrator' : 'Leader',
        'roles' => $roles,
        'terms' => ['s101' => [OSM_DEMO_TERM], 's102' => [OSM_DEMO_TERM]],
    ]]];
}
