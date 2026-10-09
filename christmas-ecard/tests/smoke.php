<?php
// php tests/smoke.php : runs core logic against a throwaway DB.
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-test-' . getmypid() . '.sqlite');
putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mails(): int { return is_file(ROOT . '/data/outbox.log') ? count(file(ROOT . '/data/outbox.log')) : 0; }
function mk_send(int $uid, string $status = 'draft', int $don = 0, array $to = [['A', 'a@x.com']]): int {
    q("insert into sends(user_id,card,sender_name,message,donation,status,created,updated) values(?,'santa','Sam','Merry!',?,?,?,?)", [$uid, $don, $status, time(), time()]);
    $id = (int)db()->lastInsertId();
    foreach ($to as [$n, $e]) q('insert into recipients(send_id,name,email,token) values(?,?,?,?)', [$id, $n, $e, token()]);
    return $id;
}

[$rows, $errs] = parse_recipients("Gran, gran@example.com\nUncle Bob <bob@example.com>\nbad line\nX, nope\nGran2, GRAN@example.com");
ok(count($rows) === 2 && count($errs) === 3, 'parse: 2 valid, 3 rejected (junk, bad email, duplicate)');
ok(totp(b32e('12345678901234567890'), 59) === '287082', 'totp matches RFC 6238 vector');

q("insert into users(name,email,pass,verified,created) values('Sam','sam@x.com','x',1,?)", [time()]);

// free send, once only
$a = mk_send(1, 'draft', 0, [['A', 'a@x.com'], ['B', 'b@x.com']]);
ok(queue_send($a) && !queue_send($a), 'free send queues once');
ok(mails() === 2, 'one email per recipient'); ok(process_queue() === 0, 'no duplicate sends on re-run');
ok(str_contains(file_get_contents(ROOT . '/data/outbox.log'), 'optout'), 'email carries an opt-out link');

// payment: mismatch, repeats
$p = mk_send(1, 'awaiting_payment', 500, [['C', 'c@x.com']]);
ok(!confirm_payment($p, 'cs_1', 100), 'wrong amount rejected');
ok(confirm_payment($p, 'cs_1', 500) && confirm_payment($p, 'cs_1', 500), 'repeat callback accepted');
ok((int)one('select count(*) c from donations')['c'] === 1 && mails() === 4, 'one donation, receipt + exactly one card email');

// FR-038 / AC-19: payment pending, parent chooses free, late payment must not send twice
$l = mk_send(1, 'awaiting_payment', 300, [['D', 'd@x.com']]); $before = mails();
ok(queue_send($l) && mails() === $before + 1, 'free send chosen while payment pending dispatches once');
confirm_payment($l, 'cs_late', 300);
ok(mails() === $before + 2 && one('select count(*) c from recipients where send_id=? and status=\'sent\'', [$l])['c'] == 1, 'late payment records donation + receipt only, no second card');
ok((int)one('select count(*) c from donations where send_id=?', [$l])['c'] === 1, 'late donation still recorded');

// FR-040/041 / AC-21: opt-out scopes enforced at dispatch
$o1 = mk_send(1, 'draft', 0, [['E', 'e@x.com']]); optout('E@x.com', 1);
queue_send($o1); ok(one('select status from recipients where send_id=?', [$o1])['status'] === 'cancelled', 'sender-scope opt-out stops dispatch');
q("insert into users(name,email,pass,verified,created) values('Other','o@x.com','x',1,?)", [time()]);
$o2 = mk_send(2, 'draft', 0, [['E', 'e@x.com']]); queue_send($o2);
ok(one('select status from recipients where send_id=?', [$o2])['status'] === 'sent', 'sender-scope opt-out does not affect other senders');
optout('e@x.com', 0); $o3 = mk_send(2, 'draft', 0, [['E', 'e@x.com']]); queue_send($o3);
ok(one('select status from recipients where send_id=?', [$o3])['status'] === 'cancelled', 'global opt-out stops every sender');
$o4 = mk_send(1, 'draft', 0, [['F', 'f@x.com']]); q("update sends set status='queued' where id=?", [$o4]); q("update recipients set status='queued' where send_id=?", [$o4]);
optout('f@x.com', 0); process_queue();
ok(one('select status from recipients where send_id=?', [$o4])['status'] === 'cancelled', 'opt-out after queueing, before dispatch, is honoured');

// FR-043 / AC-23: cancellation vs claim
$c1 = mk_send(1, 'draft', 0, [['G', 'g@x.com']]); q("update sends set status='queued' where id=?", [$c1]); q("update recipients set status='queued' where send_id=?", [$c1]);
$rid = (int)one('select id from recipients where send_id=?', [$c1])['id'];
ok(cancel_recipient($rid) && !cancel_recipient($rid), 'cancel wins once on a queued delivery');
process_queue(); ok(one('select status from recipients where id=?', [$rid])['status'] === 'cancelled', 'cancelled delivery is never sent');
$c2 = mk_send(1, 'draft', 0, [['H', 'h@x.com']]); queue_send($c2); $r2 = (int)one('select id from recipients where send_id=?', [$c2])['id'];
ok(!cancel_recipient($r2), 'cancel loses once the delivery was claimed');

// FR-042 / AC-22: repeats flagged
$rp = mk_send(1, 'draft', 0, [['A', 'a@x.com'], ['Z', 'z@x.com']]);
ok(repeats_for(one('select * from sends where id=?', [$rp])) === ['a@x.com'], 'repeat recipient from an earlier card is flagged');

// pause, closure (FR-046/047, AC-25)
set_setting('paused', '1'); $q1 = mk_send(1, 'draft', 0, [['I', 'i@x.com']]); queue_send($q1);
ok(one('select status from recipients where send_id=?', [$q1])['status'] === 'queued', 'emergency pause holds dispatch');
set_setting('paused', '0');
set_setting('opens', date('Y-m-d\TH:i', time() + 3600)); ok(campaign_state() === 'before', 'campaign not yet open');
set_setting('opens', ''); set_setting('closes', date('Y-m-d\TH:i', time() - 3600)); ok(campaign_state() === 'closed', 'campaign closed');
set_setting('closure_queue', 'hold'); ok(process_queue() === 0, 'closure with "hold" keeps accepted work queued');
set_setting('closure_queue', 'send'); ok(process_queue() === 1, 'closure with "send" still dispatches accepted work');
set_setting('closes', ''); ok(campaign_state() === 'open' && date_default_timezone_get() === 'Europe/London', 'open again; UK time zone');

// FR-048 / AC-26: formula injection
ok(csv_text('=HYPERLINK("x")') === "'=HYPERLINK(\"x\")" && csv_text('+1') === "'+1" && csv_text('Sam') === 'Sam', 'csv_text neutralises formulas');

// FR-056: statuses
$now = time();
ok(rstatus(['viewed_at' => 1, 'delivered_at' => null, 'status' => 'sent', 'sent_at' => $now]) === 'Viewed', 'status Viewed');
ok(rstatus(['viewed_at' => null, 'delivered_at' => null, 'status' => 'sent', 'sent_at' => $now - 200000]) === 'Delivery unconfirmed', 'status Delivery unconfirmed after 48h');
ok(rstatus(['viewed_at' => null, 'delivered_at' => null, 'status' => 'cancelled', 'sent_at' => null]) === 'Cancelled', 'status Cancelled');

// FR-053: anonymous draft survives to a new user
$_SESSION = []; $anon = mk_send(0); $_SESSION['drafts'] = [$anon]; claim_drafts(2);
ok((int)one('select user_id from sends where id=?', [$anon])['user_id'] === 2, 'anonymous draft is claimed after registration');

// roles
$_SESSION['uid'] = 2; q("update users set roles='finance,complaints' where id=2");
ok(can('finance') && !can('delivery'), 'role check');


// ---- v1.2
[$rows, $errs] = parse_recipients("Gran, gran@example.com | Love you lots
Bob, bob@example.com");
ok($rows[0][2] === 'Love you lots' && $rows[1][2] === '' && !$errs, 'FR-058 per-recipient override parsed');
$ov = mk_send(1, 'draft', 0, [['P', 'p@x.com'], ['Q', 'q@x.com']]); q("update recipients set own_msg='Just for P' where send_id=? and name='P'", [$ov]);
$sv = one('select * from sends where id=?', [$ov]); $rv = all('select * from recipients where send_id=? order by id', [$ov]);
ok(resolved_msg($rv[0], $sv) === 'Just for P' && resolved_msg($rv[1], $sv) === 'Merry!', 'override wins; shared message used otherwise');
q("update sends set message='Changed shared' where id=?", [$ov]); $sv = one('select * from sends where id=?', [$ov]);
ok(resolved_msg($rv[0], $sv) === 'Just for P' && resolved_msg($rv[1], $sv) === 'Changed shared', 'editing the shared greeting never replaces overrides');

ok(abuse_check('See www.evil.com now') !== null && abuse_check('Visit http://x.y') !== null && abuse_check('Happy Christmas, Gran!') === null, 'FR-066 URLs rejected by default');
set_setting('abuse_terms', 'badword, rude'); ok(abuse_check('so RUDE') !== null, 'configurable blocked terms'); set_setting('abuse_terms', '');
ok(h('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;', 'HTML escaped');

// FR-059 copy
$sent = mk_send(1, 'draft', 0, [['K', 'k@x.com'], ['L', 'l@x.com']]); queue_send($sent); q("update sends set donation=500 where id=?", [$sent]);
$rid = (int)one('select id from recipients where send_id=? and name=?', [$sent, 'K'])['id'];
$cp = copy_send($sent, 1, [$rid]); $cs = one('select * from sends where id=?', [$cp]); $cr = all('select * from recipients where send_id=?', [$cp]);
ok($cs['status'] === 'draft' && $cs['donation'] == 0 && $cs['message'] === 'Merry!' && count($cr) === 1 && $cr[0]['status'] === 'draft' && !$cr[0]['sent_at'], 'copy: unsent draft, only chosen recipient, no donation/status');
ok($cr[0]['token'] !== one('select token from recipients where id=?', [$rid])['token'], 'copy: fresh token');
ok(copy_send($sent, 2, [$rid]) === 0, 'copy refuses another user card');

// FR-061 donation note
$dn = mk_send(1, 'awaiting_payment', 300, [['M', 'm@x.com']]); q("update sends set donation_note=1 where id=?", [$dn]);
ok(card_note(one('select * from sends where id=?', [$dn])) === '', 'no donation line before verified payment');
confirm_payment($dn, 'cs_note', 300); $note = card_note(one('select * from sends where id=?', [$dn]));
ok($note !== '' && !str_contains($note, '3') && !str_contains($note, '£'), 'donation line only after payment, no amount');
$fr = mk_send(1, 'draft', 0, [['N', 'n@x.com']]); q("update sends set donation_note=1 where id=?", [$fr]);
ok(card_note(one('select * from sends where id=?', [$fr])) === '', 'free card never claims a donation');

// FR-060 email
$log = file_get_contents(ROOT . '/data/outbox.log');
ok(str_contains($log, 'via 7th Swindon Scouts') && str_contains($log, '"html":true') && !str_contains($log, '"from":"sam@'), 'branded From name on our own address, with HTML part');
$rr = one('select * from recipients where id=?', [$rid]); ok(!str_contains(email_html($rr, $sv), 'k@x.com') && !str_contains(email_html($rr, $sv), 'l@x.com'), 'email exposes no recipient addresses');

// FR-065 notifications
q("update users set notify='viewed' where id=1"); $before = mails();
$vr = one('select * from recipients where id=?', [$rid]); notify_view($vr, one('select * from sends where id=?', [$sent]));
ok(mails() === $before + 1, 'viewed notification only when opted in'); q("update users set notify='off' where id=1"); notify_view($vr, one('select * from sends where id=?', [$sent]));
ok(mails() === $before + 1, 'default off sends nothing');

// ---- v1.3: recovery rules
$pc = mk_send(1, 'awaiting_payment', 500, [['R', 'r@x.com']]); $sp = one('select * from sends where id=?', [$pc]);
ok(pay_cancel($sp) === 'cancelled' && one('select status from sends where id=?', [$pc])['status'] === 'draft', 'cancelled attempt returns to draft, nothing dispatched');
ok(one('select status from recipients where send_id=?', [$pc])['status'] === 'draft', 'cancelled checkout is not permission to send: recipients still draft');
back_to_draft($pc); ok(one('select status from sends where id=?', [$pc])['status'] === 'draft', 'back_to_draft is a no-op unless awaiting payment');
confirm_payment($pc, 'cs_after_cancel', 500);
ok(one('select status from sends where id=?', [$pc])['status'] === 'draft' && (int)one('select count(*) c from donations where stripe_session=?', ['cs_after_cancel'])['c'] === 1, 'payment landing after cancellation is recorded but never auto-sends');

@unlink(env('DB_PATH'));
exit($GLOBALS['bad'] ?? 0);
