<?php
// php tests/giftaid_test.php : Gift Aid rules (FR-141, D-12).
putenv('DB_PATH=' . sys_get_temp_dir() . '/ecard-ga-' . getmypid() . '.sqlite'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
@mkdir(ROOT . '/data', 0775, true); @unlink(ROOT . '/data/outbox.log');
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
q("insert into users(name,email,pass,verified,created,terms_version) values('Sam','sam@x.com','x',1,?,?)", [time(), TERMS_VERSION]);

// gating: off until approved, named, and switched on
ok(!giftaid_on(), 'off by default');
set_setting('giftaid_enabled', '1'); set_setting('giftaid_charity', '7th Swindon Scout Group'); ok(!giftaid_on(), 'switch alone is not enough without D-12 approval');
q("insert into decisions(id,value,ref,status) values('D-12','Include','Minute 9','open')"); ok(!giftaid_on(), 'open decision does not enable it');
q("update decisions set status='approved' where id='D-12'"); ok(giftaid_on(), 'on once approved with a reference, charity named and switched on');
q("update decisions set ref='' where id='D-12'"); ok(!giftaid_on(), 'approval without a reference does not count'); q("update decisions set ref='Minute 9' where id='D-12'");
ok(str_contains(giftaid_wording(), '7th Swindon Scout Group') && str_contains(giftaid_wording(), 'UK taxpayer'), 'declaration names the charity and states taxpayer status');

// validation
ok(giftaid_postcode('sn1 1aa') === 'SN1 1AA' && giftaid_postcode('SN11AA') === 'SN1 1AA' && giftaid_postcode('W1A 0AX') === 'W1A 0AX' && giftaid_postcode('12345') === null && giftaid_postcode('') === null, 'UK postcodes normalised, junk rejected');
[$d, $e] = giftaid_validate(['ga_first' => 'Sam', 'ga_last' => 'Smith', 'ga_house' => '12', 'ga_postcode' => 'sn1 1aa', 'ga_taxpayer' => '1']);
ok($d && !$e && $d['postcode'] === 'SN1 1AA', 'complete declaration accepted');
[$d, $e] = giftaid_validate(['ga_first' => 'Sam', 'ga_last' => '', 'ga_house' => '', 'ga_postcode' => 'bad']);
ok(!$d && count($e) === 4, 'missing last name, house, postcode and confirmation are all reported');
[$d, $e] = giftaid_validate(['ga_first' => str_repeat('a', 36), 'ga_last' => 'S', 'ga_house' => '1', 'ga_postcode' => 'SN1 1AA', 'ga_taxpayer' => '1']); ok(!$d, 'HMRC field length enforced');

// lifecycle: pending, linked on verified payment, receipt line
q("insert into sends(user_id,card,sender_name,message,donation,status,created,updated) values(1,'santa','Sam','Hi',1000,'awaiting_payment',?,?)", [time(), time()]);
q("insert into recipients(send_id,name,email,token) values(1,'A','a@x.com',?)", [token()]);
[$d] = giftaid_validate(['ga_first' => 'Sam', 'ga_last' => 'Smith', 'ga_house' => '12', 'ga_postcode' => 'SN1 1AA', 'ga_taxpayer' => '1']);
giftaid_save_pending(1, $d); ok(one('select status from giftaid where send_id=1')['status'] === 'pending', 'declaration waits as pending');
ok(giftaid_eligible() === [], 'pending declarations are never claimable');
giftaid_save_pending(1, null); ok(one('select 1 from giftaid where send_id=1') === null, 'choosing free or unticking removes the pending declaration');
giftaid_save_pending(1, $d);
confirm_payment(1, 'cs_ga1', 1000);
ok(one('select status from giftaid where send_id=1')['status'] === 'declared', 'verified payment turns it into a declaration');
ok(str_contains(file_get_contents(ROOT . '/data/outbox.log'), 'extra \u00a32.50'), 'receipt states the extra Gift Aid amount');
confirm_payment(1, 'cs_ga1', 1000); ok((int)one('select count(*) c from giftaid')['c'] === 1, 'repeat callback creates no second declaration');

// eligibility: refunds, withdrawal, claiming
ok(count(giftaid_eligible()) === 1 && giftaid_eligible()[0]['amount'] === 1000, 'declared donation is eligible for its full amount');
q("update donations set refunded=400 where stripe_session='cs_ga1'"); ok(giftaid_eligible()[0]['amount'] === 600, 'partial refund reduces the claimable amount');
q("update donations set refunded=1000 where stripe_session='cs_ga1'"); ok(giftaid_eligible() === [], 'fully refunded donation is not claimable');
q("update donations set refunded=0 where stripe_session='cs_ga1'"); q("update giftaid set status='withdrawn'"); ok(giftaid_eligible() === [], 'withdrawn declaration is not claimable'); q("update giftaid set status='declared'");
ok(count(giftaid_eligible(date('Y-m-d', time() + 86400 * 2), '2999-12-31')) === 0, 'date range filters');
q('update giftaid set claimed_at=?, claim_batch=? where send_id=1', [time(), 'HMRC-1']); ok(giftaid_eligible() === [] && count(giftaid_eligible('2000-01-01', '2999-12-31', false)) === 1, 'claimed rows are not offered again');

// export hygiene
ok(csv_text('=1+1') === "'=1+1", 'formula-like names are neutralised in the schedule');

@unlink(env('DB_PATH')); exit($GLOBALS['bad'] ?? 0);
