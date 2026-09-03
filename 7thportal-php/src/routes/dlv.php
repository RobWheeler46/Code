<?php
// External DLV email approval routes (FR-AA-017..030): admin settings, GLV resend, and
// the public no-login voting confirmation pages. The vote pages authenticate purely by
// the high-entropy token in the URL and expose no portal navigation or wider data.

// ── Admin: DLV email settings (FR-AA-018) ───────────────────────────────────────
$router->get('/api/admin/dlv-settings', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    jsonResponse(dlvSettings());
});

$router->put('/api/admin/dlv-settings', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    $b = requestBody();
    if (array_key_exists('email', $b) && trim((string) $b['email']) !== '' && !filter_var(trim((string) $b['email']), FILTER_VALIDATE_EMAIL)) {
        jsonResponse(['error' => 'Enter a valid DLV email address.'], 422);
    }
    dlvSaveSettings($b);
    logAudit(['userId' => $user['id'], 'action' => 'admin_dlv_settings', 'entityType' => 'settings', 'entityId' => null, 'ipAddress' => clientIp(), 'details' => array_intersect_key($b, array_flip(['email', 'displayName', 'voteDays', 'reminderDays', 'copyGlv', 'maxAttachMb']))]);
    jsonResponse(dlvSettings());
});

// ── GLV/Admin: resend an unanswered request (FR-AA-029) ─────────────────────────
// Reissues fresh voting tokens for the SAME immutable pack and voids the old ones.
$router->post('/api/activity/dlv-packs/:pid/resend', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $pack = dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$params['pid']]);
    if (!$pack) jsonResponse(['error' => 'Approval pack not found.'], 404);
    if ($pack['status'] !== 'awaiting') jsonResponse(['error' => 'Only an awaiting request can be resent.'], 409);
    $f = dbGet('SELECT * FROM activity_forms WHERE id = ?', [$pack['form_id']]);
    if (!$f || !activityCanView($user, $f)) jsonResponse(['error' => 'Not permitted.'], 403);
    dlvIssueTokens((int) $pack['id'], dlvSettings()['voteDays']);
    activityLogEvent((int) $f['id'], $user['id'], 'dlv_resend', 'glv', null);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_dlv_resend', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeDlvPack(dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack['id']])));
});

// ── Public no-login voting pages (FR-AA-022..024) ───────────────────────────────
// A minimal, self-contained page: no portal chrome, no navigation, no session. The GET
// only shows a confirmation UI; the vote commits on the POST, so an email scanner that
// pre-fetches the link can never cast a vote.
function dlvVotePage(string $title, string $bodyHtml, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Robots-Tag: noindex, nofollow');
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>' . $esc($title) . ' - 7thPortal</title>'
        . '<style>body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#eef3f2;color:#221c2e}'
        . '.wrap{max-width:560px;margin:0 auto;padding:1.5rem}.card{background:#fff;border:1px solid #d6e4e1;border-radius:14px;padding:1.4rem;margin-top:2rem;box-shadow:0 6px 18px rgba(27,21,51,.06)}'
        . 'h1{font-size:1.3rem;margin:.2rem 0 .2rem}.ref{color:#0f766e;font-weight:800;letter-spacing:.02em}.muted{color:#6b6478;font-size:.9rem}'
        . 'label{display:block;font-weight:600;margin:1rem 0 .3rem}textarea{width:100%;padding:.6rem;border:1px solid #d6e4e1;border-radius:8px;font:inherit;box-sizing:border-box}'
        . '.btn{display:inline-block;border:0;border-radius:999px;padding:.7rem 1.4rem;font-weight:700;font-size:1rem;cursor:pointer;text-decoration:none}'
        . '.btn-go{background:#0f766e;color:#fff}.btn-danger{background:#b3261e;color:#fff}.btn-sec{background:#e7efed;color:#221c2e}'
        . '.row{display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1.2rem;align-items:center}.brand{font-weight:800;color:#0f766e}.err{color:#b3261e}</style></head><body>'
        . '<div class="wrap"><div class="brand">7thPortal Activity Approval</div><div class="card">' . $bodyHtml . '</div>'
        . '<p class="muted" style="text-align:center;margin-top:1rem">This is a one-off approval link for a District volunteer. No 7thPortal account is required.</p></div></body></html>';
    exit;
}

function dlvContextHtml(array $snap): string
{
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $date = $snap['activityDate'] ?? '';
    return '<p class="ref">' . $esc($snap['reference'] ?? '') . '</p>'
        . '<h1>' . $esc($snap['activityDescription'] ?? 'Activity') . '</h1>'
        . '<p class="muted">' . $esc(trim(($date ? $date . ' · ' : '') . ($snap['activityLocation'] ?? '') . ' · ' . ($snap['sectionNames'] ?? ''), ' ·')) . '</p>'
        . '<p class="muted">The Group Lead Volunteer endorsed this activity for District approval.<br>Reason: ' . $esc($snap['referralReason'] ?? '') . '</p>';
}

$router->get('/activity/vote/:token', function ($params) {
    $look = dlvTokenLookup((string) $params['token']);
    if (!$look || !$look['pack']) dlvVotePage('Link not valid', '<h1>This voting link can no longer be used</h1><p class="muted">It may have expired, been replaced, already been used, or the activity may have been superseded.</p>', 404);
    $reason = dlvTokenBlockReason($look['token'], $look['pack']);
    if ($reason !== '') {
        dlvVotePage('Link not valid', '<h1>This voting link can no longer be used</h1><p class="muted">It may have expired, been replaced, already been voted, or the activity may have been superseded.</p><p class="muted">Reference: ' . htmlspecialchars((string) ($look['pack']['recipient_email'] ? json_decode($look['pack']['snapshot_json'], true)['reference'] ?? '' : ''), ENT_QUOTES) . '</p>', 410);
    }
    $snap = json_decode($look['pack']['snapshot_json'] ?: '{}', true) ?: [];
    $approve = $look['token']['action'] === 'approve';
    $heading = $approve ? 'APPROVE ACTIVITY' : 'REJECT ACTIVITY';
    $field = $approve
        ? '<label>Optional comment</label><textarea name="comment" rows="3" placeholder="Any note for the record"></textarea>'
        : '<label>Reason for rejection <span class="err">*</span></label><textarea name="comment" rows="3" placeholder="Please explain what needs to change" required></textarea>';
    $btn = $approve
        ? '<button class="btn btn-go" type="submit">Confirm approval</button>'
        : '<button class="btn btn-danger" type="submit">Confirm rejection</button>';
    $body = '<div class="muted" style="font-weight:800;letter-spacing:.05em;color:' . ($approve ? '#0f766e' : '#b3261e') . '">' . $heading . '</div>'
        . dlvContextHtml($snap)
        . '<p class="muted">By confirming, you ' . ($approve ? 'approve' : 'reject') . ' the activity represented by approval pack ' . htmlspecialchars($snap['reference'] ?? '', ENT_QUOTES) . ' v' . (int) $look['pack']['version'] . '.</p>'
        . '<form method="post" action="/activity/vote/' . htmlspecialchars((string) $params['token'], ENT_QUOTES) . '">' . $field
        . '<div class="row">' . $btn . '</div></form>';
    dlvVotePage($approve ? 'Approve activity' : 'Reject activity', $body);
});

$router->post('/activity/vote/:token', function ($params) {
    $look = dlvTokenLookup((string) $params['token']);
    if (!$look || !$look['pack']) dlvVotePage('Link not valid', '<h1>This voting link can no longer be used</h1><p class="muted">It may have expired or been replaced.</p>', 410);
    if (dlvTokenBlockReason($look['token'], $look['pack']) !== '') {
        dlvVotePage('Link not valid', '<h1>This voting link can no longer be used</h1><p class="muted">It may have expired, been replaced or already been used.</p>', 410);
    }
    $comment = trim((string) ($_POST['comment'] ?? (requestBody()['comment'] ?? '')));
    if ($look['token']['action'] === 'reject' && $comment === '') {
        // Re-render the reject page with an error.
        $snap = json_decode($look['pack']['snapshot_json'] ?: '{}', true) ?: [];
        dlvVotePage('Reject activity', '<div class="muted err" style="font-weight:800">A rejection reason is required.</div>' . dlvContextHtml($snap)
            . '<form method="post" action="/activity/vote/' . htmlspecialchars((string) $params['token'], ENT_QUOTES) . '"><label>Reason for rejection <span class="err">*</span></label><textarea name="comment" rows="3" required></textarea>'
            . '<div class="row"><button class="btn btn-danger" type="submit">Confirm rejection</button></div></form>', 422);
    }
    dlvApplyVote($look['token'], $look['pack'], $comment);
    $approve = $look['token']['action'] === 'approve';
    dlvVotePage($approve ? 'Approved' : 'Rejected',
        '<h1>' . ($approve ? 'Thank you - activity approved' : 'Recorded - activity rejected') . '</h1>'
        . '<p class="muted">Your decision has been recorded and the Group has been notified. You can close this page.</p>');
});
