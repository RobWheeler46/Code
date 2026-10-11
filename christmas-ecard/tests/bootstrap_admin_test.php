<?php
// php tests/bootstrap_admin_test.php : ADMIN_EMAIL makes the first confirmed owner of that address the first restricted administrator, once
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-ba-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mk(string $e, int $v = 1): int { q("insert into users(name,email,pass,verified,created) values('X',?,'x',?,?)", [$e, $v, time()]); return (int)db()->lastInsertId(); }
function u(int $id): array { return one('select * from users where id=?', [$id]); }
$a = mk('owner@x.com'); bootstrap_admin($a); ok(!u($a)['is_admin'], 'with ADMIN_EMAIL unset nobody becomes an administrator');
putenv('ADMIN_EMAIL=Owner@X.com'); $unv = mk('owner2@x.com', 0); putenv('ADMIN_EMAIL=owner2@x.com'); bootstrap_admin($unv); ok(!u($unv)['is_admin'], 'an address that is not confirmed is not enough');
putenv('ADMIN_EMAIL=Owner@X.com'); $other = mk('someone@x.com'); bootstrap_admin($other); ok(!u($other)['is_admin'], 'a different address gets nothing');
bootstrap_admin($a); $r = u($a); ok($r['is_admin'] == 1 && in_array('rolesadmin', explode(',', $r['roles'])) && !preg_match('/tg(editor|reviewer|approver|dispatch)/', $r['roles']) && count(explode(',', $r['roles'])) === 6, 'the confirmed owner of the address becomes a restricted administrator, with the six usual roles and no Trustee greeting role (the match ignores capital letters)');
$ev = one("select detail from audit where action='admin_bootstrap'"); ok($ev && !str_contains($ev['detail'], '@'), 'it is recorded without the address');
q("update users set is_admin=0, roles='' where id=?", [$a]); $b = mk('owner@x.com.au'); putenv('ADMIN_EMAIL=owner@x.com.au'); $c = mk('second@x.com'); q("update users set is_admin=1, roles='rolesadmin' where id=?", [$c]); bootstrap_admin($b);
ok(!u($b)['is_admin'], 'it does nothing once a restricted administrator exists');
@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
