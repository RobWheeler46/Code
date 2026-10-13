<?php
putenv('APP_ENV=development');
// php tests/occasion_filter_test.php : choosing cards by occasion on the home page, and the occasion field in the library
$work = sys_get_temp_dir() . '/ecard-occ-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function page_for(string $work, string $q): string { file_put_contents("$work/h.php", '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . '; ' . $q . ' r_home();'); return (string)shell_exec('php ' . escapeshellarg("$work/h.php")); }
function tiles(string $h): int { return substr_count($h, 'class="tile"'); }

// only Christmas cards on show: no filter row
$h = page_for($work, ''); ok(tiles($h) > 0 && !str_contains($h, 'name="occasion"'), 'with one occasion there is nothing to filter');
$xmas = tiles($h);

// add two published birthday cards and one thank you card
$t = time(); $cid = (int)one('select min(id) i from campaigns')['i'];
foreach ([['bday-a', 'birthday'], ['bday-b', 'birthday'], ['thanks-a', 'thank-you']] as $i => [$slug, $cat]) {
    q('insert into designs(slug,internal_name,category,created) values(?,?,?,?)', [$slug, $slug, $cat, $t]); $did = (int)db()->lastInsertId();
    q("insert into design_versions(design_id,version_no,title,description,alt_text,created,pub_name,pub_thumb,published_at) values(?,1,?,?,?,?,'x.webp','t-x.webp',?)", [$did, "Card $slug", 'Words', "Alt $slug", $t, $t]); $vid = (int)db()->lastInsertId();
    q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank) values(?,?,?,'published',?)", [$cid, $did, $vid, 900 + $i]);
}
$h = page_for($work, ''); ok(str_contains($h, '<select id="gocc" name="occasion"') && str_contains($h, '>All occasions<') && str_contains($h, '>Christmas<') && str_contains($h, '>Birthday<') && str_contains($h, '>Thank you<'), 'with several occasions a drop down appears above the cards');
ok(!str_contains($h, '>Celebration<'), 'an occasion with no cards on show is not offered');
ok(tiles($h) === $xmas + 3 && !str_contains($h, ' selected>'), 'with no choice made every card is shown and nothing is picked in the drop down');
$h = page_for($work, '$_GET["occasion"] = "birthday";'); ok(tiles($h) === 2 && str_contains($h, 'Card bday-a') && !str_contains($h, 'Card thanks-a') && str_contains($h, '<option value="birthday" selected>Birthday</option>'), 'choosing Birthday shows only the two birthday cards and marks the choice');
$h = page_for($work, '$_GET["occasion"] = "thank-you";'); ok(tiles($h) === 1, 'choosing Thank you shows its one card');
$h = page_for($work, '$_GET["occasion"] = "christmas";'); ok(tiles($h) === $xmas, 'choosing Christmas shows only the Christmas cards');
$h = page_for($work, '$_GET["occasion"] = "celebration";'); ok(tiles($h) === $xmas + 3, 'an occasion with no cards, or a made up one, falls back to showing everything');
$h = page_for($work, '$_GET["occasion"] = "<script>";'); ok(tiles($h) === $xmas + 3 && !str_contains($h, '<script>'), 'odd input is ignored and never printed');

$h = page_for($work, ''); ok(str_contains($h, '<noscript><button class="btn alt">Show</button></noscript>') && str_contains($h, 'data-autosubmit'), 'the Show button is only there when scripts are off; otherwise choosing an occasion applies it');

// the library: an occasion can be chosen, and the thumbnail focus class is on the picture
$lib = file_get_contents(__DIR__ . '/../src/library_admin.php');
ok(str_contains($lib, "name=\"occasion\"") && str_contains($lib, 'update designs set internal_name=?, category=?'), 'the card editor has an Occasion choice that is saved');
ok(str_contains($lib, "class=\"libimg ' . \$cls . ' fp'"), 'the thumbnail focus point is applied as a class on the picture');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
