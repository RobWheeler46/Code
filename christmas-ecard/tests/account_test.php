<?php
// php tests/account_test.php : the account page over real HTTP: name, email change with confirmation, password change, preferences
$work = sys_get_temp_dir() . '/ecard-ac-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); $log = ROOT . '/data/outbox.log'; @unlink($log);
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $email): void { q("insert into users(name,email,pass,verified,created,terms_version) values(?,?,?,1,?,?)", [$n, $email, password_hash('Old-password-123', PASSWORD_DEFAULT), time(), TERMS_VERSION]); }
mk('Amy', 'amy@x.com'); mk('Bob', 'bob@x.com'); mk('Taken', 'taken@x.com');
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array {
    global $port; $loc = ''; $GLOBALS['hdr'] = ''; $ch = curl_init("http://127.0.0.1:$port$path");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); $GLOBALS['hdr'] .= $h; return strlen($h); }]);
    if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); }
    $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc];
}
function tok(string $html): string { preg_match('/name="_c" value="([^"]+)"/', $html, $m); return $m[1] ?? ''; }
function login(string $email, string $pw): string { $jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $jar); http('POST', '/login', $jar, ['_c' => tok($b), 'email' => $email, 'password' => $pw]); return $jar; }
function row(string $email): array { return (new PDO('sqlite:' . $GLOBALS['dbf']))->query("select * from users where email=" . db()->quote($email))->fetch(PDO::FETCH_ASSOC) ?: []; }
function mails(): string { $o = ''; foreach (@file($GLOBALS['log']) ?: [] as $l) { $j = json_decode($l, true); if ($j) $o .= "To: {$j['to']}
Subject: {$j['subject']}
{$j['text']}
----
"; } return $o; }
function act(string $jar, array $post): array { [, $p] = http('GET', '/account', $jar); return http('POST', '/account', $jar, ['_c' => tok($p)] + $post); }
$anon = tempnam(sys_get_temp_dir(), 'jar'); [$c, , $l] = http('GET', '/account', $anon); ok($c === 302 && str_contains($l, '/login'), 'signed out visitors are sent to sign in');
$amy = login('amy@x.com', 'Old-password-123'); [$c, $page] = http('GET', '/account', $amy);
ok($c === 200 && str_contains($page, 'amy@x.com') && stripos($GLOBALS['hdr'], 'noindex') !== false && str_contains($page, 'href="/account"'), 'the account page shows the address, is not indexed and is in the menu');

// name
act($amy, ['do' => 'name', 'name' => '<b>Amy</b> Smith']); ok(row('amy@x.com')['name'] === '<b>Amy</b> Smith', 'the name is saved');
[, $p] = http('GET', '/account', $amy); ok(str_contains($p, '&lt;b&gt;Amy&lt;/b&gt; Smith') && !str_contains($p, '<b>Amy</b>'), 'and shown safely');
act($amy, ['do' => 'name', 'name' => '   ']); ok(row('amy@x.com')['name'] === '<b>Amy</b> Smith', 'an empty name is refused');

// email
act($amy, ['do' => 'email', 'email' => 'amy.new@x.com', 'current' => 'wrong']); ok(row('amy@x.com')['pending_email'] === null && !str_contains(mails(), 'amy.new@x.com'), 'a wrong current password changes nothing and sends nothing');
act($amy, ['do' => 'email', 'email' => 'taken@x.com', 'current' => 'Old-password-123']); ok(row('amy@x.com')['pending_email'] === null, 'an address already in use is refused');
act($amy, ['do' => 'email', 'email' => 'not-an-email', 'current' => 'Old-password-123']); ok(row('amy@x.com')['pending_email'] === null, 'an invalid address is refused');
act($amy, ['do' => 'email', 'email' => 'Amy.New@X.com', 'current' => 'Old-password-123']);
$r = row('amy@x.com'); preg_match('#/account/confirm-email\?t=([0-9a-f]+)#', mails(), $m); $t = $m[1] ?? '';
ok($r['email'] === 'amy@x.com' && $r['pending_email'] === 'amy.new@x.com' && $t !== '', 'the new address waits for confirmation and the link goes to it');
ok($r['pending_token'] !== $t && $r['pending_token'] === hash('sha256', $t), 'only a hash of the confirmation link is stored');
$warn = ''; foreach (explode("----
", mails()) as $blk) if (str_contains($blk, 'Subject: A change of email address was requested')) $warn = $blk;
ok(str_starts_with($warn, 'To: amy@x.com') && str_contains($warn, acct_mask('amy.new@x.com')) && !str_contains($warn, 'amy.new@x.com'), 'the old address is warned, with the new one masked');
$bob = login('bob@x.com', 'Old-password-123'); http('GET', '/account/confirm-email?t=' . $t, $bob); ok(row('amy@x.com')['email'] === 'amy@x.com' && row('bob@x.com')['email'] === 'bob@x.com', 'another signed in person cannot use the link');
[$c, , $l] = http('GET', '/account/confirm-email?t=' . $t, $anon); ok($c === 302 && str_contains($l, '/login') && row('amy@x.com')['email'] === 'amy@x.com', 'a signed out visitor cannot use the link');
http('GET', '/account/confirm-email?t=' . str_repeat('0', 48), $amy); ok(row('amy@x.com')['email'] === 'amy@x.com', 'a wrong link does nothing');
http('GET', '/account/confirm-email?t=' . $t, $amy); $r = row('amy.new@x.com');
ok($r && $r['verified'] == 1 && $r['pending_email'] === null && $r['pending_token'] === null && !row('amy@x.com'), 'the right person confirms it and the email changes');
http('GET', '/account/confirm-email?t=' . $t, $amy); ok(row('amy.new@x.com')['email'] === 'amy.new@x.com', 'the link works once');
act($amy, ['do' => 'email', 'email' => 'amy.later@x.com', 'current' => 'Old-password-123']); $pdo = new PDO('sqlite:' . $dbf); $pdo->exec("update users set pending_exp=" . (time() - 5) . " where email='amy.new@x.com'");
preg_match_all('#/account/confirm-email\?t=([0-9a-f]+)#', mails(), $all); http('GET', '/account/confirm-email?t=' . end($all[1]), $amy); ok(row('amy.new@x.com')['email'] === 'amy.new@x.com', 'an expired link does nothing');

// password
$bad = ['wrong current' => ['current' => 'nope', 'new' => 'Brand-new-pass-1', 'again' => 'Brand-new-pass-1'], 'too short' => ['current' => 'Old-password-123', 'new' => 'short', 'again' => 'short'], 'not matching' => ['current' => 'Old-password-123', 'new' => 'Brand-new-pass-1', 'again' => 'Brand-new-pass-2'], 'the same' => ['current' => 'Old-password-123', 'new' => 'Old-password-123', 'again' => 'Old-password-123']];
$before = row('amy.new@x.com')['pass']; foreach ($bad as $why => $p) { act($amy, ['do' => 'password'] + $p); ok(row('amy.new@x.com')['pass'] === $before, "password change refused: $why"); }
act($amy, ['do' => 'password', 'current' => 'Old-password-123', 'new' => 'Brand-new-pass-1', 'again' => 'Brand-new-pass-1']);
ok(password_verify('Brand-new-pass-1', row('amy.new@x.com')['pass']) && str_contains(mails(), 'Your password was changed'), 'the password is changed and the owner is told by email');
[$c] = http('GET', '/account', $amy); ok($c === 200, 'the person stays signed in');
$fresh = login('amy.new@x.com', 'Old-password-123'); [$c] = http('GET', '/account', $fresh); ok($c === 302, 'the old password no longer works');
$fresh = login('amy.new@x.com', 'Brand-new-pass-1'); [$c] = http('GET', '/account', $fresh); ok($c === 200, 'the new password does');

// preferences return here
[, $p] = http('GET', '/account', $amy); http('POST', '/prefs', $amy, ['_c' => tok($p), 'notify' => 'summary', 'remind' => '1', 'back' => '/account']); [$c, , $l] = http('POST', '/prefs', $amy, ['_c' => tok($p), 'notify' => 'summary', 'remind' => '1', 'back' => '/account']);
ok($c === 302 && $l === '/account' && row('amy.new@x.com')['notify'] === 'summary', 'preferences save and come back to this page');
[$c, , $l] = http('POST', '/prefs', $amy, ['_c' => tok($p), 'notify' => 'off', 'back' => 'https://evil.example/']); ok($l === '/dashboard', 'a return address outside the site is ignored');
$bad = 0; foreach ($pdo->query("select detail from audit where action like 'account_%'")->fetchAll(PDO::FETCH_COLUMN) as $d) if (preg_match('/@|[0-9a-f]{32}|password/i', (string)$d)) $bad++; ok($bad === 0, 'the change history holds no addresses, links or passwords');

proc_terminate($proc); proc_close($proc);
if (getenv('KEEPLOG')) echo @file_get_contents($work . '/srv.log');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work)); @unlink($log);
exit($GLOBALS['bad'] ?? 0);
