<?php
// php tests/library_migration_test.php : EC-01 additive tables, import of the existing designs, upgrade of an old database, rollback
$db = sys_get_temp_dir() . '/ecard-lib-' . getmypid() . '.sqlite'; @unlink($db);
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function probe(string $dbfile, string $code, string $migrate): string { // runs in a fresh process so db() boots against that file
    $f = sys_get_temp_dir() . '/lib-probe-' . getmypid() . '.php';
    file_put_contents($f, "<?php error_reporting(0); putenv('DB_PATH=" . addslashes($dbfile) . "'); putenv('LIBRARY_MIGRATE=$migrate'); require '" . addslashes(__DIR__ . '/../src/app.php') . "'; $code");
    $o = shell_exec('php ' . escapeshellarg($f)); @unlink($f); return trim((string)$o);
}
// an old database: the app as it was before EC-01, with a sent card
probe($db, "q(\"insert into users(name,email,pass,verified,created) values('S','s@x.com','x',1,1)\"); q(\"insert into sends(user_id,card,sender_name,message,status,created,updated) values(1,'pegs','S','Hi','queued',1,1)\"); echo 'ok';", 'off');
ok(probe($db, "echo count(array_filter(array_column(db()->query(\"pragma table_info(sends)\")->fetchAll(),'name'), fn(\$n)=>\$n==='campaign_id'));", 'off') === '0', 'with LIBRARY_MIGRATE=off nothing is added');
// upgrade
$r = json_decode(probe($db, "\$n = fn(\$t) => (int)db()->query(\"select count(*) from \$t\")->fetchColumn(); echo json_encode(['occ'=>\$n('occasions'),'camp'=>\$n('campaigns'),'des'=>\$n('designs'),'ver'=>\$n('design_versions'),'cd'=>\$n('campaign_designs'),'cards'=>count(cards()),'on'=>count(array_filter(cards(), fn(\$c)=>\$c['on'])),'pub'=>(int)db()->query(\"select count(*) from campaign_designs where state='published'\")->fetchColumn(),'hash'=>(int)db()->query(\"select count(*) from design_versions where sha256 is not null and width>0\")->fetchColumn(),'send'=>one('select campaign_id c, design_version_id v from sends where id=1'),'vslug'=>one('select d.slug s from design_versions v join designs d on d.id=v.design_id where v.id=(select design_version_id from sends where id=1)')['s']]);", 'on'), true);
ok($r && $r['occ'] === 1 && $r['camp'] === 1, 'one occasion (Christmas) and one campaign are created');
ok($r['des'] === $r['cards'] && $r['ver'] === $r['cards'] && $r['cd'] === $r['cards'], 'every existing design becomes a design, a version 1 and a campaign entry');
ok($r['pub'] === $r['on'], 'published entries match the designs that are switched on today');
ok($r['hash'] >= 12, 'the twelve illustrated designs record a SHA-256 and pixel size');
ok($r['send']['c'] === 1 && $r['vslug'] === 'pegs', 'an existing sent card is tied to the campaign and to its design version');
// idempotent
$again = json_decode(probe($db, "echo json_encode([(int)db()->query('select count(*) from design_versions')->fetchColumn(), (int)db()->query('select count(*) from campaigns')->fetchColumn()]);", 'on'), true);
ok($again === [$r['ver'], 1], 'running again adds nothing');
// a new send picks up the campaign at the next boot
ok(probe($db, "q(\"insert into sends(user_id,card,sender_name,message,status,created,updated) values(1,'scouty','S','Hi','draft',1,1)\"); library_import(db()); echo (int)one('select count(*) n from sends where campaign_id is null')['n'];", 'on') === '0', 'new sends are linked too');
// rollback
$gone = probe($db, "library_rollback(); \$t = db()->query(\"select count(*) from sqlite_master where name in ('occasions','campaigns','designs','design_versions','campaign_designs')\")->fetchColumn(); \$c = count(array_filter(array_column(db()->query('pragma table_info(sends)')->fetchAll(),'name'), fn(\$n)=>in_array(\$n,['campaign_id','design_version_id']))); echo \$t.','.\$c.','.(int)one('select count(*) n from sends')['n'];", 'off');
ok($gone === '0,0,2', 'rollback removes the tables and columns and keeps every card');
@unlink($db); exit($GLOBALS['bad'] ?? 0);
