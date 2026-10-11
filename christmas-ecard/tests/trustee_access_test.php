<?php
// php tests/trustee_access_test.php : TG-02 the private Trustee greetings entry over real HTTP (FR-189): hidden, flagged, role gated, no member data
$work = sys_get_temp_dir() . '/ecard-ta-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $roles, int $admin = 1): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,?,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $admin, $roles, $admin ? $sec : null]); return ["$n@x.com", $admin ? $sec : null]; }
$U = ['editor' => mk('editor', 'tgeditor'), 'reviewer' => mk('reviewer', 'tgreviewer'), 'approver' => mk('approver', 'tgapprover'), 'dispatch' => mk('dispatch', 'tgdispatch'),
    'root' => mk('root', 'rolesadmin'), 'campaign' => mk('campaign', 'campaign'), 'finance' => mk('finance', 'finance'), 'delivery' => mk('delivery', 'delivery'), 'plain' => mk('plain', '', 0)];
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'LIBRARY_DIR' => $work . '/library']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array {
    global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); $GLOBALS['hdr'] .= $h; return strlen($h); }]);
    $GLOBALS['hdr'] = ''; if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); }
    $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc];
}
function tok(string $html): string { preg_match('/name="_c" value="([^"]+)"/', $html, $m); return $m[1] ?? ''; }
function login(array $u): string { $jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $jar); http('POST', '/login', $jar, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); if ($u[1]) { [, $m] = http('GET', '/mfa', $jar); http('POST', '/mfa', $jar, ['_c' => tok($m), 'code' => totp($u[1], time())]); } return $jar; }
function flag(string $k): string { return (string)(new PDO('sqlite:' . $GLOBALS['dbf']))->query("select v from settings where k='$k'")->fetchColumn(); }
$J = ['anon' => tempnam(sys_get_temp_dir(), 'jar')]; foreach ($U as $k => $u) $J[$k] = login($u);
$path = '/private/trustee-greetings';
[, $notFound] = http('GET', '/no-such-page', $J['anon']); $strip = fn($h) => preg_replace('/name="_c" value="[^"]+"/', '', $h);

// flag off: nobody sees it, and the refusal looks like any missing page
foreach ($J as $who => $jar) { [$c, $b] = http('GET', $path, $jar); ok($c === 404 && str_contains($b, "Page not found."), "flag off: $who gets the not found page"); }
[$c, $b] = http('GET', $path, $J['anon']); ok($c === 404 && $strip($b) === $strip($notFound), 'a signed out visitor gets exactly the page a missing address gets');
[$c] = http('GET', '/admin/private-features', $J['campaign']); ok($c === 403, 'only a restricted administrator can reach the feature switches (campaign manager refused)');
[$c] = http('GET', '/admin/private-features', $J['editor']); ok($c === 403, 'a Trustee greeting editor cannot reach the feature switches');

// switching on needs a reason and an approval reference, and is recorded
[, $pf] = http('GET', '/admin/private-features', $J['root']); $t = tok($pf);
[$c] = http('POST', '/admin/private-features/save', $J['campaign'], ['_c' => tok(http('GET', '/admin', $J['campaign'])[1]), 'feature' => 'private_trustee_greetings', 'state' => 'on', 'reason' => 'x', 'reference' => 'y']); ok($c === 403 && flag('private_trustee_greetings') !== '1', 'a campaign manager cannot switch it on');
[$c] = http('POST', '/admin/private-features/save', $J['root'], ['_c' => $t, 'feature' => 'private_trustee_greetings', 'state' => 'on', 'reason' => 'Trial', 'reference' => '']); ok($c === 302 && flag('private_trustee_greetings') !== '1', 'without an approval reference it stays off');
[$c] = http('POST', '/admin/private-features/save', $J['root'], ['_c' => $t, 'feature' => 'private_section_greetings', 'state' => 'on', 'reason' => 'Trial', 'reference' => 'Minute 1']); ok($c === 400 && flag('private_section_greetings') !== '1', 'section leader suggestions cannot be switched on before Trustee greetings are on');
[$c] = http('POST', '/admin/private-features/save', $J['root'], ['_c' => $t, 'feature' => 'private_trustee_greetings', 'state' => 'on', 'reason' => 'Trustee meeting', 'reference' => 'Minute 12.3']);
ok($c === 302 && flag('private_trustee_greetings') === '1' && flag('pf_ref_private_trustee_greetings') === 'Minute 12.3', 'a restricted administrator can switch it on with a reference');
ok((int)(new PDO('sqlite:' . $dbf))->query("select count(*) from audit where action='private_feature_on' and detail like '%Minute 12.3%'")->fetchColumn() === 1, 'switching on is recorded with the approval reference');

// flag on: only the four Trustee greeting roles get in
foreach (['editor', 'reviewer', 'approver', 'dispatch'] as $who) { [$c, $b] = http('GET', $path, $J[$who]); ok($c === 200 && str_contains($b, 'Not connected') && stripos($GLOBALS['hdr'], 'noindex') !== false, "flag on: the $who role can open the console, which says it is not connected, and it is not indexed"); }
foreach (['root', 'campaign', 'finance', 'delivery', 'plain', 'anon'] as $who) { [$c, $b] = http('GET', $path, $J[$who]); ok($c === 404 && str_contains($b, "Page not found."), "flag on: $who still gets the not found page (including a restricted administrator)"); }
[$c, $b] = http('GET', '/admin', $J['editor']); ok(str_contains($b, '/private/trustee-greetings'), 'the entry appears in the admin menu only for a Trustee greeting role');
[$c, $b] = http('GET', '/admin', $J['campaign']); ok(!str_contains($b, '/private/trustee-greetings'), 'it does not appear in the menu for anyone else');
[$c, $pub] = http('GET', '/', $J['anon']); ok(!str_contains($pub, 'trustee-greetings') && !str_contains(strtolower($pub), 'private greeting'), 'nothing on the public site mentions it');
$noMfa = tempnam(sys_get_temp_dir(), 'jar'); [, $lg] = http('GET', '/login', $noMfa); http('POST', '/login', $noMfa, ['_c' => tok($lg), 'email' => $U['editor'][0], 'password' => 'Test-pass-123']); [$c, $nb, $l] = http('GET', $path, $noMfa); ok($c === 302 && str_contains($l, '/mfa'), 'a Trustee role holder who has not done the second step is sent to it');

// no member data exists
$tables = (new PDO('sqlite:' . $dbf))->query("select name from sqlite_master where type='table'")->fetchAll(PDO::FETCH_COLUMN);
ok(!array_filter($tables, fn($n) => preg_match('/member|guardian|greeting/i', $n)), 'the database holds no member, guardian or greeting tables');
// switching off works and hides it again
[, $pf] = http('GET', '/admin/private-features', $J['root']); http('POST', '/admin/private-features/save', $J['root'], ['_c' => tok($pf), 'feature' => 'private_trustee_greetings', 'state' => 'off', 'reason' => 'Paused']);
[$c] = http('GET', $path, $J['editor']); ok($c === 404 && flag('private_trustee_greetings') === '0', 'switching it off hides it again immediately');
// the first administrator created at the command line does not get Trustee roles
q("insert into users(name,email,pass,verified,created) values('First','first@x.com','x',1,?)", [time()]);
shell_exec('php ' . escapeshellarg(__DIR__ . '/../src/cli.php') . ' admin first@x.com'); $r = (string)(new PDO('sqlite:' . $dbf))->query("select roles from users where email='first@x.com'")->fetchColumn();
ok(str_contains($r, 'rolesadmin') && !preg_match('/tg(editor|reviewer|approver|dispatch)/', $r), 'the command line admin helper gives the original six roles and no Trustee greeting role');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
