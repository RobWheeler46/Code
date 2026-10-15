<?php
putenv('APP_ENV=development');
// php tests/season_test.php : each occasion can have a season, and the home page leads with what is in season
$work = sys_get_temp_dir() . '/ecard-season-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function page_for(string $work): string { file_put_contents("$work/h.php", '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . '; r_home();'); return (string)shell_exec('php ' . escapeshellarg("$work/h.php")); }
function first_card(string $h): string { preg_match('#class="tile" href="/compose\?card=([^"]+)"#', $h, $m); return $m[1] ?? ''; }
function heading(string $h): string { preg_match('#<h1>([^<]*)</h1>#', $h, $m); return $m[1] ?? ''; }
function season(string $slug, ?string $a, ?string $b): void { q('update occasions set season_start=?, season_end=? where slug=?', [$a, $b, $slug]); }
$d = fn($s) => strtotime("$s 12:00");

// Christmas keeps its dates (1 November to 6 January) and the others start with no season
ok(in_season('christmas', $d('2026-12-25')) && in_season('christmas', $d('2026-11-01')) && in_season('christmas', $d('2027-01-06')), 'Christmas is in season from 1 November to 6 January');
ok(!in_season('christmas', $d('2026-10-31')) && !in_season('christmas', $d('2027-01-07')) && !in_season('christmas', $d('2026-07-01')), 'and out of season the rest of the year');
ok(!in_season('birthday', $d('2026-12-25')) && season_window('birthday') === null && !in_season('nonsense'), 'an occasion with no season is never in season');
// windows are read once for each request, so the rest of this test changes them in the database and asks fresh
$run = function (string $code) use ($work): string { file_put_contents("$work/r.php", '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . '; ' . $code); return trim((string)shell_exec('php ' . escapeshellarg("$work/r.php"))); };
season('birthday', '12-20', '01-02'); ok($run('echo json_encode([in_season("birthday", strtotime("2026-12-31 12:00")), in_season("birthday", strtotime("2026-12-19 12:00")), in_season("birthday", strtotime("2027-01-03 12:00"))]);') === '[true,false,false]', 'a season can cross the new year');
season('birthday', '03-01', '04-30'); ok($run('echo json_encode([in_season("birthday", strtotime("2026-04-01 12:00")), in_season("birthday", strtotime("2026-12-25 12:00"))]);') === '[true,false]', 'and one that does not');
season('birthday', null, null);

// the card wording: the name as typed, with the right small word
q("insert into occasions(slug,label,sort) values('easter','Easter',9)");
ok($run('echo card_phrase(["card" => "pegs"]), "|", card_phrase_for("Easter card"), "|", card_phrase_for("Birthday card");') === 'a Christmas card|an Easter card|a Birthday card', 'a card reads "a Christmas card", "an Easter card" and "a Birthday card"');

// the home page: birthday cards added to the Christmas ones
$t = time(); $cid = (int)one('select min(id) i from campaigns')['i'];
foreach ([['bday-a', 'birthday'], ['bday-b', 'birthday']] as $i => [$slug, $cat]) {
    q('insert into designs(slug,internal_name,category,created) values(?,?,?,?)', [$slug, $slug, $cat, $t]); $did = (int)db()->lastInsertId();
    q("insert into design_versions(design_id,version_no,title,description,alt_text,created,pub_name,pub_thumb,published_at) values(?,1,?,?,?,?,'x.webp','t-x.webp',?)", [$did, "Card $slug", 'Words', "Alt $slug", $t, $t]); $vid = (int)db()->lastInsertId();
    q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank) values(?,?,?,'published',?)", [$cid, $did, $vid, 900 + $i]);
}
$md = date('m-d'); $later = date('m-d', time() + 40 * 86400); $later2 = date('m-d', time() + 41 * 86400);
season('christmas', $md, $md); season('birthday', null, null); $h = page_for($work);
ok(!str_starts_with(first_card($h), 'bday') && first_card($h) !== '' && heading($h) === 'Send a Christmas card, Scout style', 'with Christmas in season its cards come first and the heading says Christmas');
season('christmas', $later, $later2); $h = page_for($work);
ok(str_starts_with(first_card($h), 'bday') && heading($h) === 'Send a card, Scout style', 'with Christmas out of season and nothing else in season, the cards with no season come first and the heading is general');
ok(substr_count($h, 'class="tile"') === substr_count(page_for($work), 'class="tile"') && str_contains($h, 'compose?card=pegs'), 'the Christmas cards are all still there, just later');
season('birthday', $md, $md); $h = page_for($work);
ok(str_starts_with(first_card($h), 'bday') && heading($h) === 'Send a Birthday card, Scout style', 'an occasion whose season is on leads, and the heading names it');
season('christmas', $md, $md); $h = page_for($work);
ok(!str_starts_with(first_card($h), 'bday') && heading($h) === 'Send a Christmas card, Scout style', 'when two seasons are on, the one higher in the Occasions list leads');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
