<?php
putenv('APP_ENV=development');
// php tests/security_fixes_test.php : hashed account tokens, Postmark webhook auth, sessions, production by default
$work = sys_get_temp_dir() . '/ecard-sec-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('POSTMARK_HOOK_KEY=hook-key-123');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
@mkdir(ROOT . '/data', 0775, true); $log = ROOT . '/data/outbox.log'; @unlink($log);
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'POSTMARK_HOOK_KEY' => 'hook-key-123']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, array|string|null $post = null, array $hdr = []): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => $hdr]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, is_array($post) ? http_build_query($post) : $post); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function lastmail(): string { $l = file($GLOBALS['log']) ?: []; $j = json_decode((string)end($l), true); return (string)($j['text'] ?? ''); }
function pdo(): PDO { global $dbf; return new PDO('sqlite:' . $dbf); }
$jar = tempnam(sys_get_temp_dir(), 'jar');

// 1. verification token
[, $b] = http('/register', $jar); http('/register', $jar, ['_c' => tok($b), 'name' => 'Sam', 'email' => 'sam@x.example', 'password' => 'A-long-pass-123', 'accept' => '1', 'terms' => '1']);
preg_match('#/verify\?t=([a-f0-9]+)#', lastmail(), $m); $vt = $m[1] ?? '';
$stored = (string)pdo()->query("select verify_token from users where email='sam@x.example'")->fetchColumn();
ok($vt !== '' && $stored !== $vt && $stored === hash('sha256', $vt), 'the verification token is stored as a hash, not as the emailed value');
http('/verify?t=' . $stored, tempnam(sys_get_temp_dir(), 'j')); ok((int)pdo()->query("select verified from users where email='sam@x.example'")->fetchColumn() === 0, 'the stored hash cannot be used as the link');
http('/verify?t=' . $vt, $jar); ok((int)pdo()->query("select verified from users where email='sam@x.example'")->fetchColumn() === 1, 'the emailed link still verifies the account');

// 2. reset token
[, $b] = http('/forgot', $jar); http('/forgot', $jar, ['_c' => tok($b), 'email' => 'sam@x.example']);
preg_match('#/reset\?t=([a-f0-9]+)#', lastmail(), $m); $rt = $m[1] ?? '';
$stored = (string)pdo()->query("select reset_token from users where email='sam@x.example'")->fetchColumn();
ok($rt !== '' && $stored === hash('sha256', $rt), 'the reset token is stored as a hash');
[$c] = http('/reset?t=' . $stored, tempnam(sys_get_temp_dir(), 'j')); [, $pg] = http('/reset?t=' . $stored, tempnam(sys_get_temp_dir(), 'j')); ok(!str_contains($pg, 'Choose a new password'), 'the stored hash does not open the reset page');
[, $pg] = http('/reset?t=' . $rt, $jar); ok(str_contains($pg, 'Choose a new password'), 'the emailed link opens the reset page');
http('/reset', $jar, ['_c' => tok($pg), 't' => $rt, 'password' => 'Another-long-pass-9', 'again' => 'Another-long-pass-9']); ok(password_verify('Another-long-pass-9', (string)pdo()->query("select pass from users where email='sam@x.example'")->fetchColumn()) && pdo()->query("select reset_token from users where email='sam@x.example'")->fetchColumn() === '', 'resetting works once and clears the token');

// 3. an old plain text token is converted, so links already emailed keep working
$plain = bin2hex(random_bytes(24)); pdo()->exec("update users set reset_token='$plain', reset_exp=" . (time() + 600) . " where email='sam@x.example'");
http('/', tempnam(sys_get_temp_dir(), 'j')); ok(pdo()->query("select reset_token from users where email='sam@x.example'")->fetchColumn() === hash('sha256', $plain), 'a plain text token from before the change is hashed on the next request');
[, $pg] = http('/reset?t=' . $plain, tempnam(sys_get_temp_dir(), 'j')); ok(str_contains($pg, 'Choose a new password'), 'and its emailed link still works');

// 4. Postmark webhook key
$body = json_encode(['RecordType' => 'Delivery', 'MessageID' => 'x']); $basic = fn($pw) => ['Authorization: Basic ' . base64_encode("hook:$pw")];
[$c] = http('/hooks/postmark', tempnam(sys_get_temp_dir(), 'j'), $body); ok($c === 403, 'the webhook refuses a request with no key');
[$c] = http('/hooks/postmark', tempnam(sys_get_temp_dir(), 'j'), $body, $basic('wrong')); ok($c === 403, 'the webhook refuses a wrong Basic Auth password');
[$c] = http('/hooks/postmark', tempnam(sys_get_temp_dir(), 'j'), $body, $basic('hook-key-123')); ok($c !== 403, 'the webhook accepts the key as the Basic Auth password');
[$c] = http('/hooks/postmark?k=hook-key-123', tempnam(sys_get_temp_dir(), 'j'), $body); ok($c !== 403, 'the old ?k= key still works until the webhook URL is changed');
[$c] = http('/hooks/postmark?k=nope', tempnam(sys_get_temp_dir(), 'j'), $body); ok($c === 403, 'a wrong ?k= key is refused');

// 5. sessions and environment
$tmp = tempnam(sys_get_temp_dir(), 'j'); http('/', $tmp);
$f = file_get_contents(__DIR__ . '/../src/lib.php'); ok(str_contains($f, "ini_set('session.use_strict_mode', '1')"), 'sessions refuse ids the server did not issue');
putenv('APP_ENV'); ok(app_env() === 'production', 'with no APP_ENV the site counts as production'); putenv('APP_ENV=development'); ok(app_env() === 'development', 'APP_ENV=development still gives a development site');
ok(!is_file(__DIR__ . '/../cj2.txt'), 'the stray cookie jar is gone');

proc_terminate($proc); proc_close($proc); @unlink($log);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
