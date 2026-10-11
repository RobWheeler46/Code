<?php
// php tests/campaigns_test.php : EC-06 and EC-07 draft campaigns, reuse of designs, donation boundaries (OCA-03, 04, 05, 09, 10)
$work = sys_get_temp_dir() . '/ecard-cp-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function mkuser(string $n, string $roles): int { q("insert into users(name,email,pass,verified,created,is_admin,roles) values(?,?,?,1,?,1,?)", [$n, "$n@x.com", 'x', time(), $roles]); return (int)db()->lastInsertId(); }
$pub = mkuser('pub', 'rolesadmin'); $mgr = mkuser('mgr', 'campaign'); $fin = mkuser('fin', 'finance');
$xmas = lib_campaign(); $galleryBefore = array_keys(gallery_cards()); $xrow = campaign_row($xmas); $occ = (int)one("select id from occasions where slug='thank-you'")['id'];

// create
$e = campaign_create(['name' => '', 'occasion' => 0, 'mode' => 'optional', 'beneficiary' => ''], $mgr)['errors'];
ok(isset($e['name'], $e['occasion'], $e['beneficiary']), 'a draft needs a name, an occasion and (for donations) a beneficiary');
ok(!campaign_create(['name' => 'Thank you 2027', 'occasion' => $occ, 'mode' => 'none'], $fin)['ok'], 'a finance administrator cannot create a campaign');
$r = campaign_create(['name' => 'Thank you 2027', 'occasion' => $occ, 'mode' => 'none'], $mgr); $cid = $r['id'];
ok($r['ok'] && campaign_row($cid)['status'] === 'draft' && campaign_row($cid)['beneficiary'] === null && campaign_row($cid)['giftaid'] == 0, 'a manager can create a draft; greeting only has no beneficiary and Gift Aid is off');
ok(!campaign_create(['name' => 'thank you 2027', 'occasion' => $occ, 'mode' => 'none'], $mgr)['ok'], 'a second campaign with the same name is refused');
$c2 = campaign_create(['name' => 'Thank you fundraiser', 'occasion' => $occ, 'mode' => 'optional', 'beneficiary' => 'The Group minibus fund'], $mgr)['id'];
ok(array_keys(gallery_cards()) === $galleryBefore && lib_campaign() === $xmas && campaign_row($xmas) === $xrow, 'OCA-04: creating campaigns leaves Christmas, its gallery and its settings exactly as they were');
ok(!preg_match('/update campaigns set status/i', file_get_contents(__DIR__ . '/../src/campaigns.php')), 'there is no code path that makes a campaign live');

// update and conflict
$rev = campaign_row($cid)['revision'];
ok(campaign_update($cid, ['name' => 'Thank you 2027', 'mode' => 'optional', 'beneficiary' => 'Camp fund', 'rev' => $rev], $mgr)['ok'] && campaign_row($cid)['donation_mode'] === 'optional', 'a draft can be updated');
$st = campaign_update($cid, ['name' => 'Stale', 'mode' => 'none', 'rev' => $rev], $mgr); ok(!$st['ok'] && !empty($st['conflict']), 'an update based on an old revision is refused');

// reuse a design
$pubd = lib_rows('published')[0]; $files = count(glob(ROOT . '/data/art/*') ?: []) + count(glob(art_dir() . '/*/*') ?: []);
ok(!campaign_attach($cid, (int)$pubd['did'], false, $mgr)['ok'], 'OCA-05: reusing a design needs the wording and year to be reviewed');
ok(campaign_attach($cid, (int)$pubd['did'], true, $mgr)['ok'], 'a published design can be reused in a draft campaign');
$cd = one('select * from campaign_designs where campaign_id=? and design_id=?', [$cid, $pubd['did']]);
ok((int)$cd['published_version_id'] === (int)$pubd['pub_vid'] && $cd['state'] === 'draft' && count(glob(ROOT . '/data/art/*') ?: []) + count(glob(art_dir() . '/*/*') ?: []) === $files, 'it points at the same approved version and copies no picture');
ok(campaign_attach($cid, (int)$pubd['did'], true, $mgr)['same'] ?? false, 'attaching twice changes nothing');
q("insert into designs(slug,internal_name,created) values('unpub','Unpublished',1)"); $ud = (int)db()->lastInsertId(); q("insert into design_versions(design_id,version_no,rev,created) values(?,1,1,1)", [$ud]); q("insert into campaign_designs(campaign_id,design_id,state,order_rank) values(?,?, 'draft', 50)", [$xmas, $ud]);
ok(!campaign_attach($cid, $ud, true, $mgr)['ok'], 'a design that is not published cannot be reused');
ok(array_keys(gallery_cards()) === $galleryBefore, 'OCA-03: a design attached to a draft campaign changes nothing for senders');
ok(campaign_detach($cid, (int)$pubd['did'], $mgr)['ok'] && !one('select 1 x from campaign_designs where campaign_id=? and design_id=?', [$cid, $pubd['did']]) && lib_row((int)$pubd['did'])['state'] === 'published', 'removing it from the draft leaves the design published for Christmas');

// donations and Gift Aid follow the campaign (EC-07)
q("update settings set v='1' where k='giftaid_enabled'"); set_setting('giftaid_enabled', '1');
$send = fn($camp) => ['campaign_id' => $camp];
ok(campaign_allows([], 'donation') && campaign_allows($send(null), 'giftaid') && campaign_allows($send($xmas), 'donation'), 'Christmas keeps optional donations and its Gift Aid setting');
ok(!campaign_allows($send($cid), 'giftaid') && campaign_allows($send($cid), 'donation'), 'a new campaign with donations still has Gift Aid off');
$none = campaign_create(['name' => 'Greeting only', 'occasion' => $occ, 'mode' => 'none'], $mgr)['id'];
ok(!campaign_allows($send($none), 'donation') && !campaign_allows($send($none), 'giftaid'), 'OCA-09: a greeting only campaign allows no donation and no Gift Aid');
ok(campaign_row($none)['status'] === 'draft' && campaign_row($cid)['status'] === 'draft' && campaign_row($c2)['status'] === 'draft', 'every campaign made here is still a draft');

// public route guard and role guard in the source
foreach (['r_admin_campaigns', 'r_admin_campaigns_create', 'r_admin_campaigns_view', 'r_admin_campaigns_action'] as $fn) {
    $rf = new ReflectionFunction($fn); $body = implode('', array_slice(file($rf->getFileName()), $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
    ok(str_contains($body, 'need_admin(') && str_contains($body, 'lib_role()'), "$fn requires a signed in administrator with the campaign or restricted administrator role");
}
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
