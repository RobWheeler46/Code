<?php
// Action Centre (FRD FR-ACT). Actions are computed live from the other modules
// so they are always current, then filtered to what this user's role permits and
// minus anything they have dismissed. Nothing about an action is stored except a
// per-user dismissal (dismissed_actions).

// One action item. priority: High|Medium|Low. dismissible items can be hidden by
// the user; workflow/governance items cannot (FR-ACT-005).
function actionItem(string $key, string $priority, string $type, string $action, string $owner, string $status, string $link, ?string $due = null, bool $dismissible = false): array
{
    return compact('key', 'priority', 'type', 'action', 'owner', 'status', 'link', 'due', 'dismissible');
}

function moduleEnabled(string $key): bool
{
    $row = dbGet('SELECT value FROM settings WHERE key = ?', [$key]);
    return $row && $row['value'] === 'true';
}

// Build the role-aware action list for a user (FR-ACT-002, FR-ACT-006).
function buildActionCentre(array $user): array
{
    $role = $user['portal_role'];
    $uid = (int) $user['id'];
    $items = [];
    $today = gmdate('Y-m-d');
    $isLeader = isLeaderRole($role);
    $isAdmin = isAdminRole($role);

    if ($isLeader) {
        // Documents needing this leader's acknowledgement (current version unacked).
        if (moduleEnabled('document_library_enabled')) {
            $docs = dbAll("SELECT id, title FROM documents WHERE status = 'published'");
            foreach ($docs as $d) {
                $ver = dbGet('SELECT id FROM document_versions WHERE document_id = ? ORDER BY version_number DESC LIMIT 1', [$d['id']]);
                if (!$ver) continue;
                $acked = dbGet('SELECT 1 FROM document_acknowledgements WHERE version_id = ? AND user_id = ?', [$ver['id'], $uid]);
                if (!$acked) {
                    $items[] = actionItem('doc-ack-' . $d['id'] . '-' . $ver['id'], 'Medium', 'Document', 'Acknowledge: ' . $d['title'], 'You', 'Acknowledge', 'documents.html');
                }
            }
        }
        // Photo albums awaiting approval.
        if (moduleEnabled('gallery_enabled')) {
            foreach (dbAll("SELECT id, title FROM gallery_albums WHERE status = 'pending_approval'") as $a) {
                $items[] = actionItem('album-approve-' . $a['id'], 'High', 'Photo approval', $a['title'], 'Leaders', 'Open', 'leader-gallery.html');
            }
        }
        // Finance: claimant's own drafts / more-info; treasurer's payables.
        if (moduleEnabled('finance_enabled')) {
            foreach (dbAll("SELECT id, claim_number FROM expense_claims WHERE claimant_user_id = ? AND status = 'draft'", [$uid]) as $c) {
                $items[] = actionItem('claim-draft-' . $c['id'], 'Low', 'Expenses', 'Finish and submit claim ' . $c['claim_number'], 'You', 'Edit', 'expenses.html', null, true);
            }
            $moreInfo = (int) dbGet("SELECT COUNT(*) AS n FROM expense_claim_items i JOIN expense_claims c ON c.id = i.claim_id WHERE c.claimant_user_id = ? AND i.status = 'more_info_requested'", [$uid])['n'];
            if ($moreInfo > 0) $items[] = actionItem('claim-moreinfo', 'High', 'Expenses', $moreInfo . ' claim item' . ($moreInfo === 1 ? '' : 's') . ' need more information', 'You', 'Open', 'expenses.html');
            // First approval waiting on this user: their nominated items, or (legacy)
            // items on accounts where they are the approver/deputy - never their own.
            $awaitingMine = (int) dbGet(
                "SELECT COUNT(*) AS n FROM expense_claim_items eci JOIN expense_claims ec ON ec.id = eci.claim_id
                 WHERE eci.status = 'submitted' AND ec.claimant_user_id != ?
                   AND ( eci.selected_approver_user_id = ?
                      OR (eci.selected_approver_user_id IS NULL AND eci.account_id IN (SELECT id FROM expense_accounts WHERE approver_user_id = ? OR deputy_approver_user_id = ?)) )",
                [$uid, $uid, $uid, $uid]
            )['n'];
            if ($awaitingMine > 0) $items[] = actionItem('claims-approve', 'High', 'Expenses', $awaitingMine . ' claim item' . ($awaitingMine === 1 ? '' : 's') . ' awaiting your approval', 'You', 'Open', 'expenses.html');
            if (isTreasurerRole($role) || isChairRole($role)) {
                $second = (int) dbGet("SELECT COUNT(*) AS n FROM expense_claim_items eci JOIN expense_claims ec ON ec.id = eci.claim_id WHERE eci.status = 'pending_second_approval' AND ec.claimant_user_id != ?", [$uid])['n'];
                if ($second > 0) $items[] = actionItem('claims-second', 'High', 'Expenses', $second . ' claim item' . ($second === 1 ? '' : 's') . ' awaiting your second approval', 'You', 'Open', 'expenses.html');
            }
            if (isTreasurerRole($role)) {
                $payable = (int) dbGet("SELECT COUNT(*) AS n FROM expense_claim_items WHERE status IN ('approved','ready_for_payment')")['n'];
                if ($payable > 0) $items[] = actionItem('claims-pay', 'High', 'Expenses', $payable . ' approved claim item' . ($payable === 1 ? '' : 's') . ' to pay', 'Treasurer', 'Open', 'treasurer.html');
            }
        }
    }

    if ($isLeader) {
        // Equipment checks/returns/replacement (FR-EQP-006).
        if (function_exists('equipmentActionItems')) $items = array_merge($items, equipmentActionItems());
        // Overdue incident follow-up actions (FR-INC "Incident action due").
        if (function_exists('incidentActionItems')) $items = array_merge($items, incidentActionItems($user));
        // Draft event/camp hubs needing setup (FR-EVT-HUB-007).
        if (function_exists('eventHubActionItems')) $items = array_merge($items, eventHubActionItems($user));
        // QM bookings to review + overdue returns (FR-QM-015/016).
        if (function_exists('qmActionItems')) $items = array_merge($items, qmActionItems($user));
        // Upcoming calendar placeholders to firm up (FR-CAL-013).
        if (function_exists('calendarActionItems')) $items = array_merge($items, calendarActionItems($user));
        // Open attendance registers to complete (FR-SEC-ATT).
        if (function_exists('attendanceActionItems')) $items = array_merge($items, attendanceActionItems($user));
        // Activity forms to complete/approve (Activity Approval pack).
        if (function_exists('activityActionItems')) $items = array_merge($items, activityActionItems($user));
        // Patrol Points submissions awaiting a (non-conflicted) approver (FRD v2.1 s13).
        if (function_exists('patrolPointsActionItems')) $items = array_merge($items, patrolPointsActionItems($user));
    }

    if ($isAdmin) {
        // Section capacity warnings.
        if (function_exists('capacityBuildSummary')) {
            foreach (capacityBuildSummary()['sections'] as $s) {
                if (in_array($s['status'], ['watch', 'full', 'over'], true)) {
                    $pri = $s['status'] === 'good' ? 'Low' : ($s['status'] === 'watch' ? 'Medium' : 'High');
                    $items[] = actionItem('cap-' . $s['sectionId'], $pri, 'Capacity', $s['sectionName'] . ' is ' . ($s['status'] === 'over' ? 'over capacity' : $s['status']), 'Admin', 'Review', 'admin.html?tab=capacity');
                }
            }
        }
        // Parent accounts with no linked child.
        $noKids = (int) dbGet("SELECT COUNT(*) AS n FROM users WHERE portal_role = 'parent' AND account_status = 'active' AND id NOT IN (SELECT DISTINCT parent_user_id FROM parent_child_links)")['n'];
        if ($noKids > 0) $items[] = actionItem('parents-nolink', 'Medium', 'Access', $noKids . ' parent account' . ($noKids === 1 ? '' : 's') . ' with no linked child', 'Admin', 'Open', 'admin.html?tab=parents');
        // Overdue document reviews.
        foreach (dbAll("SELECT id, title, review_date FROM documents WHERE review_date IS NOT NULL AND review_date < ?", [$today]) as $d) {
            $items[] = actionItem('doc-review-' . $d['id'], 'Medium', 'Document', 'Review overdue: ' . $d['title'], 'Admin', 'Open', 'documents.html', $d['review_date']);
        }
    }

    if ($role === 'parent') {
        // Recently published notices for this parent.
        foreach (dbAll("SELECT id, title, start_date FROM notices WHERE status = 'published' AND audience IN ('all','parents') AND start_date >= ? ORDER BY start_date DESC LIMIT 10", [gmdate('Y-m-d', strtotime('-21 days'))]) as $n) {
            $items[] = actionItem('notice-' . $n['id'], 'Low', 'Notice', $n['title'], 'You', 'Read', 'notices.html', null, true);
        }
    }

    // Trustee viewer / chair: governance oversight (overdue reviews + capacity risks).
    if (in_array($role, ['trustee_viewer', 'chair'], true)) {
        foreach (dbAll("SELECT id, title, review_date FROM documents WHERE review_date IS NOT NULL AND review_date < ?", [$today]) as $d) {
            $items[] = actionItem('gov-doc-' . $d['id'], 'Medium', 'Governance', 'Policy overdue for review: ' . $d['title'], 'Trustees', 'View', 'documents.html', $d['review_date']);
        }
    }

    // Drop dismissed items (FR-ACT-005).
    $dismissed = array_column(dbAll('SELECT action_key FROM dismissed_actions WHERE user_id = ?', [$uid]), 'action_key');
    $items = array_values(array_filter($items, fn($i) => !in_array($i['key'], $dismissed, true)));

    // Order by priority then due date.
    $rank = ['High' => 0, 'Medium' => 1, 'Low' => 2];
    usort($items, fn($a, $b) => ($rank[$a['priority']] <=> $rank[$b['priority']]) ?: (strcmp($a['due'] ?? '9999', $b['due'] ?? '9999')));
    return $items;
}

// Summary counts for the Action Centre stat cards.
function actionCentreSummary(array $items): array
{
    $weekEnd = gmdate('Y-m-d', strtotime('+7 days'));
    return [
        'total' => count($items),
        'high' => count(array_filter($items, fn($i) => $i['priority'] === 'High')),
        'dueThisWeek' => count(array_filter($items, fn($i) => $i['due'] !== null && $i['due'] <= $weekEnd)),
    ];
}
