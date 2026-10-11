<?php
// php tests/library_security_test.php : EC-08 the library over real HTTP: sign in, two step, roles, CSRF, confirmation, replay, Group scope, upload abuse
$work = sys_get_temp_dir() . '/ecard-ls-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite'; $lib = $work . '/library';
putenv('DB_PATH=' . $dbf); putenv('LIBRARY_DIR=' . $lib); putenv('POSTMARK_TOKEN='); putenv('APP_URL=http://127.0.0.1');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function pic(string $to, int $r = 0): string { $im = imagecreatetruecolor(1060, 1484); imagefilledrectangle($im, 0, 0, 1060, 1484, imagecolorallocate($im, $r, 60, 140)); imagepng($im, $to); imagedestroy($im); return $to; }
function mk(string $n, string $roles, int $admin): array { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,?,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $admin, $roles, $admin ? $sec : null]); return [(int)db()->lastInsertId(), $sec, "$n@x.com"]; }
[$pubId, $pubSec, $pubMail] = mk('pub', 'rolesadmin', 1); [$mgrId, $mgrSec, $mgrMail] = mk('mgr', 'campaign', 1); [$finId, $finSec, $finMail] = mk('fin', 'finance', 1); [, , $plainMail] = mk('plain', '', 0);
$good = ['name' => 'Snowy', 'words' => 'Snowy Christmas', 'alt' => 'Scouts in the snow. The words say: Snowy Christmas.', 'rights' => '1', 'year' => '1', 'focus' => '0'];
$d = library_save($good, pic("$work/a.png", 5), $mgrId); $row = lib_row($d['id']); $did = (int)$d['id']; $vid = (int)$row['vid'];
q("insert into designs(owner_group_id,slug,internal_name,created) values(2,'other-group','Other Group card',1)"); $odid = (int)db()->lastInsertId();
q("insert into design_versions(design_id,version_no,title,description,alt_text,full_key,thumb_key,rev,created) values(?,1,'Other','x','Other group card alt text long enough','ab/f-" . str_repeat('1', 32) . ".webp','ab/t-" . str_repeat('1', 32) . ".webp',1,1)", [$odid]);
q("insert into campaign_designs(campaign_id,design_id,state,order_rank) values(?, ?, 'draft', 99)", [lib_campaign(), $odid]);

// start the real application
$port = random_int(18100, 18900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'LIBRARY_DIR' => $lib]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null, array $files = []): array {
    global $port; $loc = ''; $ch = curl_init("http://127.0.0.1:$port$path");
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); return strlen($h); }]);
    if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, $files ? $post + $files : http_build_query($post ?? [])); }
    $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc];
}
function tok(string $html): string { preg_match('/name="_c" value="([^"]+)"/', $html, $m); return $m[1] ?? ''; }
function login(string $email, ?string $secret): string {
    $jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $jar); http('POST', '/login', $jar, ['_c' => tok($b), 'email' => $email, 'password' => 'Test-pass-123']);
    if ($secret) { [, $m] = http('GET', '/mfa', $jar); http('POST', '/mfa', $jar, ['_c' => tok($m), 'code' => totp($secret, time())]); }
    return $jar;
}
function state(int $did): string { return lib_row_fresh($did)['state'] ?? '?'; }
function lib_row_fresh(int $did): ?array { return (new PDO('sqlite:' . getenv('DB_PATH')))->query('select cd.state from campaign_designs cd where cd.design_id=' . $did)->fetch(PDO::FETCH_ASSOC) ?: null; }
function audits(string $a): int { return (int)(new PDO('sqlite:' . getenv('DB_PATH')))->query("select count(*) from audit where action='$a'")->fetchColumn(); }

$anon = tempnam(sys_get_temp_dir(), 'jar');
foreach (['/admin/library', '/admin/library/edit', '/admin/library/preview?id=' . $did, '/admin/library/img?v=' . $vid . '&k=thumb'] as $p) { [$c, , $l] = http('GET', $p, $anon); ok($c === 302 && str_contains($l, '/login'), "signed out: $p goes to sign in"); }
[$c, , $l] = http('POST', '/admin/library/action', $anon, ['do' => 'publish', 'id' => $did, 'confirmed' => 1]); ok($c === 403 || ($c === 302 && str_contains($l, '/login')), 'signed out: a forged publish is refused');
$plain = login($plainMail, null); [$c] = http('GET', '/admin/library', $plain); ok($c === 403, 'a signed in sender who is not an administrator gets 403');
$noMfa = login($mgrMail, null); [$c, , $l] = http('GET', '/admin/library', $noMfa); ok($c === 302 && str_contains($l, '/mfa'), 'an administrator who has not done the second step is sent to it');
$fin = login($finMail, $finSec);
foreach (['/admin/library', '/admin/library/preview?id=' . $did, '/admin/library/img?v=' . $vid . '&k=thumb'] as $p) { [$c] = http('GET', $p, $fin); ok($c === 403, "finance administrator: $p is refused"); }
[, $adm] = http('GET', '/admin', $fin); [$c] = http('POST', '/admin/library/action', $fin, ['_c' => tok($adm), 'do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev'], 'confirmed' => 1]); ok($c === 403 && state($did) === 'draft', 'finance administrator: a forged publish with a valid CSRF token is refused and nothing changes');

$mgr = login($mgrMail, $mgrSec); [$c, $page] = http('GET', '/admin/library/preview?id=' . $did, $mgr); ok($c === 200 && str_contains($page, 'Only a publisher can publish'), 'a campaign manager sees the draft but is told only a publisher can publish');
[$c] = http('POST', '/admin/library/action', $mgr, ['do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev'], 'confirmed' => 1]); ok($c === 403 && state($did) === 'draft', 'a POST without the CSRF token is refused');
[$c, $b] = http('POST', '/admin/library/action', $mgr, ['_c' => tok($page) ?: tok(http('GET', '/admin', $mgr)[1]), 'do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev'], 'confirmed' => 1]); ok($c === 403 && state($did) === 'draft', 'a campaign manager forging a publish with a valid token is refused');

$pub = login($pubMail, $pubSec); [, $pp] = http('GET', '/admin/library/preview?id=' . $did, $pub); $t = tok($pp);
[$c, $b] = http('POST', '/admin/library/action', $pub, ['_c' => $t, 'do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev']]); ok($c === 200 && str_contains($b, 'This makes the version available') && state($did) === 'draft', 'without confirmation the publisher is shown what will happen and nothing changes');
[$c] = http('POST', '/admin/library/action', $pub, ['_c' => $t, 'do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev'], 'confirmed' => 1]); ok($c === 302 && state($did) === 'published', 'the publisher confirms and it is published');
[$c] = http('POST', '/admin/library/action', $pub, ['_c' => $t, 'do' => 'publish', 'id' => $did, 'vid' => $vid, 'rev' => $row['rev'], 'confirmed' => 1]); ok($c === 302 && audits('library_published') === 1, 'CAT-12 style replay: submitting the same publish again changes nothing and records one event');
[$c] = http('POST', '/admin/library/action', $pub, ['_c' => $t, 'do' => 'explode', 'id' => $did, 'confirmed' => 1]); ok($c === 400, 'an unknown action is refused');

// Group scope (OCA-11)
[$c] = http('GET', '/admin/library/preview?id=' . $odid, $pub); ok($c === 404, "another Group's design cannot be opened");
[$c, $list] = http('GET', '/admin/library', $pub); ok($c === 200 && !str_contains($list, 'Other Group card'), "another Group's design is not in the list");
[$c] = http('POST', '/admin/library/action', $pub, ['_c' => $t, 'do' => 'hold', 'id' => $odid, 'confirmed' => 1]); ok($c >= 400, "another Group's design cannot be changed");
$ovid = (int)(new PDO('sqlite:' . $dbf))->query("select id from design_versions where design_id=$odid")->fetchColumn();
[$c] = http('GET', '/admin/library/img?v=' . $ovid . '&k=thumb', $pub); ok($c === 404, "another Group's picture cannot be fetched");
[$c, $body] = http('GET', '/admin/library/img?v=' . $vid . '&k=../../../../etc/passwd', $pub); $thumbFile = $lib . '/' . (new PDO('sqlite:' . $dbf))->query('select thumb_key from design_versions where id=' . $vid)->fetchColumn();
ok($c === 200 && $body === file_get_contents($thumbFile), 'a path in the picture request is ignored: only the stored thumbnail is ever served');

// upload abuse over HTTP (CAT-02)
$files = count(glob("$lib/*/*") ?: []);
file_put_contents("$work/evil.png", "<?php system('id'); ?>" . str_repeat(' ', 300));
[, $ed] = http('GET', '/admin/library/edit', $mgr); $et = tok($ed);
[$c, , $l] = http('POST', '/admin/library/save', $mgr, ['_c' => $et, 'id' => 0, 'name' => 'Evil', 'words' => 'x', 'alt' => 'A long enough description of the evil card.'], ['art' => new CURLFile("$work/evil.png", 'image/png', 'evil.png')]);
ok($c === 302 && str_contains($l, '/admin/library/edit') && count(glob("$lib/*/*") ?: []) === $files, 'a script renamed to .png is refused over HTTP and nothing is stored');
[, $ed2] = http('GET', '/admin/library/edit', $mgr); ok(str_contains($ed2, 'We can only accept PNG, JPEG or WebP'), 'the sender of the bad file is told why, in plain words');
[$c] = http('POST', '/admin/library/save', $fin, ['_c' => tok($adm), 'id' => 0, 'name' => 'Fin', 'words' => 'x', 'alt' => 'A long enough description of the card.'], ['art' => new CURLFile(pic("$work/f.png", 9), 'image/png', 'f.png')]);
ok($c === 403 && count(glob("$lib/*/*") ?: []) === $files, 'a finance administrator cannot upload');

// nothing private ends up in the change history
$bad = 0; foreach ((new PDO('sqlite:' . $dbf))->query("select detail from audit where action like 'library_%'")->fetchAll(PDO::FETCH_COLUMN) as $dtl) if (preg_match('/@|[0-9a-f]{40,}|password|token/i', (string)$dtl)) $bad++;
ok($bad === 0, 'library entries in the change history hold no email addresses, links or secrets');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
