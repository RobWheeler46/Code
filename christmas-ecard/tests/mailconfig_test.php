<?php
putenv('APP_ENV=development');
// php tests/mailconfig_test.php : email delivery settings in Admin, with a real test email through a pretend SMTP server
$work = sys_get_temp_dir() . '/ecard-mc-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite'; $log = $work . '/mail.log'; $smtp = random_int(20100, 20900);
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $roles): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $roles, $sec]); return ["$n@x.com", $sec]; }
$U = ['app' => mk('app', 'appadmin'), 'fin' => mk('fin', 'finance')];
$fake = proc_open([PHP_BINARY, __DIR__ . '/fake_smtp.php', (string)$smtp, $log], [1 => ['file', $work . '/s.out', 'w'], 2 => ['file', $work . '/s.out', 'a']], $p1);
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '']));
for ($i = 0; $i < 50 && !(@fsockopen('127.0.0.1', $port) && @fsockopen('127.0.0.1', $smtp)); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); }]); if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $j); http('POST', '/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('GET', '/mfa', $j); http('POST', '/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function st(string $k): string { return (string)(new PDO('sqlite:' . $GLOBALS['dbf']))->query("select v from settings where k=" . db()->quote($k))->fetchColumn(); }
function save(string $jar, array $o): array { [, $p] = http('GET', '/admin/mail', $jar); http('POST', '/admin/mail', $jar, ['_c' => tok($p)] + $o); return http('GET', '/admin/mail', $jar); }
function sendtest(string $jar): string { [, $p] = http('GET', '/admin/mail', $jar); http('POST', '/admin/mail', $jar, ['_c' => tok($p), 'do' => 'test']); [, $b] = http('GET', '/admin/mail', $jar); preg_match('/class="flash[^"]*"[^>]*>([^<]*)/', $b, $m); return $m[1] ?? ''; }
$app = login($U['app']); $fin = login($U['fin']);
$form = ['provider' => 'smtp', 'from' => 'cards@7thswindon.org.uk', 'smtp_host' => '127.0.0.1', 'smtp_port' => (string)$smtp, 'smtp_secure' => 'none', 'smtp_user' => 'cards@7thswindon.org.uk', 'smtp_pass' => 'secret-pass', 'smtp_per_run' => '20', 'postmark_token' => '', 'current' => 'Test-pass-123'];

[$c] = http('GET', '/admin/mail', $fin); ok($c === 403, 'a finance administrator cannot open the email settings');
[, $fp] = http('GET', '/admin', $fin); [$c] = http('POST', '/admin/mail', $fin, ['_c' => tok($fp)] + $form); ok($c === 403 && st('mail_provider') === '', 'or change them');
[$c, $pg] = http('GET', '/admin/mail', $app); ok($c === 200 && str_contains($pg, 'Sending through: <strong>nothing') && str_contains($pg, 'Send a test email to app@x.com'), 'an application administrator sees the settings, which start as "nothing" because nothing is set up');

// saving needs their own password and valid values
save($app, ['current' => 'wrong'] + $form); ok(st('mail_provider') === '' && st('mail_smtp_pass') === '', 'a wrong password saves nothing');
[, $badpg] = save($app, ['smtp_host' => 'http://evil/x', 'smtp_port' => '99999'] + $form); ok(st('mail_smtp_host') === '' && str_contains($badpg, 'just the server name') && str_contains($badpg, 'port number'), 'a bad server name or port is refused with plain messages');
[, $badpg] = save($app, ['provider' => 'postmark'] + $form); ok(st('mail_provider') === '' && str_contains($badpg, 'Postmark server token'), 'choosing Postmark without a token is refused');
[, $after] = save($app, ['smtp_pass' => 'secret-pass', 'smtp_user' => "x\r\ny"] + $form); ok(st('mail_smtp_pass') === '' , 'control characters in a login are refused');

// saving for real
[, $pg] = save($app, $form); ok(st('mail_provider') === 'smtp' && st('mail_smtp_host') === '127.0.0.1' && st('mail_smtp_pass') === 'secret-pass', 'a good save is stored');
ok(!str_contains($pg, 'secret-pass') && str_contains($pg, 'Mail password: saved in Admin') && str_contains($pg, 'Sending through: <strong>your own mail account'), 'the password is never shown again, only that it is saved');
$aud = (new PDO('sqlite:' . $dbf))->query("select detail from audit where action='mail_settings_changed'")->fetchAll(PDO::FETCH_COLUMN);
ok($aud && !str_contains(implode(' ', $aud), 'secret-pass') && str_contains(implode(' ', $aud), 'mail_smtp_pass'), 'the change history names the settings that changed but never the values');

// the test email, end to end through the pretend mail server
@unlink($log); $msg = sendtest($app); $l = @file($log) ?: []; $m = $l ? json_decode(end($l), true) : [];
ok(str_contains($msg, 'accepted the test email for app@x.com') && $m && str_contains($m['rcpt'], '<app@x.com>') && str_contains($m['data'], 'test email') && $m['user'] === 'cards@7thswindon.org.uk' && $m['pass'] === 'secret-pass', 'the test email reaches the mail server, addressed to the administrator, using the saved login');
ok(str_starts_with(st('mail_test_result'), 'ok|'), 'and the result is remembered');
// a blank password field keeps the saved one; the wrong one fails with a readable message
save($app, ['smtp_pass' => ''] + $form); ok(st('mail_smtp_pass') === 'secret-pass', 'leaving the password blank keeps the saved one');
save($app, ['smtp_pass' => 'bad'] + $form); $msg = sendtest($app); ok(str_contains($msg, 'did not go through') && str_contains($msg, 'user name or password was not accepted') && !str_contains($msg, 'bad'), 'a wrong mail password gives a readable failure');
save($app, ['clear_smtp_pass' => '1', 'smtp_pass' => ''] + $form); ok(st('mail_smtp_pass') === '', 'the saved password can be removed');
save($app, ['provider' => 'log', 'smtp_pass' => 'secret-pass'] + $form); @unlink($log); $msg = sendtest($app); ok(str_contains($msg, 'Nothing was sent') && !is_file($log), 'with "do not send" chosen, the test says nothing was sent');
save($app, ['provider' => ''] + $form); ok(st('mail_provider') === '', 'automatic can be chosen again');
putenv('SMTP_HOST=envhost.example'); set_setting('mail_smtp_host', ''); ok(mail_cfg('SMTP_HOST') === 'envhost.example', 'when nothing is saved, the .env value is used'); set_setting('mail_smtp_host', 'saved.example'); ok(mail_cfg('SMTP_HOST') === 'saved.example', 'and what is saved in Admin wins');
for ($i = 0; $i < 6; $i++) sendtest($app); $msg = sendtest($app); ok(!str_contains($msg, 'accepted') , 'test emails are limited to five an hour');

proc_terminate($proc); proc_close($proc); proc_terminate($fake); proc_close($fake);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
