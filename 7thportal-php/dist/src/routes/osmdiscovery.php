<?php
// OSM Discovery & Capability Registry routes (Master FRD v3.4, OSM Discovery spec v1.0,
// FR-OSMD-001..018 / AC-329..344). Every route is Portal-Administrator only; a
// non-admin gets a flat 403 and can infer nothing about capabilities or sections
// (AC-344). Discovery is read-only and never enables a feature or broadens access.

function requireDiscoveryView(): array
{
    $user = requireAuth();
    if (!osmdCanView($user)) jsonResponse(['error' => 'You do not have permission to view OSM discovery.'], 403);
    return $user;
}
function requireDiscoveryRun(): array
{
    $user = requireAuth();
    if (!osmdCanRun($user)) jsonResponse(['error' => 'You do not have permission to run OSM discovery.'], 403);
    return $user;
}

// Discovery summary: current registry, last completed run, changes and integration
// health (FR-OSMD-001/008/014). Also the entry point's health projection.
$router->get('/api/osm/discovery', function ($params) {
    requireDiscoveryView();
    // Summary counts/changes come from the last full run; the registry projection below
    // already reflects any targeted re-tests since then (a targeted run covers one
    // capability, so it must not become the whole-picture "last run").
    $last = dbGet("SELECT * FROM osm_discovery_runs WHERE status = 'complete' AND mode != 'targeted' ORDER BY id DESC LIMIT 1");
    $latestAny = dbGet("SELECT * FROM osm_discovery_runs ORDER BY id DESC LIMIT 1");
    $running = dbGet("SELECT 1 FROM osm_discovery_runs WHERE status = 'running'") ? true : false;
    // Registry is stale if the most recent run did not complete (e.g. outage/auth).
    $stale = $latestAny && $latestAny['status'] !== 'complete' && !$running;
    jsonResponse([
        'connectorVersion' => OSMD_CONNECTOR_VERSION,
        'context' => osmdBuildContext(),
        'lastRun' => $last ? serializeOsmdRun($last) : null,
        'latestRun' => $latestAny ? serializeOsmdRun($latestAny) : null,
        'running' => $running,
        'stale' => $stale,
        'registry' => osmdRegistry(),
        'statuses' => array_map(fn($s) => ['key' => $s, 'label' => osmdStatusLabel($s)], OSMD_STATUSES),
    ]);
});

// Start a discovery run (FR-OSMD-002/012). Body: { mode: 'safe' | 'extended' }.
$router->post('/api/osm/discovery/runs', function ($params) {
    $user = requireDiscoveryRun();
    $b = requestBody();
    $mode = in_array($b['mode'] ?? 'safe', ['safe', 'extended'], true) ? $b['mode'] : 'safe';
    try {
        $runId = osmdRunDiscovery($user, $mode);
    } catch (RuntimeException $e) {
        jsonResponse(['error' => $e->getMessage()], 409);
    }
    $run = dbGet('SELECT * FROM osm_discovery_runs WHERE id = ?', [$runId]);
    jsonResponse(['run' => serializeOsmdRun($run)], 201);
});

$router->get('/api/osm/discovery/runs', function ($params) {
    requireDiscoveryView();
    jsonResponse(['runs' => array_map('serializeOsmdRun', dbAll('SELECT * FROM osm_discovery_runs ORDER BY id DESC LIMIT 50'))]);
});

$router->get('/api/osm/discovery/runs/:id', function ($params) {
    requireDiscoveryView();
    $run = dbGet('SELECT * FROM osm_discovery_runs WHERE id = ?', [(int) $params['id']]);
    if (!$run) jsonResponse(['error' => 'Discovery run not found.'], 404);
    $results = array_map('serializeOsmdResult', dbAll('SELECT * FROM osm_discovery_results WHERE run_id = ? ORDER BY capability_key', [(int) $run['id']]));
    // Attach dependent-feature mapping to each result (spec s9 "Feature map").
    $cat = osmdCatalogue();
    foreach ($results as &$r) $r['features'] = $cat[$r['capability']]['features'] ?? [];
    unset($r);
    jsonResponse(['run' => serializeOsmdRun($run), 'results' => $results]);
});

// Cancel an in-progress run (spec s13). Completed probe results stay attributable but
// the run becomes Incomplete.
$router->post('/api/osm/discovery/runs/:id/cancel', function ($params) {
    $user = requireDiscoveryRun();
    $run = dbGet('SELECT * FROM osm_discovery_runs WHERE id = ?', [(int) $params['id']]);
    if (!$run) jsonResponse(['error' => 'Discovery run not found.'], 404);
    if ($run['status'] !== 'running') jsonResponse(['error' => 'Only a running discovery can be cancelled.'], 409);
    dbRun("UPDATE osm_discovery_runs SET status = 'incomplete', completed_at = datetime('now'), scope_note = 'Cancelled by administrator' WHERE id = ?", [(int) $run['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'osm_discovery_cancel', 'entityType' => 'osm_discovery_run', 'entityId' => (string) $run['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// Capability detail + run history + dependent features + admin notes (spec s10).
$router->get('/api/osm/discovery/capabilities/:key', function ($params) {
    requireDiscoveryView();
    $cat = osmdCatalogue();
    $key = $params['key'];
    if (!isset($cat[$key])) jsonResponse(['error' => 'Unknown capability.'], 404);
    $entry = $cat[$key];
    $reg = dbGet('SELECT * FROM osm_capability_registry WHERE capability_key = ?', [$key]);
    $history = array_map(function ($res) {
        return [
            'runId' => (int) $res['run_id'],
            'status' => $res['status'],
            'statusLabel' => osmdStatusLabel($res['status']),
            'scope' => json_decode($res['scope_json'] ?? '[]', true) ?: [],
            'testedAt' => $res['created_at'],
        ];
    }, dbAll('SELECT r.*, run.completed_at FROM osm_discovery_results r JOIN osm_discovery_runs run ON run.id = r.run_id WHERE r.capability_key = ? ORDER BY r.run_id DESC LIMIT 30', [$key]));
    $notes = array_map(fn($n) => [
        'id' => (int) $n['id'],
        'note' => $n['note'],
        'author' => trim((string) (($n['first_name'] ?? '') . ' ' . ($n['last_name'] ?? ''))) ?: 'Administrator',
        'createdAt' => $n['created_at'],
    ], dbAll('SELECT n.*, u.first_name, u.last_name FROM osm_capability_notes n LEFT JOIN users u ON u.id = n.actor_user_id WHERE n.capability_key = ? ORDER BY n.id DESC', [$key]));
    $status = $reg['status'] ?? 'not_tested';
    jsonResponse([
        'key' => $key,
        'area' => $entry['area'],
        'checks' => $entry['checks'],
        'status' => $status,
        'statusLabel' => osmdStatusLabel($status),
        'scope' => $reg ? (json_decode($reg['scope_json'] ?? '[]', true) ?: []) : [],
        'evidence' => $reg ? (json_decode($reg['evidence_json'] ?? '{}', true) ?: []) : [],
        'lastTestedAt' => $reg['last_tested_at'] ?? null,
        'features' => $entry['features'],
        'readiness' => osmdFeatureReadinessFor($status),
        'history' => $history,
        'notes' => $notes,
    ]);
});

// Targeted re-test of one capability (FR-OSMD-010 / AC-334) - updates the projection and
// adds history without touching unrelated capabilities.
$router->post('/api/osm/discovery/capabilities/:key/retest', function ($params) {
    $user = requireDiscoveryRun();
    $cat = osmdCatalogue();
    $key = $params['key'];
    if (!isset($cat[$key])) jsonResponse(['error' => 'Unknown capability.'], 404);
    $b = requestBody();
    $mode = in_array($b['mode'] ?? 'safe', ['safe', 'extended'], true) ? $b['mode'] : 'safe';
    $runId = osmdRunDiscovery($user, $mode, [$key]);
    $reg = dbGet('SELECT * FROM osm_capability_registry WHERE capability_key = ?', [$key]);
    jsonResponse(['ok' => true, 'runId' => $runId, 'status' => $reg['status'] ?? 'unknown'], 201);
});

// Attach an append-only admin note (FR-OSMD-017 / AC-343). Never edits probe evidence.
$router->post('/api/osm/discovery/capabilities/:key/notes', function ($params) {
    $user = requireDiscoveryRun();
    $cat = osmdCatalogue();
    $key = $params['key'];
    if (!isset($cat[$key])) jsonResponse(['error' => 'Unknown capability.'], 404);
    $note = trim((string) (requestBody()['note'] ?? ''));
    if ($note === '') jsonResponse(['error' => 'A note is required.'], 422);
    $id = (int) dbRun('INSERT INTO osm_capability_notes (capability_key, actor_user_id, note) VALUES (?, ?, ?)', [$key, $user['id'], mb_substr($note, 0, 1000)])['lastInsertId'];
    logAudit(['userId' => $user['id'], 'action' => 'osm_capability_note', 'entityType' => 'osm_capability', 'entityId' => $key, 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true, 'id' => $id], 201);
});

// Permission-filtered export (FR-OSMD-015 / AC-336).
$router->get('/api/osm/discovery/export', function ($params) {
    requireDiscoveryView();
    $runId = (int) (queryParam('runId') ?: 0);
    if (!$runId) {
        // Default to the latest full run so an export is the whole picture, not a
        // single-capability targeted re-test.
        $last = dbGet("SELECT id FROM osm_discovery_runs WHERE status = 'complete' AND mode != 'targeted' ORDER BY id DESC LIMIT 1");
        $runId = $last ? (int) $last['id'] : 0;
    }
    $export = $runId ? osmdExportRun($runId) : null;
    if (!$export) jsonResponse(['error' => 'No completed discovery run to export.'], 404);
    jsonResponse($export);
});
