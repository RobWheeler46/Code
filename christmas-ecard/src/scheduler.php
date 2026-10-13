<?php
// Scheduled work without cPanel cron. The same jobs as `php src/cli.php queue | alerts | alerts-daily | purge`, run in two ways:
//  1. after a web request has been answered (so nobody waits for it), at most once a minute;
//  2. when an outside timer (for example cron-job.org, free) opens /hooks/tick?k=KEY every few minutes, which also covers quiet periods.
// Real cron still works and is still better: if both run, a claim on each job stops them doing the same work twice.

/** True for the one caller that wins the right to run a job now. Atomic: the update only succeeds if the last run is old enough. */
function sched_claim(string $key, int $everySecs): bool {
    $now = time(); q('insert or ignore into settings(k,v) values(?,?)', [$key, '0']);
    return q("update settings set v=? where k=? and cast(v as integer) <= ?", [(string)$now, $key, $now - $everySecs])->rowCount() === 1;
}

/** Runs whatever is due. Returns what it did, for the outside timer's reply. */
function scheduler_run(): array {
    $did = [];
    if (sched_claim('last_queue', 60)) {
        // an ordinary mail account caps emails per hour, and this runs every minute instead of every five, so each run sends a fifth of the usual batch
        $limit = mail_provider() === 'smtp' ? max(1, (int)ceil((int)mail_cfg('SMTP_PER_RUN', '20') / 5)) : 50;
        $did['sent'] = process_queue($limit);
    }
    if (sched_claim('last_alerts', 300)) $did['alert_emails'] = alerts_tick();
    if (sched_claim('last_alerts_daily', 86400)) $did['summaries'] = alerts_daily();
    if (sched_claim('last_purge', 86400)) $did['purged'] = purge_old();
    return $did;
}

/** Registered after the page is built. Finishes the response first so the visitor never waits. Off in the test web server unless SCHEDULER=on. */
function scheduler_after_request(): void {
    if (env('SCHEDULER', 'on') === 'off' || (PHP_SAPI === 'cli-server' && env('SCHEDULER', '') !== 'on') || PHP_SAPI === 'cli') return;
    ignore_user_abort(true); @set_time_limit(120);
    if (function_exists('fastcgi_finish_request')) fastcgi_finish_request(); elseif (function_exists('litespeed_finish_request')) litespeed_finish_request(); else { @ob_end_flush(); @flush(); }
    try { scheduler_run(); } catch (Throwable $e) { error_log('scheduler: ' . $e->getMessage()); }
}

/** The secret in the timer's address. Made once, kept in settings, shown on System health. */
function tick_key(): string { $k = setting('tick_key'); if ($k === '') { $k = bin2hex(random_bytes(16)); set_setting('tick_key', $k); } return $k; }

function r_tick_hook(): void {
    if (!hash_equals(tick_key(), (string)($_GET['k'] ?? ''))) { http_response_code(403); exit; }
    header('Content-Type: text/plain'); header('Cache-Control: no-store');
    exit(json_encode(scheduler_run() ?: ['idle' => true]) . "\n");
}
