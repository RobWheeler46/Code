<?php
putenv('APP_ENV=development');
// php tests/token_hash_test.php : mailed card links are stored only as a hash (build pack hardening)
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-th-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN='); putenv('APP_URL=https://cards.example.org');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); @unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function find_fail(string $t): bool { return !one("select id from recipients where (token_hash=sha256(?) or (token_hash is null and token=?)) and status in ('sent','sending','queued','failed','bounced')", [$t, $t]); } // same lookup as recipient_by_token, which exits on a miss
q("insert into users(name,email,pass,verified,created,terms_version) values('Sam','sam@x.com','x',1,?,?)", [time(), TERMS_VERSION]);
q("insert into sends(user_id,card,sender_name,message,status,queued_at,created,updated) values(1,'santa','Sam','Hi','queued',?,?,?)", [time(), time(), time()]);
$plain = token(); q("insert into recipients(send_id,name,email,token,status) values(1,'Gran','gran@x.com',?,'queued')", [$plain]);
ok(recipient_by_token($plain)['name'] === 'Gran', 'a queued card still opens by its plain link (hash not yet written)');
process_queue();
$r = one("select * from recipients where email='gran@x.com'");
ok($r['status'] === 'sent' && $r['token'] === null, 'after sending, the plain link is no longer stored');
ok($r['token_hash'] === hash('sha256', $plain), 'only its SHA-256 hash is stored');
ok(str_contains(file_get_contents(ROOT . '/data/outbox.log'), $plain), 'the email that went out did carry the real link');
ok(recipient_by_token($plain)['name'] === 'Gran', 'the emailed link still opens the card');
ok(find_fail(hash('sha256', $plain)), 'the stored hash is not itself a working link');
// correction: fresh link, old link dies, both race-safe
q("update recipients set status='failed' where id=?", [$r['id']]);
ok(requeue_recipient((int)$r['id'], null, 1, 'test'), 'a sent then failed delivery can be requeued by hash');
$n = one('select * from recipients where id=?', [$r['id']]);
ok($n['token'] && $n['token'] !== $plain && $n['token_hash'] === hash('sha256', $n['token']), 'requeue issues a new link and matching hash');
ok(find_fail($plain), 'the old link stops working');
q("delete from sends"); @unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
