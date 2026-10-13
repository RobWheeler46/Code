<?php
putenv('APP_ENV=development');
// php tests/scheduler_test.php : queued cards are sent without cron, by visits and by an outside timer
$work = sys_get_temp_dir() . '/ecard-sch-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
@mkdir(ROOT . '/data', 0775, true);
function queue_one(string $tag): int { $t = time(); q("insert or ignore into users(id,name,email,pass,verified,created) values(1,'S','s@x.example','x',1,?)", [$t]); q("insert into sends(user_id,card,sender_name,message,status,queued_at,created,updated) values(1,'pegs','S','Hi','queued',?,?,?)", [$t, $t, $t]); $sid = (int)db()->lastInsertId(); q("insert into recipients(send_id,name,email,token,status,next_at) values(?,?,?,?,'queued',0)", [$sid, 'G', "$tag@example.org", "tok$tag"]); return (int)db()->lastInsertId(); }
function status(int $id): string { return (string)one('select status from recipients where id=?', [$id])['status']; }

// the claim
ok(sched_claim('job_x', 60) === true && sched_claim('job_x', 60) === false, 'a job can be claimed once in its interval, so two callers never both run it');
q("update settings set v=? where k='job_x'", [(string)(time() - 61)]); ok(sched_claim('job_x', 60) === true, 'and again once the interval has passed');

// running it directly
$a = queue_one('a'); $r = scheduler_run(); ok(($r['sent'] ?? 0) === 1 && status($a) === 'sent', 'due cards are sent');
$b = queue_one('b'); $r = scheduler_run(); ok(!isset($r['sent']) && status($b) === 'queued', 'a second run inside the same minute does nothing');
q("update settings set v=? where k='last_queue'", [(string)(time() - 61)]); scheduler_run(); ok(status($b) === 'sent', 'the next minute it sends the next card');
ok((int)setting('last_queue') > time() - 5, 'the queue heartbeat on System health is kept fresh');
set_setting('paused', '1');
$c = queue_one('c'); q("update settings set v=? where k='last_queue'", [(string)(time() - 61)]); scheduler_run(); ok(status($c) === 'queued', 'a paused dispatch stays paused');
set_setting('paused', '0');

// over HTTP
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function get(string $path): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true]); $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
$key = tick_key(); ok(strlen($key) === 32 && tick_key() === $key, 'the timer address has a stable secret key');
[$c] = get('/hooks/tick'); ok($c === 403, 'the timer address refuses a request with no key'); [$c] = get('/hooks/tick?k=wrong'); ok($c === 403, 'and a wrong key');
$d = queue_one('d'); q("update settings set v=? where k='last_queue'", [(string)(time() - 61)]); [$c, $body] = get('/hooks/tick?k=' . $key); ok($c === 200 && status($d) === 'sent' && str_contains($body, '"sent":'), 'the right key sends the queue and says what it did');
[$c, $body] = get('/hooks/tick?k=' . $key); ok($c === 200 && str_contains($body, 'idle'), 'asking again straight away reports idle');
[$c] = get('/'); $e = queue_one('e'); q("update settings set v=? where k='last_queue'", [(string)(time() - 61)]); get('/help'); ok(status($e) === 'queued', 'with the scheduler off a page visit sends nothing (test server default)');
proc_terminate($proc); proc_close($proc);

// a visit triggers it when the scheduler is on
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:" . ($port + 1), '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv2.log', 'w'], 2 => ['file', $work . '/srv2.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'on']));
$port++; for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
get('/help'); for ($i = 0; $i < 30 && status($e) !== 'sent'; $i++) usleep(100000); ok(status($e) === 'sent', 'a page visit sends waiting cards after the page has been answered');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
