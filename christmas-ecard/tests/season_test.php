<?php
putenv('APP_ENV=development');
// php tests/season_test.php : the home page leads with what suits the time of year
$work = sys_get_temp_dir() . '/ecard-season-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function page_for(string $work): string { file_put_contents("$work/h.php", '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . '; r_home();'); return (string)shell_exec('php ' . escapeshellarg("$work/h.php")); }
function first_card(string $h): string { preg_match('#class="tile" href="/compose\?card=([^"]+)"#', $h, $m); return $m[1] ?? ''; }
function heroes(string $h): string { preg_match('#<h1>([^<]*)</h1>#', $h, $m); return $m[1] ?? ''; }

// the window (default 1 November to 6 January, crossing the new year)
$d = fn($s) => strtotime("$s 12:00");
ok(christmas_season($d('2026-12-25')) && christmas_season($d('2026-11-01')) && christmas_season($d('2027-01-06')) && christmas_season($d('2026-11-30')), 'Christmas is in season from 1 November to 6 January');
ok(!christmas_season($d('2026-10-31')) && !christmas_season($d('2027-01-07')) && !christmas_season($d('2026-07-01')), 'and out of season the rest of the year');
set_setting('season_start', '12-20'); set_setting('season_end', '01-02'); ok(christmas_season($d('2026-12-31')) && !christmas_season($d('2026-12-19')) && !christmas_season($d('2027-01-03')), 'a window set in Site settings is followed, including across the new year');
set_setting('season_start', '03-01'); set_setting('season_end', '04-30'); ok(christmas_season($d('2026-04-01')) && !christmas_season($d('2026-12-25')), 'and one that does not cross the new year');
set_setting('season_start', ''); set_setting('season_end', ''); ok(christmas_season($d('2026-12-25')), 'blank settings fall back to the defaults');
ok(cfg_validate(['x', 'md'], '11-01')[1] === null && cfg_validate(['x', 'md'], '13-40')[1] !== null && cfg_validate(['x', 'md'], 'Nov 1')[1] !== null && cfg_validate(['x', 'md'], '')[1] !== null, 'the settings only accept a real month and day');

// the home page: birthday cards added to the Christmas ones
$t = time(); $cid = (int)one('select min(id) i from campaigns')['i'];
foreach ([['bday-a', 'birthday'], ['bday-b', 'birthday']] as $i => [$slug, $cat]) {
    q('insert into designs(slug,internal_name,category,created) values(?,?,?,?)', [$slug, $slug, $cat, $t]); $did = (int)db()->lastInsertId();
    q("insert into design_versions(design_id,version_no,title,description,alt_text,created,pub_name,pub_thumb,published_at) values(?,1,?,?,?,?,'x.webp','t-x.webp',?)", [$did, "Card $slug", 'Words', "Alt $slug", $t, $t]); $vid = (int)db()->lastInsertId();
    q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank) values(?,?,?,'published',?)", [$cid, $did, $vid, 900 + $i]);
}
$md = date('m-d'); $later = date('m-d', time() + 40 * 86400); $later2 = date('m-d', time() + 41 * 86400);
set_setting('season_start', $md); set_setting('season_end', $md); $h = page_for($work);
ok(!str_starts_with(first_card($h), 'bday') && first_card($h) !== '' && heroes($h) === 'Send a Christmas card, Scout style', 'in season the Christmas cards come first and the heading says Christmas');
set_setting('season_start', $later); set_setting('season_end', $later2); $h = page_for($work);
ok(str_starts_with(first_card($h), 'bday') && heroes($h) === 'Send a card, Scout style', 'out of season the other cards come first and the heading is general');
ok(substr_count($h, 'class="tile"') === substr_count(page_for($work), 'class="tile"') && str_contains($h, 'compose?card=pegs'), 'out of season the Christmas cards are still all there, just later');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
