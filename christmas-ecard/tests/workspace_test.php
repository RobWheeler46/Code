<?php
putenv('APP_ENV=development');
// php tests/workspace_test.php : ADM-07 the volunteer workspace role by role: what each role is shown, and what each role can actually open
$work = sys_get_temp_dir() . '/ecard-ws-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$roles = ['campaign', 'delivery', 'complaints', 'finance', 'appadmin', 'rolesadmin']; $U = [];
foreach ($roles as $r) { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", ["u$r", "$r@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $r, $sec]); $U[$r] = ["$r@x.com", $sec]; }
// the expectation, written out again here on purpose (not read from the manifest): which roles may use which destination
$six = ['campaign', 'appadmin', 'finance', 'delivery', 'complaints', 'rolesadmin'];
$rules = ['/admin' => ['*'], '/admin/library' => ['campaign', 'rolesadmin'], '/admin/campaigns' => ['campaign', 'rolesadmin'], '/admin/campaign' => ['campaign', 'appadmin', 'finance', 'delivery', 'rolesadmin'],
    '/admin/delivery' => ['delivery', 'appadmin', 'rolesadmin'], '/admin/reports' => ['complaints'], '/admin/senders' => ['complaints', 'rolesadmin'], '/admin/finance' => ['finance'], '/admin/giftaid' => ['finance'],
    '/admin/measures' => ['campaign', 'finance', 'appadmin', 'rolesadmin'], '/admin/platform' => $six, '/admin/app' => ['appadmin', 'campaign', 'delivery', 'rolesadmin'], '/admin/mail' => ['appadmin', 'rolesadmin'], '/admin/wording' => ['appadmin', 'rolesadmin'],
    '/admin/email' => ['appadmin', 'rolesadmin'], '/admin/privacy' => ['rolesadmin', 'campaign', 'appadmin', 'finance', 'delivery'], '/admin/access' => ['rolesadmin'], '/admin/rehearsal' => ['appadmin', 'rolesadmin'],
    '/admin/health' => $six, '/admin/audit' => $six];
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); }]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('/mfa', $j); http('/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function menu(string $html): array { if (!preg_match('#<nav aria-label="Workspace">(.*?)</nav>#s', $html, $m)) return []; preg_match_all('#<a href="([^"]+)"#', $m[1], $a); return $a[1]; }

$mismatch = []; $menus = []; $jars = [];
foreach ($roles as $r) {
    $jar = $jars[$r] = login($U[$r]); [$c, $page] = http('/admin', $jar); $menus[$r] = menu($page);
    $want = array_keys(array_filter($rules, fn($who) => in_array('*', $who, true) || in_array($r, $who, true)));
    // the menu shows destinations, platform tools are reached from Platform controls
    $wantMenu = array_values(array_filter($want, fn($h) => !in_array($h, ['/admin/app', '/admin/mail', '/admin/wording', '/admin/email', '/admin/privacy', '/admin/access', '/admin/rehearsal', '/admin/health', '/admin/audit'], true)));
    $got = $menus[$r]; sort($wantMenu); sort($got);
    ok($c === 200 && $got === $wantMenu, "$r: the menu shows exactly " . count($wantMenu) . ' destinations (' . ($got === $wantMenu ? 'match' : 'got ' . implode(' ', $got) . ' wanted ' . implode(' ', $wantMenu)) . ')');
    foreach ($rules as $href => $who) {
        [$code] = http($href, $jar); $should = in_array('*', $who, true) || in_array($r, $who, true); $opened = $code === 200;
        if ($should !== $opened) $mismatch[] = "$r $href: " . ($should ? 'should open' : 'should be refused') . " but gave $code";
    }
}
ok(!$mismatch, 'every role can open exactly the destinations it is meant to, and is refused the rest' . ($mismatch ? ': ' . implode('; ', $mismatch) : ''));
// platform hub and overview shortcuts follow the menu
$j = $jars['appadmin']; [, $hub] = http('/admin/platform', $j); preg_match_all('#class="wscard" href="([^"]+)"#', $hub, $cards);
ok(!array_diff(['/admin/app', '/admin/mail', '/admin/wording', '/admin/health', '/admin/audit'], $cards[1]) && !in_array('/admin/access', $cards[1], true), 'Platform controls lists only the tools that role may use');
[, $ov] = http('/admin', $j); preg_match_all('#class="wscard" href="([^"]+)"#', $ov, $sc); $m = $menus['appadmin']; $sc = $sc[1]; sort($sc); $mm = array_values(array_diff($m, ['/admin'])); sort($mm);
ok($sc === $mm && str_contains($ov, 'What would you like to do?') && str_contains($ov, 'Where things stand'), 'the overview shortcuts are the same destinations as the menu');
// breadcrumbs and current page
[, $pg] = http('/admin/library', $jars['campaign']); ok(str_contains($pg, 'aria-label="Breadcrumb"') && str_contains($pg, '<span aria-current="page">eCard Library</span>') && str_contains($pg, 'Cards and campaigns') && str_contains($pg, '<a href="/admin/library" aria-current="page">eCard Library</a>'), 'a page shows its breadcrumb and is marked as the current page in the menu');
[, $pg] = http('/admin/mail', $j); ok(str_contains($pg, 'Platform controls') && str_contains($pg, '<span aria-current="page">Email delivery</span>') && str_contains($pg, '<a href="/admin/platform" aria-current="true">Platform controls</a>'), 'a tool inside Platform controls shows where it sits');
ok(str_contains($pg, '<details class="wsmenu" open><summary>Workspace menu</summary>') && str_contains($pg, '<meta name="viewport"'), 'the menu is a disclosure that the page can close on a phone');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
