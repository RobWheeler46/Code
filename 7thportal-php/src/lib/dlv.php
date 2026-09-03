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
