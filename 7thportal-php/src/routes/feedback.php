<?php
// Demo/UAT feedback capture (Test Environment pack DEMO-FB). Testers submit
// feedback from any page while in demo mode; admins review and export it.

const DEMO_FB_CATEGORIES = ['feedback' => 'Feedback', 'defect' => 'Defect', 'question' => 'Question', 'enhancement' => 'Enhancement'];

// Submit feedback (any authenticated user - demo personas are logged in).
$router->post('/api/feedback', function ($params) {
    $user = requireAuth();
    $b = requestBody();
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'Please add a comment.'], 422);
    $category = isset(DEMO_FB_CATEGORIES[$b['category'] ?? '']) ? $b['category'] : 'feedback';
    $rating = isset($b['rating']) && is_numeric($b['rating']) ? max(1, min(5, (int) $b['rating'])) : null;
    $device = in_array($b['device'] ?? '', ['mobile', 'tablet', 'desktop'], true) ? $b['device'] : null;
    $persona = trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')) . ' (' . ($user['portal_role'] ?? '') . ')';
    dbRun('INSERT INTO demo_feedback (user_id, persona, page, device, rating, category, comment) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$user['id'], $persona, mb_substr(trim((string) ($b['page'] ?? '')), 0, 120), $device, $rating, $category, mb_substr($comment, 0, 2000)]);
    logAudit(['userId' => $user['id'], 'action' => 'demo_feedback_submit', 'ipAddress' => clientIp(), 'details' => ['category' => $category]]);
    jsonResponse(['ok' => true], 201);
});

// Admin: list recent feedback.
$router->get('/api/admin/feedback', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $rows = dbAll('SELECT * FROM demo_feedback ORDER BY id DESC LIMIT 500');
    jsonResponse([
        'categories' => DEMO_FB_CATEGORIES,
        'feedback' => array_map(fn($r) => [
            'id' => (int) $r['id'], 'persona' => $r['persona'], 'page' => $r['page'], 'device' => $r['device'],
            'rating' => $r['rating'] !== null ? (int) $r['rating'] : null,
            'category' => $r['category'], 'categoryLabel' => DEMO_FB_CATEGORIES[$r['category']] ?? $r['category'],
            'comment' => $r['comment'], 'createdAt' => $r['created_at'],
        ], $rows),
    ]);
});

// Admin: export feedback to CSV.
$router->get('/api/admin/feedback/export.csv', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $out = fopen('php://temp', 'r+');
    fputcsv($out, ['When', 'Persona', 'Category', 'Rating', 'Device', 'Page', 'Comment']);
    foreach (dbAll('SELECT * FROM demo_feedback ORDER BY id DESC') as $r) {
        fputcsv($out, [$r['created_at'], $r['persona'], DEMO_FB_CATEGORIES[$r['category']] ?? $r['category'], $r['rating'], $r['device'], $r['page'], $r['comment']]);
    }
    rewind($out);
    $csv = stream_get_contents($out);
    fclose($out);
    logAudit(['userId' => $user['id'], 'action' => 'demo_feedback_export', 'ipAddress' => clientIp()]);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="7thportal-demo-feedback.csv"');
    echo "\xEF\xBB\xBF" . $csv;
    exit;
});
