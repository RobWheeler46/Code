<?php
putenv('APP_ENV=development');
// php tests/invites_test.php : administrator invitations over real HTTP (FR-088)
$work = sys_get_temp_dir() . '/ecard-iv-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); $log = ROOT . '/data/outbox.log'; @unlink($log);
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $n, string $roles = '', int $admin = 0, int $verified = 1): array { $sec = $admin ? b32e(random_bytes(10)) : null; q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,?,?,?,?,?,?)", [$n, "$n@x.com", password_hash('Test-pass-123', PASSWORD_DEFAULT), $verified, time(), TERMS_VERSION, $admin, $roles, $sec]); return ["$n@x.com", $sec]; }
$U = ['root' => mk('root', 'rolesadmin', 1), 'camp' => mk('camp', 'admin', 1), 'newbie' => mk('newbie', 'admin'), 'other' => mk('other'), 'unv' => mk('unv', '', 0, 0)];
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $m, string $path, string $jar, ?array $post = null): array { global $port; $loc = ''; $GLOBALS['hdr'] = ''; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$loc) { if (stripos($h, 'location:') === 0) $loc = trim(substr($h, 9)); $GLOBALS['hdr'] .= $h; return strlen($h); }]); if ($m === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post ?? [])); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b, $loc]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('GET', '/login', $j); http('POST', '/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); if ($u[1]) { [, $m] = http('GET', '/mfa', $j); http('POST', '/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); } return $j; }
function pdo(): PDO { return new PDO('sqlite:' . $GLOBALS['dbf']); }
function user_row(string $e): array { return pdo()->query("select * from users where email=" . pdo()->quote($e))->fetch(PDO::FETCH_ASSOC) ?: []; }
function links(): array { $o = []; foreach (@file($GLOBALS['log']) ?: [] as $l) { $j = json_decode($l, true); if ($j && preg_match('#/invite\?t=([0-9a-f]+)#', $j['text'], $m)) $o[] = [$j['to'], $m[1], $j['text']]; } return $o; }
function admin_post(string $jar, array $post): array { [, $p] = http('GET', '/admin/access', $jar); return http('POST', '/admin/invites', $jar, ['_c' => tok($p)] + $post); }
$anon = tempnam(sys_get_temp_dir(), 'jar'); $root = login($U['root']); $camp = login($U['camp']);

// who may invite
[$c, , ] = http('POST', '/admin/invites', $camp, ['_c' => tok(http('GET', '/admin', $camp)[1]), 'do' => 'create', 'email' => 'newbie@x.com', 'roles' => ['admin']]); ok($c === 403 && !links(), 'a campaign manager cannot invite');
ok(!invite_create('newbie@x.com', ['admin'], (int)user_row('camp@x.com')['id'])['ok'], 'and the function itself refuses them too');
[$c, $pg] = http('GET', '/admin/access', $root); ok($c === 200 && str_contains($pg, 'Invite someone by email'), 'a restricted administrator sees the invitation form');

// validation
foreach ([['not-an-email', ['admin'], 'a bad address'], ['newbie@x.com', [], 'no role'], ['camp@x.com', ['admin'], 'someone who is already an administrator'], ['newbie@x.com', ['notarole'], 'an unknown role']] as [$e, $r, $why]) { admin_post($root, ['do' => 'create', 'email' => $e, 'roles' => $r]); }
ok(!links() && (int)pdo()->query('select count(*) from admin_invites')->fetchColumn() === 0, 'a bad address, no role, an existing administrator or an unknown role are all refused');

// create
admin_post($root, ['do' => 'create', 'email' => 'Newbie@X.com', 'roles' => ['admin', 'owner']]); $L = links(); [$to, $t1, $txt] = $L[0] ?? ['', '', ''];
$row = pdo()->query('select * from admin_invites')->fetch(PDO::FETCH_ASSOC);
ok($to === 'newbie@x.com' && $row['roles'] === 'admin,owner' && $row['token_hash'] === hash('sha256', $t1) && $row['token_hash'] !== $t1, 'the invitation goes to the lowercased address and only a hash of the link is stored');
ok(str_contains($txt, 'Administrator') && str_contains($txt, 'ignore this email'), 'the email says which roles and what to do if it was not expected');
[, $pg] = http('GET', '/admin/access', $root); ok(str_contains($pg, 'newbie@x.com') && str_contains($pg, 'Waiting for an answer'), 'it shows as waiting for an answer');

// who can use the link
[$c, $b] = http('GET', '/invite?t=' . $t1, $anon); ok($c === 200 && str_contains($b, 'n*****@x.com') && !str_contains($b, 'newbie@x.com') && stripos($GLOBALS['hdr'], 'noindex') !== false, 'a signed out visitor sees only a masked address and a sign in prompt, and the page is not indexed');
[$c, $b] = http('GET', '/invite?t=' . str_repeat('0', 40), $anon); ok($c === 404 && str_contains($b, 'not valid'), 'a made up link is just not valid');
$other = login($U['other']); [, $pg] = http('GET', '/invite?t=' . $t1, $other); [$c, , $l] = http('POST', '/invite?t=' . $t1, $other, ['_c' => tok($pg), 't' => $t1]);
ok($c === 302 && !user_row('other@x.com')['is_admin'] && (int)pdo()->query('select count(*) from admin_invites where accepted_at is not null')->fetchColumn() === 0, 'someone signed in with a different address cannot accept it');
$unvId = (int)user_row('unv@x.com')['id']; pdo()->exec("insert into admin_invites(email,roles,token_hash,invited_by,created,expires) values('unv@x.com','campaign','" . hash('sha256', 'unv-token') . "',1," . time() . "," . (time() + 3600) . ")");
ok(!invite_accept('unv-token', user_row('unv@x.com')), 'an address that is not confirmed cannot accept');
pdo()->exec("update admin_invites set revoked_at=" . time() . " where token_hash='" . hash('sha256', 'unv-token') . "'");

// accept
$newbie = login($U['newbie']); [, $pg] = http('GET', '/invite?t=' . $t1, $newbie); ok(str_contains($pg, 'Accept the invitation') && str_contains($pg, 'Administrator, Owner'), 'the right person sees what they are accepting');
[$c, , $l] = http('POST', '/invite?t=' . $t1, $newbie, ['_c' => tok($pg), 't' => $t1]); $nr = user_row('newbie@x.com');
ok($c === 302 && $l === '/admin' && $nr['is_admin'] == 1 && $nr['roles'] === 'admin,owner', 'accepting makes them an administrator and keeps any role they already had');
[$c, , $l] = http('GET', '/admin', $newbie); ok($c === 302 && str_contains($l, '/mfa'), 'they cannot use Admin until they have done the two step sign in');
[$c] = http('POST', '/invite?t=' . $t1, $newbie, ['_c' => tok($pg), 't' => $t1]); [$c2, $b2] = http('GET', '/invite?t=' . $t1, $anon); ok($c2 === 404, 'the link works once');
[, $pg] = http('GET', '/admin/access', $root); ok(!str_contains($pg, 'Waiting for an answer'), 'it is no longer shown as waiting');

// revoke, resend, expiry
admin_post($root, ['do' => 'create', 'email' => 'later@x.com', 'roles' => ['admin']]); $L = links(); [, $t2] = end($L); $id2 = (int)pdo()->query("select id from admin_invites where email='later@x.com'")->fetchColumn();
admin_post($root, ['do' => 'resend', 'id' => $id2]); $L = links(); [, $t3] = end($L);
ok($t3 !== $t2 && http('GET', '/invite?t=' . $t2, $anon)[0] === 404 && http('GET', '/invite?t=' . $t3, $anon)[0] === 200, 'sending again replaces the link, and the old one stops working');
$cur = (int)pdo()->query("select id from admin_invites where email='later@x.com' and revoked_at is null")->fetchColumn(); admin_post($root, ['do' => 'revoke', 'id' => $cur]);
ok(http('GET', '/invite?t=' . $t3, $anon)[0] === 404, 'revoking makes the link stop working at once');
admin_post($root, ['do' => 'create', 'email' => 'old@x.com', 'roles' => ['admin']]); $L = links(); [, $t4] = end($L); pdo()->exec("update admin_invites set expires=" . (time() - 5) . " where email='old@x.com'");
ok(http('GET', '/invite?t=' . $t4, $anon)[0] === 404, 'an expired invitation is not valid');
for ($i = 0; $i < 20; $i++) pdo()->exec("insert into admin_invites(email,roles,token_hash,invited_by,created,expires) values('p$i@x.com','delivery','h$i',1," . time() . "," . (time() + 3600) . ")");
ok(!invite_create('overflow@x.com', ['admin'], (int)user_row('root@x.com')['id'])['ok'], 'no more than 20 invitations can wait at once');

// existing safeguards still hold, and the history is clean
$bad = 0; foreach (pdo()->query("select detail from audit where action like 'admin_invite%'")->fetchAll(PDO::FETCH_COLUMN) as $d) if (preg_match('/@|[0-9a-f]{32}/', (string)$d)) $bad++;
ok($bad === 0 && (int)pdo()->query("select count(*) from audit where action like 'admin_invite%'")->fetchColumn() >= 5, 'invitation events are in the change history with no addresses or links');
ok(!user_row('other@x.com')['is_admin'], 'nobody else gained access');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work)); @unlink($log);
exit($GLOBALS['bad'] ?? 0);
