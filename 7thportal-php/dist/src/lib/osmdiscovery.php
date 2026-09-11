<?php
// OSM Discovery & Capability Registry (Master FRD v3.4, OSM Discovery spec v1.0).
// A safe, read-only, repeatable probe of the connected OSM context. It records
// evidence about which capabilities the connection exposes; it never mutates OSM,
// never enables a production feature, never broadens a permission ceiling, and never
// persists tokens or personal response bodies (FR-OSMD-003/007/018, AC-330/335/336).

const OSMD_CONNECTOR_VERSION = 'osm-connector-2026.09';

// The seven-state result model (spec s6). Ordered best-to-worst for change scoring.
const OSMD_STATUSES = ['available', 'partial', 'permission_limited', 'unavailable', 'unknown', 'error', 'not_tested'];

// Configurable capability catalogue (spec s5 + s11). Each entry: the capability area,
// the 7thPortal features that depend on it, and - for the demo/evidence provider - a
// representative classification with an evidence class, so the whole feature is
// demonstrable and testable without a live OSM token. The real-OSM adapter
// (osmdRealProbe) fills the same shape from actual read probes.
function osmdCatalogue(): array
{
    return [
        'identity_session'   => ['area' => 'Identity & session',        'checks' => 'Connected identity, accessible sections, role/permission metadata, token scopes where exposed', 'features' => ['Active context', 'Access ceiling'],                 'demo' => ['status' => 'available',         'evidence' => 'Connected identity and roles resolved from the session context'],
                                 'sectionScoped' => true],
        'sections'           => ['area' => 'Sections & organisation',   'checks' => 'Section IDs/names, structure and accessible scope',                                        'features' => ['Section contexts', 'Reporting'],                       'demo' => ['status' => 'available',         'evidence' => 'Stable section IDs mapped for the accessible scope'],
                                 'sectionScoped' => true],
        'members'            => ['area' => 'Members',                    'checks' => 'Stable member references and minimal roster capability',                                    'features' => ['People', 'Participant selection', 'Counts'],           'demo' => ['status' => 'available',         'evidence' => 'Representative roster read succeeded (references and counts only)'],
                                 'sectionScoped' => true],
        'parents_contacts'   => ['area' => 'Parents / contacts',        'checks' => 'Whether parent/contact relationships and permitted fields can be read',                     'features' => ['Parent linkage', 'Operational contact views'],        'demo' => ['status' => 'partial',           'evidence' => 'Contact relationships visible but not all permitted fields are exposed to this scope'],
                                 'sectionScoped' => true],
        'patrols'            => ['area' => 'Patrols / sixes',           'checks' => 'Patrol/six structures and memberships',                                                    'features' => ['People grouping', 'Patrol Points team seed'],         'demo' => ['status' => 'available',         'evidence' => 'Patrol/six groupings present on the roster references'],
                                 'sectionScoped' => true],
        'programme'          => ['area' => 'Programme',                 'checks' => 'Meeting/programme items, dates, activity metadata',                                        'features' => ['Leader Today', 'Meeting Mode', 'Calendar'],           'demo' => ['status' => 'available',         'evidence' => 'Representative programme read succeeded; no personal body retained'],
                                 'sectionScoped' => true],
        'attendance'         => ['area' => 'Attendance',                'checks' => 'Register availability and permitted attendance data',                                      'features' => ['Meeting readiness', 'Attendance insights'],           'demo' => ['status' => 'unknown',           'evidence' => 'No reliable attendance probe is configured for this connector yet'],
                                 'sectionScoped' => true],
        'badges'             => ['area' => 'Badges',                    'checks' => 'Badge catalogue, progress and programme links where available',                             'features' => ['Badge opportunity planning'],                         'demo' => ['status' => 'available',         'evidence' => 'Badge catalogue and progress links resolved for the tested scope', 'extendableFrom' => 'partial'],
                                 'sectionScoped' => true],
        'events'             => ['area' => 'Events',                    'checks' => 'Event records and participant/response capability where exposed',                            'features' => ['Events & Camps projection'],                          'demo' => ['status' => 'available',         'evidence' => 'Event records readable; official response remains OSM-owned'],
                                 'sectionScoped' => true],
        'event_payments'     => ['area' => 'Event payments',            'checks' => 'Payment/status visibility where exposed',                                                   'features' => ['Parent/leader status projection only'],               'demo' => ['status' => 'permission_limited', 'evidence' => 'Payment capability appears to exist but the connected scope is not permitted to read it'],
                                 'sectionScoped' => true],
        'risk_assessments'   => ['area' => 'Risk assessments',         'checks' => 'Risk-assessment references/metadata or linked evidence capability',                         'features' => ['Activity Approval evidence reuse'],                   'demo' => ['status' => 'partial',           'evidence' => 'References/metadata readable but not full linked evidence'],
                                 'sectionScoped' => true],
        'custom_flexi'       => ['area' => 'Custom / Flexi data',      'checks' => 'Custom fields available to authorised scope',                                               'features' => ['Controlled operational enrichment'],                  'demo' => ['status' => 'unknown',           'evidence' => 'Custom/Flexi fields not probed in Safe mode'],
                                 'sectionScoped' => true],
        'quartermaster'      => ['area' => 'Quartermaster',            'checks' => 'Any OSM equipment/quartermaster capability exposed',                                        'features' => ['Migration/link decisions (avoid duplicate master)'],  'demo' => ['status' => 'unavailable',       'evidence' => 'The connected context exposes no equipment/quartermaster capability'],
                                 'sectionScoped' => false],
        'expenses_finance'   => ['area' => 'Expenses / finance',       'checks' => 'Any OSM finance/expense capability exposed',                                                'features' => ['Integration decision (do not assume write support)'], 'demo' => ['status' => 'unavailable',       'evidence' => 'The connected context exposes no finance/expense capability'],
                                 'sectionScoped' => false],
        'census_capacity'    => ['area' => 'Census / capacity',        'checks' => 'Census or membership-count capability where exposed',                                       'features' => ['Section health & capacity trends'],                   'demo' => ['status' => 'partial',           'evidence' => 'Aggregate counts available; full census breakdown not exposed to this scope'],
                                 'sectionScoped' => true],
        'audit_history'      => ['area' => 'Audit / history',          'checks' => 'Source audit/change metadata where exposed',                                                'features' => ['Sync diagnosis', 'Change attribution'],               'demo' => ['status' => 'unknown',           'evidence' => 'No source audit/history probe is configured for this connector yet'],
                                 'sectionScoped' => false],
        'rate_limits'        => ['area' => 'Rate limits / connector constraints', 'checks' => 'Observed/declared throttling, paging, error and version characteristics',                 'features' => ['Connector resilience', 'Scheduling'],                 'demo' => ['status' => 'available',         'evidence' => 'Connector paging and backoff characteristics observed within limits'],
                                 'sectionScoped' => false],
    ];
}

function osmdStatusLabel(string $s): string
{
    return [
        'available' => 'Available', 'partial' => 'Partial', 'permission_limited' => 'Permission limited',
        'unavailable' => 'Unavailable', 'unknown' => 'Unknown', 'error' => 'Error', 'not_tested' => 'Not tested',
    ][$s] ?? $s;
}

// Only Portal Administrators may run or view discovery (least privilege - discovery
// evidence is data-minimised but still integration-sensitive). FR-OSMD-002.
function osmdCanRun(array $user): bool { return ($user['portal_role'] ?? '') === 'admin'; }
function osmdCanView(array $user): bool { return ($user['portal_role'] ?? '') === 'admin'; }

// Build the non-secret discovery context: connection state and accessible sections.
// Never returns tokens or a bulk roster (spec s7 step 2, AC-330).
function osmdBuildContext(): array
{
    // In this build OSM /ext reads are blocked from the server IP, so live data reads are
    // sign-in-only. Whenever demo mode is allowed (including a configured-but-read-blocked
    // deployment with ALLOW_DEMO_MODE), discovery runs against the demo/evidence context:
    // real section identifiers from the section registry, evidence-based classification,
    // and no personal data. Only non-secret identifiers are ever returned.
    if (osmDemoModeAllowed()) {
        $sections = array_map(fn($s) => ['id' => $s['sectionid'], 'name' => $s['sectionname']], array_values(OSM_DEMO_SECTIONS));
        return ['account' => 'Demo OSM context (evidence mode)', 'sections' => $sections, 'connected' => true, 'authFresh' => true, 'demo' => true];
    }
    // Pure production with live reads: reflect real connection health so a pre-flight
    // outage/auth problem is detectable (AC-337). Sections would come from a supported
    // read contract; connection/auth state still drives pre-flight.
    $health = osmdConnectionHealth();
    return ['account' => 'Connected OSM context', 'sections' => [], 'connected' => $health['connected'], 'authFresh' => $health['authFresh'], 'demo' => false];
}

// Non-secret connection health for pre-flight. Demo/evidence mode is always healthy; a
// live-read connection is healthy only while a usable service read token is available.
function osmdConnectionHealth(): array
{
    if (osmDemoModeAllowed()) return ['connected' => true, 'authFresh' => true];
    if (function_exists('getServiceAccount') && function_exists('osmDataReadTokenFor')) {
        $svc = getServiceAccount();
        if ($svc) {
            $tok = osmDataReadTokenFor($svc);
            return ['connected' => empty($tok['unavailable']), 'authFresh' => empty($tok['unavailable'])];
        }
    }
    return ['connected' => osmIsConfigured(), 'authFresh' => true];
}

// Default probe provider. In the demo/evidence context it classifies each capability
// from the catalogue's representative evidence; Extended mode can lift a capability
// flagged with extendableFrom to Available. A real-OSM adapter would replace this with
// actual read probes while returning the identical shape.
function osmdDefaultProvider(string $capKey, array $ctx, string $mode): array
{
    $cat = osmdCatalogue();
    $entry = $cat[$capKey] ?? null;
    if (!$entry) return ['status' => 'unknown', 'scope' => [], 'evidence' => ['class' => 'no_probe', 'detail' => 'Unknown capability'], 'response_class' => 'excluded', 'duration_ms' => 0];
    $t0 = microtime(true);
    // On a LIVE connection (not the demo/evidence context) we must not assert the
    // catalogue's representative classifications as though a real read happened - no live
    // /ext read adapter is wired yet (and /ext reads are blocked from the server IP), so
    // there is no probe evidence. Report honestly: the established session proves identity
    // and connector characteristics; every capability that needs a live data read is
    // Unknown until a real probe exists (spec s6 - "no reliable probe/evidence"). This
    // keeps a live run from fabricating Available with no tested scope (AC-330/331/335).
    if (empty($ctx['demo'])) {
        $dur = max(1, (int) round((microtime(true) - $t0) * 1000));
        if ($capKey === 'identity_session') {
            return ['status' => 'available', 'scope' => [], 'evidence' => ['class' => 'ok', 'detail' => 'Connected identity and roles resolved from the live session context'], 'response_class' => 'ok', 'duration_ms' => $dur];
        }
        return ['status' => 'unknown', 'scope' => [], 'evidence' => ['class' => 'no_evidence', 'detail' => 'No live read probe is configured for this connector yet; discovery cannot confirm this capability from the connected context'], 'response_class' => 'no_evidence', 'duration_ms' => $dur];
    }
    $status = $entry['demo']['status'];
    $evidence = $entry['demo']['evidence'];
    // Extended read validation may resolve a Partial to Available where a representative
    // read is enough to confirm it (spec s4).
    if ($mode === 'extended' && ($entry['demo']['extendableFrom'] ?? null) === $status) {
        $status = 'available';
        $evidence = $evidence . ' (confirmed under extended read validation)';
    }
    $scope = ($entry['sectionScoped'] ?? false) && in_array($status, ['available', 'partial', 'permission_limited'], true)
        ? array_map(fn($s) => $s['name'], $ctx['sections'] ?? []) : [];
    $respClass = [
        'available' => 'ok', 'partial' => 'ok', 'permission_limited' => 'permission_denied',
        'unavailable' => 'not_exposed', 'unknown' => 'no_evidence', 'error' => 'error', 'not_tested' => 'excluded',
    ][$status] ?? 'ok';
    return [
        'status' => $status,
        'scope' => $scope,
        'evidence' => ['class' => $respClass, 'detail' => $evidence],
        'response_class' => $respClass,
        'duration_ms' => max(1, (int) round((microtime(true) - $t0) * 1000)),
    ];
}

// ── Live probe adapter (startup call + representative member read) ────────────
// OSM tolerates reads from the server with a real token: the startup payload
// (/ext/generic/startup/) carries the connected identity, the accessible sections (via
// roles) and per-section term metadata; and the contact grid (getMembers, per section +
// term) returns a roster we count without retaining any personal data. Everything else
// needs a further /ext read that is blocked, so it stays Unknown, never Unavailable.
//
// Which token: 'service' uses the shared service connection (parent-dashboard reader);
// 'me' uses the acting administrator's OWN OSM sign-in, so members light up for the
// sections that person is permitted to see. Using their own token broadens nothing -
// it is exactly the access they already hold in OSM (AC-318/344).
function osmdResolveToken(?array $actor, string $source): array
{
    if ($source === 'me') {
        if (!$actor || !function_exists('osmDataReadTokenFor')) return ['unavailable' => true];
        return osmDataReadTokenFor($actor);
    }
    $svc = function_exists('getServiceAccount') ? getServiceAccount() : null;
    return ($svc && function_exists('osmDataReadTokenFor')) ? osmDataReadTokenFor($svc) : ['unavailable' => true];
}

// Fetch + shape the startup payload with a specific token. Returns the same state shape
// osmdClassifyFromStartup consumes.
function osmdFetchStartupWith(?string $token): array
{
    if (!$token || $token === 'demo') return ['ok' => false, 'globals' => [], 'sections' => [], 'terms' => [], 'error' => 'no_live_token'];
    try {
        $g = osmGetStartupData($token)['data']['globals'] ?? [];
        $sections = [];
        $sectionTypes = [];
        foreach ((is_array($g['roles'] ?? null) ? $g['roles'] : []) as $r) {
            if (!empty($r['sectionid'])) {
                $sections[(string) $r['sectionid']] = $r['sectionname'] ?? ('Section ' . $r['sectionid']);
                $sectionTypes[(string) $r['sectionid']] = $r['section'] ?? null; // cubs/scouts/... - needed for badge reads
            }
        }
        return ['ok' => true, 'globals' => $g, 'sections' => $sections, 'sectionTypes' => $sectionTypes, 'terms' => is_array($g['terms'] ?? null) ? $g['terms'] : [], 'error' => null];
    } catch (Throwable $e) {
        return ['ok' => false, 'globals' => [], 'sections' => [], 'terms' => [], 'error' => 'probe_failed:' . osmdRedactMessage($e->getMessage())];
    }
}

// Read helpers normalised to {ok, count, blocked?, patrols?} so the gather loop is
// uniform and each real OSM read stays in one place. Counts only - no rows retained.
function osmdNormMembers(array $r): array
{
    if (empty($r['ok'])) return ['ok' => false, 'blocked' => !empty($r['blocked'])];
    $patrols = [];
    foreach (($r['members'] ?? []) as $m) { $p = $m['patrol'] ?? null; if ($p) $patrols[$p] = true; }
    return ['ok' => true, 'count' => (int) ($r['count'] ?? count($r['members'] ?? [])), 'patrols' => count($patrols)];
}
function osmdNormItems(array $r): array
{
    // osmGetSectionEvents / osmGetSectionProgramme return ['available'=>bool,'items'=>[...]].
    if (empty($r['available'])) return ['ok' => false];
    return ['ok' => true, 'count' => count($r['items'] ?? [])];
}
function osmdReadBadges(?string $token, ?string $type, string $sid, ?string $termId): array
{
    if (!$token || !$termId) return ['ok' => false];
    try {
        $resp = osmGet($token, '/ext/badges/records/', ['action' => 'getAvailableBadges', 'section' => $type, 'section_id' => $sid, 'term_id' => $termId, 'type_id' => '1', 'context' => 'none']);
        $data = $resp['data'] ?? [];
        return ['ok' => true, 'count' => is_array($data) ? count($data) : 0];
    } catch (Throwable $e) {
        return ['ok' => false];
    }
}

// One representative pass over the accessible sections that reads members, events,
// programme and badges - keeping ONLY counts (FR-OSMD-007, data minimisation). Safe mode
// samples the first few sections; Extended covers all. A blocked/throttled response stops
// the pass immediately so OSM is never hammered. $readers is injectable for testing; each
// returns the normalised {ok,count,...} shape.
function osmdLiveGather(?string $token, array $startup, string $mode = 'safe', array $readers = []): array
{
    $g = [
        'ran' => false, 'blocked' => false, 'sampled' => false,
        'members' => ['covered' => [], 'total' => 0, 'error' => false],
        'patrols' => ['covered' => [], 'total' => 0],
        'events' => ['covered' => [], 'total' => 0, 'error' => false],
        'programme' => ['covered' => [], 'total' => 0, 'error' => false],
        'badges' => ['covered' => [], 'total' => 0, 'error' => false],
    ];
    if (!$token || empty($startup['ok'])) return $g;
    $g['ran'] = true;
    $R = [
        'members' => $readers['members'] ?? fn($t, $s, $tm, $ty) => osmdNormMembers(osmGridMembers($t, $s, $tm)),
        'events' => $readers['events'] ?? fn($t, $s, $tm, $ty) => osmdNormItems(osmGetSectionEvents($t, $s)),
        'programme' => $readers['programme'] ?? fn($t, $s, $tm, $ty) => osmdNormItems(osmGetSectionProgramme($t, $s, $tm)),
        'badges' => $readers['badges'] ?? fn($t, $s, $tm, $ty) => osmdReadBadges($t, $ty, $s, $tm),
    ];
    $limit = $mode === 'extended' ? 100 : 3;
    $i = 0;
    foreach ($startup['sections'] as $sid => $name) {
        if ($i >= $limit) { $g['sampled'] = true; break; }
        $i++;
        $term = function_exists('osmCurrentTermFromData') ? osmCurrentTermFromData($startup['terms'], (string) $sid) : null;
        $termId = is_array($term) ? ($term['termId'] ?? null) : null;
        $type = $startup['sectionTypes'][(string) $sid] ?? null;
        foreach (['members', 'events', 'programme', 'badges'] as $cap) {
            if ($cap !== 'events' && !$termId) continue; // members/programme/badges need a term
            try {
                $r = $R[$cap]($token, (string) $sid, $termId, $type);
            } catch (Throwable $e) { $g[$cap]['error'] = true; continue; }
            if (!empty($r['blocked'])) { $g['blocked'] = true; break 2; } // stop hammering OSM
            if (!empty($r['ok'])) {
                $g[$cap]['covered'][] = $name;
                $g[$cap]['total'] += (int) ($r['count'] ?? 0);
                if ($cap === 'members' && !empty($r['patrols'])) { $g['patrols']['total'] += (int) $r['patrols']; $g['patrols']['covered'][] = $name; }
            } else {
                $g[$cap]['error'] = true;
            }
        }
    }
    return $g;
}

// Classify a live-read capability from the gathered aggregate. Counts and section scope
// only; a blocked read is Error, a missing token/term Unknown - never Unavailable (AC-332).
function osmdClassifyLive(string $cap, array $startup, array $g, string $mode = 'safe'): array
{
    $ev = fn($status, $scope, $class, $detail) => ['status' => $status, 'scope' => $scope, 'evidence' => ['class' => $class, 'detail' => $detail], 'response_class' => $class, 'duration_ms' => 1];
    if (empty($g['ran'])) {
        if (($startup['error'] ?? '') === 'no_live_token') return $ev('unknown', [], 'no_evidence', 'No live token available to probe this capability');
        if (!empty($startup['error'])) return $ev('error', [], 'error', 'Live read skipped after a failed startup probe');
        return $ev('unknown', [], 'no_evidence', 'Not probed');
    }
    $note = !empty($g['sampled']) ? ' (representative sample)' : '';
    $n = fn($cap2) => count($g[$cap2]['covered']);
    switch ($cap) {
        case 'members':
            if ($g['members']['covered']) return $ev('available', $g['members']['covered'], 'ok', $g['members']['total'] . ' member reference(s) across ' . $n('members') . ' section(s)' . $note . '; counts only, no names/DOB/contact/medical retained');
            if ($g['blocked']) return $ev('error', [], 'rate_limited', 'OSM blocked or throttled the member read; capability not confirmed');
            if ($g['members']['error']) return $ev('error', [], 'error', 'The member read failed; capability not confirmed');
            return $ev('unknown', [], 'no_evidence', 'No section with a current term was available to read members');
        case 'patrols':
            return $g['patrols']['covered']
                ? $ev('available', $g['patrols']['covered'], 'ok', $g['patrols']['total'] . ' patrol/six grouping(s) across ' . $n('patrols') . ' section(s)' . $note . '; counts only')
                : $ev('unknown', [], 'no_evidence', 'No patrol/six groupings were present in the member read');
        case 'events':
            if ($g['events']['covered']) return $ev('available', $g['events']['covered'], 'ok', $g['events']['total'] . ' event(s) readable across ' . $n('events') . ' section(s)' . $note);
            if ($g['blocked']) return $ev('error', [], 'rate_limited', 'OSM blocked or throttled the events read');
            if ($g['events']['error']) return $ev('error', [], 'error', 'The events read failed');
            return $ev('unknown', [], 'no_evidence', 'Events were not probed');
        case 'programme':
            if ($g['programme']['covered']) return $ev('available', $g['programme']['covered'], 'ok', $g['programme']['total'] . ' programme item(s) readable across ' . $n('programme') . ' section(s)' . $note);
            return osmdClassifyFromStartup($startup, 'programme', $mode); // fall back to term metadata (Partial)
        case 'badges':
            if ($g['badges']['covered']) return $ev('available', $g['badges']['covered'], 'ok', 'Badge catalogue readable across ' . $n('badges') . ' section(s)' . $note . ' (' . $g['badges']['total'] . ' badge records sampled)');
            if ($g['blocked']) return $ev('error', [], 'rate_limited', 'OSM blocked or throttled the badge read');
            if ($g['badges']['error']) return $ev('error', [], 'error', 'The badge read failed');
            return $ev('unknown', [], 'no_evidence', 'Badges were not probed');
        case 'census_capacity':
            return $g['members']['covered']
                ? $ev('partial', $g['members']['covered'], 'ok', 'Aggregate membership counts available (' . $g['members']['total'] . ' across ' . $n('members') . ' section(s))' . $note . '; full census breakdown not read')
                : $ev('unknown', [], 'no_evidence', 'No membership counts available to derive capacity');
    }
    return $ev('unknown', [], 'no_evidence', 'Not probed');
}

// Pure classifier: resolve one capability from an already-fetched startup state. Kept
// separate from the fetch so it is unit-testable with a synthetic payload.
function osmdClassifyFromStartup(array $s, string $capKey, string $mode = 'safe'): array
{
    $ev = fn($status, $scope, $class, $detail) => ['status' => $status, 'scope' => $scope, 'evidence' => ['class' => $class, 'detail' => $detail], 'response_class' => $class, 'duration_ms' => 1];
    if (!empty($s['error'])) {
        // No usable startup evidence. A missing token is "no live probe" (Unknown); a
        // failed call is an Error - never Unavailable merely because the probe failed.
        if ($s['error'] === 'no_live_token') return $ev('unknown', [], 'no_evidence', 'No live service connection is available to probe this capability');
        return $ev('error', [], 'error', 'OSM startup probe failed: ' . substr($s['error'], strlen('probe_failed:')));
    }
    $sectionNames = array_values($s['sections']);
    $hasIdentity = !empty($s['globals']['user_id']) || !empty($s['globals']['roles']);
    switch ($capKey) {
        case 'identity_session':
            return $hasIdentity
                ? $ev('available', [], 'ok', 'Connected identity and roles resolved from the OSM startup payload')
                : $ev('unknown', [], 'no_evidence', 'Startup payload carried no identity to confirm the session');
        case 'sections':
            return $sectionNames
                ? $ev('available', $sectionNames, 'ok', count($sectionNames) . ' accessible section(s) resolved from startup roles')
                : $ev('unknown', [], 'no_evidence', 'Startup payload exposed no accessible sections');
        case 'programme':
            // Startup carries per-section term metadata, which programme reads depend on.
            // That is real metadata evidence, but not a full programme-item read: Partial.
            $withTerm = [];
            foreach ($s['sections'] as $sid => $name) {
                if (function_exists('osmCurrentTermFromData') && osmCurrentTermFromData($s['terms'], (string) $sid)) $withTerm[] = $name;
            }
            return $withTerm
                ? $ev('partial', $withTerm, 'ok', 'Section and current-term metadata available from startup; full programme item read not performed')
                : $ev('unknown', [], 'no_evidence', 'No current-term metadata in startup to confirm programme access');
        case 'rate_limits':
            return $ev('available', [], 'ok', 'Startup call completed within connector limits');
        default:
            // Members, badges, events, attendance, patrols, parents, etc. all need a
            // dedicated /ext read the startup call does not provide (and which is blocked
            // from the server IP): honestly Unknown until a real probe exists (AC-332).
            return $ev('unknown', [], 'no_evidence', 'Not evidenced by the startup probe; a dedicated read is required and is not available from this connector yet');
    }
}

// The live provider used on a real connection. Resolves the chosen token once and fetches
// the startup payload once (shared across every capability in the run); classifies the
// metadata-derived capabilities from startup, and routes 'members' to a real (count-only)
// contact-grid read using the same token.
function osmdMakeLiveProvider(?array $actor = null, string $tokenSource = 'service'): callable
{
    $state = ['ready' => false, 'token' => null, 'startup' => null];
    $ensure = function () use (&$state, $actor, $tokenSource) {
        if ($state['ready']) return;
        $state['ready'] = true;
        $tok = osmdResolveToken($actor, $tokenSource);
        $state['token'] = (empty($tok['unavailable']) && !empty($tok['token']) && $tok['token'] !== 'demo') ? $tok['token'] : null;
        $state['startup'] = osmdFetchStartupWith($state['token']);
    };
    $liveCaps = ['members', 'patrols', 'events', 'programme', 'badges', 'census_capacity'];
    return function (string $capKey, array $ctx, string $mode) use (&$state, $ensure, $liveCaps) {
        $ensure();
        if (in_array($capKey, $liveCaps, true)) {
            if (!array_key_exists('gather', $state)) $state['gather'] = osmdLiveGather($state['token'], $state['startup'], $mode);
            return osmdClassifyLive($capKey, $state['startup'], $state['gather'], $mode);
        }
        return osmdClassifyFromStartup($state['startup'], $capKey, $mode);
    };
}

// Run a discovery. $onlyKeys limits to a targeted re-test; $provider is swappable so
// failure/outage paths are testable. Returns the run id. Enforces one full run per
// connection at a time (FR-OSMD-012 / AC-342). Pre-flight failures (no connection /
// auth) leave the prior registry intact and stale rather than overwriting it (AC-337).
function osmdRunDiscovery(array $actor, string $mode = 'safe', ?array $onlyKeys = null, ?callable $provider = null, ?array $ctxOverride = null, string $tokenSource = 'service'): int
{
    $isTargeted = $onlyKeys !== null;
    if (!$isTargeted && dbGet("SELECT 1 FROM osm_discovery_runs WHERE status = 'running'")) {
        throw new RuntimeException('A discovery run is already in progress for this connection.');
    }
    $ctx = $ctxOverride ?? osmdBuildContext();
    $ctx['readVia'] = $tokenSource; // 'service' | 'me' - recorded on the run for provenance (no token value stored)
    // Choose the default provider from the context: the live startup-based probe on a real
    // connection, the demo/evidence classifier in the demo/UAT context. An explicit
    // provider (tests) always wins.
    if ($provider === null) $provider = empty($ctx['demo']) ? osmdMakeLiveProvider($actor, $tokenSource) : 'osmdDefaultProvider';
    $runId = (int) dbRun(
        "INSERT INTO osm_discovery_runs (mode, status, actor_user_id, connector_version, context_json, scope_note, started_at) VALUES (?, 'running', ?, ?, ?, ?, datetime('now'))",
        [$isTargeted ? 'targeted' : $mode, $actor['id'] ?? null, OSMD_CONNECTOR_VERSION, json_encode($ctx), $isTargeted ? implode(',', $onlyKeys) : null]
    )['lastInsertId'];

    // Pre-flight (spec s7 step 1). No usable connection -> incomplete; prior registry is
    // preserved and marked stale, never overwritten to Unavailable.
    if (!$ctx['connected'] || !$ctx['authFresh']) {
        $reason = !$ctx['connected'] ? 'OSM connection unavailable' : 'OSM authentication expired';
        dbRun("UPDATE osm_discovery_runs SET status = 'incomplete', completed_at = datetime('now'), summary_json = ?, scope_note = ? WHERE id = ?",
            [json_encode(['incomplete' => true, 'reason' => $reason]), $reason, $runId]);
        logAudit(['userId' => $actor['id'] ?? null, 'action' => 'osm_discovery_incomplete', 'entityType' => 'osm_discovery_run', 'entityId' => (string) $runId, 'ipAddress' => clientIp(), 'details' => ['reason' => $reason]]);
        return $runId;
    }

    $keys = $isTargeted ? array_values(array_intersect($onlyKeys, array_keys(osmdCatalogue()))) : array_keys(osmdCatalogue());
    $counts = array_fill_keys(OSMD_STATUSES, 0);
    $hadError = false;
    foreach ($keys as $key) {
        try {
            $r = $provider($key, $ctx, $isTargeted ? 'targeted' : $mode);
        } catch (Throwable $e) {
            // A probe that should have worked but failed is Error, never Unavailable (AC-332).
            $r = ['status' => 'error', 'scope' => [], 'evidence' => ['class' => 'error', 'detail' => 'Probe failed: ' . osmdRedactMessage($e->getMessage())], 'response_class' => 'error', 'duration_ms' => 0];
        }
        $status = in_array($r['status'], OSMD_STATUSES, true) ? $r['status'] : 'unknown';
        if ($status === 'error') $hadError = true;
        $counts[$status] = ($counts[$status] ?? 0) + 1;
        dbRun("INSERT INTO osm_discovery_results (run_id, capability_key, status, scope_json, evidence_json, response_class, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [$runId, $key, $status, json_encode($r['scope'] ?? []), json_encode($r['evidence'] ?? []), $r['response_class'] ?? null, $r['duration_ms'] ?? null]);
    }

    // Compare against the previous completed run before this one is finalised.
    $prev = dbGet("SELECT id FROM osm_discovery_runs WHERE status IN ('complete') AND id < ? ORDER BY id DESC LIMIT 1", [$runId]);
    $changes = $prev ? osmdCompareRuns((int) $prev['id'], $runId) : ['baseline' => true];

    // A capability that was Available and is now lost is a material integration change:
    // surface it as an admin-visible audit signal. Dependent features fail safe because
    // their readiness is derived from the (now lower) status, never fabricated (AC-338).
    if (!empty($changes['lost'])) {
        logAudit(['userId' => $actor['id'] ?? null, 'action' => 'osm_discovery_capability_lost', 'entityType' => 'osm_discovery_run', 'entityId' => (string) $runId, 'ipAddress' => clientIp(), 'details' => ['lost' => $changes['lost']]]);
    }

    // Sections discovered: the pre-probe context may not enumerate them (live), so prefer
    // the scope resolved by the 'sections' capability probe, falling back to the context.
    $secResult = dbGet("SELECT scope_json FROM osm_discovery_results WHERE run_id = ? AND capability_key = 'sections'", [$runId]);
    $sectionsCount = $secResult ? count(json_decode($secResult['scope_json'] ?? '[]', true) ?: []) : count($ctx['sections'] ?? []);
    $summary = ['counts' => $counts, 'sections' => $sectionsCount, 'mode' => $isTargeted ? 'targeted' : $mode];
    dbRun("UPDATE osm_discovery_runs SET status = 'complete', completed_at = datetime('now'), summary_json = ?, changes_json = ? WHERE id = ?",
        [json_encode($summary), json_encode($changes), $runId]);

    // Update the current registry projection for the capabilities this run resolved.
    // A transient Error result never overwrites a prior definitive status to Unavailable -
    // it is stored as Error, distinct from Unavailable (AC-332/337).
    foreach (dbAll('SELECT * FROM osm_discovery_results WHERE run_id = ?', [$runId]) as $res) {
        dbRun("INSERT INTO osm_capability_registry (capability_key, status, scope_json, evidence_json, last_run_id, last_tested_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
               ON CONFLICT(capability_key) DO UPDATE SET status = excluded.status, scope_json = excluded.scope_json,
                 evidence_json = excluded.evidence_json, last_run_id = excluded.last_run_id, last_tested_at = excluded.last_tested_at, updated_at = datetime('now')",
            [$res['capability_key'], $res['status'], $res['scope_json'], $res['evidence_json'], $runId]);
    }

    logAudit(['userId' => $actor['id'] ?? null, 'action' => $isTargeted ? 'osm_discovery_retest' : 'osm_discovery_run', 'entityType' => 'osm_discovery_run', 'entityId' => (string) $runId, 'ipAddress' => clientIp(), 'details' => ['mode' => $isTargeted ? 'targeted' : $mode, 'capabilities' => count($keys), 'hadError' => $hadError]]);
    return $runId;
}

// Redact anything token/secret-shaped or that looks like personal data out of a probe
// diagnostic message before it is stored (FR-OSMD-007).
function osmdRedactMessage(string $msg): string
{
    $msg = preg_replace('/(token|secret|bearer|password|authorization)[=:\s][^\s]+/i', '$1 [redacted]', $msg);
    $msg = preg_replace('/[\w.+-]+@[\w.-]+\.\w+/', '[email redacted]', $msg);
    return mb_substr((string) $msg, 0, 200);
}

// Diff two completed runs by capability (spec s7 step 6, FR-OSMD-008).
function osmdCompareRuns(int $prevRunId, int $runId): array
{
    $load = fn($id) => array_column(dbAll('SELECT capability_key, status, scope_json FROM osm_discovery_results WHERE run_id = ?', [$id]), null, 'capability_key');
    $prev = $load($prevRunId);
    $curr = $load($runId);
    $newlyAvailable = $lost = $statusChanged = $scopeChanged = [];
    foreach ($curr as $key => $c) {
        $p = $prev[$key] ?? null;
        if (!$p) { if ($c['status'] === 'available') $newlyAvailable[] = $key; continue; }
        if ($p['status'] !== $c['status']) {
            if ($c['status'] === 'available' && $p['status'] !== 'available') $newlyAvailable[] = $key;
            elseif ($p['status'] === 'available' && $c['status'] !== 'available') $lost[] = $key;
            else $statusChanged[] = ['key' => $key, 'from' => $p['status'], 'to' => $c['status']];
        } elseif (($p['scope_json'] ?? '') !== ($c['scope_json'] ?? '')) {
            $scopeChanged[] = $key;
        }
    }
    return ['prevRunId' => $prevRunId, 'newlyAvailable' => $newlyAvailable, 'lost' => $lost, 'statusChanged' => $statusChanged, 'scopeChanged' => $scopeChanged];
}

// The current capability registry projection with dependent feature mapping and
// readiness (spec s11, FR-OSMD-009). Feature readiness NEVER enables a feature.
function osmdRegistry(): array
{
    $cat = osmdCatalogue();
    $reg = array_column(dbAll('SELECT * FROM osm_capability_registry'), null, 'capability_key');
    $out = [];
    foreach ($cat as $key => $entry) {
        $r = $reg[$key] ?? null;
        $status = $r['status'] ?? 'not_tested';
        $out[] = [
            'key' => $key,
            'area' => $entry['area'],
            'checks' => $entry['checks'],
            'status' => $status,
            'statusLabel' => osmdStatusLabel($status),
            'scope' => $r ? (json_decode($r['scope_json'] ?? '[]', true) ?: []) : [],
            'lastTestedAt' => $r['last_tested_at'] ?? null,
            'features' => $entry['features'],
            'readiness' => osmdFeatureReadinessFor($status),
        ];
    }
    return $out;
}

// A feature is Ready only when its capability is Available; otherwise it stays
// gated/partial/unavailable - discovery never turns it on (AC-341).
function osmdFeatureReadinessFor(string $status): string
{
    return match ($status) {
        'available' => 'ready',
        'partial' => 'partial',
        'permission_limited' => 'permission_gap',
        default => 'not_ready',
    };
}

// Permission-filtered export payload (FR-OSMD-015 / AC-336): capability status, scope,
// evidence class, timestamps and dependent features - no secrets, no bulk personal data.
function osmdExportRun(int $runId): ?array
{
    $run = dbGet('SELECT * FROM osm_discovery_runs WHERE id = ?', [$runId]);
    if (!$run) return null;
    $cat = osmdCatalogue();
    $results = array_map(function ($res) use ($cat) {
        $ev = json_decode($res['evidence_json'] ?? '{}', true) ?: [];
        return [
            'capability' => $res['capability_key'],
            'area' => $cat[$res['capability_key']]['area'] ?? $res['capability_key'],
            'status' => $res['status'],
            'scope' => json_decode($res['scope_json'] ?? '[]', true) ?: [],
            'evidenceClass' => $ev['class'] ?? null,
            'evidence' => $ev['detail'] ?? null,
            'testedAt' => $res['created_at'],
            'dependentFeatures' => $cat[$res['capability_key']]['features'] ?? [],
        ];
    }, dbAll('SELECT * FROM osm_discovery_results WHERE run_id = ? ORDER BY capability_key', [$runId]));
    return [
        'runId' => (int) $run['id'],
        'connectorVersion' => $run['connector_version'],
        'mode' => $run['mode'],
        'status' => $run['status'],
        'startedAt' => $run['started_at'],
        'completedAt' => $run['completed_at'],
        'context' => json_decode($run['context_json'] ?? '{}', true) ?: [],
        'summary' => json_decode($run['summary_json'] ?? '{}', true) ?: [],
        'capabilities' => $results,
        'note' => 'Read-only discovery evidence; no secrets or bulk personal data.',
    ];
}

function serializeOsmdRun(array $run): array
{
    return [
        'id' => (int) $run['id'],
        'mode' => $run['mode'],
        'status' => $run['status'],
        'connectorVersion' => $run['connector_version'],
        'context' => json_decode($run['context_json'] ?? '{}', true) ?: [],
        'summary' => json_decode($run['summary_json'] ?? '{}', true) ?: [],
        'changes' => json_decode($run['changes_json'] ?? '{}', true) ?: [],
        'scopeNote' => $run['scope_note'] ?? null,
        'startedAt' => $run['started_at'],
        'completedAt' => $run['completed_at'],
    ];
}

function serializeOsmdResult(array $res): array
{
    $cat = osmdCatalogue();
    return [
        'capability' => $res['capability_key'],
        'area' => $cat[$res['capability_key']]['area'] ?? $res['capability_key'],
        'status' => $res['status'],
        'statusLabel' => osmdStatusLabel($res['status']),
        'scope' => json_decode($res['scope_json'] ?? '[]', true) ?: [],
        'evidence' => json_decode($res['evidence_json'] ?? '{}', true) ?: [],
        'responseClass' => $res['response_class'] ?? null,
        'durationMs' => $res['duration_ms'] !== null ? (int) $res['duration_ms'] : null,
        'testedAt' => $res['created_at'],
    ];
}
