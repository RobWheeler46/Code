<?php
// php tests/smoke.php : runs core logic against a throwaway DB.
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-test-' . getmypid() . '.sqlite');
putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }

// recipients: 20 ok / parsing
[$rows, $errs] = parse_recipients("Gran, gran@example.com\nUncle Bob <bob@example.com>\nbad line\nX, nope\nGran2, GRAN@example.com");
ok(count($rows) === 2 && count($errs) === 3, 'parse: 2 valid, 3 rejected (junk, bad email, duplicate)');

// totp RFC 6238 vector (secret "12345678901234567890", t=59 -> 94287082, 6 digits 287082)
ok(totp(b32e('12345678901234567890'), 59) === '287082', 'totp matches RFC 6238 vector');

// send flow
q("insert into users(name,email,pass,verified,created) values('Sam','sam@x.com','x',1,?)", [time()]);
q("insert into sends(user_id,card,sender_name,message,created,updated) values(1,'santa','Sam','Merry!',?,?)", [time(), time()]);
foreach ([['A', 'a@x.com'], ['B', 'b@x.com']] as [$n, $e]) q('insert into recipients(send_id,name,email,token) values(1,?,?,?)', [$n, $e, token()]);
ok(queue_send(1) && !queue_send(1), 'free send queues once, second call is a no-op');
ok(count(file(ROOT . '/data/outbox.log')) === 2, 'one email per recipient');
ok(process_queue() === 0, 'no duplicate sends on re-run');

// payment: mismatch, repeat callbacks
q("insert into sends(user_id,card,sender_name,message,donation,status,created,updated) values(1,'santa','Sam','Hi',500,'awaiting_payment',?,?)", [time(), time()]);
q("insert into recipients(send_id,name,email,token) values(2,'C','c@x.com',?)", [token()]);
ok(!confirm_payment(2, 'cs_1', 100), 'wrong amount rejected');
ok(confirm_payment(2, 'cs_1', 500) && confirm_payment(2, 'cs_1', 500), 'repeat callback accepted');
ok((int)one('select count(*) c from donations')['c'] === 1, 'one donation row');
ok(count(file(ROOT . '/data/outbox.log')) === 4, 'receipt + exactly one card email (no duplicate send)');

// pause + suppression
set_setting('paused', '1'); q("update recipients set status='queued' where id=3");
ok(process_queue() === 0, 'paused queue sends nothing');
set_setting('paused', '0'); q("insert into suppressed values('c@x.com',1)");
process_queue(); ok(one('select status from recipients where id=3')['status'] === 'failed', 'suppressed address not sent');

@unlink(env('DB_PATH'));
exit($GLOBALS['bad'] ?? 0);
