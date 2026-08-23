<?php
// Global search (v1, leader-only): a quick permission-aware find across the
// operational entities a leader can already reach. Only ENABLED modules are
// searched, so a result can never surface from a module that's turned off, and
// each category reuses that module's own visibility rules (published-only notices/
// documents, the leader's own claims, etc.). Parents get 403 - a parent-safe search
// is a later increment.
$router->get('/api/search', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    $q = trim((string) queryParam('q'));
    if (mb_strlen($q) < 2) {
        jsonResponse(['q' => $q, 'results' => [], 'total' => 0]);
    }
    $like = '%' . $q . '%';
    $results = [];
    $add = function (string $type, string $typeLabel, string $label, string $sublabel, string $link) use (&$results) {
        $results[] = ['type' => $type, 'typeLabel' => $typeLabel, 'label' => $label, 'sublabel' => $sublabel, 'link' => $link];
    };

    if (eventHubEnabled()) {
        foreach (dbAll("SELECT id, title, event_type, section_name, location, start_date FROM event_hubs WHERE title LIKE ? OR location LIKE ? OR section_name LIKE ? ORDER BY (status = 'published') DESC, start_date DESC LIMIT 5", [$like, $like, $like]) as $r) {
            $sub = (EVENT_TYPES[$r['event_type']] ?? 'Event') . ($r['start_date'] ? ' · ' . $r['start_date'] : '') . ($r['location'] ? ' · ' . $r['location'] : '');
            $add('event', 'Events & camps', $r['title'], $sub, 'event-hub.html?id=' . $r['id']);
        }
    }
    if (equipmentRegisterEnabled()) {
        foreach (dbAll("SELECT id, name, category, location, owner_name FROM equipment_assets WHERE name LIKE ? OR category LIKE ? OR location LIKE ? OR owner_name LIKE ? ORDER BY name LIMIT 5", [$like, $like, $like, $like]) as $r) {
            $sub = ucfirst($r['category']) . ($r['location'] ? ' · ' . $r['location'] : '');
            $add('equipment', 'Equipment', $r['name'], $sub, 'equipment.html');
        }
    }
    if (documentLibraryEnabled()) {
        // Published documents any leader can see, plus the leader's own drafts.
        foreach (dbAll("SELECT id, title, category, status FROM documents WHERE title LIKE ? AND (status = 'published' OR created_by = ?) ORDER BY title LIMIT 5", [$like, $user['id']]) as $r) {
            $add('document', 'Documents', $r['title'], ucfirst($r['category']) . ($r['status'] === 'draft' ? ' · draft' : ''), 'documents.html');
        }
    }
    // Published notices (leaders have broad notice visibility).
    foreach (dbAll("SELECT id, title, section_name FROM notices WHERE status = 'published' AND (title LIKE ? OR body LIKE ?) ORDER BY start_date DESC LIMIT 5", [$like, $like]) as $r) {
        $add('notice', 'Notices', $r['title'], $r['section_name'] ?: 'All', 'notices.html');
    }
    // Sections from the central directory.
    foreach (dbAll("SELECT osm_section_id, section_name, section_type FROM osm_sections WHERE section_name LIKE ? ORDER BY section_name LIMIT 5", [$like]) as $r) {
        $add('section', 'Sections', $r['section_name'], ucfirst((string) ($r['section_type'] ?? '')), 'section.html?id=' . rawurlencode($r['osm_section_id']));
    }
    if (financeEnabled()) {
        // Only the searcher's OWN claims - never anyone else's.
        foreach (dbAll("SELECT id, claim_number, title, status FROM expense_claims WHERE claimant_user_id = ? AND (claim_number LIKE ? OR title LIKE ?) ORDER BY id DESC LIMIT 5", [$user['id'], $like, $like]) as $r) {
            $add('claim', 'My claims', $r['claim_number'] . ' — ' . $r['title'], ucfirst(str_replace('_', ' ', $r['status'])), 'claim-edit.html?id=' . $r['id']);
        }
    }

    logAudit(['userId' => $user['id'], 'action' => 'search', 'ipAddress' => clientIp(), 'details' => ['q' => $q, 'results' => count($results)]]);
    jsonResponse(['q' => $q, 'results' => $results, 'total' => count($results)]);
});
