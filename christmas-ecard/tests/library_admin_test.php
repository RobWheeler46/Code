<?php
putenv('APP_ENV=development');
// php tests/library_admin_test.php : EC-03 eCard Library drafts (CAT-03 gating info, CAT-06 role guard, CAT-11 conflict, discard rules)
$work = sys_get_temp_dir() . '/ecard-la-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function pic(string $to, int $w = 1060, int $h = 1484): string { $im = imagecreatetruecolor($w, $h); imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, rand(0, 90), 60, 140)); imagepng($im, $to); imagedestroy($im); return $to; }
function libfiles(): int { $n = 0; foreach (glob(art_dir() . '/*/*') ?: [] as $f) if (is_file($f) && basename(dirname($f)) !== 'tmp') $n++; return $n; }
q("insert into users(name,email,pass,verified,created,is_admin,roles) values('Cam','c@x.com','x',1,?,1,'campaign,rolesadmin')", [time()]);
$good = ['name' => 'Snowy Scouts', 'words' => 'Have a snowy Christmas', 'alt' => 'A Scout and a snowman toast marshmallows. The words say: Have a snowy Christmas.', 'rights' => '1', 'year' => '1', 'focus' => '10'];

$pubBefore = count(array_filter(cards(), fn($c) => $c['on'])); $slugsBefore = array_keys(cards());
$r = library_save($good, pic("$work/a.png"), 1);
ok($r['ok'] && $r['id'], 'a draft is created from a picture and details');
$row = lib_row($r['id']);
ok($row['state'] === 'draft' && !$row['imported'] && $row['full_key'] && $row['rev'] == 1 && !lib_missing($row), 'it starts as a draft and has everything needed to publish');
ok(array_keys(cards()) === $slugsBefore && count(array_filter(cards(), fn($c) => $c['on'])) === $pubBefore, 'CAT-05 guard: the draft does not appear in the public design list');
ok(libfiles() === 3, 'the original and both derivatives are stored');

// validation
$e = library_save(['name' => '', 'words' => '', 'alt' => 'short'], null, 1)['errors'];
ok(isset($e['name'], $e['words'], $e['alt'], $e['art']), 'CAT-03: a missing name, words, description or picture is reported field by field');
$e = library_save($good, pic("$work/tiny.png", 300, 400), 1)['errors'];
ok(isset($e['art']) && libfiles() === 3, 'a picture that is too small is refused and nothing is stored');
$no = library_save(array_merge($good, ['name' => 'Needs checks', 'rights' => '', 'year' => '']), pic("$work/b.png"), 1);
$miss = lib_missing(lib_row($no['id']));
ok(count($miss) === 2 && str_contains(implode(' ', $miss), 'right') && str_contains(implode(' ', $miss), 'year'), 'a draft without the rights or year confirmation is saved but flagged as not ready');

// edit, conflict, replace picture
$id = $r['id']; $old = (array)one('select full_key, thumb_key, original_key from design_versions where design_id=?', [$id]);
$u = library_save(array_merge($good, ['id' => $id, 'rev' => 1, 'name' => 'Snowy Scouts 2']), null, 1);
ok($u['ok'] && lib_row($id)['internal_name'] === 'Snowy Scouts 2' && lib_row($id)['rev'] == 2, 'editing details works and moves the revision on');
$c = library_save(array_merge($good, ['id' => $id, 'rev' => 1, 'name' => 'Stale']), null, 1);
ok(!$c['ok'] && !empty($c['conflict']) && lib_row($id)['internal_name'] === 'Snowy Scouts 2', 'CAT-11: an edit based on an old revision is refused and overwrites nothing');
$before = libfiles(); $u = library_save(array_merge($good, ['id' => $id, 'rev' => 2]), pic("$work/c.png"), 1);
$new = (array)one('select full_key from design_versions where design_id=?', [$id]);
ok($u['ok'] && $new['full_key'] !== $old['full_key'] && !is_file(art_dir() . '/' . $old['full_key']) && libfiles() === $before, 'replacing the picture of a draft stores the new one and removes the old files');

// imported designs are read only here
$imp = lib_rows('published')[0];
ok($imp['imported'] && library_save(array_merge($good, ['id' => $imp['did'], 'rev' => 0]), null, 1)['ok'] === false, 'an existing published design cannot be edited here');
ok(count(lib_rows('published')) === $pubBefore, 'the published tab matches the designs that are on today');
ok(library_discard((int)$imp['did'], 1) === false, 'an existing design cannot be discarded');

// discard
$used = library_save(array_merge($good, ['name' => 'Used']), pic("$work/d.png"), 1); $uv = (int)lib_row($used['id'])['vid'];
q("insert into users(name,email,pass,verified,created) values('X','x@x.com','x',1,?)", [time()]);
q("insert into sends(user_id,card,sender_name,message,status,created,updated,design_version_id) values(1,'pegs','S','m','queued',1,1,?)", [$uv]);
ok(library_discard($used['id'], 1) === false, 'a draft that a sent card refers to cannot be discarded');
$files = libfiles(); ok(library_discard($id, 1) && !lib_row($id) && libfiles() === $files - 3, 'discarding an unused draft removes it and its files');
ok((int)one("select count(*) n from audit where action in ('library_draft_created','library_draft_updated','library_draft_discarded')")['n'] >= 5, 'created, updated and discarded drafts are audited');

// every screen checks the role, and the picture route only serves names this service made
foreach (['r_admin_library', 'r_admin_library_edit', 'r_admin_library_save', 'r_admin_library_discard', 'r_admin_library_preview', 'r_admin_library_img'] as $fn) {
    $rf = new ReflectionFunction($fn); $body = implode('', array_slice(file($rf->getFileName()), $rf->getStartLine() - 1, $rf->getEndLine() - $rf->getStartLine() + 1));
    ok(str_contains($body, 'need_admin(') && str_contains($body, 'lib_role()'), "$fn requires a signed in administrator with the campaign or restricted administrator role");
}
ok(str_contains(file_get_contents(__DIR__ . '/../src/library_admin.php'), '#^[0-9a-f]{2}/[oft]-[0-9a-f]{32}'), 'the picture route only serves files with names this service created');

exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
