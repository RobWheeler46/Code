<?php
// Badges Awarded summary (per section). A Tier A feature: it holds and shows only
// aggregate counts - how many badges are awarded/completed per section, broken down by
// badge type - never any individual member's name or progress (see
// DECISIONS-osm-integration.md, item 2). The counts are read from OSM by an
// admin-triggered, paced refresh and mirrored into osm_badge_summary; every viewer reads
// the mirror, so a page load never calls OSM (the rate-limit-safe pattern from item 1).

// Any leader/leadership/trustee role may VIEW the summary - it is aggregate structure
// data, useful across the leadership team and safe for trustees (Tier A). Only a Portal
// Administrator may trigger a REFRESH, since a refresh spends OSM rate-limit budget
// (mirrors who may run OSM Discovery).
function osmBadgesCanView(array $user): bool { return userHasLeaderAccess($user); }
function osmBadgesCanRefresh(array $user): bool { return isAdminRole($user['portal_role'] ?? ''); }

// Deterministic per-section demo summary, computed from the same demo fixtures the rest
// of the app uses, so the screen is fully populated and clickable without a live OSM
// connection. A completed demo badge counts as both completed and awarded.
function osmBadgesDemoSummary(string $sectionId): array
{
    $members = OSM_DEMO_MEMBERS[$sectionId] ?? [];
    $byType = [];
    foreach (OSM_BADGE_TYPE_NAMES as $tn) $byType[$tn] = ['awarded' => 0, 'completed' => 0, 'badges' => 0];
    $seen = [];
    foreach ($members as $m) {
        foreach (OSM_DEMO_BADGES[$m['id']] ?? [] as $b) {
            $type = $b['type'] ?? 'Activity';
            if (!isset($byType[$type])) $byType[$type] = ['awarded' => 0, 'completed' => 0, 'badges' => 0];
            $seen[$type . '|' . ($b['badgeName'] ?? '')] = true;
            if (!empty($b['completed'])) { $byType[$type]['awarded']++; $byType[$type]['completed']++; }
        }
    }
    foreach ($byType as $t => &$v) {
        $v['badges'] = count(array_filter(array_keys($seen), fn($k) => str_starts_with($k, $t . '|')));
    }
    unset($v);
    return [
        'available' => true, 'termId' => OSM_DEMO_TERM['termid'], 'byType' => $byType,
        'totalAwarded' => array_sum(array_column($byType, 'awarded')),
        'totalCompleted' => array_sum(array_column($byType, 'completed')),
        'badgeCount' => array_sum(array_column($byType, 'badges')),
        'awardFieldSeen' => true,
    ];
}

// Write (or replace) one section's row. A section that failed mid-refresh is NOT passed
// here - it keeps its previous row untouched, so the mirror is never half-wiped.
function osmBadgesUpsert(array $sec, ?string $termId, ?string $termName, array $sum, string $status, string $source, array $actor): void
{
    dbRun(
        "INSERT INTO osm_badge_summary
           (section_id, section_name, term_id, term_name, total_awarded, total_completed, by_type_json, badge_count, status, source, synced_at, synced_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
         ON CONFLICT(section_id) DO UPDATE SET
           section_name = excluded.section_name, term_id = excluded.term_id, term_name = excluded.term_name,
           total_awarded = excluded.total_awarded, total_completed = excluded.total_completed,
           by_type_json = excluded.by_type_json, badge_count = excluded.badge_count,
           status = excluded.status, source = excluded.source, synced_at = excluded.synced_at, synced_by = excluded.synced_by",
        [
            $sec['id'], $sec['name'], $termId, $termName,
            (int) ($sum['totalAwarded'] ?? 0), (int) ($sum['totalCompleted'] ?? 0),
            json_encode($sum['byType'] ?? []), (int) ($sum['badgeCount'] ?? 0),
            $status, $source, (int) $actor['id'],
        ]
    );
}

// Admin-triggered refresh. Resolves the sections and current term from the OSM startup
// context (via the service connection, or demo fixtures), then reads each section's
// aggregate badge counts, pacing between sections. A throttle (HTTP 429/503) stops the
// pass immediately and leaves already-synced and untouched sections intact; a single
// section's read error is counted and skipped without wiping its previous row.
// $opts['readers']['summary'] is injectable so the pass can be unit-tested offline.
function osmBadgesRefresh(array $actor, array $opts = []): array
{
    if (!osmBadgesCanRefresh($actor)) throw new RuntimeException('You do not have permission to refresh the badges summary.');
    $demo = osmDemoModeAllowed();
    $source = $demo ? 'demo' : 'live';
    $sections = [];
    $termsBy = [];
    $token = 'demo'; // real service token resolved below on a live connection

    if ($demo) {
        foreach (OSM_DEMO_SECTIONS as $sid => $s) {
            $sections[] = ['id' => (string) $sid, 'name' => $s['sectionname'], 'type' => $s['section']];
        }
    } else {
        $svc = function_exists('getServiceAccount') ? getServiceAccount() : null;
        $tok = $svc ? osmDataReadTokenFor($svc) : ['unavailable' => true];
        if (!empty($tok['unavailable'])) throw new RuntimeException($tok['reason'] ?? 'No OSM service connection is available to read from.');
        $token = $tok['token'];
        $startup = osmdFetchStartupWith($token);
        if (empty($startup['ok'])) throw new RuntimeException('Could not read the OSM startup context to list sections.');
        foreach (($startup['sections'] ?? []) as $sid => $name) {
            $sections[] = ['id' => (string) $sid, 'name' => $name, 'type' => $startup['sectionTypes'][$sid] ?? null];
        }
        $termsBy = $startup['terms'] ?? [];
    }

    $read = $opts['readers']['summary'] ?? function (string $sid, ?string $type, ?string $termId) use ($demo, $token) {
        return $demo ? osmBadgesDemoSummary($sid) : osmGetSectionBadgeSummary($token, $type, $sid, $termId);
    };

    $out = ['source' => $source, 'sections' => count($sections), 'synced' => 0, 'errors' => 0, 'blocked' => 0, 'needsVerification' => 0, 'partial' => false];
    $n = count($sections);
    foreach ($sections as $i => $sec) {
        if ($demo) { $termId = OSM_DEMO_TERM['termid']; $termName = OSM_DEMO_TERM['name']; }
        else {
            $t = osmCurrentTermFromData($termsBy, $sec['id']);
            $termId = $t['termId'] ?? null;
            $termName = $t['name'] ?? null;
        }
        try {
            $sum = $read($sec['id'], $sec['type'], $termId);
        } catch (Throwable $e) {
            if (preg_match('/error (429|503)/', $e->getMessage())) { $out['blocked']++; $out['partial'] = true; break; }
            $out['errors']++;
            continue; // keep the section's previous row
        }
        if (empty($sum['available'])) {
            if (($sum['reason'] ?? '') === 'no_term') {
                osmBadgesUpsert($sec, $termId, $termName, ['byType' => [], 'totalAwarded' => 0, 'totalCompleted' => 0, 'badgeCount' => 0], 'empty', $source, $actor);
            } else {
                $out['errors']++;
            }
            continue;
        }
        $status = !empty($sum['awardFieldSeen']) ? 'ok' : 'needs_verification';
        if ($status === 'needs_verification') $out['needsVerification']++;
        osmBadgesUpsert($sec, $sum['termId'] ?? $termId, $termName, $sum, $status, $source, $actor);
        $out['synced']++;
        if (!$demo && $i < $n - 1) usleep(300000); // pace live reads under the throttle
    }

    if (function_exists('logAudit')) {
        logAudit(['userId' => $actor['id'], 'action' => 'osm_badges_refresh', 'entityType' => 'osm_badge_summary', 'entityId' => $source, 'ipAddress' => function_exists('clientIp') ? clientIp() : null]);
    }
    return $out;
}

// One-section diagnostic: read the real getAvailableBadges response for the first
// accessible section and report its SHAPE (top-level keys, how many badge rows were
// found, and one sample row's field names and scalar values) so the aggregate award/
// completed fields can be mapped from real evidence rather than guessed. Reads only the
// badge catalogue for a single section (four calls) - no member data, no throttle risk.
function osmBadgesDiagnose(array $actor): array
{
    if (!osmBadgesCanRefresh($actor)) throw new RuntimeException('You do not have permission to run the badge diagnostic.');
    if (osmDemoModeAllowed()) throw new RuntimeException('This is running in demo mode, so there is no live OSM response to inspect. Deploy to the live server and run it there.');
    $svc = function_exists('getServiceAccount') ? getServiceAccount() : null;
    $tok = $svc ? osmDataReadTokenFor($svc) : ['unavailable' => true];
    if (!empty($tok['unavailable'])) throw new RuntimeException($tok['reason'] ?? 'No OSM service connection is available to read from.');
    $token = $tok['token'];
    $startup = osmdFetchStartupWith($token);
    if (empty($startup['ok']) || empty($startup['sections'])) throw new RuntimeException('Could not read any sections from the OSM startup context.');
    $sid = (string) array_key_first($startup['sections']);
    $type = $startup['sectionTypes'][$sid] ?? null;
    $termId = osmCurrentTermIdForSection($token, $sid);
    $out = ['section' => $startup['sections'][$sid], 'sectionId' => $sid, 'sectionType' => $type, 'termId' => $termId, 'byType' => []];
    foreach (OSM_BADGE_TYPE_NAMES as $typeId => $typeName) {
        try {
            $resp = osmGet($token, '/ext/badges/records/', ['action' => 'getAvailableBadges', 'section' => $type, 'section_id' => $sid, 'term_id' => $termId, 'type_id' => (string) $typeId, 'context' => 'none']);
        } catch (Throwable $e) {
            $out['byType'][$typeName] = ['error' => function_exists('osmdRedactMessage') ? osmdRedactMessage($e->getMessage()) : 'read failed'];
            continue;
        }
        $rows = osmBadgeExtractRows($resp);
        $sample = $rows[0] ?? null;
        $out['byType'][$typeName] = [
            'topLevelType' => array_is_list($resp) ? 'list' : 'object',
            'topLevelKeys' => array_is_list($resp) ? [] : array_slice(array_keys($resp), 0, 25),
            'rowsFound' => count($rows),
            'sampleKeys' => $sample ? array_keys($sample) : [],
            'sample' => $sample ? array_map(fn($v) => is_scalar($v) ? $v : ('[' . gettype($v) . ']'), $sample) : null,
        ];
    }
    if (function_exists('logAudit')) {
        logAudit(['userId' => $actor['id'], 'action' => 'osm_badges_diagnose', 'entityType' => 'osm_badge_summary', 'entityId' => $sid, 'ipAddress' => function_exists('clientIp') ? clientIp() : null]);
    }
    return $out;
}

// The mirror, shaped for the screen: per-section rows, group totals, per-type totals,
// and metadata (when it was last synced, whether any section needs a shape check).
function osmBadgesSummaryData(): array
{
    $rows = dbAll('SELECT * FROM osm_badge_summary ORDER BY section_name');
    $sections = [];
    $totals = ['awarded' => 0, 'completed' => 0, 'badges' => 0];
    $byType = [];
    $lastSynced = null;
    $source = null;
    $needsVerification = false;
    foreach ($rows as $r) {
        $bt = json_decode($r['by_type_json'] ?? '{}', true) ?: [];
        $sections[] = [
            'sectionId' => $r['section_id'], 'sectionName' => $r['section_name'],
            'term' => $r['term_name'], 'termId' => $r['term_id'],
            'totalAwarded' => (int) $r['total_awarded'], 'totalCompleted' => (int) $r['total_completed'],
            'badgeCount' => (int) $r['badge_count'], 'byType' => $bt,
            'status' => $r['status'], 'source' => $r['source'], 'syncedAt' => $r['synced_at'],
        ];
        $totals['awarded'] += (int) $r['total_awarded'];
        $totals['completed'] += (int) $r['total_completed'];
        $totals['badges'] += (int) $r['badge_count'];
        foreach ($bt as $t => $v) {
            $byType[$t]['awarded'] = ($byType[$t]['awarded'] ?? 0) + (int) ($v['awarded'] ?? 0);
            $byType[$t]['completed'] = ($byType[$t]['completed'] ?? 0) + (int) ($v['completed'] ?? 0);
            $byType[$t]['badges'] = ($byType[$t]['badges'] ?? 0) + (int) ($v['badges'] ?? 0);
        }
        if (!$lastSynced || $r['synced_at'] > $lastSynced) { $lastSynced = $r['synced_at']; $source = $r['source']; }
        if ($r['status'] === 'needs_verification') $needsVerification = true;
    }
    return [
        'sections' => $sections, 'totals' => $totals, 'byType' => $byType,
        'typeOrder' => array_values(OSM_BADGE_TYPE_NAMES),
        'lastSynced' => $lastSynced, 'source' => $source, 'needsVerification' => $needsVerification,
    ];
}
