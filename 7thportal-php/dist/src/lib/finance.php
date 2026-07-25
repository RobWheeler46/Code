<?php
// Expenses, Mileage, Treasurer and Trustee Board finance module - multi-item
// claims model (7thPortal_Expenses_Data_Model.docx / _Database_Schema.docx /
// _API_Requirements.docx). A claim is a header; the financially meaningful
// records are its items - approval, rejection and payment all happen at
// item level, so one claim can mix receipt and mileage items across
// different accounts under a single claim reference. Built against the
// decisions in DECISIONS-finance-module.md - notably: no bank details are
// ever stored here (payment happens entirely in the existing bank process),
// and the module ships off by default via 'finance_enabled', same pattern
// as the photo gallery, until an admin turns it on for the pilot.
//
// Deliberately simplified vs. the technical appendices, to stay
// proportionate for a single-developer/volunteer-run project on SQLite:
// integer autoincrement IDs (not UUID), no malware/virus scanning on
// uploads (no infra for it, and not in DEPLOY.md's hosting checklist), no
// idempotency keys/ETag concurrency control (SQLite serialises writes;
// traffic scale here doesn't need it), no generic ApprovalRule matcher
// table (the actual policy only ever varies by account + a global
// threshold pair, which expense_accounts.approver/deputy + financeThresholds()
// already express fully), and no true split-amount partial payment of a
// single item (a payment batch can include several items in one action,
// but each item is paid in full).

define('RECEIPT_UPLOAD_DIR', __DIR__ . '/../../data/receipt-uploads');
if (!is_dir(RECEIPT_UPLOAD_DIR)) mkdir(RECEIPT_UPLOAD_DIR, 0775, true);
const RECEIPT_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function financeEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'finance_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireFinanceEnabled(): void
{
    if (!financeEnabled()) jsonResponse(['error' => 'The expenses and mileage module is not enabled yet. Ask a Portal Administrator to turn it on in Admin Settings.'], 403);
}

// Suggested starter thresholds accepted as-is (DECISIONS-finance-module.md
// item 3): up to tier1 -> single account approver; tier1-tier2 -> account
// approver, Treasurer reviews before payment (already the normal flow -
// every approved item passes through the Treasurer queue); over tier2 ->
// account approver AND a Treasurer/Chair second approval before it counts
// as fully approved.
function financeThresholds(): array
{
    $map = [];
    foreach (dbAll("SELECT * FROM settings WHERE key IN ('finance_threshold_tier1', 'finance_threshold_tier2', 'finance_retention_days')") as $row) {
        $map[$row['key']] = $row['value'];
    }
    return [
        'tier1' => (float) ($map['finance_threshold_tier1'] ?? 50),
        'tier2' => (float) ($map['finance_threshold_tier2'] ?? 250),
        'retentionDays' => (int) ($map['finance_retention_days'] ?? 730), // DECISIONS-finance-module.md item 5: 2 years
    ];
}

function itemNeedsSecondApproval(float $amount): bool
{
    return $amount > financeThresholds()['tier2'];
}

// ── Claim numbers ────────────────────────────────────────────────────────────

function generateClaimNumber(): string
{
    // Global sequence, not per-year-reset - simpler than a per-year counter
    // table and this Group won't remotely approach needing one in a year.
    $n = (int) (dbGet('SELECT COALESCE(MAX(id), 0) AS n FROM expense_claims')['n'] ?? 0) + 1;
    return 'EXP-' . date('Y') . '-' . str_pad((string) $n, 6, '0', STR_PAD_LEFT);
}

// ── Mileage ─────────────────────────────────────────────────────────────────

function activeMileageRate(string $vehicleType, string $journeyDate): ?array
{
    return dbGet(
        'SELECT * FROM mileage_rates WHERE vehicle_type = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1',
        [$vehicleType, $journeyDate]
    );
}

// UK tax year runs 6 April to 5 April - returns [start, end] as Y-m-d strings
// covering the tax year that $date falls within.
function ukTaxYearRange(string $date): array
{
    $y = (int) date('Y', strtotime($date));
    $aprilSixThisYear = "$y-04-06";
    if ($date >= $aprilSixThisYear) {
        return [$aprilSixThisYear, ($y + 1) . '-04-05'];
    }
    return [($y - 1) . '-04-06', "$y-04-05"];
}

// Implements the 2026/27 HMRC AMAP car/van tiering (55p for the claimant's
// first 10,000 business miles in the UK tax year, 25p after) via
// mileage_rates.annual_threshold_miles/rate_after_threshold - both null for
// vehicle types with a flat rate (motorcycle, bicycle), in which case this
// behaves exactly like a flat per-mile rate. $excludeItemId lets a PATCH on
// an existing item recalculate without double-counting its own previous miles.
function calculateMileageAmount(array $rate, float $miles, string $vehicleType, string $journeyDate, int $claimantUserId, ?int $excludeItemId = null): array
{
    if (!$rate['annual_threshold_miles']) {
        return ['amount' => round($miles * (float) $rate['rate_per_mile'], 2), 'thresholdApplied' => false];
    }
    [$taxYearStart, $taxYearEnd] = ukTaxYearRange($journeyDate);
    $sql = "SELECT COALESCE(SUM(md.miles_claimed), 0) AS n
            FROM expense_mileage_details md
            JOIN expense_claim_items eci ON eci.id = md.claim_item_id
            JOIN expense_claims ec ON ec.id = eci.claim_id
            WHERE ec.claimant_user_id = ? AND md.vehicle_type = ? AND eci.status != 'rejected'
              AND eci.expense_date >= ? AND eci.expense_date <= ?";
    $params = [$claimantUserId, $vehicleType, $taxYearStart, $taxYearEnd];
    if ($excludeItemId) { $sql .= ' AND eci.id != ?'; $params[] = $excludeItemId; }
    $priorMiles = (float) dbGet($sql, $params)['n'];

    $remainingAtFullRate = max(0, (float) $rate['annual_threshold_miles'] - $priorMiles);
    $milesAtFullRate = min($miles, $remainingAtFullRate);
    $milesAtReducedRate = $miles - $milesAtFullRate;
    $reducedRate = (float) ($rate['rate_after_threshold'] ?? $rate['rate_per_mile']);
    $amount = $milesAtFullRate * (float) $rate['rate_per_mile'] + $milesAtReducedRate * $reducedRate;
    return ['amount' => round($amount, 2), 'thresholdApplied' => $milesAtReducedRate > 0];
}

// ── Receipt storage - private, authenticated-proxy-only, same principle as
// the gallery's "no public image URL" design, just without the image
// processing (a receipt isn't a photo of a child, so no EXIF/resize need).
// One receipt can support multiple items (policy doc section 15), via the
// expense_claim_item_receipts join table. ──

function receiptStorageKey(): string { return bin2hex(random_bytes(20)); }
function receiptFilePathFor(string $key, string $ext): string { return RECEIPT_UPLOAD_DIR . "/$key.$ext"; }

// Sniffs the file type from its actual bytes rather than trusting the
// browser-supplied Content-Type or relying on the fileinfo extension (not
// guaranteed present on shared hosting, and not in DEPLOY.md's checklist) -
// getimagesize() and a PDF magic-byte check both work with only core PHP.
function detectReceiptExtension(string $tmpPath): ?string
{
    $info = @getimagesize($tmpPath);
    if ($info && ($info['mime'] ?? null) === 'image/jpeg') return 'jpg';
    if ($info && ($info['mime'] ?? null) === 'image/png') return 'png';
    $head = @file_get_contents($tmpPath, false, null, 0, 5);
    if ($head !== false && str_starts_with($head, '%PDF-')) return 'pdf';
    return null;
}

function saveReceiptFile(string $key, string $ext, string $data): void
{
    file_put_contents(receiptFilePathFor($key, $ext), $data);
}

function deleteReceiptFileOnDisk(string $storageKey): void
{
    foreach (['jpg', 'png', 'pdf'] as $ext) {
        $p = receiptFilePathFor($storageKey, $ext);
        if (is_file($p)) { unlink($p); return; }
    }
}

function linkReceiptToItem(int $receiptId, int $itemId): void
{
    dbRun('INSERT OR IGNORE INTO expense_claim_item_receipts (claim_item_id, receipt_id) VALUES (?, ?)', [$itemId, $receiptId]);
}

// Unlinks a receipt from one item; deletes the underlying receipt row/file
// too once no item references it any more, so uploads never become orphaned.
function unlinkReceiptFromItem(int $receiptId, int $itemId): void
{
    dbRun('DELETE FROM expense_claim_item_receipts WHERE claim_item_id = ? AND receipt_id = ?', [$itemId, $receiptId]);
    $stillLinked = dbGet('SELECT 1 AS x FROM expense_claim_item_receipts WHERE receipt_id = ?', [$receiptId]);
    if (!$stillLinked) {
        $receipt = dbGet('SELECT * FROM expense_receipts WHERE id = ?', [$receiptId]);
        if ($receipt) {
            deleteReceiptFileOnDisk($receipt['storage_key']);
            dbRun('DELETE FROM expense_receipts WHERE id = ?', [$receiptId]);
        }
    }
}

function receiptsForItem(int $itemId): array
{
    return dbAll(
        'SELECT r.* FROM expense_receipts r JOIN expense_claim_item_receipts j ON j.receipt_id = r.id WHERE j.claim_item_id = ? ORDER BY r.created_at',
        [$itemId]
    );
}

// ── Serialization ────────────────────────────────────────────────────────────

function serializeAccount(array $account): array
{
    $approver = $account['approver_user_id'] ? dbGet('SELECT id, first_name, last_name FROM users WHERE id = ?', [$account['approver_user_id']]) : null;
    $deputy = $account['deputy_approver_user_id'] ? dbGet('SELECT id, first_name, last_name FROM users WHERE id = ?', [$account['deputy_approver_user_id']]) : null;
    return [
        'id' => (int) $account['id'],
        'name' => $account['name'],
        'code' => $account['code'],
        'active' => (bool) $account['active'],
        'approver' => $approver ? ['id' => (int) $approver['id'], 'name' => $approver['first_name'] . ' ' . $approver['last_name']] : null,
        'deputyApprover' => $deputy ? ['id' => (int) $deputy['id'], 'name' => $deputy['first_name'] . ' ' . $deputy['last_name']] : null,
    ];
}

function serializeCategory(array $category): array
{
    return ['id' => (int) $category['id'], 'name' => $category['name'], 'code' => $category['code'], 'active' => (bool) $category['active']];
}

function serializeReceipt(array $receipt): array
{
    return ['id' => (int) $receipt['id'], 'filename' => $receipt['original_filename']];
}

// Joins in the parent claim's claimant/claim_number/claim_status so callers
// (permission checks, list views) don't need a second query.
function itemWithClaimQuery(): string
{
    return 'SELECT eci.*, ec.claimant_user_id AS claim_claimant_user_id, ec.claim_number AS claim_number,
             ec.title AS claim_title, ec.status AS claim_status
             FROM expense_claim_items eci JOIN expense_claims ec ON ec.id = eci.claim_id';
}

function loadItemWithClaim(int $itemId): ?array
{
    return dbGet(itemWithClaimQuery() . ' WHERE eci.id = ?', [$itemId]);
}

function serializeItem(array $item): array
{
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
    $category = $item['category_id'] ? dbGet('SELECT * FROM expense_categories WHERE id = ?', [$item['category_id']]) : null;
    $mileage = $item['item_type'] === 'mileage' ? dbGet('SELECT * FROM expense_mileage_details WHERE claim_item_id = ?', [$item['id']]) : null;
    $receipts = $item['item_type'] === 'receipt' ? receiptsForItem((int) $item['id']) : [];
    return [
        'id' => (int) $item['id'],
        'claimId' => (int) $item['claim_id'],
        'itemNumber' => (int) $item['item_number'],
        'itemType' => $item['item_type'],
        'title' => $item['title'],
        'account' => $account ? serializeAccount($account) : null,
        'category' => $category ? serializeCategory($category) : null,
        'expenseDate' => $item['expense_date'],
        'claimedAmount' => $item['claimed_amount'] !== null ? (float) $item['claimed_amount'] : null,
        'approvedAmount' => $item['approved_amount'] !== null ? (float) $item['approved_amount'] : null,
        'status' => $item['status'],
        'receiptExceptionReason' => $item['receipt_exception_reason'],
        'receipts' => array_map('serializeReceipt', $receipts),
        'mileage' => $mileage ? [
            'journeyPurpose' => $mileage['journey_purpose'],
            'startLocation' => $mileage['start_location'],
            'endLocation' => $mileage['end_location'],
            'returnJourney' => (bool) $mileage['return_journey'],
            'miles' => $mileage['miles_claimed'] !== null ? (float) $mileage['miles_claimed'] : null,
            'vehicleType' => $mileage['vehicle_type'],
            'rateApplied' => $mileage['rate_applied'] !== null ? (float) $mileage['rate_applied'] : null,
            'declarationAccepted' => (bool) $mileage['declaration_accepted'],
        ] : null,
        'secondApprovalRequired' => (bool) $item['second_approval_required'],
        'submittedAt' => $item['submitted_at'],
        'approvedAt' => $item['approved_at'],
        'secondApprovedAt' => $item['second_approved_at'],
        'rejectedAt' => $item['rejected_at'],
        'rejectionReason' => $item['rejection_reason'],
        'moreInfoRequestedAt' => $item['more_info_requested_at'],
        'moreInfoNote' => $item['more_info_note'],
        'readyForPaymentAt' => $item['ready_for_payment_at'],
        'paidAt' => $item['paid_at'],
        'createdAt' => $item['created_at'],
        'updatedAt' => $item['updated_at'],
    ];
}

// Used for approver/Treasurer list views, where - unlike the Trustee
// dashboard - knowing who submitted the item is exactly what the viewer
// needs to make their decision, so claimant name is included here.
// $item must come from itemWithClaimQuery().
function serializeItemWithClaimContext(array $item): array
{
    $claimant = dbGet('SELECT id, first_name, last_name FROM users WHERE id = ?', [$item['claim_claimant_user_id']]);
    return array_merge(serializeItem($item), [
        'claimNumber' => $item['claim_number'],
        'claimTitle' => $item['claim_title'],
        'claimId' => (int) $item['claim_id'],
        'claimant' => $claimant ? ['id' => (int) $claimant['id'], 'name' => $claimant['first_name'] . ' ' . $claimant['last_name']] : null,
    ]);
}

function itemsForClaim(int $claimId): array
{
    return dbAll('SELECT * FROM expense_claim_items WHERE claim_id = ? ORDER BY item_number', [$claimId]);
}

function serializeClaim(array $claim): array
{
    $items = itemsForClaim((int) $claim['id']);
    $claimant = dbGet('SELECT id, first_name, last_name FROM users WHERE id = ?', [$claim['claimant_user_id']]);
    $claimedTotal = array_sum(array_map(fn($i) => (float) ($i['claimed_amount'] ?? 0), array_filter($items, fn($i) => $i['status'] !== 'rejected')));
    $approvedTotal = array_sum(array_map(fn($i) => (float) ($i['approved_amount'] ?? $i['claimed_amount'] ?? 0), array_filter($items, fn($i) => in_array($i['status'], ['approved', 'ready_for_payment', 'paid'], true))));
    $payableTotal = array_sum(array_map(fn($i) => (float) ($i['approved_amount'] ?? $i['claimed_amount'] ?? 0), array_filter($items, fn($i) => in_array($i['status'], ['approved', 'ready_for_payment'], true))));
    return [
        'id' => (int) $claim['id'],
        'claimNumber' => $claim['claim_number'],
        'claimant' => $claimant ? ['id' => (int) $claimant['id'], 'name' => $claimant['first_name'] . ' ' . $claimant['last_name']] : null,
        'title' => $claim['title'],
        'notes' => $claim['notes'],
        'status' => $claim['status'],
        'claimTotalAmount' => round($claimedTotal, 2),
        'approvedTotalAmount' => round($approvedTotal, 2),
        'payableTotalAmount' => round($payableTotal, 2),
        'itemCount' => count($items),
        'items' => array_map('serializeItem', $items),
        'submittedAt' => $claim['submitted_at'],
        'createdAt' => $claim['created_at'],
        'updatedAt' => $claim['updated_at'],
    ];
}

// ── Claim status derivation (Database Schema doc "Recommended status
// rules") - claim_status is always computed from its items, never set
// directly, so it can't drift out of sync with reality. ────────────────────

function deriveClaimStatus(array $items): string
{
    if (count($items) === 0) return 'draft';
    $statuses = array_column($items, 'status');
    if (array_reduce($statuses, fn($carry, $s) => $carry && $s === 'draft', true)) return 'draft';

    $payable = array_filter($items, fn($i) => $i['status'] !== 'rejected');
    if (count($payable) === 0) return 'rejected';

    $payableStatuses = array_column($payable, 'status');
    $allPaid = array_reduce($payableStatuses, fn($carry, $s) => $carry && $s === 'paid', true);
    if ($allPaid) return 'paid';

    $anyPaid = in_array('paid', $payableStatuses, true);
    if ($anyPaid) return 'partially_paid';

    $approvedLike = ['approved', 'ready_for_payment', 'paid'];
    $allApproved = array_reduce($payableStatuses, fn($carry, $s) => $carry && in_array($s, $approvedLike, true), true);
    if ($allApproved) return 'approved';

    $anyApproved = count(array_filter($payableStatuses, fn($s) => in_array($s, $approvedLike, true))) > 0;
    if ($anyApproved) return 'partially_approved';

    return 'submitted';
}

function recalculateClaimStatus(int $claimId): void
{
    $items = itemsForClaim($claimId);
    $status = deriveClaimStatus($items);
    dbRun("UPDATE expense_claims SET status = ?, updated_at = datetime('now') WHERE id = ?", [$status, $claimId]);
}

// ── Permissions ──────────────────────────────────────────────────────────────

function isAccountApprover(array $user, array $account): bool
{
    return (int) $user['id'] === (int) ($account['approver_user_id'] ?? 0)
        || (int) $user['id'] === (int) ($account['deputy_approver_user_id'] ?? 0);
}

// EXP-003 (Must): a user must never approve their own claim item - not even
// an admin override, since that would defeat the whole point of the check.
// $item must come from itemWithClaimQuery() (needs claim_claimant_user_id).
function canActOnItemApproval(array $user, array $item): bool
{
    if ((int) $user['id'] === (int) $item['claim_claimant_user_id']) return false;
    $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$item['account_id']]);
    if (!$account) return false;
    return isAccountApprover($user, $account) || isAdminRole($user['portal_role']);
}

function canActOnSecondApproval(array $user, array $item): bool
{
    if ((int) $user['id'] === (int) $item['claim_claimant_user_id']) return false;
    return isTreasurerRole($user['portal_role']) || isChairRole($user['portal_role']);
}

// Whether $user may view the claim header $claim (a raw expense_claims row)
// at all - either as claimant, finance leadership, or an approver for at
// least one of its items.
function canViewClaimHeader(array $user, array $claim): bool
{
    if (isAdminRole($user['portal_role'])) return true;
    if ((int) $user['id'] === (int) $claim['claimant_user_id']) return true;
    if (isTreasurerRole($user['portal_role']) || isChairRole($user['portal_role']) || isTrusteeDashboardRole($user['portal_role'])) return true;
    foreach (dbAll('SELECT DISTINCT account_id FROM expense_claim_items WHERE claim_id = ?', [$claim['id']]) as $row) {
        $account = dbGet('SELECT * FROM expense_accounts WHERE id = ?', [$row['account_id']]);
        if ($account && isAccountApprover($user, $account)) return true;
    }
    return false;
}

function canViewReceipt(array $user, int $receiptId): bool
{
    $items = dbAll(
        'SELECT ec.* FROM expense_claim_item_receipts j
         JOIN expense_claim_items eci ON eci.id = j.claim_item_id
         JOIN expense_claims ec ON ec.id = eci.claim_id
         WHERE j.receipt_id = ?',
        [$receiptId]
    );
    foreach ($items as $claim) { if (canViewClaimHeader($user, $claim)) return true; }
    return false;
}

// What the *current viewer* may do with a specific item - keeps the
// approve/reject/self-approval rules in one place instead of duplicating
// them in the frontend. $item must come from itemWithClaimQuery().
function myActionsForItem(array $user, array $item): array
{
    $isOwner = (int) $user['id'] === (int) $item['claim_claimant_user_id'];
    return [
        'canEdit' => $isOwner && in_array($item['status'], ['draft', 'more_info_requested'], true),
        'canDelete' => $isOwner && $item['status'] === 'draft',
        'canApprove' => $item['status'] === 'submitted' && canActOnItemApproval($user, $item),
        'canRequestInfo' => $item['status'] === 'submitted' && canActOnItemApproval($user, $item),
        'canSecondApprove' => $item['status'] === 'pending_second_approval' && canActOnSecondApproval($user, $item),
        'canReject' => in_array($item['status'], ['submitted', 'pending_second_approval'], true)
            && (canActOnItemApproval($user, $item) || canActOnSecondApproval($user, $item)),
        'canMarkReadyForPayment' => $item['status'] === 'approved' && isTreasurerRole($user['portal_role']),
    ];
}

// ── Retention (DECISIONS-finance-module.md item 5: 2 years) ─────────────────
// Financial records are soft-archived, never hard-deleted, on the reasoning
// that an independent examiner/auditor may reasonably expect a paid claim's
// record to still exist even years later - unlike gallery photos, where
// deletion is the safeguarding-driven default (see pruneArchivedAlbums()).
function pruneOldClaims(): void
{
    $days = financeThresholds()['retentionDays'];
    $stale = dbAll("SELECT DISTINCT claim_id FROM expense_claim_items WHERE status = 'paid' AND paid_at < datetime('now', ?)", ["-$days days"]);
    dbRun("UPDATE expense_claim_items SET status = 'archived', updated_at = datetime('now')
           WHERE status = 'paid' AND paid_at < datetime('now', ?)", ["-$days days"]);
    foreach ($stale as $row) { recalculateClaimStatus((int) $row['claim_id']); }
}

// One-time starter data so an admin turning the module on for the pilot
// isn't looking at an empty accounts list - matches the pilot defaults
// accepted in DECISIONS-finance-module.md item 8 (Cubs/Scouts/Group).
// Approvers are deliberately left unset - "which named person approves
// which account" is still an open decision (item 2/3), not something to guess.
// Mileage rates are the 2026/27 HMRC AMAP rates (7th_Swindon_Scouts_Expenses
// _and_Mileage_Policy section 13) - car/van tiers at 10,000 miles/tax year.
function financeSeedDemoDataIfMissing(): void
{
    if (!dbGet('SELECT id FROM expense_accounts LIMIT 1')) {
        foreach (['Cubs', 'Scouts', 'Group'] as $name) {
            dbRun('INSERT INTO expense_accounts (name) VALUES (?)', [$name]);
        }
    }
    if (!dbGet('SELECT id FROM expense_categories LIMIT 1')) {
        foreach (['Equipment', 'Food & catering', 'Travel & mileage', 'Activity materials', 'Administration', 'Training', 'Other'] as $name) {
            dbRun('INSERT INTO expense_categories (name) VALUES (?)', [$name]);
        }
    }
    if (!dbGet('SELECT id FROM mileage_rates LIMIT 1')) {
        dbRun("INSERT INTO mileage_rates (vehicle_type, rate_per_mile, annual_threshold_miles, rate_after_threshold, effective_from) VALUES ('car', 0.55, 10000, 0.25, '2026-04-06')");
        dbRun("INSERT INTO mileage_rates (vehicle_type, rate_per_mile, effective_from) VALUES ('motorcycle', 0.24, '2026-04-06')");
        dbRun("INSERT INTO mileage_rates (vehicle_type, rate_per_mile, effective_from) VALUES ('bicycle', 0.20, '2026-04-06')");
    }
}

// ── CSV export (item-level per Data Model section 13 / API Requirements
// "Accounting export must be item-level and include claim number, item
// number, account code, category, amount, claimant, approval date and
// payment date") ─────────────────────────────────────────────────────────

// $rows must come from itemWithClaimQuery() (needs claim_number/claim_claimant_user_id).
function itemsToCsv(array $rows): string
{
    $out = fopen('php://temp', 'r+');
    fputcsv($out, ['Claim number', 'Item', 'Type', 'Claimant', 'Account', 'Category', 'Expense date', 'Claimed', 'Approved', 'Status', 'Approved at', 'Paid at']);
    foreach ($rows as $row) {
        $s = serializeItem($row);
        $claimant = dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$row['claim_claimant_user_id']]);
        fputcsv($out, [
            $row['claim_number'], $s['itemNumber'], $s['itemType'],
            $claimant ? $claimant['first_name'] . ' ' . $claimant['last_name'] : '',
            $s['account']['name'] ?? '', $s['category']['name'] ?? '', $s['expenseDate'],
            $s['claimedAmount'], $s['approvedAmount'], $s['status'], $s['approvedAt'], $s['paidAt'],
        ]);
    }
    rewind($out);
    $csv = stream_get_contents($out);
    fclose($out);
    return $csv;
}
