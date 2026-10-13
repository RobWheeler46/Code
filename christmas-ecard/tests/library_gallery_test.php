<?php
putenv('APP_ENV=development');
// php tests/library_gallery_test.php : EC-05 what senders can choose, in what order, and the home page hero (OCA-01, CAT-07, CAT-09, FR-171)
$work = sys_get_temp_dir() . '/ecard-lg-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function pic(string $to, int $r = 0): string { $im = imagecreatetruecolor(1060, 1484); imagefilledrectangle($im, 0, 0, 1060, 1484, imagecolorallocate($im, $r, 60, 140)); imagepng($im, $to); imagedestroy($im); return $to; }
function mkuser(string $n, string $roles): int { q("insert into users(name,email,pass,verified,created,is_admin,roles) values(?,?,?,1,?,1,?)", [$n, "$n@x.com", 'x', time(), $roles]); return (int)db()->lastInsertId(); }
$pub = mkuser('pub', 'rolesadmin'); $mgr = mkuser('mgr', 'campaign'); $fin = mkuser('fin', '', 0);
$good = ['name' => 'Snowy', 'words' => 'Snowy Christmas', 'alt' => 'Scouts in the snow. The words say: Snowy Christmas.', 'rights' => '1', 'year' => '1', 'focus' => '0'];

$before = array_keys(gallery_cards());
$d = library_save($good, pic("$work/a.png", 5), $mgr); $draft = lib_row($d['id']);
ok(array_keys(gallery_cards()) === $before && !isset(gallery_cards()[$draft['slug']]), 'OCA-01: a draft is not in the gallery');
library_publish($d['id'], $draft['vid'], $draft['rev'], $pub); $slug = $draft['slug'];
ok(array_keys(gallery_cards()) === array_merge($before, [$slug]), 'a published design joins the end of the gallery');
$hb = lib_rows('held_back')[0]['slug'] ?? null; ok(!isset(gallery_cards()[$hb]) && ($hb === null || cards()[$hb]['on'] === false), 'held back designs are not in the gallery');
ok(array_keys(gallery_cards()) === array_keys(array_filter(cards(), fn($c) => $c['on'])), 'the gallery, the hero and the start route all read this one list');

// ordering
$order = array_keys(gallery_cards()); $last = end($order);
ok(design_move($last, -1, $mgr, true) && array_keys(gallery_cards())[count($order) - 2] === $last, 'CAT-09: moving a design earlier changes the gallery order');
$probe = sys_get_temp_dir() . '/lg-probe-' . getmypid() . '.php';
file_put_contents($probe, "<?php error_reporting(0); putenv('DB_PATH=" . addslashes($dbf) . "'); putenv('LIBRARY_DIR=" . addslashes($work . '/library') . "'); require '" . addslashes(__DIR__ . '/../src/app.php') . "'; echo implode(',', array_keys(gallery_cards()));");
$other = trim((string)shell_exec('php ' . escapeshellarg($probe))); @unlink($probe);
ok($other === implode(',', array_keys(gallery_cards())), 'a new request, in a new process, sees the same order');
ok(implode(',', array_column(lib_rows('published'), 'slug')) === implode(',', array_keys(gallery_cards())), 'the library lists published designs in the gallery order');
ok((int)one('select order_rank r from campaign_designs where design_id=?', [$d['id']])['r'] === array_search($slug, array_keys(cards())), 'the stored campaign order matches');
// moving skips held back neighbours
$ids = array_keys(cards()); $pubs = array_keys(gallery_cards()); $a = $pubs[1]; $b = $pubs[2];
library_transition((int)lib_row_by_slug($a)['did'], 'hold', $mgr);
$after = array_keys(gallery_cards()); $pos = array_search($b, $after);
ok(design_move($b, -1, $mgr, true) && array_search($b, array_keys(gallery_cards())) === $pos - 1, 'moving among visible designs skips one that is held back');
function lib_row_by_slug(string $s): array { foreach (lib_rows() as $r) if ($r['slug'] === $s) return $r; return []; }
ok(!library_order((int)lib_row_by_slug($a)['did'], 'move_up', $mgr)['ok'], 'a held back design cannot be moved');
ok(!library_order((int)lib_row_by_slug($pubs[3])['did'], 'move_up', $fin)['ok'], 'a non administrator cannot reorder designs');

// featured hero
$target = array_keys(gallery_cards())[2]; $tid = (int)lib_row_by_slug($target)['did'];
ok(!library_feature($tid, true, $mgr)['ok'], 'a campaign manager cannot feature a design');
ok(library_feature($tid, true, $pub)['ok'], 'a publisher can feature a design');
$seen = []; for ($i = 0; $i < 40; $i++) $seen[hero_card()] = 1;
ok(array_keys($seen) === [$target], 'the home page picture comes from the featured design');
library_transition($tid, 'hold', $pub); $seen = []; for ($i = 0; $i < 60; $i++) $seen[hero_card()] = 1;
ok(!isset($seen[$target]) && count($seen) > 3, 'a featured design that is held back is never shown, and the hero falls back to the others');
library_transition($tid, 'unhold', $pub); library_feature($tid, false, $pub); $seen = []; for ($i = 0; $i < 80; $i++) $seen[hero_card()] = 1;
ok(count($seen) > 3, 'with nothing featured the picture is random again');
$_SESSION['hero'] = $target; ok(hero_for_session() !== '' && gallery_cards()[hero_for_session()] ?? false, 'the session hero is always a design senders can choose');

// a draft whose design is later held back keeps its content and is steered to choose another
$src = file_get_contents(__DIR__ . '/../src/app.php');
ok(str_contains($src, 'no longer available. Use Change design to pick another. Your message and recipients are safe.') && str_contains($src, "redirect('/compose?id=' . (int)\$s['id'])"), 'compose and review keep a saved draft and ask for another design instead of discarding it');

exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
