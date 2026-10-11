<?php
// php tests/ops_test.php : terms, suspension, row entry, alerts (FRD 2.1).
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-op-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); @unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mails(): int { return is_file(ROOT . '/data/outbox.log') ? count(file(ROOT . '/data/outbox.log')) : 0; }
q("insert into users(name,email,pass,verified,created,terms_version) values('Sam','sam@x.com','x',1,?,?)", [time(), TERMS_VERSION]);
q("insert into users(name,email,pass,verified,created,terms_version) values('Old','old@x.com','x',1,?,'older')", [time()]);

// FR-132 terms
ok(terms_ok(one('select * from users where id=1')) && !terms_ok(one('select * from users where id=2')), 'terms version check');
accept_terms(2); ok(terms_ok(one('select * from users where id=2')) && one('select terms_at from users where id=2')['terms_at'] > 0, 'acceptance stores version and time');

// FR-133 suspension
q("insert into sends(user_id,card,sender_name,message,status,queued_at,created,updated) values(1,'santa','Sam','Hi','queued',?,?,?)", [time(), time(), time()]);
q("insert into recipients(send_id,name,email,token,status) values(1,'A','a@x.com','t1','queued'),(1,'B','b@x.com','t2','sent')");
ok(sender_blocked(one('select * from users where id=1')) === null, 'active sender not blocked');
$n = suspend_sender(1, 'test', 2); ok($n === 1, 'suspension cancels only unclaimed queued deliveries');
ok(one("select status from recipients where token='t1'")['status'] === 'cancelled' && one("select status from recipients where token='t2'")['status'] === 'sent', 'sent cards untouched');
ok(str_contains(sender_blocked(one('select * from users where id=1')), 'A-1') && !str_contains(sender_blocked(one('select * from users where id=1')), 'report'), 'neutral message with support reference');
q("insert into recipients(send_id,name,email,token,status) values(1,'C','c@x.com','t3','queued')"); $before = mails(); process_queue();
ok(one("select status from recipients where token='t3'")['status'] === 'cancelled' && mails() === $before, 'dispatch refuses a suspended sender (covers late payments)');
reinstate_sender(1, 'ok', 2); ok(sender_blocked(one('select * from users where id=1')) === null, 'reinstated');
ok((int)one("select count(*) c from audit where action in ('sender_suspended','sender_reinstated')")['c'] === 2, 'suspension and reinstatement audited');

// FR-137 rows
[$rows, $e] = parse_rows(['Gran', 'Bob', '', 'X'], ['gran@x.com', 'nope', '', 'GRAN@x.com'], ['Hi', '', '', '']);
ok(count($rows) === 1 && isset($e['email1']) && isset($e['email3']) && !isset($e['name0']), 'rows: invalid email and duplicate flagged per row, valid row kept, blank ignored');
[$rows, $e] = parse_rows(['A'], ['a@x.com'], [str_repeat('x', msg_max() + 1)]); ok(isset($e['msg0']), 'personal message limit enforced');
[$rows, $e] = parse_rows([''], ['a@x.com'], ['']); ok(isset($e['name0']) && !$rows, 'name required');

// FR-134 alerts
set_setting('alert_emails', 'ops@x.com'); set_setting('alert_escalate_emails', 'boss@x.com'); set_setting('alert_escalate_minutes', '30');
$t0 = 1000000; $m0 = mails(); $sent = alerts_tick($t0);
ok($sent >= 1 && mails() > $m0, 'new alerts email the named people');
ok(alerts_tick($t0 + 60) === 0, 'the same alert is not emailed again');
$sent2 = alerts_tick($t0 + 3600); ok($sent2 >= 1 && (int)one('select count(*) c from alerts where escalated=1')['c'] >= 1, 'unacknowledged alert escalates once to the second list');
ok(alerts_tick($t0 + 7200) === 0, 'escalation happens once');
set_setting('last_queue', (string)time()); alerts_tick(time());
ok((int)one("select resolved_at from alerts where akey='cron'")['resolved_at'] > 0, 'alert resolves itself when the condition clears');

putenv('APP_ENV=development'); ok(campaign_state() === 'open', 'development is never locked');

// FR-144 reminders
q("insert into users(name,email,pass,verified,created,remind) values('Yes','yes@x.com','x',1,?,1),('No','no@x.com','x',1,?,0)", [time(), time()]);
$m = mails(); ok(send_reminders(2026) === 1 && mails() === $m + 1, 'only consenting users get the reminder');
ok(send_reminders(2026) === 0, 'at most one reminder per user per year'); ok(send_reminders(2027) === 1, 'sends again the next year');
$yid = (int)one("select id from users where email='yes@x.com'")['id'];
ok(hash_equals(remind_token($yid), remind_token($yid)) && !hash_equals(remind_token($yid), remind_token($yid + 1)), 'stop link token is per user');
ok(str_contains(file_get_contents(ROOT . '/data/outbox.log'), 'remind-off?u=' . $yid), 'every reminder carries a one-click stop link');

// logo in the recipient email uses the public site address, with alt text and still no recipient addresses
putenv('APP_URL=https://cards.example.org'); $eh = email_html(['name' => 'Gran', 'email' => 'gran@x.com', 'token' => str_repeat('a', 48)], ['sender_name' => 'Smiths']);
ok(str_contains($eh, 'https://cards.example.org/assets/brand/7th-swindon-circle-blue.png') && str_contains($eh, 'alt="7th Swindon Scouts"') && !str_contains($eh, 'gran@x.com'), 'email carries the logo from APP_URL and no recipient address'); putenv('APP_URL=');

// FR-139 measures and FR-136 test exclusion
ok(masked(0) === '0' && masked(3) === 'fewer than 5' && masked(5) === '5', 'small counts are masked');
ok(pct(1, 3) === 'not enough data' && pct(5, 10) === '50%', 'percentages need enough data');
q("insert into sends(user_id,card,sender_name,message,status,created,updated,is_test) values(1,'santa','T','x','queued',?,?,1)", [time(), time()]);
q("insert into recipients(send_id,name,email,token,status,sent_at) values((select max(id) from sends),'T','t@x.com','tt1','sent',?)", [time()]);
$a = campaign_measures(); q('update sends set is_test=0 where id=(select max(id) from sends)'); $b = campaign_measures();
ok($b['started'] === $a['started'] + 1 && $b['submitted'] === $a['submitted'] + 1, 'rehearsal cards are left out of the measures');

@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
