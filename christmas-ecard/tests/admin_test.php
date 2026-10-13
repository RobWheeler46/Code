<?php
putenv('APP_ENV=development');
// php tests/admin_test.php : configuration validation, delivery recovery, health evidence (FR-081 to FR-095, FR-124 to FR-130).
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-ad-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
q("insert into users(name,email,pass,verified,created) values('Sam','sam@x.com','x',1,?)", [time()]);

$app = config_spec('app')['fields']; $cam = config_spec('site')['fields'];
ok(cfg_validate($app['max_recipients'], '21')[1] !== null && cfg_validate($app['max_recipients'], '0')[1] !== null && cfg_validate($app['max_recipients'], '12') === ['12', null], 'recipient limit bounded 1 to 20');
ok(cfg_validate($app['msg_max'], '-5')[1] !== null && cfg_validate($app['msg_max'], 'abc')[1] !== null, 'negative and non-numeric limits rejected');
ok(cfg_validate($cam['amounts_pence'], '2, 5, 10') === ['200,500,1000', null] && cfg_validate($cam['amounts_pence'], '0')[1] !== null && cfg_validate($cam['amounts_pence'], '9999')[1] !== null && cfg_validate($cam['amounts_pence'], '1,2,3,4,5,6')[1] !== null, 'suggested amounts: £1 to £500, at most five');
ok(max_recipients() === 20, 'default ceiling 20'); set_setting('max_recipients', '99'); ok(max_recipients() === 20, 'stored value cannot push the ceiling above 20'); set_setting('max_recipients', '5'); ok(max_recipients() === 5, 'lower ceiling honoured');
set_setting('max_recipients', '20');

// FR-124 correction: fresh token, old one revoked, audited, no double requeue
q("insert into sends(user_id,card,sender_name,message,status,created,updated) values(1,'santa','Sam','Hi','queued',?,?)", [time(), time()]);
q("insert into recipients(send_id,name,email,token,status,error) values(1,'G','gran@x.com','oldtoken','failed','bounced')");
ok(requeue_recipient(1, 'gran@y.com', 1, 'test') && !requeue_recipient(1, 'gran@z.com', 1, 'test'), 'correction applies once');
$r = one('select * from recipients where id=1'); ok($r['token'] !== 'oldtoken' && $r['email'] === 'gran@y.com' && $r['status'] === 'queued', 'fresh token, corrected address, queued');
ok(one("select 1 from recipients where token='oldtoken'") === null, 'superseded link no longer resolves');
ok(str_contains(one("select detail from audit where action='address_correction'")['detail'], 'previous link revoked'), 'correction audited with original and new address');
q("insert into recipients(send_id,name,email,token,status,sent_at) values(1,'H','h@x.com','t2','sent',?)", [time()]);
ok(!requeue_recipient(2, null, 1, 'test'), 'a freshly sent (not uncertain) delivery cannot be resent');
q('update recipients set sent_at=? where id=2', [time() - 200000]); ok(rstatus(one('select * from recipients where id=2')) === 'Delivery unconfirmed' && requeue_recipient(2, null, 1, 'test'), 'uncertain delivery can be resent by explicit action');

// FR-126: permanent / unknown markers never auto-retry (simulated through queue state)
q("insert into recipients(send_id,name,email,token,status,tries,next_at) values(1,'W','w@x.com','t3','queued',0,?)", [time() + 600]);
$before = (int)one("select count(*) c from recipients where status='sent'")['c']; process_queue();
ok((int)one("select count(*) c from recipients where status='sent'")['c'] === $before + 2 && one("select status from recipients where token='t3'")['status'] === 'queued', 'backed-off delivery waits for its retry time');

// FR-125/130: health shows Unknown/Stale rather than Healthy
$al = health_alerts(); ok(count(array_filter($al, fn($x) => str_contains($x, 'Unknown'))) >= 1 && !isset($al['backup']) && !isset($al['offsite']) && !isset($al['restore']), 'a never-run job shows Unknown, and backups no longer raise alerts');
set_setting('last_queue', (string)(time() - 3600)); ok(count(array_filter(health_alerts(), fn($x) => str_contains($x, 'Stale'))) >= 1, 'old evidence shows Stale');
set_setting('last_queue', (string)time()); set_setting('last_backup', (string)time());
q("insert into sends(user_id,card,sender_name,message,status,donation,created,updated) values(1,'santa','Sam','x','awaiting_payment',500,?,?)", [time(), time() - 1000]);
ok(count(array_filter(health_alerts(), fn($x) => str_contains($x, 'pending over 15 minutes'))) === 1, 'pending payment flagged after 15 minutes, not declared failed');
ok(one("select status from sends where donation=500 and status='awaiting_payment'") !== null, 'elapsed time alone never fails a payment');

// FR-128 scanners
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 Microsoft Office Safelinks'; ok(is_scanner(), 'known scanner is not a human view');
$_SERVER['HTTP_USER_AGENT'] = 'Mozilla/5.0 (Windows NT 10.0) Firefox/130'; ok(!is_scanner(), 'ordinary browser qualifies');

// privacy impact
q("update recipients set sent_at=? where id=1", [time() - 40 * 86400]);
ok(str_contains(implode(' ', privacy_impact(['expiry_days' => 30])), '1 cards that are viewable now would stop'), 'shortening expiry shows affected count');
// illustrated designs: image present, greeting is in the picture, alt text carries the printed words
$six = ['pegs', 'scouty', 'dry', 'knoty', 'chaos', 'woggle', 'scouty-family', 'calm', 'family', 'adventure', 'proud', 'little']; $good = true;
foreach ($six as $id) { $c = cards()[$id] ?? null; if (!$c || !$c['baked'] || !is_file(ROOT . "/public/assets/card-$id.webp") || !str_contains(card_art($id), '<img') || !str_contains($c['desc'], 'The words say')) $good = false; }
ok($good && array_slice(array_keys(cards()), 0, 12) === $six, 'twelve illustrated designs load first, with their images and alt text');
ok(str_contains(cards()['pegs']['desc'], 'May all your pegs go in first time') && str_contains(cards()['dry']['desc'], 'dry Christmas'), 'alt text repeats the words printed on the card');

// hero picks only enabled designs, and varies
$seen = []; for ($i = 0; $i < 200; $i++) $seen[hero_card()] = 1;
ok(!array_diff(array_keys($seen), $six) && count($seen) > 6, 'hero is always an enabled design and varies between visits');
set_setting('off_pegs', '1'); $seen = []; for ($i = 0; $i < 200; $i++) $seen[hero_card()] = 1; set_setting('off_pegs', '');
ok(!isset($seen['pegs']), 'a disabled design is never chosen for the hero');

// the ten drawn designs start switched off but can be enabled; the illustrated ones start on and can be disabled
$on = array_keys(array_filter(cards(), fn($c) => $c['on']));
ok($on === array_values(array_diff($six, ['woggle'])), 'the illustrated designs are on by default, except Woggle which is held back until its 2025 artwork is fixed');
set_setting('off_blame', '0'); set_setting('off_pegs', '1'); $on2 = array_keys(array_filter(cards(), fn($c) => $c['on']));
ok(in_array('blame', $on2) && !in_array('pegs', $on2) && count($on2) === 11, 'a drawn design can be enabled and an illustrated one disabled');
set_setting('off_blame', ''); set_setting('off_pegs', '');
set_setting('off_woggle', '0'); ok(cards()['woggle']['on'], 'Woggle can be enabled in Admin once the picture is fixed'); set_setting('off_woggle', '');

@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
