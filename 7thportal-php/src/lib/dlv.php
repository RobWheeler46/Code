<?php
// External DLV (District Lead Volunteer) email approval for Activity Approval
// (FR-AA-017..030). When a GLV endorses an activity for District approval, the portal
// freezes an immutable versioned evidence pack, records the DLV's external Approve/
// Reject vote via high-entropy no-login links, and drives the form's approval state and
// the final calendar/Event-Hub automation gate. The DLV never needs a portal account.
//
// This module owns settings, the snapshot/pack/token lifecycle and vote application.
// The PDF pack generation and the email delivery are layered on in their own units.

const DLV_SETTING_DEFAULTS = [
    'dlv_email' => '',
    'dlv_display_name' => 'District Lead Volunteer',
    'dlv_reply_to' => '',
    'dlv_vote_days' => '14',
    'dlv_reminder_days' => '5',
    'dlv_copy_glv' => 'true',
    'dlv_max_attach_mb' => '20',
    'dlv_subject_template' => 'Activity approval required - {activity} - {reference}',
];

const DLV_POLICY_REF = 'Swindon North Scout District Activity Approval Policy v3, 12 Apr 2026';

function dlvSettings(): array
{
    $map = [];
    foreach (dbAll("SELECT key, value FROM settings WHERE key LIKE 'dlv\\_%' ESCAPE '\\'") as $r) $map[$r['key']] = $r['value'];
    $g = fn($k) => $map[$k] ?? DLV_SETTING_DEFAULTS[$k];
    return [
        'email' => $g('dlv_email'),
        'displayName' => $g('dlv_display_name'),
        'replyTo' => $g('dlv_reply_to'),
        'voteDays' => (int) $g('dlv_vote_days'),
        'reminderDays' => (int) $g('dlv_reminder_days'),
        'copyGlv' => $g('dlv_copy_glv') === 'true',
        'maxAttachMb' => (int) $g('dlv_max_attach_mb'),
        'subjectTemplate' => $g('dlv_subject_template'),
        'configured' => trim((string) $g('dlv_email')) !== '',
    ];
}

function dlvSaveSettings(array $b): void
{
    $up = fn($k, $v) => dbRun("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [$k, $v]);
    if (array_key_exists('email', $b)) $up('dlv_email', trim((string) $b['email']));
    if (array_key_exists('displayName', $b)) $up('dlv_display_name', trim((string) $b['displayName']) ?: DLV_SETTING_DEFAULTS['dlv_display_name']);
    if (array_key_exists('replyTo', $b)) $up('dlv_reply_to', trim((string) $b['replyTo']));
    if (array_key_exists('voteDays', $b)) $up('dlv_vote_days', (string) max(1, (int) $b['voteDays']));
    if (array_key_exists('reminderDays', $b)) $up('dlv_reminder_days', (string) max(0, (int) $b['reminderDays']));
    if (array_key_exists('copyGlv', $b)) $up('dlv_copy_glv', !empty($b['copyGlv']) ? 'true' : 'false');
    if (array_key_exists('maxAttachMb', $b)) $up('dlv_max_attach_mb', (string) max(1, (int) $b['maxAttachMb']));
    if (array_key_exists('subjectTemplate', $b)) $up('dlv_subject_template', trim((string) $b['subjectTemplate']) ?: DLV_SETTING_DEFAULTS['dlv_subject_template']);
}

// Freeze the form's approval-relevant data for the immutable pack (field spec: counts,
// never youth names; leader contact; characteristics; evidence confirmations + the
// attachment manifest). This JSON is the single source the PDF is rendered from.
function dlvBuildSnapshot(array $f, array $glvUser, string $reason): array
{
    $files = array_map(fn($x) => [
        'name' => $x['original_name'] ?? ($x['file_name'] ?? 'file'),
        'category' => $x['category'] ?? null,
    ], dbAll('SELECT * FROM activity_form_files WHERE form_id = ?', [$f['id']]));
    return [
        'reference' => $f['reference'] ?: ('AAF-' . $f['id']),
        'activityDescription' => $f['activity_description'],
        'activityLocation' => $f['activity_location'],
        'activityDate' => $f['activity_date'],
        'activityEndDate' => $f['activity_end_date'],
        'leaderName' => $f['leader_name'],
        'leaderPhone' => $f['leader_phone'],
        'leaderEmail' => $f['leader_email'],
        'sectionNames' => $f['section_names'],
        'ypCount' => $f['yp_count'] !== null ? (int) $f['yp_count'] : null,
        'adultCount' => $f['adult_count'] !== null ? (int) $f['adult_count'] : null,
        'activityType' => $f['activity_type'],
        'qualifications' => $f['qualifications'],
        'inTouch' => $f['in_touch'],
        'externalProvider' => (bool) $f['external_provider_used'],
        'unityRequired' => (bool) $f['unity_approval_required'],
        'riskAssessmentConfirmed' => (bool) $f['risk_assessment_confirmed'],
        'publicLiabilityConfirmed' => (bool) $f['public_liability_confirmed'],
        'activityRulesConfirmed' => (bool) $f['activity_rules_confirmed'],
        'notes' => $f['notes'],
        'glvName' => trim(($glvUser['first_name'] ?? '') . ' ' . ($glvUser['last_name'] ?? '')) ?: 'GLV',
        'referralReason' => $reason,
        'submittedAt' => $f['submitted_at'],
        'policyRef' => DLV_POLICY_REF,
        'files' => $files,
    ];
}

// Create a new versioned pack, superseding any active one for the form (and voiding
// its live tokens). Status starts 'preparing'; the caller sends it and moves it on.
function dlvCreatePack(array $f, array $glvUser, string $reason): array
{
    dbRun("UPDATE activity_dlv_tokens SET void_at = datetime('now') WHERE used_at IS NULL AND void_at IS NULL AND pack_id IN (SELECT id FROM activity_dlv_packs WHERE form_id = ? AND status IN ('preparing','awaiting','failed'))", [$f['id']]);
    dbRun("UPDATE activity_dlv_packs SET status = 'superseded' WHERE form_id = ? AND status IN ('preparing','awaiting','failed')", [$f['id']]);
    $ver = (int) dbGet('SELECT COALESCE(MAX(version), 0) + 1 AS n FROM activity_dlv_packs WHERE form_id = ?', [$f['id']])['n'];
    $s = dlvSettings();
    $res = dbRun(
        'INSERT INTO activity_dlv_packs (form_id, version, status, referral_reason, snapshot_json, recipient_email, recipient_name, glv_user_id, glv_user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [$f['id'], $ver, 'preparing', $reason, json_encode(dlvBuildSnapshot($f, $glvUser, $reason)), $s['email'], $s['displayName'], $glvUser['id'], trim(($glvUser['first_name'] ?? '') . ' ' . ($glvUser['last_name'] ?? '')) ?: null]
    );
    return dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$res['lastInsertId']]);
}

// Issue a fresh Approve + Reject token pair for a pack (voiding any earlier live ones),
// and stamp the shared expiry. Returns ['approve' => token, 'reject' => token].
function dlvIssueTokens(int $packId, int $voteDays): array
{
    dbRun("UPDATE activity_dlv_tokens SET void_at = datetime('now') WHERE pack_id = ? AND used_at IS NULL AND void_at IS NULL", [$packId]);
    $expires = gmdate('Y-m-d H:i:s', strtotime('+' . max(1, $voteDays) . ' days'));
    $out = [];
    foreach (['approve', 'reject'] as $action) {
        $tok = bin2hex(random_bytes(32));
        dbRun('INSERT INTO activity_dlv_tokens (pack_id, action, token, expires_at) VALUES (?, ?, ?, ?)', [$packId, $action, $tok, $expires]);
        $out[$action] = $tok;
    }
    dbRun('UPDATE activity_dlv_packs SET expires_at = ? WHERE id = ?', [$expires, $packId]);
    return $out;
}

function dlvTokenLookup(string $token): ?array
{
    if (!preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $t = dbGet('SELECT * FROM activity_dlv_tokens WHERE token = ?', [$token]);
    if (!$t) return null;
    return ['token' => $t, 'pack' => dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$t['pack_id']])];
}

// Why a link can't vote right now: '' means it can. Order matters (used before expired).
function dlvTokenBlockReason(array $t, array $pack): string
{
    if (!empty($t['used_at'])) return 'used';
    if (!empty($t['void_at'])) return 'void';
    if (!empty($t['expires_at']) && $t['expires_at'] < gmdate('Y-m-d H:i:s')) return 'expired';
    if (($pack['status'] ?? '') !== 'awaiting') return 'closed';
    return '';
}

// Apply a confirmed DLV vote: consume the token, void its sibling, decide the pack, and
// move the form's approval state (approve -> approved + calendar automation; reject ->
// back to the GLV/leader as more-info). Notifies the leader and the referring GLV.
function dlvApplyVote(array $t, array $pack, string $comment): array
{
    dbRun("UPDATE activity_dlv_tokens SET used_at = datetime('now') WHERE id = ?", [$t['id']]);
    dbRun("UPDATE activity_dlv_tokens SET void_at = datetime('now') WHERE pack_id = ? AND id != ? AND used_at IS NULL AND void_at IS NULL", [$pack['id'], $t['id']]);
    $approve = $t['action'] === 'approve';
    dbRun("UPDATE activity_dlv_packs SET status = ?, decision = ?, decision_comment = ?, decided_at = datetime('now') WHERE id = ?",
        [$approve ? 'approved' : 'rejected', $t['action'], $comment ?: null, $pack['id']]);

    $f = dbGet('SELECT * FROM activity_forms WHERE id = ?', [$pack['form_id']]);
    $ref = $f['reference'] ?: ('AAF-' . $f['id']);
    if ($approve) {
        // DLV approval is the final authority - run the same calendar automation as a
        // final GLV approval (this is the gate that was blocked while awaiting the vote).
        $calId = function_exists('activityCreateCalendarEntry') ? activityCreateCalendarEntry($f, (int) ($pack['glv_user_id'] ?? 0)) : null;
        dbRun("UPDATE activity_forms SET status = 'approved', dlv_stage = 'approved', calendar_entry_id = ?, updated_at = datetime('now') WHERE id = ?", [$calId, $f['id']]);
        if (function_exists('activityLogEvent')) activityLogEvent((int) $f['id'], null, 'dlv_approve', 'dlv', $comment ?: null);
        notify((int) $f['created_by'], 'activity_form', 'Activity approved by the DLV', $ref . ' was approved by the District Lead Volunteer.' . ($calId ? ' A draft calendar entry was created.' : ''), 'activity-form.html?id=' . $f['id']);
        if (!empty($pack['glv_user_id'])) notify((int) $pack['glv_user_id'], 'activity_form', 'DLV approved', $ref . ' was approved by the DLV.', 'activity-form.html?id=' . $f['id']);
    } else {
        dbRun("UPDATE activity_forms SET status = 'more_info', more_info_stage = 'glv', dlv_stage = 'rejected', updated_at = datetime('now') WHERE id = ?", [$f['id']]);
        if (function_exists('activityLogEvent')) activityLogEvent((int) $f['id'], null, 'dlv_reject', 'dlv', $comment ?: null);
        notify((int) $f['created_by'], 'activity_form', 'Activity not approved by the DLV', $ref . ' was not approved. Reason: ' . $comment, 'activity-form.html?id=' . $f['id']);
        if (!empty($pack['glv_user_id'])) notify((int) $pack['glv_user_id'], 'activity_form', 'DLV rejected', $ref . ' was rejected by the DLV. Reason: ' . $comment, 'activity-form.html?id=' . $f['id']);
    }
    return dbGet('SELECT * FROM activity_dlv_packs WHERE id = ?', [$pack['id']]);
}

function serializeDlvPack(array $p): array
{
    return [
        'id' => (int) $p['id'],
        'formId' => (int) $p['form_id'],
        'version' => (int) $p['version'],
        'status' => $p['status'],
        'referralReason' => $p['referral_reason'],
        'recipientEmail' => $p['recipient_email'],
        'recipientName' => $p['recipient_name'],
        'glvName' => $p['glv_user_name'],
        'generatedAt' => $p['generated_at'],
        'sentAt' => $p['sent_at'],
        'sendError' => $p['send_error'],
        'expiresAt' => $p['expires_at'],
        'decision' => $p['decision'],
        'decisionComment' => $p['decision_comment'],
        'decidedAt' => $p['decided_at'],
        'snapshot' => json_decode($p['snapshot_json'] ?: '{}', true) ?: [],
    ];
}

// The current (most recent) pack for a form, or null.
function dlvActivePack(int $formId): ?array
{
    return dbGet('SELECT * FROM activity_dlv_packs WHERE form_id = ? ORDER BY version DESC LIMIT 1', [$formId]);
}

// ── Immutable PDF evidence pack (FR-AA-019) ─────────────────────────────────────
// The pack layout, as pdfBuild() blocks, straight from the frozen snapshot. Follows
// the DLV Approval Pack field spec: counts (never youth names), leader contact,
// characteristics, evidence confirmations, GLV endorsement and the attachment manifest.
function dlvPackBlocks(array $s): array
{
    $yn = fn($b) => !empty($b) ? 'Yes' : 'No';
    $dates = trim(($s['activityDate'] ?? '') . (!empty($s['activityEndDate']) && $s['activityEndDate'] !== ($s['activityDate'] ?? '') ? ' - ' . $s['activityEndDate'] : ''));
    $b = [
        ['h1', '7thPortal - DLV Activity Approval Pack'],
        ['text', 'Group endorsed - awaiting DLV decision. This pack contains the minimum information required to approve the activity: participant counts, not young-person names.'],
        ['rule'],
        ['h2', 'Approval request'],
        ['kv', 'Reference', $s['reference'] ?? ''],
        ['kv', 'District policy', $s['policyRef'] ?? DLV_POLICY_REF],
        ['kv', 'Pack generated', gmdate('d M Y H:i') . ' UTC'],
        ['kv', 'Submitted', $s['submittedAt'] ?? ''],
        ['h2', 'Activity'],
        ['kv', 'Description', $s['activityDescription'] ?? ''],
        ['kv', 'Date', $dates],
        ['kv', 'Location', $s['activityLocation'] ?? ''],
        ['kv', 'Section(s)', $s['sectionNames'] ?? ''],
        ['kv', 'Estimated young people', $s['ypCount'] !== null ? (string) $s['ypCount'] : ''],
        ['kv', 'Estimated adults', $s['adultCount'] !== null ? (string) $s['adultCount'] : ''],
        ['h2', 'Leader in charge'],
        ['kv', 'Name', $s['leaderName'] ?? ''],
        ['kv', 'Phone', $s['leaderPhone'] ?? ''],
        ['kv', 'Email', $s['leaderEmail'] ?? ''],
        ['h2', 'Characteristics & evidence'],
        ['kv', 'Activity type', $s['activityType'] ?? ''],
        ['kv', 'External provider', $yn($s['externalProvider'] ?? false)],
        ['kv', 'Unity insurance', !empty($s['unityRequired']) ? 'Required / evidence attached' : 'Not required'],
        ['kv', 'Qualifications', $s['qualifications'] ?? ''],
        ['kv', 'In Touch process', $s['inTouch'] ?? ''],
        ['kv', 'Risk assessment confirmed', $yn($s['riskAssessmentConfirmed'] ?? false)],
        ['kv', 'Public liability confirmed', $yn($s['publicLiabilityConfirmed'] ?? false)],
        ['kv', 'Activity Rules confirmed', $yn($s['activityRulesConfirmed'] ?? false)],
        ['h2', 'GLV endorsement / DLV referral'],
        ['kv', 'Endorsed by (GLV)', $s['glvName'] ?? ''],
        ['kv', 'Referral reason', $s['referralReason'] ?? ''],
    ];
    if (!empty($s['notes'])) $b[] = ['kv', 'Notes', $s['notes']];
    $b[] = ['h2', 'Attachment manifest'];
    if (!empty($s['files'])) {
        foreach ($s['files'] as $f) $b[] = ['kv', ucfirst((string) ($f['category'] ?? 'document')), $f['name'] ?? 'file'];
    } else {
        $b[] = ['text', 'No supporting files were attached to this submission.'];
    }
    return $b;
}

// Render the pack PDF to disk (data/dlv-packs/) and record its path. Idempotent per
// pack version - the file is the immutable artefact emailed to the DLV.
function dlvRenderPackPdf(array $pack): string
{
    if (!function_exists('pdfBuild')) return '';
    $snap = json_decode($pack['snapshot_json'] ?: '{}', true) ?: [];
    $bytes = pdfBuild(dlvPackBlocks($snap));
    $dir = dirname(__DIR__, 2) . '/data/dlv-packs';
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    $file = $dir . '/pack-' . (int) $pack['id'] . '-v' . (int) $pack['version'] . '.pdf';
    file_put_contents($file, $bytes);
    dbRun('UPDATE activity_dlv_packs SET pdf_path = ? WHERE id = ?', [$file, $pack['id']]);
    return $file;
}

// The DLV-facing filename for the pack PDF.
function dlvPackFilename(array $pack, array $snap): string
{
    return ($snap['reference'] ?? ('AAF-' . $pack['form_id'])) . '-DLV-Approval-Pack-v' . (int) $pack['version'] . '.pdf';
}

// ── Email delivery of the pack (FR-AA-020/021) ──────────────────────────────────
// The public base URL the DLV's vote links resolve against: an explicit APP_BASE_URL
// wins, otherwise it's derived from the current request (honouring a proxy's scheme).
function dlvBaseUrl(): string
{
    $env = function_exists('env') ? trim((string) env('APP_BASE_URL')) : '';
    if ($env !== '') return rtrim($env, '/');
    $scheme = (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')) ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    return $scheme . '://' . $host;
}

const DLV_EXT_MIME = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'gif' => 'image/gif', 'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'txt' => 'text/plain'];

// Email the pack + all supporting evidence to the DLV with the two voting links.
// FR-AA-020: never silently omit evidence - if a file can't be read or the total
// exceeds the configured limit, the request is marked failed (not sent) with a clear
// reason for the GLV to resolve. Returns ['status' => 'awaiting'|'failed', ...].
function dlvSendPack(array $pack, array $tokens): array
{
    $s = dlvSettings();
    $snap = json_decode($pack['snapshot_json'] ?: '{}', true) ?: [];

    // Attachments: the immutable PDF pack first, then every supporting file.
    $atts = [['filename' => dlvPackFilename($pack, $snap), 'mime' => 'application/pdf',
        'content' => ($pack['pdf_path'] && is_file($pack['pdf_path'])) ? file_get_contents($pack['pdf_path']) : pdfBuild(dlvPackBlocks($snap))]];
    $missing = [];
    foreach (dbAll('SELECT * FROM activity_form_files WHERE form_id = ?', [$pack['form_id']]) as $file) {
        $path = function_exists('activityFilePathFor') ? activityFilePathFor($file['storage_key'], $file['ext']) : null;
        if ($path && is_file($path)) {
            $atts[] = ['filename' => $file['original_filename'] ?: ('evidence.' . $file['ext']), 'mime' => DLV_EXT_MIME[strtolower($file['ext'])] ?? 'application/octet-stream', 'content' => file_get_contents($path)];
        } else {
            $missing[] = $file['original_filename'] ?: $file['storage_key'];
        }
    }
    $fail = function (string $why) use ($pack) {
        dbRun("UPDATE activity_dlv_packs SET status = 'failed', send_error = ? WHERE id = ?", [$why, $pack['id']]);
        return ['status' => 'failed', 'error' => $why];
    };
    if ($missing) return $fail('Some supporting files could not be attached: ' . implode(', ', $missing) . '. Re-upload them, then resend.');
    $total = array_sum(array_map(fn($a) => strlen((string) $a['content']), $atts));
    if ($total > $s['maxAttachMb'] * 1024 * 1024) {
        return $fail('The evidence pack is ' . round($total / 1048576, 1) . ' MB, over the ' . $s['maxAttachMb'] . ' MB email limit. Reduce file sizes, then resend.');
    }

    $base = dlvBaseUrl();
    $approveUrl = $base . '/activity/vote/' . $tokens['approve'];
    $rejectUrl = $base . '/activity/vote/' . $tokens['reject'];
    $subject = strtr($s['subjectTemplate'], ['{activity}' => $snap['activityDescription'] ?? 'Activity', '{reference}' => $snap['reference'] ?? '']);
    $body = "Hello " . ($s['displayName'] ?: 'District Lead Volunteer') . ",\n\n"
        . "7th Swindon Scouts has referred the following activity for your approval.\n\n"
        . "Activity: " . ($snap['activityDescription'] ?? '') . "\n"
        . "Date: " . ($snap['activityDate'] ?? '') . "\n"
        . "Location: " . ($snap['activityLocation'] ?? '') . "\n"
        . "Sections: " . ($snap['sectionNames'] ?? '') . "\n"
        . "Leader in Charge: " . ($snap['leaderName'] ?? '') . "\n"
        . "Reference: " . ($snap['reference'] ?? '') . "\n\n"
        . "GLV endorsement\nThe Group Lead Volunteer has reviewed and endorsed the activity for District approval.\nReason: " . ($snap['referralReason'] ?? '') . "\n\n"
        . "Attached\n" . implode("\n", array_map(fn($a) => '- ' . $a['filename'], $atts)) . "\n\n"
        . "Please review the attached approval pack and supporting evidence, then vote:\n\n"
        . "APPROVE: " . $approveUrl . "\nREJECT:  " . $rejectUrl . "\n\n"
        . "Each link opens a confirmation page - no 7thPortal account is required.\n"
        . ($pack['expires_at'] ? "This voting request expires on " . date('j F Y', strtotime($pack['expires_at'])) . ".\n" : '')
        . ($s['replyTo'] ? "Questions can be sent by replying to this email.\n" : '');

    $opts = ['replyTo' => $s['replyTo'] ?: null, 'cc' => []];
    if ($s['copyGlv'] && !empty($pack['glv_user_id'])) {
        $g = dbGet('SELECT email FROM users WHERE id = ?', [$pack['glv_user_id']]);
        if ($g && !empty($g['email'])) $opts['cc'][] = $g['email'];
    }
    try {
        $sent = function_exists('sendEmailWithAttachments') ? sendEmailWithAttachments($s['email'], $subject, $body, $atts, $opts) : false;
    } catch (Throwable $e) {
        return $fail('The email could not be sent: ' . substr($e->getMessage(), 0, 200));
    }
    if ($sent) {
        dbRun("UPDATE activity_dlv_packs SET status = 'awaiting', sent_at = datetime('now'), send_error = NULL WHERE id = ?", [$pack['id']]);
        return ['status' => 'awaiting', 'sent' => true];
    }
    // Mailer not configured (e.g. the demo/test environment): the request is live but
    // no email left the building. Not a hard failure - the GLV can resend once SMTP is on.
    dbRun("UPDATE activity_dlv_packs SET status = 'awaiting', send_error = 'Email was not delivered (no mail server is configured on this environment).' WHERE id = ?", [$pack['id']]);
    return ['status' => 'awaiting', 'sent' => false];
}
