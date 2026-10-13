<?php
putenv('APP_ENV=development');
// php tests/wording_test.php : editable email and help wording (FR-085): constrained, escaped, and never able to remove the fixed parts
$work = sys_get_temp_dir() . '/ecard-wd-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$F = config_spec('wording')['fields']; $v = fn($k, $raw) => cfg_validate($F[$k], $raw);

// validation
ok($v('email_subject', '{sender} sent you a Christmas card')[1] === null, 'the default subject is valid');
ok($v('email_subject', 'A card for you')[1] !== null, 'a subject without {sender} is refused');
ok($v('email_subject', '{sender} {name} wishes')[1] !== null && $v('email_subject', '{sender} wishes {')[1] !== null, 'any other placeholder, or a stray brace, is refused');
ok($v('email_subject', '<b>{sender}</b>')[1] !== null && $v('email_subject', str_repeat('x', 100) . '{sender}')[1] !== null, 'markup and over long subjects are refused');
ok($v('email_subject', "{sender}\r\nBcc: someone@example.com")[0] === '{sender} Bcc: someone@example.com', 'line breaks in a subject are flattened, so a header cannot be injected');
ok($v('email_button', 'Open it')[1] === null && $v('email_button', '{sender}')[1] !== null && $v('email_button', '')[1] !== null && $v('email_button', '<a>')[1] !== null, 'the button takes plain words only');
ok($v('support_email', 'Help@Example.org') === ['help@example.org', null] && $v('support_email', '')[1] === null && $v('support_email', 'nope')[1] !== null, 'the support address is one valid email, or blank');
$good = "How do I stop emails?\nUse the stop link at the bottom of the email.\n\nCan I send from a phone?\nYes, the site works on phones.";
ok($v('help_extra', $good)[1] === null && count(faq_parse($good)) === 2, 'extra Help questions are read as question and answer pairs');
ok($v('help_extra', "Question without answer")[1] !== null && $v('help_extra', str_repeat("Q?\nA.\n\n", 11))[1] !== null && $v('help_extra', str_repeat('q', 130) . "\nanswer")[1] !== null, 'a missing answer, more than 10 questions or a very long question are refused');

// rendering
$r = ['id' => 1, 'name' => 'Gran', 'email' => 'g@x.com', 'token' => str_repeat('a', 48)]; $s = ['sender_name' => 'The <i>Smiths</i>'];
ok(email_subject($s) === 'The <i>Smiths</i> sent you a Christmas card' && str_contains(email_body($r, $s), 'Open your card here:'), 'with nothing set, wording is exactly what it was');
set_setting('email_subject', 'Season\'s greetings from {sender}'); set_setting('email_intro', '{sender} is thinking of you this Christmas.'); set_setting('email_button', 'See your card');
$h = email_html($r, $s); $t = email_body($r, $s);
ok(email_subject($s) === 'Season\'s greetings from The <i>Smiths</i>' && str_contains($h, '<strong>The &lt;i&gt;Smiths&lt;/i&gt;</strong> is thinking of you') && !str_contains($h, '<i>Smiths'), 'the sender name is merged in and escaped in the HTML');
ok(str_contains($h, '>See your card</a>') && str_contains($t, 'See your card here:') && str_contains($t, 'The <i>Smiths</i> is thinking of you'), 'the new button and opening line appear in HTML and plain text');
foreach (['/c/' . $r['token'], '/optout/' . $r['token'], '/privacy'] as $must) ok(str_contains($h, $must) && str_contains($t, $must), "the fixed part $must is still in every email");
$q = ['sender_name' => "Eve\r\nBcc: x@y.z"]; ok(!preg_match('/[\r\n]/', email_subject($q)), 'a sender name with line breaks cannot break the subject');
set_setting('email_subject', ''); set_setting('email_intro', ''); set_setting('email_button', ''); ok(email_subject(['sender_name' => 'A']) === 'A sent you a Christmas card', 'blank settings fall back to the defaults');

// admin page and Help over HTTP
function mk(string $n, string $roles): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $roles, $sec]); return ["$n@x.com", $sec]; }
$U = ['app' => mk('app', 'appadmin'), 'fin' => mk('fin', 'finance')];
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); }]); if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $j); http('POST', '/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('GET', '/mfa', $j); http('POST', '/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function st(string $k): string { return (string)(new PDO('sqlite:' . $GLOBALS['dbf']))->query("select v from settings where k='$k'")->fetchColumn(); }
$app = login($U['app']); $fin = login($U['fin']);
[$c, $page] = http('GET', '/admin/wording', $app); ok($c === 200 && str_contains($page, 'email_subject') && str_contains($page, 'Preview the email'), 'an application administrator sees the wording page');
[, $fp] = http('GET', '/admin/wording', $fin); [$c, $fb] = http('POST', '/admin/wording', $fin, ['_c' => tok($fp) ?: tok(http('GET', '/admin', $fin)[1]), 'f_email_subject' => 'Hacked {sender}', 'f_email_intro' => '{sender} hi', 'f_email_button' => 'Go', 'f_support_email' => '', 'f_help_extra' => '', 'confirmed' => 1, 'ver' => '0']);
ok($c === 403 && st('email_subject') === '', 'a finance administrator cannot change the wording');
$post = ['_c' => tok($page), 'f_email_subject' => 'A Christmas greeting from {sender}', 'f_email_intro' => '{sender} sent you a Christmas card.', 'f_email_button' => 'Open your card', 'f_support_email' => 'Cards.Help@Example.org', 'f_help_extra' => "Can I use my phone?\nYes. The site works on phones <b>and</b> tablets."];
[$c, $rev] = http('POST', '/admin/wording', $app, $post); ok($c === 200 && str_contains($rev, 'Review changes') && st('email_subject') === '', 'saving first shows old and new values and changes nothing');
[$c] = http('POST', '/admin/wording', $app, $post + ['confirmed' => 1, 'ver' => st('cfg_version') ?: '0']); ok($c === 302 && st('email_subject') === 'A Christmas greeting from {sender}' && st('support_email') === 'cards.help@example.org', 'confirming saves it');
ok((int)(new PDO('sqlite:' . $dbf))->query("select count(*) from audit where action='config_wording'")->fetchColumn() === 1, 'the change is in the change history');
$anon = tempnam(sys_get_temp_dir(), 'jar'); [$c, $help] = http('GET', '/help', $anon);
ok($c === 200 && str_contains($help, 'Can I use my phone?') && str_contains($help, 'tablets') && !str_contains($help, '<b>and</b>') && str_contains($help, 'cards.help@example.org'), 'the Help page shows the extra question as plain text and the new support address');
[$c, $bad] = http('POST', '/admin/wording', $app, ['_c' => tok($page), 'f_email_subject' => 'No name here', 'f_email_intro' => '{sender} x', 'f_email_button' => 'Go', 'f_support_email' => '', 'f_help_extra' => '']);
ok($c === 302 && st('email_subject') === 'A Christmas greeting from {sender}', 'invalid wording is refused and the saved wording stays');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
