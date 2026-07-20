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
    $result = dbRun(
        'INSERT INTO expense_claims (claim_number, claimant_user_id, title, notes) VALUES (?, ?, ?, ?)',
        [generateClaimNumber(), $user['id'], $body['title'], $body['notes'] ?? null]
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
    dbRun(
        "UPDATE expense_claims SET title = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
        [$body['title'] ?? $claim['title'], array_key_exists('notes', $body) ? $body['notes'] : $claim['notes'], $claim['id']]
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

    $itemNumber = (int) (dbGet('SELECT COALESCE(MAX(item_number), 0) AS n FROM expense_claim_items WHERE claim_id = ?', [$claim['id']])['n']) + 1;
    $result = dbRun(
        'INSERT INTO expense_claim_items (claim_id, item_number, item_type, title, account_id, category_id, expense_date, claimed_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $claim['id'], $itemNumber, $itemType, $body['title'], $account['id'], $body['categoryId'] ?? null,
            $body['expenseDate'] ?? null, $itemType === 'receipt' ? (float) ($body['claimedAmount'] ?? 0) : null,
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

    dbRun(
        "UPDATE expense_claim_items SET title = ?, account_id = ?, category_id = ?, expense_date = ?, claimed_amount = ?,
         receipt_exception_reason = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['title'] ?? $item['title'],
            $account ? $account['id'] : $item['account_id'],
            array_key_exists('categoryId', $body) ? $body['categoryId'] : $item['category_id'],
            $body['expenseDate'] ?? $item['expense_date'],
            $item['item_type'] === 'receipt' && array_key_exists('claimedAmount', $body) ? (float) $body['claimedAmount'] : $item['claimed_amount'],
            array_key_exists('receiptExceptionReason', $body) ? $body['receiptExceptionReason'] : $item['receipt_exception_reason'],
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
    }

    foreach ($submittable as $item) {
        $secondApprovalRequired = itemNeedsSecondApproval((float) $item['claimed_amount']);
        dbRun(
            "UPDATE expense_claim_items SET status = 'submitted', submitted_at = datetime('now'), second_approval_required = ?,
             more_info_requested_by = NULL, more_info_requested_at = NULL, more_info_note = NULL, updated_at = datetime('now') WHERE id = ?",
            [$secondApprovalRequired ? 1 : 0, $item['id']]
        );
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
    $claimIds = [];
    foreach ($items as $item) {
        dbRun('INSERT INTO expense_payment_items (payment_batch_id, claim_item_id, paid_amount) VALUES (?, ?, ?)', [$batch['lastInsertId'], $item['id'], $item['approved_amount'] ?? $item['claimed_amount']]);
        dbRun("UPDATE expense_claim_items SET status = 'paid', paid_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$item['id']]);
        $claimIds[(int) $item['claim_id']] = true;
    }
    foreach (array_keys($claimIds) as $claimId) { recalculateClaimStatus($claimId); }
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
    $result = dbRun(
        'INSERT INTO expense_accounts (name, code, approver_user_id, deputy_approver_user_id) VALUES (?, ?, ?, ?)',
        [$body['name'], $body['code'] ?? null, $body['approverUserId'] ?? null, $body['deputyApproverUserId'] ?? null]
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
    dbRun(
        "UPDATE expense_accounts SET name = ?, code = ?, approver_user_id = ?, deputy_approver_user_id = ?, active = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['name'] ?? $account['name'],
            array_key_exists('code', $body) ? $body['code'] : $account['code'],
            array_key_exists('approverUserId', $body) ? $body['approverUserId'] : $account['approver_user_id'],
            array_key_exists('deputyApproverUserId', $body) ? $body['deputyApproverUserId'] : $account['deputy_approver_user_id'],
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
