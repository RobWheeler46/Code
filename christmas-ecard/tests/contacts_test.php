<?php
putenv('APP_ENV=development');
// php tests/contacts_test.php : address book and group rules (FR-100 to FR-116).
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-ct-' . getmypid() . '.sqlite');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
foreach ([['Ann', 'ann@x.com'], ['Bo', 'bo@x.com']] as [$n, $e]) q("insert into users(name,email,pass,verified,created) values(?,?,'x',1,?)", [$n, $e, time()]);

ok(norm_email('  Sam.Smith+tag@EXAMPLE.Com ') === 'Sam.Smith+tag@example.com', 'norm_email lowercases domain only, keeps dots and plus tags');
ok(email_key('A.B+x@Ex.com') === email_key('a.b+x@ex.COM') && email_key('a.b@x.com') !== email_key('ab@x.com'), 'duplicate rule: case-folded, dots/plus kept');
ok(contact_errors('', 'x') === ['name' => 'Enter a name of 1 to 100 characters.', 'email' => 'Enter a valid email address.'] && !contact_errors('Ann', 'ann@x.com'), 'validation');

q("insert into contacts(user_id,name,email,created,updated) values(1,'Gran','gran@x.com',1,1),(1,'Uncle Bob','bob@x.com',1,1),(2,'Other','other@x.com',1,1)");
q("insert into groups(user_id,name) values(1,'Family'),(2,'Secret')");
set_memberships(1, 1, [1, 2, 99]); // group 2 belongs to user 2, 99 does not exist
ok(member_ids(1) === [1], 'cannot attach another owner\'s group');
set_memberships(1, 1, [1, 1]); ok(count(member_ids(1)) === 1, 'multi-group, no duplicate membership');
ok(array_column(contacts_for(1), 'name') === ['Gran', 'Uncle Bob'], 'All contacts is owner-only');
ok(array_column(contacts_for(1, '', 'none'), 'name') === ['Uncle Bob'], 'Ungrouped filter');
ok(array_column(contacts_for(1, '', '1'), 'name') === ['Gran'], 'group filter');
ok(array_column(contacts_for(1, 'BOB'), 'name') === ['Uncle Bob'] && !contacts_for(1, 'other'), 'search is case-insensitive and owner-scoped');
ok(!contacts_for(1, '%'), 'LIKE wildcards are escaped');
ok(contact_dup(1, 'GRAN@X.COM')['name'] === 'Gran' && contact_dup(1, 'gran@x.com', 1) === null && contact_dup(2, 'gran@x.com') === null, 'duplicate detection per owner');
ok(group_name_ok(1, '  family ') !== null && group_name_ok(1, 'Friends') === null && group_name_ok(2, 'Family') === null && group_name_ok(1, '') !== null, 'group names: duplicate (case/space folded) rejected, per owner');
$_SESSION['uid'] = 1; ok(own_contact(1)['name'] === 'Gran', 'owner can load own contact');
ok(one('select 1 from contacts where id=3 and user_id=1') === null, 'other owner\'s contact not reachable by id');
@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
