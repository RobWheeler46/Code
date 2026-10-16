<?php
putenv('APP_ENV=development');
// php tests/scheduling_test.php : choosing when a card is delivered
$work = sys_get_temp_dir() . '/ecard-when-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
@mkdir(ROOT . '/data', 0775, true);

// the rules, in process
ok(schedule_parse([]) === 0 && schedule_parse(['when' => 'now']) === 0, 'sending now is the default');
ok(schedule_parse(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 600)]) === false, 'less than an hour ahead is refused');
ok(schedule_parse(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 86400 * 100)]) === false, 'more than 90 days ahead is refused');
ok(schedule_parse(['when' => 'custom', 'when_custom' => 'tomorrow']) === false && schedule_parse(['when' => 'bogus']) === false, 'anything that is not a proper date or a known choice is refused');
$ts = schedule_parse(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 86400 * 3)]); ok(is_int($ts) && abs($ts - (time() + 86400 * 3)) < 120, 'a date a few days ahead is accepted');
ok(schedule_parse(['when' => 'eve']) === false && schedule_parse(['when' => 'day']) === false, 'the old Christmas Eve and Christmas Day choices are gone');
ok(str_contains(schedule_picker([]), 'As soon as possible') && str_contains(schedule_picker([]), 'name="when_custom"'), 'the picker offers now and a chosen date');

// the queue honours it
$t = time(); q("insert into users(id,name,email,pass,verified,created,terms_version) values(1,'Sam','sam@x.example',?,1,?,?)", [password_hash('Test-pass-123', PASSWORD_DEFAULT), $t, TERMS_VERSION]);
function mk(int $at): array { $t = time(); q("insert into sends(user_id,card,sender_name,message,status,created,updated,send_at) values(1,'pegs','Sam','Hello','draft',?,?,?)", [$t, $t, $at]); $sid = (int)db()->lastInsertId(); q("insert into recipients(send_id,name,email,token,status) values(?,?,?,?,'draft')", [$sid, 'Gran', "g$sid@example.org", "t$sid"]); return [$sid, (int)db()->lastInsertId()]; }
[$s1, $r1] = mk(time() + 7200); queue_send($s1); $row = one('select * from recipients where id=?', [$r1]);
ok($row['status'] === 'queued' && (int)$row['next_at'] === (int)one('select send_at from sends where id=?', [$s1])['send_at'] && rstatus($row) === 'Scheduled', 'a scheduled card is queued for its time and shows as Scheduled');
process_queue(); ok(one('select status from recipients where id=?', [$r1])['status'] === 'queued', 'it is not sent early');
[$s2, $r2] = mk(0); queue_send($s2); ok(one('select status from recipients where id=?', [$r2])['status'] === 'sent', 'an ordinary card still goes straight away');
q('update recipients set next_at=? where id=?', [time() - 5, $r1]); q("update settings set v='0' where k='last_queue'"); scheduler_run(); ok(one('select status from recipients where id=?', [$r1])['status'] === 'sent', 'once its time comes the scheduled job sends it');
[$s3, $r3] = mk(time() + 7200); queue_send($s3); ok(cancel_recipient($r3) && one('select status from recipients where id=?', [$r3])['status'] === 'cancelled', 'a scheduled card can be cancelled before it goes');
q("update recipients set tries=1, next_at=? where id=?", [time() + 300, $r3]); q("update recipients set status='queued' where id=?", [$r3]); ok(rstatus(one('select * from recipients where id=?', [$r3])) === 'Queued', 'a retry waiting a few minutes is not shown as Scheduled');

// over HTTP: the review screen
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
$jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $jar); http('/login', $jar, ['_c' => tok($b), 'email' => 'sam@x.example', 'password' => 'Test-pass-123']);
[$s4, $r4] = mk(0); [, $page] = http("/review?id=$s4", $jar);
ok(str_contains($page, 'When should the cards arrive?') && str_contains($page, '<select name="when"><option value="now" selected>'), 'the review screen shows the delivery choice');
$go = fn(array $f) => http("/review?id=$s4", $jar, ['_c' => tok($page), 'id' => $s4, 'do' => 'send', 'mode' => 'free'] + $f);
$go(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 600)]); ok(one('select status from sends where id=?', [$s4])['status'] === 'draft', 'too soon: the card stays a draft and nothing is queued');
$want = date('Y-m-d\TH:i', time() + 86400 * 5); $go(['when' => 'custom', 'when_custom' => $want]); $row = one('select * from sends where id=?', [$s4]); $rec = one('select * from recipients where id=?', [$r4]);
ok($row['status'] === 'queued' && (int)$row['send_at'] === strtotime($want) && (int)$rec['next_at'] === strtotime($want) && $rec['status'] === 'queued', 'a chosen time is saved on the card and its recipients');
[, $st] = http("/send?id=$s4&done=1", $jar); ok(str_contains($st, 'Your cards are scheduled') && str_contains($st, 'Scheduled'), 'the status page says the cards are scheduled');
[, $dash] = http('/dashboard', $jar); ok(str_contains($dash, 'Scheduled'), 'My cards shows them as scheduled');
[, $help] = http('/help', $jar); ok(str_contains($help, 'Can I choose when a card arrives?'), 'the Help page explains it');
// change the delivery time of a scheduled card, and the thank you block
ok(str_contains($st, 'Change the delivery time') && str_contains($st, 'Tell a friend') && str_contains($st, 'ref=sendshare') && str_contains($st, 'wa.me'), 'the status page offers a new time, and a Tell a friend block after sending');
[, $st2] = http("/send?id=$s4", $jar); ok(!str_contains($st2, 'Tell a friend'), 'the friend block shows only straight after sending');
$re = fn(array $f) => http("/send?id=$s4", $jar, ['_c' => tok($st), 'id' => $s4, 'do' => 'reschedule'] + $f);
$re(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 600)]); ok((int)one('select next_at from recipients where id=?', [$r4])['next_at'] === strtotime($want), 'a new time less than an hour away is refused');
$new = date('Y-m-d\TH:i', time() + 86400 * 8); $re(['when' => 'custom', 'when_custom' => $new]);
ok((int)one('select send_at from sends where id=?', [$s4])['send_at'] === strtotime($new) && (int)one('select next_at from recipients where id=?', [$r4])['next_at'] === strtotime($new), 'a valid new time moves the card and its recipients');
q("update recipients set status='sent' where id=?", [$r4]); $re(['when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 86400 * 9)]); ok((int)one('select next_at from recipients where id=?', [$r4])['next_at'] === strtotime($new), 'a card that has already gone is not moved');
// My cards says plainly where each card stands
q('update recipients set sent_at=? where id=?', [time() - 60, $r4]); [, $dash] = http('/dashboard', $jar); ok(preg_match('/Merry Christmess|pill sent">Sent</', $dash) && str_contains($dash, 'pill sent">Sent<'), 'a card that has gone out shows a Sent label');
q('update recipients set sent_at=? where id=?', [time() - 86400 * 400, $r4]); [, $dash] = http('/dashboard', $jar); ok(str_contains($dash, 'pill expired">Links expired<'), 'a card whose links have passed their time shows Links expired');
q("update recipients set status='queued', sent_at=null, next_at=? where id=?", [time() + 86400, $r4]); [, $dash] = http('/dashboard', $jar); ok(str_contains($dash, 'pill scheduled">Scheduled<'), 'a card waiting for its chosen time shows Scheduled');
// donation suggestion follows the number of cards
q("insert into settings(k,v) values('donations_enabled','1') on conflict(k) do update set v='1'");
function rev(int $n): string { global $jar; $t = time(); q("insert into sends(user_id,card,sender_name,message,status,created,updated) values(1,'pegs','Sam','Hi','draft',?,?)", [$t, $t]); $id = (int)db()->lastInsertId(); for ($i = 0; $i < $n; $i++) q("insert into recipients(send_id,name,email,token,status) values(?,?,?,?,'draft')", [$id, "R$i", "r$i@x.example", token()]); return http("/review?id=$id", $jar)[1]; }
$sug = fn(string $h) => preg_match('/value="(\d+)" checked> £[\d.]+ <small>\(suggested\)/', $h, $m) ? (int)$m[1] : 0;
ok($sug(rev(2)) === 200 && $sug(rev(6)) === 500 && $sug(rev(12)) === 1000, 'the suggested donation grows with the number of cards');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
