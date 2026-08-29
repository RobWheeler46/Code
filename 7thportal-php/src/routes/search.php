<?php
// Global search (v2): a permission-aware find that adapts to the searcher's role.
// Only ENABLED modules are searched, so a result can never surface from a module
// that's turned off, and each category reuses that module's own visibility rules
// (published-only notices/documents, the leader's own claims, etc.). Parents get a
// parent-safe search - only their children, the events they can see and the notices
// meant for them - so it never leaks leader-only or other families' data.
$router->get('/api/search', function ($params) {
    $user = requireAuth();
    $q = trim((string) queryParam('q'));
    if (mb_strlen($q) < 2) {
        jsonResponse(['q' => $q, 'results' => [], 'total' => 0]);
    }
    $like = '%' . $q . '%';
    $results = [];
    $add = function (string $type, string $typeLabel, string $label, string $sublabel, string $link) use (&$results) {
        $results[] = ['type' => $type, 'typeLabel' => $typeLabel, 'label' => $label, 'sublabel' => $sublabel, 'link' => $link];
    };

    // ── Parent-safe search ──────────────────────────────────────────────────────
    // Scoped to exactly what a parent may already see: their own linked children,
    // events/camps published to them, and notices addressed to them. Nothing else.
    if ($user['portal_role'] === 'parent') {
        $sectionIds = array_column(dbAll('SELECT DISTINCT osm_section_id FROM parent_child_links WHERE parent_user_id = ?', [$user['id']]), 'osm_section_id');
        // The parent's own children.
        foreach (dbAll('SELECT id, child_display_name, osm_section_name FROM parent_child_links WHERE parent_user_id = ? AND child_display_name LIKE ? ORDER BY child_display_name LIMIT 5', [$user['id'], $like]) as $r) {
            $add('child', 'My children', $r['child_display_name'] ?: 'Your child', $r['osm_section_name'] ?: '', 'child.html?id=' . $r['id']);
        }
        // Events/camps published to this parent (section-scoped or group-wide).
        if (function_exists('eventHubEnabled') && eventHubEnabled()) {
            $hubs = dbAll("SELECT * FROM event_hubs WHERE status = 'published' AND (title LIKE ? OR location LIKE ?) ORDER BY start_date DESC LIMIT 10", [$like, $like]);
            $shown = 0;
            foreach ($hubs as $h) {
                if (!eventHubVisibleToParent($user, $h)) continue;
                $sub = (EVENT_TYPES[$h['event_type']] ?? 'Event') . ($h['start_date'] ? ' · ' . $h['start_date'] : '') . ($h['location'] ? ' · ' . $h['location'] : '');
                $add('event', 'Events & camps', $h['title'], $sub, 'event-hub.html?id=' . $h['id']);
                if (++$shown >= 5) break;
            }
        }
        // Notices addressed to this parent (reuses the same visibility rules as the
        // notices list), then matched against the query.
        if (function_exists('listNoticesForUser')) {
            $matched = 0;
            foreach (listNoticesForUser($user, $sectionIds) as $n) {
                if (mb_stripos((string) $n['title'], $q) === false && mb_stripos((string) $n['body'], $q) === false) continue;
                $add('notice', 'Notices', $n['title'], $n['section_name'] ?: 'All', 'notices.html');
                if (++$matched >= 5) break;
            }
        }
        logAudit(['userId' => $user['id'], 'action' => 'search', 'ipAddress' => clientIp(), 'details' => ['q' => $q, 'results' => count($results), 'role' => 'parent']]);
        jsonResponse(['q' => $q, 'results' => $results, 'total' => count($results)]);
    }

    // ── Leader search ───────────────────────────────────────────────────────────
    requireLeader($user);

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
