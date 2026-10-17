<?php
putenv('APP_ENV=development');
// php tests/guest_flow_test.php : a visitor who writes a card and presses Review is guided to create an account, then comes back to the card
$work = sys_get_temp_dir() . '/ecard-guest-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null, bool $follow = false): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => $follow, CURLOPT_HEADER => true]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $r = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE); $u = (string)curl_getinfo($ch, CURLINFO_EFFECTIVE_URL); curl_close($ch); return [$c, substr($r, $hs), substr($r, 0, $hs), $u]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
$card = array_key_first(gallery_cards()); $jar = tempnam(sys_get_temp_dir(), 'jar');

// a visitor writes a card and presses Review
[, $pg] = http('/compose?card=' . $card, $jar);
http('/compose', $jar, ['_c' => tok($pg), 'card' => $card, 'act' => 'continue', 'sender_name' => 'The Smiths', 'message' => 'Happy Christmas!', 'r_name' => ['Gran'], 'r_email' => ['gran@example.com'], 'r_msg' => [''], 'paste' => '']);
$sid = (int)dbq('select id from sends')->fetchColumn(); ok($sid > 0, 'the card is saved as a draft');
[$c, , $hd] = http("/review?id=$sid", $jar); ok($c === 302 && str_contains($hd, '/register?next=' . urlencode("/review?id=$sid")), 'pressing Review as a visitor goes to the create account page, not a sign in page');
[$c, $reg] = http('/register?next=' . urlencode("/review?id=$sid"), $jar);
ok(str_contains($reg, 'Create your free account') && str_contains($reg, 'Your card is saved and waiting') && str_contains($reg, 'name="next" value="/review?id=' . $sid . '"') && str_contains($reg, '/login?next='), 'it says the card is waiting, keeps the way back, and offers Sign in for people who have an account');
[, $lg] = http('/login?next=' . urlencode("/review?id=$sid"), $jar); ok(str_contains($lg, '/register?next=' . urlencode("/review?id=$sid")), 'and the sign in page offers Register with the same way back');
[, $plain] = http('/register', $jar); ok(str_contains($plain, '<h1>Register</h1>') && !str_contains($plain, 'name="next"'), 'the ordinary register page is unchanged');
[, $evil] = http('/register?next=' . urlencode('//evil.example/x'), $jar); ok(!str_contains($evil, 'evil.example') && !str_contains($evil, 'name="next"'), 'any other address in next is ignored');

// registering brings the visitor back to the card, now theirs
[$c, $page, $hd] = http('/register', $jar, ['_c' => tok($reg), 'next' => "/review?id=$sid", 'name' => 'Sam Smith', 'email' => 'sam@example.com', 'password' => 'Test-pass-123', 'accept' => '1', 'website' => '']);
ok($c === 302 && str_contains($hd, "/review?id=$sid"), 'registering goes straight back to reviewing the card');
ok(dbq("select user_id from sends where id=$sid")->fetchColumn() == dbq("select id from users where email='sam@example.com'")->fetchColumn(), 'the card now belongs to the new account');
[$c, $rv] = http("/review?id=$sid", $jar); ok($c === 200 && str_contains($rv, 'Review and send') && str_contains($rv, 'gran@example.com'), 'the review page shows the saved card and recipient');
ok(str_contains($rv, 'verify') || str_contains($rv, 'Verify'), 'and reminds the sender to verify their email before sending');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
