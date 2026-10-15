<?php
putenv('APP_ENV=development');
// php tests/occasions_admin_test.php : adding, renaming and removing occasions
$work = sys_get_temp_dir() . '/ecard-occa-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$S = []; foreach (['admin' => [1, 'admin'], 'plain' => [0, '']] as $n => [$adm, $roles]) { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,?,?,?)", [$n, "$n@x.example", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $adm, $roles, $sec]); $S[$n] = ["$n@x.example", $sec]; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('/mfa', $j); http('/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function act(string $jar, array $f): array { [, $p] = http('/admin/occasions', $jar); return http('/admin/occasions', $jar, ['_c' => tok($p)] + $f); }
function occ(): array { global $dbf; return (new PDO('sqlite:' . $dbf))->query('select slug,label from occasions order by id')->fetchAll(PDO::FETCH_KEY_PAIR); }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
$a = login($S['admin']); $p = login($S['plain']);

[$c] = http('/admin/occasions', $p); ok($c === 403, 'someone who is not an administrator cannot open the screen');
[$c, $pg] = http('/admin/occasions', $a); ok($c === 200 && str_contains($pg, 'Christmas') && str_contains($pg, 'Birthday') && str_contains($pg, 'Add an occasion') && str_contains($pg, 'Built in'), 'an administrator sees the occasions, with Christmas marked as built in');
act($p, ['do' => 'add', 'label' => 'Hacked']); ok(!isset(occ()['hacked']), 'and the actions are refused for others');

act($a, ['do' => 'add', 'label' => 'Get well']); ok((occ()['get-well'] ?? '') === 'Get well', 'adding an occasion gives it a plain address name');
act($a, ['do' => 'add', 'label' => 'get WELL']); ok(count(array_filter(occ(), fn($l) => strtolower($l) === 'get well')) === 1, 'a name that already exists, in any letter case, is refused');
act($a, ['do' => 'add', 'label' => '']); act($a, ['do' => 'add', 'label' => str_repeat('x', 31)]); act($a, ['do' => 'add', 'label' => 'Bad <b>']); ok(!array_filter(occ(), fn($l) => $l === '' || strlen($l) > 30 || str_contains($l, '<')), 'empty, long and markup names are refused');
act($a, ['do' => 'add', 'label' => 'Cafe & Bar']); ok(!array_filter(occ(), fn($l) => str_contains($l, '&')), 'names with characters like an ampersand are refused');
act($a, ['do' => 'add', 'label' => 'Easter']); act($a, ['do' => 'add', 'label' => 'Get well soon']); ok(isset(occ()['easter']) && isset(occ()['get-well-soon']), 'other names are fine and get their own slugs');

$id = (int)dbq("select id from occasions where slug='easter'")->fetchColumn();
act($a, ['do' => 'rename', 'id' => $id, 'label' => 'Easter Sunday']); ok((occ()['easter'] ?? '') === 'Easter Sunday', 'renaming changes the name and keeps the stable slug');
act($a, ['do' => 'rename', 'id' => $id, 'label' => 'birthday']); ok((occ()['easter'] ?? '') === 'Easter Sunday', 'renaming to a name another occasion has is refused');
[, $pg] = http('/admin/occasions', $a); ok(!str_contains($pg, '<b>') && str_contains($pg, 'aria-label="Name of occasion Easter Sunday"'), 'names are shown safely and each field is labelled');

// a design in an occasion stops it being removed; Christmas can never be removed
(new PDO('sqlite:' . $dbf))->exec("insert into designs(slug,internal_name,category,created) values('e-test','E','easter',1)");
act($a, ['do' => 'delete', 'id' => $id]); ok(isset(occ()['easter']), 'an occasion with cards in it cannot be removed');
$xid = (int)dbq("select id from occasions where slug='christmas'")->fetchColumn(); act($a, ['do' => 'delete', 'id' => $xid]); ok(isset(occ()['christmas']), 'Christmas cannot be removed');
$gid = (int)dbq("select id from occasions where slug='get-well-soon'")->fetchColumn(); act($a, ['do' => 'delete', 'id' => $gid]); ok(!isset(occ()['get-well-soon']), 'an empty occasion can be removed');
for ($i = 0; $i < 14; $i++) act($a, ['do' => 'add', 'label' => "Extra $i"]); ok(count(occ()) <= OCCASIONS_MAX, 'there is a limit on how many occasions there can be');
// seasons
$gw0 = (int)dbq("select id from occasions where slug='get-well'")->fetchColumn();
act($a, ['do' => 'save', 'id' => $gw0, 'label' => 'Get well', 'season_start' => '03-01', 'season_end' => '04-30']); ok(dbq("select season_start||'/'||season_end from occasions where id=$gw0")->fetchColumn() === '03-01/04-30', 'a season of two month and day values can be saved');
act($a, ['do' => 'save', 'id' => $gw0, 'label' => 'Get well', 'season_start' => '13-40', 'season_end' => '04-30']); ok(dbq("select season_start from occasions where id=$gw0")->fetchColumn() === '03-01', 'a start that is not a real month and day is refused');
act($a, ['do' => 'save', 'id' => $gw0, 'label' => 'Get well', 'season_start' => '05-01', 'season_end' => '']); ok(dbq("select season_start from occasions where id=$gw0")->fetchColumn() === '03-01', 'a start with no end is refused');
act($a, ['do' => 'save', 'id' => $gw0, 'label' => 'Get well', 'season_start' => '', 'season_end' => '']); ok(dbq("select season_start from occasions where id=$gw0")->fetchColumn() === null, 'both blank means no season');
[, $pg] = http('/admin/occasions', $a); ok(str_contains($pg, 'aria-label="Season starts for Christmas, month and day"') && str_contains($pg, 'value="11-01"'), 'every occasion has labelled season boxes, and Christmas shows its dates');

// the order occasions are listed in
function order(): array { return array_column(dbq('select slug from occasions order by sort, id')->fetchAll(PDO::FETCH_ASSOC), 'slug'); }
$before = order(); $gw = (int)dbq("select id from occasions where slug='get-well'")->fetchColumn();
ok(end($before) !== 'christmas' && array_search('get-well', $before) > array_search('birthday', $before), 'a new occasion goes to the end of the list');
act($a, ['do' => 'up', 'id' => $gw]); $o1 = order(); ok(array_search('get-well', $o1) === array_search('get-well', $before) - 1, 'Move up puts an occasion one place earlier');
act($a, ['do' => 'down', 'id' => $gw]); ok(order() === $before, 'and Move down puts it back');
$first = (int)dbq("select id from occasions where slug='" . $before[0] . "'")->fetchColumn(); act($a, ['do' => 'up', 'id' => $first]); ok(order() === $before, 'the first occasion cannot be moved up');
$lastId = (int)dbq("select id from occasions where slug='" . end($before) . "'")->fetchColumn(); act($a, ['do' => 'down', 'id' => $lastId]); ok(order() === $before, 'and the last cannot be moved down');
[, $pg] = http('/admin/occasions', $a); ok(str_contains($pg, 'aria-label="Move Get well up"') && str_contains($pg, 'aria-label="Move Get well down"'), 'each move button says which occasion it moves');
$log = (string)dbq("select group_concat(action) from audit where action like 'occasion_%'")->fetchColumn(); ok(str_contains($log, 'occasion_add') && str_contains($log, 'occasion_save') && str_contains($log, 'occasion_delete'), 'each change is recorded in the change history');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
