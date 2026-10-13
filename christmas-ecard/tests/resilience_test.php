<?php
putenv('APP_ENV=development');
// php tests/resilience_test.php : spec v2.3 launch-critical items (FR-156, 157, 160 to 163 and the non-waivable gates).
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-rs-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); @unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
q("insert into users(name,email,pass,verified,created,terms_version) values('Sam','sam@x.com','x',1,?,?)", [time(), TERMS_VERSION]);
function mk(string $status = 'queued', string $card = 'pegs', int $don = 0): int {
    q("insert into sends(user_id,card,sender_name,message,donation,status,created,updated) values(1,?,'Sam','Hi',?,?,?,?)", [$card, $don, $status, time(), time()]);
    return (int)db()->lastInsertId();
}

// ---- FR-156 artwork immutability
$file = ROOT . '/public/assets/card-chaos.webp'; $orig = file_get_contents($file);
try {
    $a = mk('queued', 'chaos'); freeze_art($a); $refA = one('select art_ref from sends where id=?', [$a])['art_ref'];
    file_put_contents($file, 'REPLACED ARTWORK'); // the campaign manager swaps the file later
    $b = mk('queued', 'chaos'); freeze_art($b); $refB = one('select art_ref from sends where id=?', [$b])['art_ref'];
    ok($refA && $refB && $refA !== $refB, 'a replaced picture gets a new frozen reference');
    ok(file_get_contents(ROOT . "/data/art/$refA") === $orig, 'the earlier card still has the original picture bytes');
    ok(str_contains(card_art('chaos', false, $refA), "/art/$refA") && str_contains(card_art('chaos'), '/assets/card-chaos.webp'), 'sent cards use the frozen copy, new cards use the live file');
    freeze_art($a); ok(one('select art_ref from sends where id=?', [$a])['art_ref'] === $refA, 'freezing twice changes nothing');
    ok(!str_contains(card_art('chaos', false, '../../etc/passwd'), 'passwd'), 'a malformed reference is never used as a path');
} finally { file_put_contents($file, $orig); }
$c = mk('draft', 'drawn-nothing'); freeze_art($c); ok(one('select art_ref from sends where id=?', [$c])['art_ref'] === null, 'a design with no file leaves no reference');

// ---- FR-157 payment events: once, in any order, exceptions visible
$pay = mk('awaiting_payment', 'pegs', 500); q("insert into recipients(send_id,name,email,token) values(?,'A','a@x.com',?)", [$pay, token()]);
$ev = fn($id, $type, $obj) => ['id' => $id, 'type' => $type, 'data' => ['object' => $obj]];
$done = $ev('evt_1', 'checkout.session.completed', ['id' => 'cs_x1', 'payment_status' => 'paid', 'amount_total' => 500, 'payment_intent' => 'pi_1', 'metadata' => ['send_id' => $pay]]);
ok(stripe_handle_event($done) === 'applied' && stripe_handle_event($done) === 'duplicate', 'the same event is applied once and a replay is ignored');
$replayNewId = $done; $replayNewId['id'] = 'evt_2';
stripe_handle_event($replayNewId); ok((int)one('select count(*) c from donations')['c'] === 1, 'the same payment under a new event id still makes one donation');
ok(one('select payment_intent from donations')['payment_intent'] === 'pi_1', 'the payment reference is kept for refunds');
ok(one('select status from sends where id=?', [$pay])['status'] === 'queued', 'one dispatch');
$wrongAmt = mk('awaiting_payment', 'pegs', 500);
ok(stripe_handle_event($ev('evt_3', 'checkout.session.completed', ['id' => 'cs_x2', 'payment_status' => 'paid', 'amount_total' => 100, 'metadata' => ["send_id" => $wrongAmt]])) === 'exception' && one("select status from sends where id=?", [$wrongAmt])['status'] === 'awaiting_payment', 'a wrong amount is an exception and sends nothing');
ok(stripe_handle_event($ev('evt_4', 'charge.refunded', ['payment_intent' => 'pi_1', 'amount_refunded' => 200])) === 'applied' && (int)one('select refunded from donations')['refunded'] === 200, 'a verified refund is imported');
ok(stripe_handle_event($ev('evt_5', 'charge.refunded', ['payment_intent' => 'pi_unknown', 'amount_refunded' => 100])) === 'exception', 'a refund we cannot match is an exception');
ok(stripe_handle_event($ev('evt_6', 'charge.dispute.created', ['payment_intent' => 'pi_1'])) === 'exception', 'a dispute is an exception');
$exc = payment_exceptions(); ok(count($exc['events']) === 3, 'exceptions are listed for finance');
q("update stripe_events set resolved_at=1, note='checked' where id='evt_5'"); ok(count(payment_exceptions()['events']) === 2, 'a resolved exception leaves the list');
$late = mk('draft', 'pegs', 300); q("insert into donations(send_id,user_id,pence,stripe_session,created) values(?,1,300,'cs_late',?)", [$late, time()]);
ok(in_array($late, array_column(payment_exceptions()['orphans'], 'send_id')), 'a gift for a card that was never sent is flagged');
$exp = mk('awaiting_payment', 'pegs', 500); q('update sends set stripe_session=? where id=?', ['cs_exp', $exp]);
stripe_handle_event($ev('evt_7', 'checkout.session.expired', ['id' => 'cs_exp'])); ok(one('select status from sends where id=?', [$exp])['status'] === 'draft', 'an expired checkout returns the card to draft without sending');

// ---- FR-163 bounces and complaints
$d = mk('queued'); q("insert into recipients(send_id,name,email,token,status) values(?,'B','bounce@x.com',?,'sent')", [$d, token()]); $rid = (int)db()->lastInsertId();
ok(postmark_handle_event(['RecordType' => 'Bounce', 'Type' => 'SoftBounce', 'Email' => 'soft@x.com', 'Metadata' => ['rid' => (string)$rid], 'Description' => 'Mailbox full']) === 'soft bounce' && !bounced_hard('soft@x.com'), 'a soft bounce does not block the address');
ok(postmark_handle_event(['RecordType' => 'Bounce', 'Type' => 'HardBounce', 'Email' => 'Bounce@X.com', 'Metadata' => ['rid' => (string)$rid], 'Description' => 'No such mailbox']) === 'hard bounce' && bounced_hard('bounce@x.com'), 'a hard bounce blocks the address');
ok(one('select error from recipients where id=?', [$rid])['error'] === 'No such mailbox', 'the diagnostic is kept for support');
$m0 = is_file(ROOT . '/data/outbox.log') ? count(file(ROOT . '/data/outbox.log')) : 0;
q("insert into recipients(send_id,name,email,token,status) values(?,'C','bounce@x.com',?,'queued')", [$d, token()]); process_queue();
ok(one("select status from recipients where email='bounce@x.com' and status<>'bounced' limit 1")['status'] === 'failed' && (is_file(ROOT . '/data/outbox.log') ? count(file(ROOT . '/data/outbox.log')) : 0) === $m0, 'a repeat send to a hard bounced address is stopped, not retried');
postmark_handle_event(['RecordType' => 'SpamComplaint', 'Email' => 'angry@x.com']);
ok(opted_out('angry@x.com', 99) && bounced_hard('angry@x.com'), 'a spam complaint opts the address out for every sender');
ok(postmark_handle_event(['RecordType' => 'Nonsense']) === 'ignored', 'unknown event types change nothing');

// ---- FR-162 encrypted backup, off-server copy, restore rehearsal
$copyDir = sys_get_temp_dir() . '/ecard-offsite-' . getmypid(); @mkdir($copyDir); putenv('BACKUP_KEY=correct horse battery staple'); putenv('BACKUP_COPY_DIR=' . $copyDir);
$r = backup_run();
ok($r['zip'] && is_file($r['zip']) && $r['plain'] === null && count($r['offsite']) === 1 && is_file($copyDir . '/' . basename($r['zip'])), 'an encrypted backup is made and copied off the server, with no plain copy left behind');
ok(!str_contains((string)file_get_contents($r['zip']), 'SQLite format 3') && !str_contains((string)file_get_contents($r['zip']), 'sam@x.com'), 'the archive does not contain readable data');
ok((int)setting('last_offsite') > 0, 'the off-server copy is recorded');
$t = sys_get_temp_dir() . '/ecard-restore-' . getmypid(); $rs = backup_restore($r['zip'], 'correct horse battery staple', $t);
ok($rs['ok'] && $rs['integrity'] === 'ok' && $rs['counts']['sends'] === (int)one('select count(*) c from sends')['c'] && $rs['art'] >= 1, 'a rehearsal restore passes integrity and matches the live data');
ok(str_starts_with(setting('last_restore_result'), 'ok'), 'the rehearsal result is recorded');
$badKey = backup_restore($r['zip'], 'wrong key', sys_get_temp_dir() . '/ecard-restore-bad-' . getmypid());
ok(!$badKey["ok"] && str_starts_with(setting('last_restore_result'), 'failed'), 'a wrong key fails and records the failure');
putenv('BACKUP_KEY='); $w = backup_run(); ok($w['zip'] === null && $w['warnings'] && !$w['offsite'], 'without a key nothing is sent off the server and a warning is raised');
putenv('BACKUP_COPY_DIR='); putenv('BACKUP_KEY=correct horse battery staple');
// restore for the gate test below
backup_restore($r['zip'], 'correct horse battery staple', $t);

// ---- hard gates cannot be overridden
putenv('APP_ENV=production');
ok(sending_state() === 'open', 'with donations off, production is not locked by the payment gate');
set_setting('donations_enabled', '1');
ok(sending_state() === 'locked' && in_array('payments', hard_gates_failing()), 'production is locked while the payment gate fails');
putenv('STRIPE_SECRET=sk_test_x'); putenv('STRIPE_WEBHOOK_SECRET=whsec_x'); set_setting('last_stripe_hook', (string)time());
ok(hard_gates_failing() === [] && sending_state() === 'open', 'every gate passes once its evidence exists');
ok(!in_array('recovery', array_keys(hard_gates())), 'a missing backup or restore rehearsal no longer locks production');
putenv('APP_ENV=development'); putenv('STRIPE_SECRET='); putenv('STRIPE_WEBHOOK_SECRET=');

// ---- FR-160 limits and traps
$probe = sys_get_temp_dir() . '/ecard-probe-' . getmypid() . '.php';
file_put_contents($probe, '<?php error_reporting(0); putenv("DB_PATH=' . str_replace('\\', '/', env('DB_PATH')) . '"); require "' . str_replace('\\', '/', ROOT) . '/src/app.php"; for ($i = 0; $i < 4; $i++) { limit_for("probe:1", 2, 60); echo "ok$i "; }');
$out = []; exec('"' . PHP_BINARY . '" "' . $probe . '"', $out); @unlink($probe);
ok(str_contains(implode('', $out), 'ok0 ok1') && !str_contains(implode('', $out), 'ok2') && str_contains(implode('', $out), 'Too many attempts'), 'the third attempt inside the window is refused');
ok((int)one("select count(*) c from audit where action='rate_limited'")['c'] >= 1, 'a refused attempt leaves an audit signal');
ok(str_contains(hp_field(), 'tabindex="-1"') && str_contains(hp_field(), 'aria-hidden'), 'the trap field is hidden from people and assistive technology');

// ---- FR-161 every admin route checks the role on the server
$src = file_get_contents(ROOT . '/src/app.php'); preg_match_all("~'(/admin[^']*)' => '(r_[a-z_0-9]+)'~", $src, $m, PREG_SET_ORDER);
$unguarded = [];
foreach ($m as [, $path, $fn]) {
    $rf = new ReflectionFunction($fn); $body = implode('', array_slice(file($rf->getFileName()), $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
    if (!preg_match('/need_admin\(|need_role\(|r_admin_config\(/', $body)) $unguarded[] = $path;
}
ok(count($m) >= 15 && $unguarded === [], 'every /admin route calls the server side role check' . ($unguarded ? ' (missing: ' . implode(', ', $unguarded) . ')' : ''));
$cfg = new ReflectionFunction('r_admin_config'); ok(str_contains(implode('', array_slice(file($cfg->getFileName()), $cfg->getStartLine() - 1, 6)), 'need_admin('), 'the shared settings handler checks MFA and role');
ok(str_contains(file_get_contents(ROOT . '/src/lib.php'), "empty(\$_SESSION['mfa'])"), 'need_admin refuses a session that has not passed the second step');
q("insert into users(name,email,pass,verified,created,is_admin,roles) values('Ad','ad@x.com','x',1,?,1,'finance')", [time()]);
ok(isset(health_alerts()['access']), 'an administrator exists and access has never been reviewed: alert');
set_setting('access_review_at', (string)time()); ok(!isset(health_alerts()['access']), 'recording the review clears the alert');

// every admin action that the permission map allows has a handler in the action switch itself (not just somewhere else in the file)
$act = new ReflectionFunction('r_admin_action'); $actBody = implode('', array_slice(file($act->getFileName()), $act->getStartLine() - 1, $act->getEndLine() - $act->getStartLine() + 1));
preg_match("~\\\$need = \[(.*?)\];~s", $actBody, $nm); preg_match_all("~'([a-z_]+)' =>~", $nm[1] ?? '', $keys); $missing = [];
foreach ($keys[1] as $k) if (!str_contains($actBody, "case '$k'") && !str_contains($actBody, "'$k'") ) $missing[] = $k;
foreach (['resolve_event', 'access_review'] as $k) if (!str_contains($actBody, "case '$k':")) $missing[] = $k;
ok($missing === [] && count($keys[1]) >= 12, 'each admin action in the permission map is handled in the action switch' . ($missing ? ' (missing: ' . implode(', ', $missing) . ')' : ''));

// ---- hero is stable within a visit
$_SESSION = []; $h1 = hero_for_session(); $same = true; for ($i = 0; $i < 20; $i++) if (hero_for_session() !== $h1) $same = false;
ok($same && cards()[$h1]['on'], 'the hero stays the same for the whole visit');
set_setting("off_$h1", '1'); $h2 = hero_for_session(); ok($h2 !== $h1 && cards()[$h2]['on'], 'if that design is switched off the hero moves to another enabled one'); set_setting("off_$h1", '');

foreach (glob(ROOT . '/data/art/chaos-*') ?: [] as $f) @unlink($f);
@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
