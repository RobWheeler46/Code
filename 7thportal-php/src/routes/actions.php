<?php
// Action Centre API (FRD FR-ACT). Every action links to the module page that
// resolves it (FR-ACT-004); dismissal is only allowed for dismissible items.

$router->get('/api/actions', function ($params) {
    $user = requireAuth();
    $items = buildActionCentre($user);
    jsonResponse(['items' => $items, 'summary' => actionCentreSummary($items)]);
});

$router->post('/api/actions/dismiss', function ($params) {
    $user = requireAuth();
    $key = requestBody()['key'] ?? '';
    if ($key === '') jsonResponse(['error' => 'An action key is required.'], 400);
    $item = null;
    foreach (buildActionCentre($user) as $i) { if ($i['key'] === $key) { $item = $i; break; } }
    if (!$item) jsonResponse(['error' => 'Action not found or already resolved.'], 404);
    if (!$item['dismissible']) jsonResponse(['error' => 'This action cannot be dismissed - resolve it from its module page.'], 400);
    dbRun('INSERT OR IGNORE INTO dismissed_actions (user_id, action_key) VALUES (?, ?)', [$user['id'], $key]);
    logAudit(['userId' => $user['id'], 'action' => 'action_dismissed', 'entityType' => 'action', 'entityId' => $key, 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
