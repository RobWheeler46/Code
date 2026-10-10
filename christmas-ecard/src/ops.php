<?php
// FRD 2.1 operations logic: terms, sender suspension, row entry validation, alerts, launch readiness.

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
    if (($n = launch_blockers()) > 0) $a['launch'] = "$n launch decisions are still Open.";
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
            foreach ($first as $to) { mail_send($to, "[Christmas cards] Alert: $k", "$text\n\nSeen: " . date('j M Y H:i', $now) . "\nAcknowledge it here: " . base_url() . "/admin/health\n"); $sent++; }
            continue;
        }
        q('update alerts set text=? where akey=?', [$text, $k]);
        if (!$row['acked_at'] && !$row['escalated'] && $now - (int)$row['first_seen'] > $after) {
            q('update alerts set escalated=1 where akey=?', [$k]);
            foreach ($second as $to) { mail_send($to, "[Christmas cards] ESCALATED alert: $k", "Not acknowledged after " . intdiv($after, 60) . " minutes.\n$text\n" . base_url() . "/admin/health\n"); $sent++; }
        }
    }
    foreach (all('select akey from alerts where resolved_at is null') as $r) if (!isset($cur[$r['akey']])) q('update alerts set resolved_at=? where akey=?', [$now, $r['akey']]);
    return $sent;
}
function alerts_daily(): int {
    if (campaign_state() !== 'open') return 0;
    $cur = health_alerts(); $n = 0;
    foreach (alert_list('alert_emails') as $to) { mail_send($to, '[Christmas cards] Daily summary', $cur ? "Open alerts:\n- " . implode("\n- ", $cur) . "\n" . base_url() . "/admin/health\n" : "No alerts. Queue and payments look normal.\n"); $n++; }
    return $n;
}

// ---- launch readiness (FR-135)
const DECISIONS = [
    'D-01' => ['Campaign dates, queue treatment at closure, expiry, retention and deletion periods', 'Trustees with operational and privacy owner', true],
    'D-02' => ['Field limits, address book and group capacities, rate limits, email forms, duplicate rule', 'Project lead with application administrator', true],
    'D-03' => ['Currency, donation bounds, suggested amounts, payment investigation thresholds', 'Treasurer with project lead', true],
    'D-04' => ['Refund role, execution route, approval conditions, receipts, reconciliation', 'Treasurer and Trustees', true],
    'D-05' => ['Retry limits, uncertain-send handling, support contact and hours, pause and late-send policy', 'Operations owner with project lead', true],
    'D-06' => ['Expected volume and concurrency, response and queue-delay targets', 'Technical lead with campaign owner', true],
    'D-07' => ['Recovery objectives, monitoring cadence, backup restoration evidence, administrator recovery', 'Technical and restricted administrator owners', true],
    'D-08' => ['Include or defer each launch Should; numbered AC-01 to AC-18; test mapping and UAT owners', 'Project lead with Trustees', true],
    'D-09' => ['Reconcile FRD with SDD and OpenSpec; confirm providers and hosting; verify callbacks and domain', 'Technical lead', true],
    'D-10' => ['Account deletion effects, retained categories, view-qualification method and wording', 'Trustees with privacy and technical owners', true],
    'D-11' => ['Recipient donations: include or defer, and wording (conditional)', 'Treasurer with Trustees', false],
    'D-12' => ['Gift Aid: include or defer, eligibility, declaration wording (conditional)', 'Treasurer with Trustees', false],
    'D-13' => ['Christmas Day delivery: include or defer, time, late-send policy (conditional)', 'Campaign owner with operations owner', false],
    'D-14' => ['Wording and ownership of privacy notice, terms, acceptable use and safeguarding statement', 'Trustees with the responsible administrator', true],
    'D-15' => ['Alert recipients, second route, escalation time, out-of-hours expectations', 'Operations owner with project lead', true],
    'D-16' => ['Success measures, targets and small-number threshold', 'Project lead with campaign owner', true],
];
/** Required decisions not approved with a reference. Conditional decisions (third value false) never block. */
function launch_blockers(): int {
    $n = 0; $have = array_column(all('select id, status, ref from decisions'), null, 'id');
    foreach (DECISIONS as $id => [, , $must]) if ($must && (($have[$id]['status'] ?? 'open') !== 'approved' || trim((string)($have[$id]['ref'] ?? '')) === '')) $n++;
    return $n;
}
function legal_approved(): bool { $d = one("select status from decisions where id='D-14'"); return $d && $d['status'] === 'approved'; }
