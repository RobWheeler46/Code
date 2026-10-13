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
$h = page_for($work, ''); ok(tiles($h) > 0 && !str_contains($h, 'class="filters"'), 'with one occasion there is nothing to filter');
$xmas = tiles($h);

// add two published birthday cards and one thank you card
$t = time(); $cid = (int)one('select min(id) i from campaigns')['i'];
foreach ([['bday-a', 'birthday'], ['bday-b', 'birthday'], ['thanks-a', 'thank-you']] as $i => [$slug, $cat]) {
    q('insert into designs(slug,internal_name,category,created) values(?,?,?,?)', [$slug, $slug, $cat, $t]); $did = (int)db()->lastInsertId();
    q("insert into design_versions(design_id,version_no,title,description,alt_text,created,pub_name,pub_thumb,published_at) values(?,1,?,?,?,?,'x.webp','t-x.webp',?)", [$did, "Card $slug", 'Words', "Alt $slug", $t, $t]); $vid = (int)db()->lastInsertId();
    q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank) values(?,?,?,'published',?)", [$cid, $did, $vid, 900 + $i]);
}
$h = page_for($work, ''); ok(str_contains($h, 'class="filters"') && str_contains($h, '>All<') && str_contains($h, '>Christmas<') && str_contains($h, '>Birthday<') && str_contains($h, '>Thank you<'), 'with several occasions a row of choices appears above the cards');
ok(!str_contains($h, '>Celebration<'), 'an occasion with no cards on show is not offered');
ok(tiles($h) === $xmas + 3 && preg_match('/<a href="\/#gallery" aria-current="true">All<\/a>/', $h), 'with no choice made every card is shown and All is marked');
$h = page_for($work, '$_GET["occasion"] = "birthday";'); ok(tiles($h) === 2 && str_contains($h, 'Card bday-a') && !str_contains($h, 'Card thanks-a') && preg_match('/aria-current="true">Birthday</', $h), 'choosing Birthday shows only the two birthday cards and marks the choice');
$h = page_for($work, '$_GET["occasion"] = "thank-you";'); ok(tiles($h) === 1, 'choosing Thank you shows its one card');
$h = page_for($work, '$_GET["occasion"] = "christmas";'); ok(tiles($h) === $xmas, 'choosing Christmas shows only the Christmas cards');
$h = page_for($work, '$_GET["occasion"] = "celebration";'); ok(tiles($h) === $xmas + 3, 'an occasion with no cards, or a made up one, falls back to showing everything');
$h = page_for($work, '$_GET["occasion"] = "<script>";'); ok(tiles($h) === $xmas + 3 && !str_contains($h, '<script>'), 'odd input is ignored and never printed');

// search
$h = page_for($work, ''); ok(str_contains($h, 'role="search"') && str_contains($h, 'name="q"'), 'the gallery has a search box');
$h = page_for($work, '$_GET["q"] = "bday-a";'); ok(tiles($h) === 1 && str_contains($h, 'Card bday-a') && str_contains($h, '1 card shown'), 'searching finds the card whose title matches and says how many');
$h = page_for($work, '$_GET["q"] = "alt bday";'); ok(tiles($h) === 2, 'every word typed has to match, in any order and in any letter case (here the description of the two birthday cards)');
$h = page_for($work, '$_GET["q"] = "MINCE";'); ok(tiles($h) >= 1 && tiles($h) < $xmas + 3, 'the words printed in a card description are searched too, ignoring capital letters');
$h = page_for($work, '$_GET["q"] = "zzzzqq";'); ok(tiles($h) === 0 && str_contains($h, 'No cards match') && str_contains($h, 'Show all cards'), 'a search with no match says so and offers all cards again');
$h = page_for($work, '$_GET["q"] = "<script>alert(1)</script>";'); ok(!str_contains($h, '<script>alert') && str_contains($h, '&lt;script&gt;'), 'what was typed is shown safely');
$h = page_for($work, '$_GET["q"] = "bday"; $_GET["occasion"] = "thank-you";'); ok(tiles($h) === 0, 'a search and an occasion together both have to match');
$h = page_for($work, '$_GET["q"] = "card"; $_GET["occasion"] = "birthday";'); ok(tiles($h) === 2 && str_contains($h, 'name="occasion" value="birthday"') && str_contains($h, 'q=card'), 'the occasion links keep the search words and the search keeps the occasion');
$h = page_for($work, '$_GET["q"] = str_repeat("a", 500);'); ok(!str_contains($h, str_repeat('a', 61)), 'a very long search is cut short');

// the library: an occasion can be chosen, and the thumbnail focus class is on the picture
$lib = file_get_contents(__DIR__ . '/../src/library_admin.php');
ok(str_contains($lib, "name=\"occasion\"") && str_contains($lib, 'update designs set internal_name=?, category=?'), 'the card editor has an Occasion choice that is saved');
ok(str_contains($lib, "class=\"libimg ' . \$cls . ' fp'"), 'the thumbnail focus point is applied as a class on the picture');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
