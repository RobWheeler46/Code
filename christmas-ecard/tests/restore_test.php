<?php
putenv('APP_ENV=development');
// php tests/restore_test.php : restoring earlier settings goes through the normal review, confirmation and audit, for restricted administrators only (FR-095)
$work = sys_get_temp_dir() . '/ecard-rs-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $roles): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $roles, $sec]); return ["$n@x.com", $sec]; }
$U = ['root' => mk('root', 'rolesadmin'), 'camp' => mk('camp', 'campaign')];
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); }]); if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $j); http('POST', '/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('GET', '/mfa', $j); http('POST', '/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function st(string $k): string { return (string)(new PDO('sqlite:' . $GLOBALS['dbf']))->query("select v from settings where k=" . db()->quote($k))->fetchColumn(); }
function lastAudit(string $a): array { return (new PDO('sqlite:' . $GLOBALS['dbf']))->query("select * from audit where action=" . db()->quote($a) . " order by id desc limit 1")->fetch(PDO::FETCH_ASSOC) ?: []; }
/** Posts the whole settings form for an area, with a few fields changed, the way the browser would. Returns [review code, confirm code]. */
function change(string $jar, string $area, array $over, array $extra = []): array {
    $F = config_spec($area)['fields']; $post = ['reason' => 'test'] + $extra; foreach ($F as $k => $f) $post['f_' . $k] = $over[$k] ?? cfg_form_value($k, $f);
    [, $pg] = http('GET', "/admin/$area", $jar); [$c1, $rv] = http('POST', "/admin/$area", $jar, ['_c' => tok($pg)] + $post);
    [$c2] = http('POST', "/admin/$area", $jar, ['_c' => tok($rv) ?: tok($pg), 'confirmed' => 1, 'ver' => st('cfg_version') ?: '0'] + $post); return [$c1, $c2, $rv];
}
$root = login($U['root']); $camp = login($U['camp']);

// two changes to the campaign page
change($root, 'site', ['giftaid_charity' => 'Alpha Scouts', 'amounts_pence' => '3, 6']); $first = (int)lastAudit('config_site')['id'];
ok(st('giftaid_charity') === 'Alpha Scouts' && st('amounts_pence') === '300,600', 'setup: the first change is saved');
change($root, 'site', ['giftaid_charity' => 'Beta Scouts']); ok(st('giftaid_charity') === 'Beta Scouts', 'setup: and a later one');
[, $hist] = http('GET', '/admin/audit', $root); ok(str_contains($hist, '/admin/site?restore=' . $first), 'a restricted administrator sees "Restore the earlier values" in the change history');
[, $hist2] = http('GET', '/admin/audit', $camp); ok(!str_contains($hist2, 'restore='), 'a campaign manager does not');

// the restore form
[$c, $form] = http('GET', '/admin/site?restore=' . $first, $root);
ok($c === 200 && str_contains($form, 'Restoring earlier values') && str_contains($form, 'cannot undo emails already sent') && str_contains($form, 'name="restore_of" value="' . $first . '"'), 'it explains what restoring cannot undo and carries the restore marker');
ok(preg_match('/name="f_giftaid_charity" value=""/', $form) && preg_match('/name="f_amounts_pence" value="2, 5, 10"/', $form), 'the form starts with the values from before that change (including money and amounts)');
ok(st('giftaid_charity') === 'Beta Scouts', 'and nothing is saved by looking');
[, $cf] = http('GET', '/admin/site?restore=' . $first, $camp); ok(!str_contains($cf, 'Restoring earlier values') && preg_match('/name="f_giftaid_charity" value="Beta Scouts"/', $cf), 'a campaign manager asking for it just sees the current settings');

// through the normal review and confirmation
$post = ['reason' => 'Put it back', 'restore_of' => $first, 'f_donations_enabled' => '0', 'f_amounts_pence' => '2, 5, 10', 'f_giftaid_charity' => '', 'f_giftaid_enabled' => '0', 'f_season_start' => '11-01', 'f_season_end' => '01-06'];
[, $pg] = http('GET', '/admin/site', $root); [$c, $rv] = http('POST', '/admin/site', $root, ['_c' => tok($pg)] + $post);
ok($c === 200 && str_contains($rv, 'Review changes') && str_contains($rv, 'Beta Scouts') && str_contains($rv, 'name="restore_of"') && st('giftaid_charity') === 'Beta Scouts', 'saving shows old and new values first and still changes nothing');
$ver = st('cfg_version'); [$c] = http('POST', '/admin/site', $root, ['_c' => tok($rv), 'confirmed' => 1, 'ver' => $ver] + $post);
$a = lastAudit('config_site'); $d = json_decode($a['detail'], true);
ok($c === 302 && st('giftaid_charity') === '' && st('amounts_pence') === '200,500,1000' && (int)st('cfg_version') === (int)$ver + 1, 'confirming restores the earlier values as a new configuration version');
ok(($d['restored_from'] ?? 0) === $first && isset($d['changes']['giftaid_charity']), 'the change history records it as a restore of that earlier change');

// forged and wrong restores
$before = st('giftaid_charity'); [, $cp] = http('GET', '/admin/site', $camp);
$forge = $post; $forge['f_giftaid_charity'] = 'Forged'; [$c] = http('POST', '/admin/site', $camp, ['_c' => tok($cp)] + $forge); ok(st('giftaid_charity') === $before, 'a campaign manager cannot use the restore marker (nothing changes)');
[$c] = http('POST', '/admin/site', $root, ['_c' => tok($pg)] + ['restore_of' => 999999] + $post); ok(st('giftaid_charity') === $before, 'a restore marker that is not a real earlier change is refused');
change($root, 'app', ['small_n' => '6']); $appChange = (int)lastAudit('config_app')['id'];
$p2 = $post; $p2['restore_of'] = $appChange; $p2['f_giftaid_charity'] = 'Cross'; [$c] = http('POST', '/admin/site', $root, ['_c' => tok($pg)] + $p2); ok(st('giftaid_charity') === $before, 'a change from another settings page cannot be used here');

// a page that needs a reason and an approval reference still does
change($root, 'privacy', ['expiry_days' => '30'], ['approval' => 'Minute 5']); $priv = (int)lastAudit('config_privacy')['id']; $pdoSt = fn() => st('expiry_days');
ok($pdoSt() === '30', 'setup: privacy change saved with its reference');
$pp = ['reason' => 'Back again', 'approval' => '', 'restore_of' => $priv, 'f_expiry_days' => '60', 'f_retention_days' => cfg_form_value('retention_days', config_spec('privacy')['fields']['retention_days'])];
[, $pgp] = http('GET', '/admin/privacy', $root); [, $rvp] = http('POST', '/admin/privacy', $root, ['_c' => tok($pgp)] + $pp); http('POST', '/admin/privacy', $root, ['_c' => tok($rvp) ?: tok($pgp), 'confirmed' => 1, 'ver' => st('cfg_version')] + $pp);
ok(st('expiry_days') === '30' && str_contains($rvp, 'Impact'), 'restoring a retention setting still shows the impact and still needs an approval reference');
$pp['approval'] = 'Minute 6'; [, $rvp] = http('POST', '/admin/privacy', $root, ['_c' => tok($pgp)] + $pp); http('POST', '/admin/privacy', $root, ['_c' => tok($rvp), 'confirmed' => 1, 'ver' => st('cfg_version')] + $pp);
ok(st('expiry_days') === '60', 'with the reference it goes through');
ok((int)(new PDO('sqlite:' . $dbf))->query("select count(*) from audit where action like 'config_%' and detail like '%restored_from%'")->fetchColumn() === 2, 'both restores are recorded as restores');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
