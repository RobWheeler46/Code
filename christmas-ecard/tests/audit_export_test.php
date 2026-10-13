<?php
putenv('APP_ENV=development');
// php tests/audit_export_test.php : exporting the change history (FR-159): role scoped, time scoped, masked, logged
$work = sys_get_temp_dir() . '/ecard-ae-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $roles): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $roles, $sec]); return ["$n@x.com", $sec]; }
$U = ['root' => mk('root', 'rolesadmin'), 'app' => mk('app', 'appadmin'), 'camp' => mk('camp', 'campaign'), 'fin' => mk('fin', 'finance')];
$yday = time() - 86400; $old = time() - 40 * 86400; $tok = str_repeat('ab12', 10);
$seed = [['config_app', '{"changes":{"alert_emails":{"from":"","to":"ops.team@example.org"}},"reason":"x"}', $yday], ['resend', "recipient 5 link $tok", $yday], ['config_campaign', '=1+1', $yday], ['dispatch_paused', 'reason: test', $yday], ['config_app', 'old entry', $old]];
foreach ($seed as [$a, $d, $t]) q('insert into audit(user_id,action,detail,created) values(1,?,?,?)', [$a, $d, $t]);
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $GLOBALS['hdr'] = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); $GLOBALS['hdr'] .= $h; return strlen($h); }]); if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $j); http('POST', '/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('GET', '/mfa', $j); http('POST', '/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function doexport(string $jar, array $o = []): array { [, $p] = http('GET', '/admin/audit/export', $jar); return http('POST', '/admin/audit/export', $jar, array_merge(['_c' => tok($p), 'from' => date('Y-m-d', time() - 2 * 86400), 'to' => date('Y-m-d'), 'reason' => 'Annual review', 'action' => ''], $o)); }
function csv(string $b): array { $f = fopen('php://memory', 'r+'); fwrite($f, $b); rewind($f); $r = []; while (($x = fgetcsv($f, 0, ',', '"', '\\')) !== false) $r[] = $x; return $r; }
$root = login($U['root']); $app = login($U['app']); $camp = login($U['camp']); $fin = login($U['fin']);

foreach (['camp' => $camp, 'fin' => $fin] as $w => $j) { [$c] = http('GET', '/admin/audit/export', $j); [$c2] = doexport($j); ok($c === 403 && $c2 === 403, "a $w role cannot reach or use the export"); }
[$c, $pg] = http('GET', '/admin/audit', $root); ok(str_contains($pg, '/admin/audit/export'), 'the change history offers the export to restricted administrators');
[, $pg] = http('GET', '/admin/audit', $camp); ok(!str_contains($pg, '/admin/audit/export'), 'and not to a campaign manager');

// checks that refuse before anything is handed over
$none = fn() => (int)(new PDO('sqlite:' . $dbf))->query("select count(*) from audit where action='audit_export'")->fetchColumn();
[$c, $b] = doexport($root, ["reason" => ""]); ok($c === 200 && str_contains($b, 'Say why') && $none() === 0, 'an export without a reason is refused and not logged');
[$c, $b] = doexport($root, ['from' => '2026-13-45']); ok($c === 200 && str_contains($b, 'start and an end date') && $none() === 0, 'a bad date is refused');
[$c, $b] = doexport($root, ['from' => date('Y-m-d'), 'to' => date('Y-m-d', time() - 5 * 86400)]); ok($c === 200 && str_contains($b, 'must not be after') && $none() === 0, 'a start after the end is refused');
[$c, $b] = doexport($root, ['from' => date('Y-m-d', time() - 400 * 86400)]); ok($c === 200 && str_contains($b, 'a year or less') && $none() === 0, 'more than a year is refused');

// the export
[$c, $b] = doexport($root); $rows = csv($b); $act = array_column(array_slice($rows, 1), 4);
ok($c === 200 && stripos($GLOBALS['hdr'], 'text/csv') !== false && stripos($GLOBALS['hdr'], 'attachment') !== false && $rows[0] === ['id', 'time_uk', 'actor_id', 'actor', 'action', 'detail'], 'a restricted administrator downloads a CSV file with a header row');
ok(in_array('config_app', $act, true) && in_array('resend', $act, true) && in_array('config_campaign', $act, true) && !str_contains($b, 'old entry'), 'it holds the entries in the chosen dates, and not the older one');
ok(!str_contains($b, 'ops.team@example.org') && str_contains($b, 'o*******@example.org') && !str_contains($b, $tok) && str_contains($b, '[removed]'), 'addresses are partly hidden and the link is removed');
ok(str_contains($b, "'=1+1") && !preg_match('/(^|,)"?=1\+1/m', $b), 'a cell that could run as a spreadsheet formula is made safe');
$a = (new PDO('sqlite:' . $dbf))->query("select * from audit where action='audit_export'")->fetch(PDO::FETCH_ASSOC); $d = json_decode($a['detail'], true);
ok($none() === 1 && $d['rows'] === count($rows) - 1 && $d['reason'] === 'Annual review' && $d['filter'] === '' && !preg_match('/@|[0-9a-f]{24}/', $a['detail']), 'the export is logged with its dates, size and reason, and no content');

// scope: an application administrator sees only their part
[$c, $b] = doexport($app); $acts = array_column(array_slice(csv($b), 1), 4);
ok($c === 200 && $acts && !array_diff($acts, ['config_app', 'dispatch_paused']) && !in_array('resend', $acts, true) && !str_contains($b, '=1+1'), 'an application administrator gets only the entries their roles allow');
[$c, $b] = doexport($app, ['action' => 'dispatch_']); $acts = array_column(array_slice(csv($b), 1), 4); ok($acts === ['dispatch_paused'], 'the action filter narrows it');

// slow it down
$last = 0; for ($i = 0; $i < 4; $i++) [$last] = doexport($root); 
[$c, $b] = doexport($root); ok(!str_starts_with($b, 'id,time_uk'), 'after five tries in an hour the next one is refused');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
