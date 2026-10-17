<?php
putenv('APP_ENV=development');
// php tests/bulk_test.php : an administrator sends one card, with a different message to each person, from a CSV file
$work = sys_get_temp_dir() . '/ecard-bulk-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$S = []; foreach (['admin' => [1, 'admin'], 'plain' => [0, '']] as $n => [$adm, $roles]) { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,?,?,?)", [$n, "$n@x.example", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $adm, $roles, $sec]); $S[$n] = ["$n@x.example", $sec]; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, array|string|null $post = null, bool $follow = false): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => $follow, CURLOPT_HEADER => true]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $post); } $r = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch); return [$c, substr($r, $hs), substr($r, 0, $hs)]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u, bool $mfa): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, http_build_query(['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123'])); if ($mfa) { [, $m] = http('/mfa', $j); http('/mfa', $j, http_build_query(['_c' => tok($m), 'code' => totp($u[1], time())])); } return $j; }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
$a = login($S['admin'], true); $p = login($S['plain'], false); $card = array_key_first(gallery_cards());
function up(string $jar, string $csv, array $extra = []): array { global $work, $card; [, $pg] = http('/admin/bulk', $jar); file_put_contents("$work/b.csv", $csv); return http('/admin/bulk', $jar, array_merge(['_c' => tok($pg), 'do' => 'upload', 'card' => $card, 'sender_name' => 'The Group', 'message' => '', 'csv' => new CURLFile("$work/b.csv", 'text/csv', 'b.csv')], $extra), true); }

[$c] = http('/admin/bulk', $p); ok($c === 403 || $c === 302, 'someone who is not an administrator cannot open the screen');
[$c, $pg] = http('/admin/bulk', $a); ok($c === 200 && str_contains($pg, 'type="file"') && str_contains($pg, 'Name,Email,Message'), 'an administrator sees the upload screen with an example of the file');
[$c] = up($p, "Gran,gran@example.com,Hello\n"); ok(dbq('select count(*) from sends where bulk=1')->fetchColumn() == 0, 'and the upload does nothing for others');

// a file with good lines and bad ones
[, $r] = up($a, "Name,Email,Message\nGran,gran@example.com,\"Thank you for the scarf, it is lovely.\"\nSam,sam@example.com,Good luck with the exams!\nBad Person,not-an-email,Hi\nGran again,GRAN@example.com,Hi\nNo Message,nomsg@example.com,\n");
ok(dbq('select count(*) from sends where bulk=1')->fetchColumn() == 1 && dbq('select count(*) from recipients')->fetchColumn() == 2, 'good lines become recipients on one draft; a bad address, a repeat and a line with no message are left out');
ok(str_contains($r, 'Check before sending') && str_contains($r, 'Line 4') && str_contains($r, 'Line 5') && str_contains($r, 'Line 6') && str_contains($r, 'Thank you for the scarf'), 'the check page lists what was not used, by line number, and shows the messages');
$sid = (int)dbq('select id from sends where bulk=1')->fetchColumn();
ok(dbq("select own_msg from recipients where email='sam@example.com'")->fetchColumn() === 'Good luck with the exams!' && dbq("select status from sends where id=$sid")->fetchColumn() === 'draft', 'each person keeps their own message, and nothing is sent yet');
ok(dbq('select count(*) from recipients where status<>\'draft\'')->fetchColumn() == 0, 'every recipient is still a draft until the administrator confirms');

// the draft is only for bulk screens, and only the owner can touch it
[$c, , $hd] = http("/compose?id=$sid", $a); ok($c === 302 && str_contains($hd, '/admin/bulk?id=' . $sid), 'the ordinary write screen sends a bulk draft back to its own screen');
[$c, , $hd] = http("/review?id=$sid", $a); ok($c === 302 && str_contains($hd, '/admin/bulk?id=' . $sid), 'and so does the ordinary review screen');
[$c] = http("/admin/bulk?id=$sid", $p); ok($c !== 200, 'someone else cannot open it');
[, $dash] = http('/dashboard', $a); ok(str_contains($dash, '/admin/bulk?id=' . $sid), 'My cards links the draft to the bulk screen');

// an empty or useless file
[, $r] = up($a, "Name,Email,Message\nOnly Bad,nope,Hi\n"); ok(str_contains($r, 'No one in the file could be used') && dbq('select count(*) from sends where bulk=1')->fetchColumn() == 1, 'a file with no usable line creates nothing and says why');
[, $r] = up($a, "Zed,zed@example.com,\n", ['message' => 'A shared message for everyone.']); ok(dbq("select count(*) from recipients where email='zed@example.com'")->fetchColumn() == 1, 'a line with no message uses the shared message when one is given');
$sid2 = (int)dbq('select max(id) from sends where bulk=1')->fetchColumn();
$over = "Name,Email,Message\n" . implode("\n", array_map(fn($i) => "P$i,p$i@example.com,Hello $i", range(1, BULK_MAX + 5))); up($a, $over); $sid3 = (int)dbq('select max(id) from sends where bulk=1')->fetchColumn();
ok(dbq("select count(*) from recipients where send_id=$sid3")->fetchColumn() == BULK_MAX, 'a file over the limit uses only the first ' . BULK_MAX . ' people');
foreach ([$sid2, $sid3] as $x) { [, $pg] = http("/admin/bulk?id=$x", $a); http("/admin/bulk?id=$x", $a, http_build_query(['_c' => tok($pg), 'id' => $x, 'do' => 'discard'])); }
ok(dbq('select count(*) from sends where bulk=1')->fetchColumn() == 1, 'a draft can be discarded');

// opt outs are noted, then the send goes through the normal queue
optout('sam@example.com', 0);
[, $pg] = http("/admin/bulk?id=$sid", $a); ok(str_contains($pg, 'asked not to receive cards'), 'the check page notes anyone who has asked to stop');
$go = http("/admin/bulk?id=$sid", $a, http_build_query(['_c' => tok($pg), 'id' => $sid, 'do' => 'send', 'when' => 'custom', 'when_custom' => date('Y-m-d\TH:i', time() + 600)]), true);
ok(dbq("select status from sends where id=$sid")->fetchColumn() === 'draft', 'a time less than an hour away is refused and nothing is queued');
[, $pg] = http("/admin/bulk?id=$sid", $a); $want = date('Y-m-d\TH:i', time() + 86400 * 3);
[, $st] = http("/admin/bulk?id=$sid", $a, http_build_query(['_c' => tok($pg), 'id' => $sid, 'do' => 'send', 'when' => 'custom', 'when_custom' => $want]), true);
ok(dbq("select status from sends where id=$sid")->fetchColumn() === 'queued' && dbq("select count(*) from recipients where send_id=$sid and status='queued'")->fetchColumn() == 2 && str_contains($st, 'Your cards are scheduled'), 'a chosen time queues every recipient for that time and shows the normal status page');
ok(str_contains(dbq("select group_concat(action) from audit where action like 'bulk_%'")->fetchColumn(), 'bulk_send'), 'the send is recorded in the change history');
$log = (string)dbq("select group_concat(detail, ' ') from audit where action like 'bulk_%'")->fetchColumn(); ok(!str_contains($log, 'gran@example.com') && !str_contains($log, 'scarf'), 'and the record holds counts only, never addresses or messages');
[, $pg] = http("/admin/bulk?id=$sid", $a); ok(!str_contains($pg, 'Send 2 cards'), 'a card that has been queued cannot be sent a second time from the bulk screen');
// the opted out person is skipped when the queue runs
dbq("update recipients set next_at=0 where send_id=$sid"); q("update settings set v='0' where k='last_queue'"); process_queue();
ok(dbq("select status from recipients where email='sam@example.com'")->fetchColumn() === 'cancelled' && dbq("select status from recipients where email='gran@example.com'")->fetchColumn() === 'sent', 'at send time the person who opted out is skipped and the other card goes out');
ok(dbq("select resolved from (select 1 resolved)")->fetchColumn() == 1 && resolved_msg(one("select * from recipients where email='gran@example.com'"), one('select * from sends where id=?', [$sid])) === 'Thank you for the scarf, it is lovely.', 'each card carries its own message');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
