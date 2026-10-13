<?php
// FRD 2.1 operations logic: terms, sender suspension, row entry validation, alerts, alerts.

const TERMS_VERSION = '2026-10-v1'; // bump when the terms or acceptable-use rules change materially

function terms_ok(array $u): bool { return ($u['terms_version'] ?? '') === TERMS_VERSION; }
function accept_terms(int $uid): void { q('update users set terms_version=?, terms_at=? where id=?', [TERMS_VERSION, time(), $uid]); }

/** FR-133: a suspended sender cannot submit or test. Neutral message, support reference, nothing about reports. */
function sender_blocked(array $u): ?string {
    return !empty($u['suspended']) ? 'Sending is not available on this account right now. Please contact support and quote reference A-' . $u['id'] . '.' : null;
}
function suspend_sender(int $uid, string $reason, int $actor): int {
    q('update users set suspended=1, suspend_reason=? where id=?', [$reason, $uid]);
    $n = q("update recipients set status='cancelled', error='Account suspended' where status='queued' and send_id in (select id from sends where user_id=?)", [$uid])->rowCount(); // unclaimed only
    audit($actor, 'sender_suspended', "user $uid, $n queued cancelled, reason: $reason");
    return $n;
}
function reinstate_sender(int $uid, string $reason, int $actor): void { q('update users set suspended=0, suspend_reason=null where id=?', [$uid]); audit($actor, 'sender_reinstated', "user $uid, reason: $reason"); }

/** FR-137: validate recipient rows. Returns [rows of [name, email, own], errors keyed name/email/msg plus row index]. Blank rows are ignored. */
function parse_rows(array $names, array $emails, array $msgs): array {
    $rows = []; $errs = []; $seen = [];
    $count = max(count($names), count($emails), count($msgs));
    for ($i = 0; $i < $count; $i++) {
        $n = trim((string)($names[$i] ?? '')); $e = trim((string)($emails[$i] ?? '')); $m = trim((string)($msgs[$i] ?? ''));
        if ($n === '' && $e === '' && $m === '') continue;
        if ($n === '' || mb_strlen($n) > 100) $errs["name$i"] = 'Enter a name of 1 to 100 characters.';
        $ne = norm_email($e);
        if (!filter_var($ne, FILTER_VALIDATE_EMAIL)) $errs["email$i"] = 'Enter a valid email address.';
        elseif (isset($seen[strtolower($ne)])) $errs["email$i"] = 'This address is already on the card.';
        if (mb_strlen($m) > msg_max()) $errs["msg$i"] = 'Use ' . msg_max() . ' characters or fewer.';
        elseif ($m !== '' && ($bad = abuse_check($m))) $errs["msg$i"] = ucfirst($bad);
        if (!isset($errs["name$i"]) && !isset($errs["email$i"]) && !isset($errs["msg$i"])) { $seen[strtolower($ne)] = 1; $rows[] = [$n, $ne, $m]; }
    }
    return [$rows, $errs];
}

// ---- alerts (FR-134): keyed so each condition notifies once, escalates once, and clears itself when resolved
function health_alerts(): array {
    $a = []; $now = time(); $hb = (int)setting('last_queue'); $bk = (int)setting('last_backup');
    if (!$hb) $a['cron'] = 'Scheduled job: Unknown (it has never reported).'; elseif ($now - $hb > 300) $a['cron'] = 'Scheduled job is Stale: last ran ' . when($hb) . '.';
    if (!$bk) $a['backup'] = 'Backup: Unknown (no backup recorded).'; elseif ($now - $bk > 129600) $a['backup'] = 'Backup is Stale: last ' . when($bk) . '.';
    $p = (int)one("select count(*) c from sends where status='awaiting_payment' and updated<?", [$now - 900])['c'];
    if ($p) $a['pay15'] = "$p payment attempts have been pending over 15 minutes (not failed; investigate).";
    $o = (int)one("select count(*) c from sends where status='awaiting_payment' and updated<?", [$now - 86400])['c'];
    if ($o) $a['pay24'] = "$o payment attempts pending over 24 hours: escalate to the Treasurer.";
    $f = (int)one("select count(*) c from recipients where status in ('failed','bounced')")['c'];
    if ($f) $a['failed'] = "$f deliveries have failed and need correction.";
    $q = one("select min(s.queued_at) t from recipients r join sends s on s.id=r.send_id where r.status='queued'");
    if ($q && $q['t'] && $now - (int)$q['t'] > 900 && setting('paused') !== '1') $a['queue'] = 'Queue is stalled: the oldest queued card has waited since ' . when((int)$q['t']) . '.';
    $of = (int)setting('last_offsite'); if (!$of) $a['offsite'] = 'Off-server backup: Unknown (none recorded).'; elseif ($now - $of > 129600) $a['offsite'] = 'Off-server backup is Stale: last ' . when($of) . '.';
    $rt = (int)setting('last_restore_test'); if (!$rt) $a['restore'] = 'Restore rehearsal: never done.'; elseif (!str_starts_with((string)setting('last_restore_result'), 'ok')) $a['restore'] = 'The last restore rehearsal failed: ' . setting('last_restore_result') . '.';
    $ex = payment_exceptions(); if ($ex['events'] || $ex['orphans']) $a['payexc'] = count($ex['events']) + count($ex['orphans']) . ' payment exceptions need finance review.';
    $cm = (int)one("select count(*) c from bounces where kind='complaint' and at>?", [$now - 86400])['c']; if ($cm) $a['complaint'] = "$cm spam complaints in the last day.";
    $rl = (int)one("select count(*) c from audit where action in ('rate_limited','honeypot') and created>?", [$now - 3600])['c']; if ($rl >= 20) $a['abuse'] = "$rl blocked or suspicious attempts in the last hour.";
    if ((int)one('select count(*) c from users where is_admin=1')['c'] > 0) { $ar = (int)setting('access_review_at'); if (!$ar || $now - $ar > 90 * 86400) $a['access'] = 'Administrator access has not been reviewed in the last 90 days.'; }
    return $a;
}
function alert_list(string $key): array { return array_values(array_filter(array_map('trim', explode(',', setting($key))))); }

/** Run from cron. New condition: email the alert list. Unacknowledged past the escalation time: email the second list once. Cleared condition: mark resolved. Returns emails sent. */
function alerts_tick(?int $now = null): int {
    $now ??= time(); $sent = 0; $cur = health_alerts(); $first = alert_list('alert_emails'); $second = alert_list('alert_escalate_emails');
    $after = max(1, (int)setting('alert_escalate_minutes', '60')) * 60; // placeholder until D-15 is approved
    foreach ($cur as $k => $text) {
        $row = one('select * from alerts where akey=?', [$k]);
        if (!$row || $row['resolved_at']) {
            q('insert or replace into alerts(akey,text,severity,first_seen,last_notified,escalated) values(?,?,?,?,?,0)', [$k, $text, in_array($k, ['pay24', 'queue', 'cron']) ? 'high' : 'normal', $now, $now]);
            foreach ($first as $to) { mail_send($to, '[eCards] Alert: ' . $k, "$text\n\nSeen: " . date('j M Y H:i', $now) . "\nAcknowledge it here: " . base_url() . "/admin/health\n"); $sent++; }
            continue;
        }
        q('update alerts set text=? where akey=?', [$text, $k]);
        if (!$row['acked_at'] && !$row['escalated'] && $now - (int)$row['first_seen'] > $after) {
            q('update alerts set escalated=1 where akey=?', [$k]);
            foreach ($second as $to) { mail_send($to, '[eCards] ESCALATED alert: ' . $k, "Not acknowledged after " . intdiv($after, 60) . " minutes.\n$text\n" . base_url() . "/admin/health\n"); $sent++; }
        }
    }
    foreach (all('select akey from alerts where resolved_at is null') as $r) if (!isset($cur[$r['akey']])) q('update alerts set resolved_at=? where akey=?', [$now, $r['akey']]);
    return $sent;
}
function alerts_daily(): int {
    if (sending_state() !== 'open') return 0;
    $cur = health_alerts(); $n = 0;
    foreach (alert_list('alert_emails') as $to) { mail_send($to, '[eCards] Daily summary', $cur ? "Open alerts:\n- " . implode("\n- ", $cur) . "\n" . base_url() . "/admin/health\n" : "No alerts. Queue and payments look normal.\n"); $n++; }
    return $n;
}

// ---- FR-144: optional once-a-year reminder. Consent is a separate, unticked choice; withdrawal is one click from every message.
function remind_token(int $uid): string {
    if (setting('secret') === '') set_setting('secret', bin2hex(random_bytes(24)));
    return hash_hmac('sha256', "remind-$uid", setting('secret'));
}
function remind_link(int $uid): string { return base_url() . "/remind-off?u=$uid&t=" . remind_token($uid); }
/** Sends at most one reminder per consenting, active user per calendar year. Returns how many were sent. */
function send_reminders(?int $year = null): int {
    $year ??= (int)date('Y'); $n = 0;
    foreach (all("select * from users where remind=1 and verified=1 and suspended=0 and (remind_year is null or remind_year<>?) and email not like '%@deleted.invalid'", [$year]) as $u) {
        if (mail_send($u['email'], 'Time to send Christmas cards? From 7th Swindon Scouts', "Hello {$u['name']},\n\nYou asked for a yearly reminder to send Christmas cards. You can send them at " . base_url() . "/. Sending is free.\n\nThis is the only email of this kind we send each year. To stop it, one click: " . remind_link((int)$u['id']) . "\n\n7th Swindon Scouts") === null) { q('update users set remind_year=? where id=?', [$year, $u['id']]); $n++; }
    }
    return $n;
}
function r_remind_off(): void {
    $uid = (int)($_GET['u'] ?? $_POST['u'] ?? 0); $t = (string)($_GET['t'] ?? $_POST['t'] ?? '');
    if (!$uid || !hash_equals(remind_token($uid), $t)) fail(404, 'That link is not valid.'); // same reply for unknown and wrong
    if (post()) { q('update users set remind=0 where id=?', [$uid]); page('Reminder stopped', '<h1>Done</h1><p>We will not send you that reminder again.</p>'); }
    page('Stop the reminder', '<h1>Stop the yearly reminder?</h1><form method="post">' . csrf() . '<input type="hidden" name="u" value="' . $uid . '"><input type="hidden" name="t" value="' . h($t) . '"><button class="btn">Yes, stop it</button></form>');
}
