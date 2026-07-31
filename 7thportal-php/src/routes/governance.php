<?php
// Trustee governance dashboard (backlog LATER-010). One read-only board view that
// aggregates COUNTS from the operational modules - incidents, section capacity,
// finance, Quartermaster/equipment and events. Trustee-board roles only, and never
// named child / sensitive detail (governance sees aggregates: FR-INC-009 etc.).
// Each panel is included only when its module is enabled; nothing is stored.

$router->get('/api/governance/dashboard', function ($params) {
    $user = requireAuth();
    if (!isTrusteeDashboardRole($user['portal_role'])) jsonResponse(['error' => 'Trustee Board access required.'], 403);
    logAudit(['userId' => $user['id'], 'action' => 'view_governance_dashboard', 'ipAddress' => clientIp()]);

    $today = gmdate('Y-m-d');
    $now = gmdate('Y-m-d H:i:s');
    $panels = [];

    // ── Safeguarding & incidents (counts only) ──────────────────────────────────
    if (function_exists('incidentLoggingEnabled') && incidentLoggingEnabled()) {
        $all = dbAll('SELECT record_type, status, due_date, created_at FROM incidents');
        $month = gmdate('Y-m');
        $byType = [];
        foreach ($all as $i) {
            if (str_starts_with((string) $i['created_at'], $month)) $byType[$i['record_type']] = ($byType[$i['record_type']] ?? 0) + 1;
        }
        $panels['incidents'] = [
            'open' => count(array_filter($all, fn($i) => $i['status'] !== 'closed')),
            'overdueActions' => count(array_filter($all, fn($i) => $i['status'] !== 'closed' && $i['due_date'] && $i['due_date'] < $today)),
            'thisMonth' => array_sum($byType),
            'total' => count($all),
            'byType' => array_map(fn($t) => ['label' => INCIDENT_TYPES[$t] ?? $t, 'count' => $byType[$t]], array_keys($byType)),
        ];
    }

    // ── Section capacity (aggregate) ────────────────────────────────────────────
    $cap = capacityBuildSummary();
    $panels['capacity'] = [
        'sections' => count($cap['sections']),
        'totalActive' => $cap['totals']['totalActive'],
        'availableSpaces' => $cap['totals']['availableSpaces'],
        'nearCapacity' => $cap['totals']['nearCapacity'],
        'atRisk' => array_values(array_map(
            fn($s) => ['section' => $s['sectionName'], 'status' => $s['status'], 'utilisation' => $s['utilisation']],
            array_filter($cap['sections'], fn($s) => in_array($s['status'], ['watch', 'full', 'over'], true))
        )),
    ];

    // ── Finance ─────────────────────────────────────────────────────────────────
    if (function_exists('financeEnabled') && financeEnabled()) {
        $items = dbAll("SELECT status, approved_amount, claimed_amount, paid_at FROM expense_claim_items WHERE status != 'draft'");
        $amt = fn($i) => (float) ($i['approved_amount'] ?? $i['claimed_amount'] ?? 0);
        $paid = array_filter($items, fn($i) => in_array($i['status'], ['paid', 'archived'], true));
        $monthStart = date('Y-m-01'); $yearStart = date('Y-01-01');
        $panels['finance'] = [
            'monthlySpend' => round(array_sum(array_map($amt, array_filter($paid, fn($i) => $i['paid_at'] >= $monthStart))), 2),
            'ytdSpend' => round(array_sum(array_map($amt, array_filter($paid, fn($i) => $i['paid_at'] >= $yearStart))), 2),
            'pending' => count(array_filter($items, fn($i) => in_array($i['status'], ['submitted', 'pending_second_approval'], true))),
            'awaitingPayment' => count(array_filter($items, fn($i) => $i['status'] === 'ready_for_payment')),
        ];
    }

    // ── Quartermaster bookings ──────────────────────────────────────────────────
    if (function_exists('qmBookingEnabled') && qmBookingEnabled()) {
        $panels['quartermaster'] = [
            'pendingReview' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'submitted'")['n'],
            'onLoan' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'collected'")['n'],
            'overdue' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_bookings WHERE status = 'collected' AND return_at IS NOT NULL AND return_at < ?", [$now])['n'],
            'damaged' => (int) dbGet("SELECT COUNT(*) AS n FROM qm_booking_items WHERE damage_notes IS NOT NULL AND damage_notes != ''")['n'],
        ];
    }

    // ── Equipment register ──────────────────────────────────────────────────────
    if (function_exists('equipmentRegisterEnabled') && equipmentRegisterEnabled()) {
        $in30 = gmdate('Y-m-d', strtotime('+30 days'));
        $panels['equipment'] = [
            'total' => (int) dbGet('SELECT COUNT(*) AS n FROM equipment_assets')['n'],
            'checksDue' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND next_inspection_date IS NOT NULL AND next_inspection_date <= ?", [$in30])['n'],
            'replacementRisk' => (int) dbGet("SELECT COUNT(*) AS n FROM equipment_assets WHERE status != 'retired' AND (condition IN ('poor','unserviceable') OR (replacement_due_date IS NOT NULL AND replacement_due_date < ?))", [$today])['n'],
        ];
    }

    // ── Events & camps ──────────────────────────────────────────────────────────
    if (function_exists('eventHubEnabled') && eventHubEnabled()) {
        $panels['events'] = [
            'published' => (int) dbGet("SELECT COUNT(*) AS n FROM event_hubs WHERE status = 'published'")['n'],
            'draft' => (int) dbGet("SELECT COUNT(*) AS n FROM event_hubs WHERE status = 'draft'")['n'],
            'upcoming' => (int) dbGet("SELECT COUNT(*) AS n FROM event_hubs WHERE status = 'published' AND start_date IS NOT NULL AND start_date >= ?", [$today])['n'],
        ];
    }

    jsonResponse([
        'panels' => $panels,
        'generatedAt' => gmdate('c'),
        'role' => roleLabel($user['portal_role']),
    ]);
});
