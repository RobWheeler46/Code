<?php
putenv('APP_ENV=development');
// php tests/library_lifecycle_test.php : EC-04 publish, hold, archive, versions, rollback (CAT-03..08, CAT-11, CAT-14, OCA-06, OCA-08)
$work = sys_get_temp_dir() . '/ecard-ll-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function pic(string $to, int $r = 0): string { $im = imagecreatetruecolor(1060, 1484); imagefilledrectangle($im, 0, 0, 1060, 1484, imagecolorallocate($im, $r, 60, 140)); imagepng($im, $to); imagedestroy($im); return $to; }
function mkuser(string $n, string $roles, int $admin = 1): int { q("insert into users(name,email,pass,verified,created,is_admin,roles) values(?,?,?,1,?,?,?)", [$n, "$n@x.com", 'x', time(), $admin, $roles]); return (int)db()->lastInsertId(); }
function send_with(string $card): int { q("insert into sends(user_id,card,sender_name,message,status,created,updated) values(1,?,'S','Hi','draft',1,1)", [$card]); $id = (int)db()->lastInsertId(); freeze_art($id); return $id; }
$pub = mkuser('pub', 'rolesadmin'); $mgr = mkuser('mgr', 'campaign'); $fin = mkuser('fin', 'finance'); $plain = mkuser('plain', '', 0);
$good = ['name' => 'Snowy Scouts', 'words' => 'Have a snowy Christmas', 'alt' => 'Scouts in the snow. The words say: Have a snowy Christmas.', 'rights' => '1', 'year' => '1', 'focus' => '0'];

// create, gate, publish
$r = library_save($good, pic("$work/a.png", 10), $mgr); $did = $r['id']; $row = lib_row($did); $slug = $row['slug'];
ok($r['ok'] && !isset(cards()[$slug]), 'a manager can make a draft, and it is not in the public design list');
$notReady = library_save(array_merge($good, ['name' => 'Unchecked', 'year' => '']), pic("$work/n.png", 20), $mgr); $nr = lib_row($notReady['id']);
$res = library_publish($nr['did'], $nr['vid'], $nr['rev'], $pub);
ok(!$res['ok'] && str_contains($res['error'], 'year'), 'CAT-04: publishing is blocked until someone has checked the wording and year');
foreach (['manager' => $mgr, 'finance user' => $fin, 'non administrator' => $plain] as $who => $uid) {
    $res = library_publish($did, $row['vid'], $row['rev'], $uid);
    ok(!$res['ok'] && !isset(cards()[$slug]), "CAT-06 and OCA-08: a $who cannot publish, even by calling the function directly");
}
$stale = library_publish($did, $row['vid'], $row['rev'] + 5, $pub);
ok(!$stale['ok'] && !empty($stale['conflict']), 'CAT-11: publishing a draft that changed since it was opened is refused');
$res = library_publish($did, $row['vid'], $row['rev'], $pub);
ok($res['ok'] && (cards()[$slug]['on'] ?? false), 'CAT-05: a publisher can publish and it appears in the design list');
$c = cards()[$slug]; ok(is_file(ROOT . '/data/art/' . $c['art']) && is_file(ROOT . '/data/art/' . $c['thumb']) && str_contains(card_art($slug), '/art/' . $c['art']), 'its picture is public under a name that includes a hash of the picture');
ok(in_array($slug, array_keys(array_filter(cards(), fn($x) => $x['on']))), 'it is eligible for the home page hero');
$again = library_publish($did, $row['vid'], $row['rev'] + 1, $pub);
ok($again['ok'] && !empty($again['same']) && (int)one("select count(*) n from audit where action='library_published'")['n'] === 1, 'publishing twice changes nothing and records one event');

// sent card pinned
$s1 = send_with($slug); $v1 = (int)lib_row($did)['pub_vid'];
$sent = one('select * from sends where id=?', [$s1]);
ok((int)$sent['design_version_id'] === $v1 && $sent['art_ref'], 'a card sent now is tied to version 1 and keeps its own copy of the picture');

// hold back (CAT-07)
ok(library_transition($did, 'hold', $mgr)['ok'] && !(cards()[$slug]['on']), 'a manager can hold a design back and it leaves the design list');
ok(!in_array($slug, array_keys(array_filter(cards(), fn($x) => $x['on']))), 'a held back design is not eligible for the hero or the gallery');
$view = card_view($slug, 'Gran', 'Hi', 'S', '', $sent['art_ref'], $v1);
ok(str_contains($view, '/art/' . $sent['art_ref']) && str_contains($view, 'Scouts in the snow'), 'CAT-07: the card already sent still shows its picture and description');
ok(!library_transition($did, 'unhold', $mgr)['ok'] && !(cards()[$slug]['on']), 'only a publisher can put it back');
ok(library_transition($did, 'unhold', $pub)['ok'] && cards()[$slug]['on'], 'a publisher can put it back in the gallery');

// version 2 (CAT-08)
ok(library_new_version($did, $mgr)['ok'], 'a manager can start a new version');
$d2 = lib_row($did); ok($d2['version_no'] == 2 && $d2['editable'] && $d2['pub_no'] == 1, 'version 2 is a private draft while version 1 stays in use');
$edit = library_save(['id' => $did, 'rev' => $d2['rev'], 'name' => 'Snowy Scouts', 'words' => 'Have a snowy 2027', 'alt' => 'Scouts in the snow. The words say: Have a snowy 2027.', 'rights' => '1', 'year' => '1', 'focus' => '0'], pic("$work/b.png", 90), $mgr);
$d2 = lib_row($did); ok($edit['ok'] && $d2['full_key'], 'the draft takes a new picture and wording');
ok(strpos(cards()[$slug]['desc'], '2027') === false, 'the gallery still shows version 1 until version 2 is published');
ok(library_publish($did, $d2['vid'], $d2['rev'], $pub)['ok'], 'version 2 is published');
ok(str_contains(cards()[$slug]['desc'], '2027') && cards()[$slug]['art'] !== $c['art'], 'new cards now use version 2 (picture and description)');
$old = card_view($slug, 'Gran', 'Hi', 'S', '', $sent['art_ref'], $v1);
ok(str_contains($old, '/art/' . $sent['art_ref']) && str_contains($old, 'snowy Christmas') && !str_contains($old, '2027'), 'CAT-08 and OCA-06: the card sent with version 1 still shows version 1 picture and description');
$s2 = send_with($slug); ok((int)one('select design_version_id v from sends where id=?', [$s2])['v'] === (int)$d2['vid'], 'a card sent now is tied to version 2');
ok(library_save(array_merge($good, ['id' => $did, 'rev' => $d2['rev']]), null, $mgr)['ok'] === false, 'a published version cannot be edited');

// rollback (CAT-14)
ok(library_use_version($did, $v1, $pub)['ok'] && str_contains(cards()[$slug]['desc'], 'snowy Christmas'), 'CAT-14: a publisher can make new cards use version 1 again');
ok(!library_use_version($did, (int)$d2['vid'], $mgr)['ok'] && str_contains(cards()[$slug]['desc'], 'snowy Christmas'), 'a manager cannot roll back or forward');
$s3 = send_with($slug); ok((int)one('select design_version_id v from sends where id=?', [$s3])['v'] === $v1, 'a card sent after the rollback is tied to version 1');
$still = card_view($slug, 'Gran', 'Hi', 'S', '', one('select art_ref a from sends where id=?', [$s2])['a'], (int)$d2['vid']);
ok(str_contains($still, '2027'), 'the card sent with version 2 is unchanged by the rollback');
ok(!library_use_version($did, (int)$d2['vid'] + 99, $pub)['ok'], 'only a version that was published before can be used again');

// archive and restore, original designs
ok(!library_transition($did, 'archive', $pub)['ok'] && lib_row($did)['state'] === 'published', 'a design must be held back before it is archived');
library_transition($did, 'hold', $pub); ok(library_transition($did, 'archive', $pub)['ok'] && lib_row($did)['state'] === 'archived' && !(cards()[$slug]['on']), 'a publisher can archive a held back design');
ok(!library_new_version($did, $mgr)['ok'], 'an archived design cannot be changed until restored');
ok(library_transition($did, 'restore', $pub)['ok'] && lib_row($did)['state'] === 'held_back', 'it can be restored as held back');
ok(library_transition($did, 'archive', $pub)['ok'] && library_transition($did, 'restore', $pub)['ok'], 'archive and restore are repeatable');
$orig = lib_rows('published')[0]; ok($orig['imported'], 'the first published design is one of the originals');
library_transition((int)$orig['did'], 'hold', $mgr); ok(!cards()[$orig['slug']]['on'], 'an original design can be held back by a manager');
ok(library_transition((int)$orig['did'], 'unhold', $pub)['ok'] && cards()[$orig['slug']]['on'], 'and put back by a publisher');
library_transition((int)$orig['did'], 'hold', $pub); $arch = library_transition((int)$orig['did'], 'archive', $pub); ok(!$arch['ok'], 'an original design cannot be archived'); library_transition((int)$orig['did'], 'unhold', $pub);

// version 2 of an original design
$ob = $orig['slug']; $before = cards()[$ob]['desc']; $so = send_with($ob); $ov1 = (int)one('select design_version_id v from sends where id=?', [$so])['v'];
library_new_version((int)$orig['did'], $mgr); $o2 = lib_row((int)$orig['did']);
library_save(['id' => $orig['did'], 'rev' => $o2['rev'], 'name' => $orig['internal_name'], 'words' => 'New words', 'alt' => 'The refreshed artwork. The words say: New words for the new year.', 'rights' => '1', 'year' => '1', 'focus' => '0'], pic("$work/o.png", 120), $mgr); $o2 = lib_row((int)$orig['did']);
ok(library_publish((int)$orig['did'], $o2['vid'], $o2['rev'], $pub)['ok'] && str_contains(cards()[$ob]['desc'], 'refreshed artwork') && !empty(cards()[$ob]['art']), 'a new version of an original design replaces its picture for new cards');
ok(str_contains(card_view($ob, 'G', 'Hi', 'S', '', one('select art_ref a from sends where id=?', [$so])['a'], $ov1), substr($before, 0, 20)), 'a card sent with the original version still shows the original description');
library_use_version((int)$orig['did'], $ov1, $pub); ok(cards()[$ob]['desc'] === $before && empty(cards()[$ob]['art']), 'rolling back returns an original design to its original picture and wording');

ok((int)one("select count(*) n from audit where action in ('library_published','library_hold','library_unhold','library_archive','library_restore','library_new_version','library_use_version')")['n'] >= 12, 'every change is recorded in the change history');
$h = new ReflectionFunction('r_admin_library_action'); $body = implode('', array_slice(file($h->getFileName()), $h->getStartLine() - 1, $h->getEndLine() - $h->getStartLine() + 1));
ok(str_contains($body, 'need_admin(') && str_contains($body, 'lib_role()') && str_contains($body, "'confirmed'"), 'the action route requires sign in, a role, and a confirmation step');

exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
