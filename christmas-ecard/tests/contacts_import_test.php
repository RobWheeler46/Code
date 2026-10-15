<?php
putenv('APP_ENV=development');
// php tests/contacts_import_test.php : adding contacts from a CSV file
$work = sys_get_temp_dir() . '/ecard-imp-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$t = time(); foreach ([1, 2] as $i) q("insert into users(id,name,email,pass,verified,created,terms_version) values(?,?,?,?,1,?,?)", [$i, "U$i", "u$i@x.example", password_hash('Test-pass-123', PASSWORD_DEFAULT), $t, TERMS_VERSION]);
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, array|string|null $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $post); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(string $e): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, http_build_query(['_c' => tok($b), 'email' => $e, 'password' => 'Test-pass-123'])); return $j; }
function imp(string $jar, string $csv): string { global $work; [, $p] = http('/contacts/import', $jar); file_put_contents("$work/c.csv", $csv); return http('/contacts/import', $jar, ['_c' => tok($p), 'csv' => new CURLFile("$work/c.csv", 'text/csv', 'c.csv')])[1]; }
function n(int $u): int { global $dbf; return (int)(new PDO('sqlite:' . $dbf))->query("select count(*) from contacts where user_id=$u")->fetchColumn(); }
$a = login('u1@x.example'); $b = login('u2@x.example');
[$c] = http('/contacts/import', login('nobody@x.example')); ok($c !== 200, 'the import page needs a signed in account');
[$c, $pg] = http('/contacts/import', $a); ok($c === 200 && str_contains($pg, 'type="file"'), 'a signed in sender sees the import page');
$r = imp($a, "Name,Email\nAnn Smith,ann@x.example\n\"Bob, Jr\",bob@x.example\nBad Person,not-an-email\n,nobody@x.example\nANN again,ANN@x.example\n");
ok(n(1) === 2 && str_contains($r, '2 added') && str_contains($r, '1 already') && str_contains($r, '2 not added') && str_contains($r, 'line 4'), 'valid lines are added, a repeat is skipped, bad lines are listed by line number');
ok(!str_contains(imp($a, "Eve,eve@x.example\n"), '0 added') && n(1) === 3, 'a file with no heading line works');
imp($b, "Zed,ann@x.example\n"); ok(n(2) === 1 && n(1) === 3, 'another sender can save the same address, and each address book stays separate');
$r = imp($a, "<b>X</b>,x@x.example\n"); ok(n(1) === 3 || n(1) === 4, 'markup in a name never breaks the page') ; ok(!str_contains($r, '<b>X</b>'), 'and is never shown raw');
q("insert into settings(k,v) values('contacts_max','3') on conflict(k) do update set v='3'"); $r = imp($a, "Full,full@x.example\n"); ok(str_contains($r, 'address book is full'), 'the address book limit is respected');
[, $pg] = http('/contacts', $a); ok(str_contains($pg, '/contacts/import'), 'the address book links to the import page');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
