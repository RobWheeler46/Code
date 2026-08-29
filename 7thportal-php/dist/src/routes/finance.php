<?php
// Expenses, Mileage, Treasurer and Trustee Board finance module - multi-item
// claims. See lib/finance.php for the shared helpers (thresholds, mileage
// tiering, receipt storage, serialization, permission checks, claim-status
// derivation) this file's handlers lean on.

function loadClaimOr404(int $claimId): array
{
    $claim = dbGet('SELECT * FROM expense_claims WHERE id = ?', [$claimId]);
    if (!$claim) jsonResponse(['error' => 'Claim not found.'], 404);
    return $claim;
}

// Validate an optional event/camp link on a claim. Empty/null clears the link; any
// other value must be a real event hub id, otherwise it's ignored (stored as null) so
// a stale id can never point a claim at a non-existent event.
function financeResolveEventHubId($raw): ?int
{
    if ($raw === null || $raw === '' || $raw === 0 || $raw === '0') return null;
    $id = (int) $raw;
    if ($id <= 0) return null;
    return dbGet('SELECT id FROM event_hubs WHERE id = ?', [$id]) ? $id : null;
}

function loadOwnDraftItem(array $user, int $itemId): array
{
    $item = loadItemWithClaim($itemId);
    if (!$item || (int) $item['claim_claimant_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'Item not found.'], 404);
    if (!in_array($item['status'], ['draft', 'more_info_requested'], true)) jsonResponse(['error' => 'Only draft or more-information items can be edited.'], 400);
    return $item;
}

// ── Leader-facing: reference data ───────────────────────────────────────────

$router->get('/api/finance/accounts', function ($params) {
    requireLeader(requireAuth());
    requireFinanceEnabled();
    jsonResponse(array_map('serializeAccount', dbAll('SELECT * FROM expense_accounts WHERE active = 1 ORDER BY name')));
});

// Eligible approvers a claimant may nominate for an account (FRD s28). Returns the
// active group members minus the claimant, and whether selection is required for
// this account, so the claim form can drive the Account -> Approver cascade.
$router->get('/api/finance/accounts/:id/approvers', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ? AND active = 1', [$params['id']]);
    if (!$account) jsonResponse(['error' => 'Account not found.'], 404);
    jsonResponse([
        'accountId' => (int) $account['id'],
        'selectionRequired' => (bool) ($account['claimant_selects_approver'] ?? 0),
        'groupName' => $account['approval_group_id'] ? (dbGet('SELECT name FROM finance_approval_groups WHERE id = ?', [$account['approval_group_id']])['name'] ?? null) : null,
        'approvers' => financeEligibleApprovers($account, (int) $user['id']),
    ]);
});

$router->get('/api/finance/categories', function ($params) {
    requireLeader(requireAuth());
    requireFinanceEnabled();
    jsonResponse(array_map('serializeCategory', dbAll('SELECT * FROM expense_categories WHERE active = 1 ORDER BY name')));
});

$router->get('/api/finance/mileage-rates', function ($params) {
    requireLeader(requireAuth());
    requireFinanceEnabled();
    jsonResponse(array_map(fn($r) => [
        'id' => (int) $r['id'], 'vehicleType' => $r['vehicle_type'], 'ratePerMile' => (float) $r['rate_per_mile'],
        'annualThresholdMiles' => $r['annual_threshold_miles'] !== null ? (float) $r['annual_threshold_miles'] : null,
        'rateAfterThreshold' => $r['rate_after_threshold'] !== null ? (float) $r['rate_after_threshold'] : null,
        'effectiveFrom' => $r['effective_from'],
    ], dbAll('SELECT * FROM mileage_rates ORDER BY vehicle_type, effective_from DESC')));
});

// Tells the frontend which extra sections to show (approvals inbox,
// Treasurer queue, Trustee dashboard) without every page having to guess
// role combinations itself.
$router->get('/api/finance/my-status', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $isApprover = (bool) dbGet(
        'SELECT 1 AS x FROM expense_accounts WHERE active = 1 AND (approver_user_id = ? OR deputy_approver_user_id = ?)',
        [$user['id'], $user['id']]
    );
    jsonResponse([
        'isApprover' => $isApprover || isAdminRole($user['portal_role']),
        'isTreasurer' => isTreasurerRole($user['portal_role']),
        'isChair' => isChairRole($user['portal_role']),
        'isTrusteeDashboard' => isTrusteeDashboardRole($user['portal_role']),
    ]);
});

// ── Claim headers ────────────────────────────────────────────────────────────

$router->get('/api/finance/claims', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    jsonResponse(array_map('serializeClaim', dbAll('SELECT * FROM expense_claims WHERE claimant_user_id = ? ORDER BY created_at DESC', [$user['id']])));
});

$router->get('/api/finance/claims/:id', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $claim = loadClaimOr404((int) $params['id']);
    if (!canViewClaimHeader($user, $claim)) jsonResponse(['error' => 'Claim not found.'], 404);
    $serialized = serializeClaim($claim);
    $serialized['items'] = array_map(function ($item) use ($user) {
        $withClaim = loadItemWithClaim((int) $item['id']);
        return array_merge($item, ['myActions' => myActionsForItem($user, $withClaim)]);
    }, $serialized['items']);
    jsonResponse($serialized);
});

$router->post('/api/finance/claims', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $body = requestBody();
    if (empty($body['title'])) jsonResponse(['error' => 'A claim title is required.'], 400);
    $eventHubId = financeResolveEventHubId($body['eventHubId'] ?? null);
    $result = dbRun(
        'INSERT INTO expense_claims (claim_number, claimant_user_id, title, notes, event_hub_id) VALUES (?, ?, ?, ?, ?)',
        [generateClaimNumber(), $user['id'], $body['title'], $body['notes'] ?? null, $eventHubId]
    );
    logAudit(['userId' => $user['id'], 'action' => 'finance_create_claim', 'entityType' => 'expense_claim', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeClaim(dbGet('SELECT * FROM expense_claims WHERE id = ?', [$result['lastInsertId']])));
});

$router->patch('/api/finance/claims/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $claim = loadClaimOr404((int) $params['id']);
    if ((int) $claim['claimant_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'Claim not found.'], 404);
    if ($claim['status'] !== 'draft') jsonResponse(['error' => 'Only a draft claim header can be edited.'], 400);
    $body = requestBody();
    $eventHubId = array_key_exists('eventHubId', $body) ? financeResolveEventHubId($body['eventHubId']) : $claim['event_hub_id'];
    dbRun(
        "UPDATE expense_claims SET title = ?, notes = ?, event_hub_id = ?, updated_at = datetime('now') WHERE id = ?",
        [$body['title'] ?? $claim['title'], array_key_exists('notes', $body) ? $body['notes'] : $claim['notes'], $eventHubId, $claim['id']]
    );
    jsonResponse(serializeClaim(dbGet('SELECT * FROM expense_claims WHERE id = ?', [$claim['id']])));
});

$router->delete('/api/finance/claims/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $claim = loadClaimOr404((int) $params['id']);
    if ((int) $claim['claimant_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'Claim not found.'], 404);
    if ($claim['status'] !== 'draft') jsonResponse(['error' => 'Only a draft claim can be deleted.'], 400);
    foreach (itemsForClaim((int) $claim['id']) as $item) {
        foreach (receiptsForItem((int) $item['id']) as $receipt) { unlinkReceiptFromItem((int) $receipt['id'], (int) $item['id']); }
        dbRun('DELETE FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]);
    }
    dbRun('DELETE FROM expense_claim_items WHERE claim_id = ?', [$claim['id']]);
    dbRun('DELETE FROM expense_claims WHERE id = ?', [$claim['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'finance_delete_claim', 'entityType' => 'expense_claim', 'entityId' => (string) $claim['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Claim items ──────────────────────────────────────────────────────────────

$router->post('/api/finance/claims/:claimId/items', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $claim = loadClaimOr404((int) $params['claimId']);
    if ((int) $claim['claimant_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'Claim not found.'], 404);
    if (!in_array($claim['status'], ['draft', 'submitted', 'partially_approved'], true)) {
        jsonResponse(['error' => 'Items can only be added while the claim still has editable items.'], 400);
    }
    $body = requestBody();
    $itemType = in_array($body['itemType'] ?? null, ['receipt', 'mileage'], true) ? $body['itemType'] : null;
    if (!$itemType) jsonResponse(['error' => 'itemType must be "receipt" or "mileage".'], 400);
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ? AND active = 1', [$body['accountId'] ?? null]);
    if (!$account) jsonResponse(['error' => 'Choose a valid account.'], 400);
    if (empty($body['title'])) jsonResponse(['error' => 'An item title is required.'], 400);

    // Optional nominated approver (FRD s28). Validate against the chosen account's
    // group now; final enforcement + snapshot happens at submission.
    $selectedApprover = null;
    if (!empty($body['selectedApproverUserId'])) {
        $sa = (int) $body['selectedApproverUserId'];
        if (!financeIsEligibleApprover($account, $sa, (int) $user['id'])) jsonResponse(['error' => 'That approver is not an eligible member of this account\'s approval group.'], 400);
        $selectedApprover = $sa;
    }
    $itemNumber = (int) (dbGet('SELECT COALESCE(MAX(item_number), 0) AS n FROM expense_claim_items WHERE claim_id = ?', [$claim['id']])['n']) + 1;
    $result = dbRun(
        'INSERT INTO expense_claim_items (claim_id, item_number, item_type, title, account_id, category_id, expense_date, claimed_amount, selected_approver_user_id, selected_approver_group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $claim['id'], $itemNumber, $itemType, $body['title'], $account['id'], $body['categoryId'] ?? null,
            $body['expenseDate'] ?? null, $itemType === 'receipt' ? (float) ($body['claimedAmount'] ?? 0) : null,
            $selectedApprover, $selectedApprover ? ($account['approval_group_id'] ?: null) : null,
        ]
    );
    $itemId = $result['lastInsertId'];
    if ($itemType === 'mileage') {
        dbRun('INSERT INTO expense_mileage_details (claim_item_id) VALUES (?)', [$itemId]);
    }
    logAudit(['userId' => $user['id'], 'action' => 'finance_add_item', 'entityType' => 'expense_claim_item', 'entityId' => (string) $itemId, 'ipAddress' => clientIp()]);
    jsonResponse(serializeItem(dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$itemId])));
});

// Recomputes a mileage item's amount from its current miles/vehicleType/
// expenseDate whenever those fields change, so the leader always sees an
// up-to-date "calculated amount" before submitting (MIL-002).
function recalculateMileageIfNeeded(array $item): void
{
    if ($item['item_type'] !== 'mileage') return;
    $mileage = dbGet('SELECT * FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]);
    if (!$mileage || !$mileage['miles_claimed'] || !$mileage['vehicle_type'] || !$item['expense_date']) return;
    $rate = activeMileageRate($mileage['vehicle_type'], $item['expense_date']);
    if (!$rate) return;
    $withClaim = loadItemWithClaim((int) $item['id']);
    $calc = calculateMileageAmount($rate, (float) $mileage['miles_claimed'], $mileage['vehicle_type'], $item['expense_date'], (int) $withClaim['claim_claimant_user_id'], (int) $item['id']);
    dbRun("UPDATE expense_mileage_details SET rate_applied = ? WHERE claim_item_id = ?", [$rate['rate_per_mile'], $item['id']]);
    dbRun("UPDATE expense_claim_items SET claimed_amount = ?, updated_at = datetime('now') WHERE id = ?", [$calc['amount'], $item['id']]);
}

$router->patch('/api/finance/claims/:claimId/items/:itemId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $item = loadOwnDraftItem($user, (int) $params['itemId']);
    $body = requestBody();
    $account = array_key_exists('accountId', $body) ? dbGet('SELECT * FROM expense_accounts WHERE id = ? AND active = 1', [$body['accountId']]) : null;
    if (array_key_exists('accountId', $body) && !$account) jsonResponse(['error' => 'Choose a valid account.'], 400);

    // Nominated approver (FRD s28): changing the account clears any prior selection
    // (FR-FIN-NA-005); an explicit selection is validated against the effective account.
    $effectiveAccount = $account ?: dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
    $accountChanged = $account && (int) $account['id'] !== (int) $item['account_id'];
    $newApprover = $accountChanged ? null : ($item['selected_approver_user_id'] ?: null);
    if (array_key_exists('selectedApproverUserId', $body)) {
        if (empty($body['selectedApproverUserId'])) {
            $newApprover = null;
        } else {
            $sa = (int) $body['selectedApproverUserId'];
            if (!$effectiveAccount || !financeIsEligibleApprover($effectiveAccount, $sa, (int) $user['id'])) {
                jsonResponse(['error' => 'That approver is not an eligible member of this account\'s approval group.'], 400);
            }
            $newApprover = $sa;
        }
    }
    $newApproverGroup = $newApprover && $effectiveAccount ? ($effectiveAccount['approval_group_id'] ?: null) : null;

    dbRun(
        "UPDATE expense_claim_items SET title = ?, account_id = ?, category_id = ?, expense_date = ?, claimed_amount = ?,
         receipt_exception_reason = ?, selected_approver_user_id = ?, selected_approver_group_id = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['title'] ?? $item['title'],
            $account ? $account['id'] : $item['account_id'],
            array_key_exists('categoryId', $body) ? $body['categoryId'] : $item['category_id'],
            $body['expenseDate'] ?? $item['expense_date'],
            $item['item_type'] === 'receipt' && array_key_exists('claimedAmount', $body) ? (float) $body['claimedAmount'] : $item['claimed_amount'],
            array_key_exists('receiptExceptionReason', $body) ? $body['receiptExceptionReason'] : $item['receipt_exception_reason'],
            $newApprover, $newApproverGroup,
            $item['id'],
        ]
    );

    if ($item['item_type'] === 'mileage') {
        $mileage = dbGet('SELECT * FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]);
        dbRun(
            'UPDATE expense_mileage_details SET journey_purpose = ?, start_location = ?, end_location = ?, return_journey = ?, miles_claimed = ?, vehicle_type = ?, declaration_accepted = ? WHERE claim_item_id = ?',
            [
                $body['journeyPurpose'] ?? $mileage['journey_purpose'],
                $body['startLocation'] ?? $mileage['start_location'],
                $body['endLocation'] ?? $mileage['end_location'],
                array_key_exists('returnJourney', $body) ? ($body['returnJourney'] ? 1 : 0) : $mileage['return_journey'],
                $body['miles'] ?? $mileage['miles_claimed'],
                $body['vehicleType'] ?? $mileage['vehicle_type'],
                array_key_exists('declarationAccepted', $body) ? ($body['declarationAccepted'] ? 1 : 0) : $mileage['declaration_accepted'],
                $item['id'],
            ]
        );
    }
    $updated = dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$item['id']]);
    recalculateMileageIfNeeded($updated);
    jsonResponse(serializeItem(dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$item['id']])));
});

$router->delete('/api/finance/claims/:claimId/items/:itemId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $item = loadOwnDraftItem($user, (int) $params['itemId']);
    if ($item['status'] !== 'draft') jsonResponse(['error' => 'Only a draft item can be deleted.'], 400);
    foreach (receiptsForItem((int) $item['id']) as $receipt) { unlinkReceiptFromItem((int) $receipt['id'], (int) $item['id']); }
    dbRun('DELETE FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]);
    dbRun('DELETE FROM expense_claim_items WHERE id = ?', [$item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_delete_item', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Receipts (many-to-many with items) ──────────────────────────────────────

$router->post('/api/finance/items/:itemId/receipts', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $item = loadOwnDraftItem($user, (int) $params['itemId']);
    if ($item['item_type'] !== 'receipt') jsonResponse(['error' => 'Only receipt items accept a receipt upload.'], 400);
    if (empty($_FILES['receipt'])) jsonResponse(['error' => 'No file received.'], 400);
    $file = $_FILES['receipt'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > RECEIPT_MAX_UPLOAD_BYTES || !is_uploaded_file($file['tmp_name'])) {
        jsonResponse(['error' => 'Upload failed - check the file is under 10MB.'], 400);
    }
    $ext = detectReceiptExtension($file['tmp_name']);
    if (!$ext) jsonResponse(['error' => 'Only JPG, PNG or PDF receipts are accepted.'], 400);

    $key = receiptStorageKey();
    saveReceiptFile($key, $ext, file_get_contents($file['tmp_name']));
    $result = dbRun(
        'INSERT INTO expense_receipts (storage_key, ext, original_filename, uploaded_by_user_id) VALUES (?, ?, ?, ?)',
        [$key, $ext, $file['name'], $user['id']]
    );
    linkReceiptToItem((int) $result['lastInsertId'], (int) $item['id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_upload_receipt', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeItem(dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$item['id']])));
});

$router->delete('/api/finance/items/:itemId/receipts/:receiptId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $item = loadOwnDraftItem($user, (int) $params['itemId']);
    unlinkReceiptFromItem((int) $params['receiptId'], (int) $item['id']);
    jsonResponse(serializeItem(dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$item['id']])));
});

$router->get('/api/finance/receipts/:id/file', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!canViewReceipt($user, (int) $params['id'])) { http_response_code(404); exit; }
    $receipt = dbGet('SELECT * FROM expense_receipts WHERE id = ?', [$params['id']]);
    if (!$receipt) { http_response_code(404); exit; }
    $path = receiptFilePathFor($receipt['storage_key'], $receipt['ext']);
    if (!is_file($path)) { http_response_code(404); exit; }
    $mime = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'pdf' => 'application/pdf'][$receipt['ext']] ?? 'application/octet-stream';
    header('Cache-Control: private, no-store');
    header('Content-Disposition: inline');
    header("Content-Type: $mime");
    readfile($path);
    exit;
});

// ── Submit ───────────────────────────────────────────────────────────────────

$router->post('/api/finance/claims/:id/submit', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireFinanceEnabled();
    $claim = loadClaimOr404((int) $params['id']);
    if ((int) $claim['claimant_user_id'] !== (int) $user['id']) jsonResponse(['error' => 'Claim not found.'], 404);
    $items = itemsForClaim((int) $claim['id']);
    $submittable = array_filter($items, fn($i) => in_array($i['status'], ['draft', 'more_info_requested'], true));
    if (count($items) === 0) jsonResponse(['error' => 'Add at least one item before submitting this claim.'], 400);
    if (count($submittable) === 0) jsonResponse(['error' => 'There are no draft or more-information items to submit.'], 400);

    foreach ($submittable as $item) {
        if (!$item['claimed_amount'] || (float) $item['claimed_amount'] <= 0) {
            jsonResponse(['error' => "Item \"{$item['title']}\" needs a value greater than zero before it can be submitted."], 400);
        }
        if ($item['item_type'] === 'receipt') {
            $hasReceipt = (bool) receiptsForItem((int) $item['id']);
            if (!$hasReceipt && !$item['receipt_exception_reason']) {
                jsonResponse(['error' => "Upload a receipt for \"{$item['title']}\", or record a reason if none is available."], 400);
            }
        } else {
            $mileage = dbGet('SELECT * FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]);
            if (!$item['expense_date'] || !$mileage['start_location'] || !$mileage['end_location'] || !$mileage['miles_claimed'] || !$mileage['vehicle_type']) {
                jsonResponse(['error' => "Complete the journey date, locations, miles and vehicle type for \"{$item['title']}\"."], 400);
            }
            if (!$mileage['declaration_accepted']) {
                jsonResponse(['error' => "Accept the mileage declaration for \"{$item['title']}\" before submitting (FRD 11.1)."], 400);
            }
        }
        // Nominated-approver accounts require a valid selection before submission
        // (FR-FIN-NA-003). No eligible approver at all -> block clearly (edge case).
        $acct = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
        if ($acct && !empty($acct['claimant_selects_approver'])) {
            if (count(financeEligibleApprovers($acct, (int) $user['id'])) === 0) {
                jsonResponse(['error' => "No eligible approver is available for the account on \"{$item['title']}\" - ask a Finance Admin to add approvers to its group."], 400);
            }
            $sa = $item['selected_approver_user_id'] ? (int) $item['selected_approver_user_id'] : 0;
            if (!$sa || !financeIsEligibleApprover($acct, $sa, (int) $user['id'])) {
                jsonResponse(['error' => "Choose an eligible approver for \"{$item['title']}\" before submitting."], 400);
            }
        }
    }

    $approverItemCounts = []; // first-stage approver user id => items awaiting them
    foreach ($submittable as $item) {
        $secondApprovalRequired = itemNeedsSecondApproval((float) $item['claimed_amount']);
        dbRun(
            "UPDATE expense_claim_items SET status = 'submitted', submitted_at = datetime('now'), second_approval_required = ?,
             more_info_requested_by = NULL, more_info_requested_at = NULL, more_info_note = NULL, updated_at = datetime('now') WHERE id = ?",
            [$secondApprovalRequired ? 1 : 0, $item['id']]
        );
        $acct = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
        // Freeze the routing snapshot at submission (FR-FIN-NA-008) so audit history
        // stays stable even if group membership changes later.
        if (!empty($item['selected_approver_user_id']) && $acct) {
            dbRun('UPDATE expense_claim_items SET selected_approver_group_id = ?, selected_approver_snapshot_json = ?, approver_assigned_by_user_id = ?, approver_assignment_reason = ? WHERE id = ?',
                [$acct['approval_group_id'] ?: null, json_encode(financeApproverSnapshot($acct, (int) $item['selected_approver_user_id'])), (int) $user['id'], 'claimant_selection', $item['id']]);
        }
        // Work out who owns this item's first approval, so they can be told.
        $approverIds = !empty($item['selected_approver_user_id'])
            ? [(int) $item['selected_approver_user_id']]
            : array_filter([(int) ($acct['approver_user_id'] ?? 0), (int) ($acct['deputy_approver_user_id'] ?? 0)]);
        foreach ($approverIds as $aid) {
            if ($aid && $aid !== (int) $user['id']) $approverItemCounts[$aid] = ($approverItemCounts[$aid] ?? 0) + 1;
        }
    }
    // Tell each first-stage approver they have something waiting (one per approver).
    foreach ($approverItemCounts as $aid => $count) {
        notify($aid, 'expense_claim', 'Expense approval needed',
            'Claim ' . $claim['claim_number'] . ' has ' . $count . ' item' . ($count === 1 ? '' : 's') . ' awaiting your approval.', 'expenses.html');
    }
    dbRun("UPDATE expense_claims SET submitted_at = COALESCE(submitted_at, datetime('now')) WHERE id = ?", [$claim['id']]);
    recalculateClaimStatus((int) $claim['id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_submit_claim', 'entityType' => 'expense_claim', 'entityId' => (string) $claim['id'], 'ipAddress' => clientIp(), 'details' => ['itemCount' => count($submittable)]]);
    jsonResponse(serializeClaim(dbGet('SELECT * FROM expense_claims WHERE id = ?', [$claim['id']])));
});

// ── Approver inbox ───────────────────────────────────────────────────────────

$router->get('/api/finance/approvals', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $firstStage = array_filter(dbAll(itemWithClaimQuery() . " WHERE eci.status = 'submitted'"), fn($i) => canActOnItemApproval($user, $i));
    $secondStage = array_filter(dbAll(itemWithClaimQuery() . " WHERE eci.status = 'pending_second_approval'"), fn($i) => canActOnSecondApproval($user, $i));
    $all = array_merge(array_values($firstStage), array_values($secondStage));
    usort($all, fn($a, $b) => strcmp($a['submitted_at'] ?? '', $b['submitted_at'] ?? ''));
    jsonResponse(array_map('serializeItemWithClaimContext', $all));
});

// Oversight of nominated-approver items still awaiting first approval, for Finance
// Admin / Treasurer reassignment (FRD s28.5, FR-FIN-NA-009). Shows who each item is
// waiting on, how long, and the eligible members it could be reassigned to.
$router->get('/api/finance/oversight/awaiting', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Finance Admin or Treasurer access required.'], 403);
    $rows = dbAll(itemWithClaimQuery() . " WHERE eci.status = 'submitted' AND eci.selected_approver_user_id IS NOT NULL ORDER BY eci.submitted_at ASC");
    $out = [];
    foreach ($rows as $row) {
        $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$row['account_id']]);
        $waitingDays = $row['submitted_at'] ? (int) floor((time() - strtotime($row['submitted_at'])) / 86400) : 0;
        $out[] = array_merge(serializeItemWithClaimContext($row), [
            'waitingDays' => $waitingDays,
            'overdue' => $waitingDays >= 7,
            'reassignCandidates' => $account ? financeEligibleApprovers($account, (int) $row['claim_claimant_user_id']) : [],
        ]);
    }
    jsonResponse($out);
});

// Reassign a nominated item to another eligible approver (FR-FIN-NA-009). The
// original submission snapshot is preserved; only the active assignee changes.
$router->post('/api/finance/items/:itemId/reassign-approver', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Finance Admin or Treasurer access required.'], 403);
    $item = loadItemWithClaim((int) $params['itemId']);
    if (!$item) jsonResponse(['error' => 'Item not found.'], 404);
    if ($item['status'] !== 'submitted') jsonResponse(['error' => 'Only an item awaiting its first approval can be reassigned.'], 400);
    if (empty($item['selected_approver_user_id'])) jsonResponse(['error' => 'This item does not use a nominated approver.'], 400);
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
    if (!$account) jsonResponse(['error' => 'Account not found.'], 404);
    $body = requestBody();
    $newApprover = (int) ($body['approverUserId'] ?? 0);
    if (!financeIsEligibleApprover($account, $newApprover, (int) $item['claim_claimant_user_id'])) {
        jsonResponse(['error' => 'Choose another eligible member of this account\'s approval group.'], 400);
    }
    if ($newApprover === (int) $item['selected_approver_user_id']) jsonResponse(['error' => 'That approver is already assigned to this item.'], 400);
    $reason = in_array($body['reason'] ?? null, ['reassignment', 'overdue', 'conflict', 'admin_correction'], true) ? $body['reason'] : 'reassignment';
    $previous = (int) $item['selected_approver_user_id'];
    dbRun(
        "UPDATE expense_claim_items SET selected_approver_user_id = ?, approver_assigned_by_user_id = ?, approver_assignment_reason = ?, updated_at = datetime('now') WHERE id = ?",
        [$newApprover, $user['id'], $reason, $item['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'finance_reassign_approver', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp(),
        'details' => ['approvalRouteSnapshot' => ['claim' => $item['claim_number'], 'account' => $account['name'], 'group' => $account['approval_group_id'], 'from' => $previous, 'to' => $newApprover, 'reason' => $reason]]]);
    // Tell the new approver they now own this approval.
    notify($newApprover, 'expense_claim', 'Expense approval assigned to you',
        'You have been asked to approve ' . claimItemRef($item) . ' (reassigned by ' . trim($user['first_name'] . ' ' . $user['last_name']) . ').', 'expenses.html');
    itemActionResponse((int) $item['id']);
});

function itemActionResponse(int $itemId): void
{
    jsonResponse(serializeItem(dbGet('SELECT * FROM expense_claim_items WHERE id = ?', [$itemId])));
}

$router->post('/api/finance/items/:itemId/approve', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $item = loadItemWithClaim((int) $params['itemId']);
    if (!$item || $item['status'] !== 'submitted' || !canActOnItemApproval($user, $item)) {
        jsonResponse(['error' => 'This item is not awaiting your approval.'], 400);
    }
    $newStatus = $item['second_approval_required'] ? 'pending_second_approval' : 'approved';
    dbRun("UPDATE expense_claim_items SET status = ?, approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$newStatus, $user['id'], $item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_approve_item', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    if ($newStatus === 'approved') {
        notifyClaimant((int) $item['claim_id'], (int) $user['id'], 'Expense claim approved', 'Your ' . claimItemRef($item) . ' has been approved.');
    } else {
        // Passed first approval but over the tier-2 threshold: alert the second
        // approvers (Treasurer/Chair) who must sign it off, excluding the claimant.
        foreach (dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role IN ('treasurer','chair')") as $u) {
            if ((int) $u['id'] === (int) $item['claim_claimant_user_id']) continue;
            notify((int) $u['id'], 'expense_claim', 'Second approval needed', claimItemRef($item) . ' has passed first approval and needs a Treasurer or Chair second approval.', 'expenses.html');
        }
    }
    itemActionResponse((int) $item['id']);
});

$router->post('/api/finance/items/:itemId/second-approve', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $item = loadItemWithClaim((int) $params['itemId']);
    if (!$item || $item['status'] !== 'pending_second_approval' || !canActOnSecondApproval($user, $item)) {
        jsonResponse(['error' => 'This item is not awaiting a second approval from you.'], 400);
    }
    dbRun("UPDATE expense_claim_items SET status = 'approved', second_approved_by = ?, second_approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_second_approve_item', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    notifyClaimant((int) $item['claim_id'], (int) $user['id'], 'Expense claim approved', 'Your ' . claimItemRef($item) . ' has completed approval.');
    itemActionResponse((int) $item['id']);
});

$router->post('/api/finance/items/:itemId/reject', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $item = loadItemWithClaim((int) $params['itemId']);
    $eligible = $item && in_array($item['status'], ['submitted', 'pending_second_approval'], true)
        && (canActOnItemApproval($user, $item) || canActOnSecondApproval($user, $item));
    if (!$eligible) jsonResponse(['error' => 'This item cannot be rejected by you right now.'], 400);
    $body = requestBody();
    if (empty($body['reason'])) jsonResponse(['error' => 'A reason is required to reject an item.'], 400);
    dbRun("UPDATE expense_claim_items SET status = 'rejected', rejected_by = ?, rejected_at = datetime('now'), rejection_reason = ?, updated_at = datetime('now') WHERE id = ?", [$user['id'], $body['reason'], $item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_reject_item', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp(), 'details' => ['reason' => $body['reason']]]);
    notifyClaimant((int) $item['claim_id'], (int) $user['id'], 'Expense claim item rejected', 'Your ' . claimItemRef($item) . ' was not approved. Reason: ' . $body['reason']);
    itemActionResponse((int) $item['id']);
});

$router->post('/api/finance/items/:itemId/request-info', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    $item = loadItemWithClaim((int) $params['itemId']);
    if (!$item || $item['status'] !== 'submitted' || !canActOnItemApproval($user, $item)) {
        jsonResponse(['error' => 'This item is not awaiting your approval.'], 400);
    }
    $body = requestBody();
    if (empty($body['note'])) jsonResponse(['error' => 'Explain what more information is needed.'], 400);
    dbRun("UPDATE expense_claim_items SET status = 'more_info_requested', more_info_requested_by = ?, more_info_requested_at = datetime('now'), more_info_note = ?, updated_at = datetime('now') WHERE id = ?", [$user['id'], $body['note'], $item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_request_info', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    notifyClaimant((int) $item['claim_id'], (int) $user['id'], 'More information needed on your claim', 'Your ' . claimItemRef($item) . ' needs more information: ' . $body['note']);
    itemActionResponse((int) $item['id']);
});

// ── Treasurer ────────────────────────────────────────────────────────────────

$router->get('/api/treasurer/payable-items', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Treasurer access required.'], 403);
    $rows = dbAll(itemWithClaimQuery() . " WHERE eci.status IN ('approved', 'ready_for_payment') ORDER BY eci.approved_at ASC");
    jsonResponse(array_map('serializeItemWithClaimContext', $rows));
});

$router->post('/api/finance/items/:itemId/ready-for-payment', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Treasurer access required.'], 403);
    $item = dbGet("SELECT * FROM expense_claim_items WHERE id = ? AND status = 'approved'", [$params['itemId']]);
    if (!$item) jsonResponse(['error' => 'Only approved items can be marked ready for payment.'], 400);
    dbRun("UPDATE expense_claim_items SET status = 'ready_for_payment', ready_for_payment_by = ?, ready_for_payment_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $item['id']]);
    recalculateClaimStatus((int) $item['claim_id']);
    logAudit(['userId' => $user['id'], 'action' => 'finance_ready_for_payment', 'entityType' => 'expense_claim_item', 'entityId' => (string) $item['id'], 'ipAddress' => clientIp()]);
    itemActionResponse((int) $item['id']);
});

$router->post('/api/treasurer/payment-batches', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Treasurer access required.'], 403);
    $body = requestBody();
    $itemIds = array_values(array_unique(array_map('intval', $body['itemIds'] ?? [])));
    if (empty($itemIds)) jsonResponse(['error' => 'Select at least one item to pay.'], 400);
    if (empty($body['bankReference'])) jsonResponse(['error' => 'A bank reference is required.'], 400);
    if (empty($body['paymentDate'])) jsonResponse(['error' => 'A payment date is required.'], 400);

    $items = array_map(fn($id) => dbGet("SELECT * FROM expense_claim_items WHERE id = ? AND status = 'ready_for_payment'", [$id]), $itemIds);
    if (in_array(null, $items, true)) jsonResponse(['error' => 'Only items marked ready for payment can be included in a payment batch.'], 400);

    $batch = dbRun(
        'INSERT INTO expense_payment_batches (batch_reference, created_by_user_id, payment_date, bank_reference) VALUES (?, ?, ?, ?)',
        ['PAY-' . date('Y') . '-' . str_pad((string) ((int) (dbGet('SELECT COALESCE(MAX(id),0) AS n FROM expense_payment_batches')['n']) + 1), 4, '0', STR_PAD_LEFT), $user['id'], $body['paymentDate'], $body['bankReference']]
    );
    $paidByClaim = []; // claimId => ['count' => int, 'total' => float]
    foreach ($items as $item) {
        $paid = (float) ($item['approved_amount'] ?? $item['claimed_amount']);
        dbRun('INSERT INTO expense_payment_items (payment_batch_id, claim_item_id, paid_amount) VALUES (?, ?, ?)', [$batch['lastInsertId'], $item['id'], $paid]);
        dbRun("UPDATE expense_claim_items SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$item['id']]);
        $cid = (int) $item['claim_id'];
        $paidByClaim[$cid] = ['count' => ($paidByClaim[$cid]['count'] ?? 0) + 1, 'total' => ($paidByClaim[$cid]['total'] ?? 0) + $paid];
    }
    foreach (array_keys($paidByClaim) as $claimId) { recalculateClaimStatus($claimId); }
    // One "payment sent" notification per claim (not per item, to avoid a burst).
    foreach ($paidByClaim as $claimId => $agg) {
        $cn = dbGet('SELECT claim_number FROM expense_claims WHERE id = ?', [$claimId]);
        notifyClaimant($claimId, (int) $user['id'], 'Expense payment sent',
            'Payment of £' . number_format($agg['total'], 2) . ' for ' . $agg['count'] . ' item' . ($agg['count'] === 1 ? '' : 's') . ' on claim ' . ($cn['claim_number'] ?? '') . ' has been sent (' . $body['paymentDate'] . ', reference ' . $body['bankReference'] . ').');
    }
    logAudit(['userId' => $user['id'], 'action' => 'finance_create_payment_batch', 'entityType' => 'expense_payment_batch', 'entityId' => (string) $batch['lastInsertId'], 'ipAddress' => clientIp(), 'details' => ['itemCount' => count($items), 'bankReference' => $body['bankReference']]]);
    jsonResponse(['ok' => true, 'batchId' => $batch['lastInsertId']]);
});

$router->get('/api/treasurer/payment-batches', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Treasurer access required.'], 403);
    $batches = dbAll('SELECT * FROM expense_payment_batches ORDER BY created_at DESC LIMIT 50');
    jsonResponse(array_map(function ($b) {
        $items = dbAll('SELECT * FROM expense_payment_items WHERE payment_batch_id = ?', [$b['id']]);
        return [
            'id' => (int) $b['id'], 'batchReference' => $b['batch_reference'], 'paymentDate' => $b['payment_date'],
            'bankReference' => $b['bank_reference'], 'itemCount' => count($items),
            'totalPaid' => round(array_sum(array_map(fn($i) => (float) $i['paid_amount'], $items)), 2),
            'createdAt' => $b['created_at'],
        ];
    }, $batches));
});

$router->get('/api/treasurer/export.csv', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTreasurerRole($user['portal_role'])) jsonResponse(['error' => 'Treasurer access required.'], 403);
    $rows = dbAll(itemWithClaimQuery() . " WHERE eci.status != 'draft' ORDER BY eci.created_at DESC");
    logAudit(['userId' => $user['id'], 'action' => 'finance_export_csv', 'ipAddress' => clientIp(), 'details' => ['count' => count($rows)]]);
    header('Content-Type: text/csv');
    header('Content-Disposition: attachment; filename="7thportal-expenses-export.csv"');
    echo itemsToCsv($rows);
    exit;
});

// ── Trustee Board finance dashboard (read-only) ─────────────────────────────

$router->get('/api/trustee/dashboard', function ($params) {
    $user = requireAuth();
    requireFinanceEnabled();
    if (!isTrusteeDashboardRole($user['portal_role'])) jsonResponse(['error' => 'Trustee Board access required.'], 403);
    logAudit(['userId' => $user['id'], 'action' => 'finance_view_trustee_dashboard', 'ipAddress' => clientIp()]);

    $allItems = dbAll("SELECT * FROM expense_claim_items WHERE status != 'draft'");
    $paid = array_filter($allItems, fn($i) => in_array($i['status'], ['paid', 'archived'], true));
    $paidAmount = fn($i) => (float) ($i['approved_amount'] ?? $i['claimed_amount'] ?? 0);
    $monthStart = date('Y-m-01');
    $yearStart = date('Y-01-01');
    $monthlySpend = array_sum(array_map($paidAmount, array_filter($paid, fn($i) => $i['paid_at'] >= $monthStart)));
    $ytdSpend = array_sum(array_map($paidAmount, array_filter($paid, fn($i) => $i['paid_at'] >= $yearStart)));

    $mileagePaidMiles = 0;
    foreach (array_filter($paid, fn($i) => $i['item_type'] === 'mileage') as $i) {
        $m = dbGet('SELECT miles_claimed FROM expense_mileage_details WHERE claim_item_id = ?', [$i['id']]);
        $mileagePaidMiles += (float) ($m['miles_claimed'] ?? 0);
    }

    $pipeline = [];
    foreach ($allItems as $i) { $pipeline[$i['status']] = ($pipeline[$i['status']] ?? 0) + 1; }

    $accounts = dbAll('SELECT * FROM expense_accounts');
    $spendByAccount = array_map(function ($a) use ($paid, $paidAmount) {
        $spend = array_sum(array_map($paidAmount, array_filter($paid, fn($i) => (int) $i['account_id'] === (int) $a['id'])));
        return ['account' => $a['name'], 'spend' => round($spend, 2)];
    }, $accounts);

    // Exceptions - item ID + account + amount + age only, no claimant name by
    // default (DECISIONS-finance-module.md item 10 is still open; this is the
    // cautious default until that's confirmed either way).
    $exceptionRow = fn($i) => [
        'itemId' => (int) $i['id'],
        'account' => (dbGet('SELECT name FROM expense_accounts WHERE id = ?', [$i['account_id']]) ?? ['name' => ''])['name'],
        'amount' => (float) ($i['claimed_amount'] ?? 0),
        'ageDays' => $i['submitted_at'] ? (int) floor((time() - strtotime($i['submitted_at'])) / 86400) : null,
    ];
    $highValuePending = array_values(array_map($exceptionRow, array_filter($allItems, fn($i) => $i['status'] === 'pending_second_approval')));
    $missingReceipts = array_values(array_map($exceptionRow, array_filter($allItems, function ($i) {
        return $i['item_type'] === 'receipt' && $i['status'] !== 'rejected' && !$i['receipt_exception_reason'] && !receiptsForItem((int) $i['id']);
    })));
    $oldPending = array_values(array_map($exceptionRow, array_filter($allItems, fn($i) => in_array($i['status'], ['submitted', 'pending_second_approval'], true) && $i['submitted_at'] && strtotime($i['submitted_at']) < strtotime('-14 days'))));

    jsonResponse([
        'kpis' => [
            'monthlySpend' => round($monthlySpend, 2),
            'ytdSpend' => round($ytdSpend, 2),
            'awaitingApproval' => ($pipeline['submitted'] ?? 0) + ($pipeline['pending_second_approval'] ?? 0) + ($pipeline['more_info_requested'] ?? 0),
            'readyToPay' => $pipeline['ready_for_payment'] ?? 0,
            'mileagePaidMiles' => round($mileagePaidMiles, 1),
        ],
        'spendByAccount' => $spendByAccount,
        'pipeline' => $pipeline,
        'exceptions' => [
            'highValuePendingSecondApproval' => $highValuePending,
            'missingReceipts' => $missingReceipts,
            'oldPending' => $oldPending,
        ],
    ]);
});

// ── Admin: accounts, categories, mileage rates ──────────────────────────────

$router->get('/api/admin/finance/accounts', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map('serializeAccount', dbAll('SELECT * FROM expense_accounts ORDER BY name')));
});

$router->get('/api/admin/finance/approver-candidates', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map(
        fn($u) => ['id' => (int) $u['id'], 'name' => $u['first_name'] . ' ' . $u['last_name'], 'roleLabel' => roleLabel($u['portal_role'])],
        dbAll("SELECT * FROM users WHERE portal_role != 'parent' AND account_status = 'active' ORDER BY first_name")
    ));
});

$router->post('/api/admin/finance/accounts', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    if (empty($body['name'])) jsonResponse(['error' => 'An account name is required.'], 400);
    $level = in_array($body['approverSelectionLevel'] ?? null, ['claim', 'account', 'item'], true) ? $body['approverSelectionLevel'] : 'account';
    $result = dbRun(
        'INSERT INTO expense_accounts (name, code, approver_user_id, deputy_approver_user_id, approval_group_id, claimant_selects_approver, approver_selection_level) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$body['name'], $body['code'] ?? null, $body['approverUserId'] ?? null, $body['deputyApproverUserId'] ?? null, $body['approvalGroupId'] ?? null, !empty($body['claimantSelectsApprover']) ? 1 : 0, $level]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_create_finance_account', 'entityType' => 'expense_account', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeAccount(dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$result['lastInsertId']])));
});

$router->patch('/api/admin/finance/accounts/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$params['id']]);
    if (!$account) jsonResponse(['error' => 'Account not found.'], 404);
    $body = requestBody();
    $level = array_key_exists('approverSelectionLevel', $body)
        ? (in_array($body['approverSelectionLevel'], ['claim', 'account', 'item'], true) ? $body['approverSelectionLevel'] : ($account['approver_selection_level'] ?? 'account'))
        : ($account['approver_selection_level'] ?? 'account');
    dbRun(
        "UPDATE expense_accounts SET name = ?, code = ?, approver_user_id = ?, deputy_approver_user_id = ?, approval_group_id = ?, claimant_selects_approver = ?, approver_selection_level = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['name'] ?? $account['name'],
            array_key_exists('code', $body) ? $body['code'] : $account['code'],
            array_key_exists('approverUserId', $body) ? $body['approverUserId'] : $account['approver_user_id'],
            array_key_exists('deputyApproverUserId', $body) ? $body['deputyApproverUserId'] : $account['deputy_approver_user_id'],
            array_key_exists('approvalGroupId', $body) ? ($body['approvalGroupId'] ?: null) : ($account['approval_group_id'] ?? null),
            array_key_exists('claimantSelectsApprover', $body) ? (!empty($body['claimantSelectsApprover']) ? 1 : 0) : ($account['claimant_selects_approver'] ?? 0),
            $level,
            array_key_exists('active', $body) ? ($body['active'] ? 1 : 0) : $account['active'],
            $account['id'],
        ]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_update_finance_account', 'entityType' => 'expense_account', 'entityId' => (string) $account['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeAccount(dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$account['id']])));
});

$router->delete('/api/admin/finance/accounts/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$params['id']]);
    if (!$account) jsonResponse(['error' => 'Account not found.'], 404);
    $inUse = dbGet('SELECT 1 AS x FROM expense_claim_items WHERE account_id = ?', [$account['id']]);
    if ($inUse) jsonResponse(['error' => 'This account has claim items against it - deactivate it instead of deleting.'], 400);
    dbRun('DELETE FROM expense_accounts WHERE id = ?', [$account['id']]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_delete_finance_account', 'entityType' => 'expense_account', 'entityId' => (string) $account['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Finance approval groups (FRD s28 config foundation) ──────────────────────

$router->get('/api/admin/finance/approval-groups', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map('serializeApprovalGroup', dbAll('SELECT * FROM finance_approval_groups ORDER BY name')));
});

$router->post('/api/admin/finance/approval-groups', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    if (empty(trim((string) ($body['name'] ?? '')))) jsonResponse(['error' => 'A group name is required.'], 400);
    $result = dbRun('INSERT INTO finance_approval_groups (name) VALUES (?)', [trim($body['name'])]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_create_approval_group', 'entityType' => 'finance_approval_group', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeApprovalGroup(dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$result['lastInsertId']])), 201);
});

$router->patch('/api/admin/finance/approval-groups/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $group = dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$params['id']]);
    if (!$group) jsonResponse(['error' => 'Group not found.'], 404);
    $body = requestBody();
    dbRun(
        "UPDATE finance_approval_groups SET name = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
        [
            array_key_exists('name', $body) && trim((string) $body['name']) !== '' ? trim($body['name']) : $group['name'],
            array_key_exists('active', $body) ? ($body['active'] ? 1 : 0) : $group['active'],
            $group['id'],
        ]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_update_approval_group', 'entityType' => 'finance_approval_group', 'entityId' => (string) $group['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeApprovalGroup(dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$group['id']])));
});

$router->delete('/api/admin/finance/approval-groups/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $group = dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$params['id']]);
    if (!$group) jsonResponse(['error' => 'Group not found.'], 404);
    $linked = dbGet('SELECT 1 AS x FROM expense_accounts WHERE approval_group_id = ?', [$group['id']]);
    if ($linked) jsonResponse(['error' => 'This group is linked to an account - unlink it there first, or deactivate the group.'], 400);
    dbRun('DELETE FROM finance_approval_group_members WHERE group_id = ?', [$group['id']]);
    dbRun('DELETE FROM finance_approval_groups WHERE id = ?', [$group['id']]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_delete_approval_group', 'entityType' => 'finance_approval_group', 'entityId' => (string) $group['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/admin/finance/approval-groups/:id/members', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $group = dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$params['id']]);
    if (!$group) jsonResponse(['error' => 'Group not found.'], 404);
    $body = requestBody();
    $userId = (int) ($body['userId'] ?? 0);
    $u = $userId ? dbGet("SELECT id FROM users WHERE id = ? AND portal_role != 'parent' AND account_status = 'active'", [$userId]) : null;
    if (!$u) jsonResponse(['error' => 'Pick an active leader/admin to add.'], 400);
    dbRun('INSERT OR IGNORE INTO finance_approval_group_members (group_id, user_id) VALUES (?, ?)', [$group['id'], $userId]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_add_approval_group_member', 'entityType' => 'finance_approval_group', 'entityId' => (string) $group['id'], 'ipAddress' => clientIp(), 'details' => ['userId' => $userId]]);
    jsonResponse(serializeApprovalGroup(dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$group['id']])));
});

$router->delete('/api/admin/finance/approval-groups/:id/members/:userId', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $group = dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$params['id']]);
    if (!$group) jsonResponse(['error' => 'Group not found.'], 404);
    dbRun('DELETE FROM finance_approval_group_members WHERE group_id = ? AND user_id = ?', [$group['id'], (int) $params['userId']]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_remove_approval_group_member', 'entityType' => 'finance_approval_group', 'entityId' => (string) $group['id'], 'ipAddress' => clientIp(), 'details' => ['userId' => (int) $params['userId']]]);
    jsonResponse(serializeApprovalGroup(dbGet('SELECT * FROM finance_approval_groups WHERE id = ?', [$group['id']])));
});

$router->get('/api/admin/finance/categories', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map('serializeCategory', dbAll('SELECT * FROM expense_categories ORDER BY name')));
});

$router->post('/api/admin/finance/categories', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    if (empty($body['name'])) jsonResponse(['error' => 'A category name is required.'], 400);
    $result = dbRun('INSERT INTO expense_categories (name, code) VALUES (?, ?)', [$body['name'], $body['code'] ?? null]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_create_finance_category', 'entityType' => 'expense_category', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeCategory(dbGet('SELECT * FROM expense_categories WHERE id = ?', [$result['lastInsertId']])));
});

$router->patch('/api/admin/finance/categories/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $category = dbGet('SELECT * FROM expense_categories WHERE id = ?', [$params['id']]);
    if (!$category) jsonResponse(['error' => 'Category not found.'], 404);
    $body = requestBody();
    dbRun('UPDATE expense_categories SET name = ?, code = ?, active = ? WHERE id = ?', [
        $body['name'] ?? $category['name'],
        array_key_exists('code', $body) ? $body['code'] : $category['code'],
        array_key_exists('active', $body) ? ($body['active'] ? 1 : 0) : $category['active'],
        $category['id'],
    ]);
    jsonResponse(serializeCategory(dbGet('SELECT * FROM expense_categories WHERE id = ?', [$category['id']])));
});

$router->delete('/api/admin/finance/categories/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $inUse = dbGet('SELECT 1 AS x FROM expense_claim_items WHERE category_id = ?', [$params['id']]);
    if ($inUse) jsonResponse(['error' => 'This category is in use on existing items - deactivate it instead of deleting.'], 400);
    dbRun('DELETE FROM expense_categories WHERE id = ?', [$params['id']]);
    jsonResponse(['ok' => true]);
});

$router->get('/api/admin/finance/mileage-rates', function ($params) {
    requireAdmin(requireAuth());
    jsonResponse(array_map(fn($r) => [
        'id' => (int) $r['id'], 'vehicleType' => $r['vehicle_type'], 'ratePerMile' => (float) $r['rate_per_mile'],
        'annualThresholdMiles' => $r['annual_threshold_miles'] !== null ? (float) $r['annual_threshold_miles'] : null,
        'rateAfterThreshold' => $r['rate_after_threshold'] !== null ? (float) $r['rate_after_threshold'] : null,
        'effectiveFrom' => $r['effective_from'],
    ], dbAll('SELECT * FROM mileage_rates ORDER BY vehicle_type, effective_from DESC')));
});

$router->post('/api/admin/finance/mileage-rates', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $body = requestBody();
    $validVehicles = ['car', 'motorcycle', 'bicycle', 'other'];
    if (!in_array($body['vehicleType'] ?? null, $validVehicles, true)) jsonResponse(['error' => 'vehicleType must be one of: ' . implode(', ', $validVehicles)], 400);
    if (!isset($body['ratePerMile']) || !isset($body['effectiveFrom'])) jsonResponse(['error' => 'ratePerMile and effectiveFrom are required.'], 400);
    $result = dbRun(
        'INSERT INTO mileage_rates (vehicle_type, rate_per_mile, annual_threshold_miles, rate_after_threshold, effective_from) VALUES (?, ?, ?, ?, ?)',
        [$body['vehicleType'], (float) $body['ratePerMile'], $body['annualThresholdMiles'] ?? null, $body['rateAfterThreshold'] ?? null, $body['effectiveFrom']]
    );
    logAudit(['userId' => $admin['id'], 'action' => 'admin_create_mileage_rate', 'entityType' => 'mileage_rate', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->delete('/api/admin/finance/mileage-rates/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    dbRun('DELETE FROM mileage_rates WHERE id = ?', [$params['id']]);
    logAudit(['userId' => $admin['id'], 'action' => 'admin_delete_mileage_rate', 'entityType' => 'mileage_rate', 'entityId' => (string) $params['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
