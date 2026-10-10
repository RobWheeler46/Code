<?php
// php tests/ux24_test.php : UX24-06 skip control and UX24-07 five area admin navigation (source level checks)
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$adm = file_get_contents(__DIR__ . '/../src/admin.php');
preg_match('/\$links = \[(.*?)\];\R/s', $adm, $l); preg_match_all("#'(/admin[a-z/]*)' => \\['#", $l[1] ?? '', $links);
preg_match('/\$groups = \[(.*?)\]; \/\/ five areas/s', $adm, $g); preg_match_all("#'(/admin[a-z/]*)'#", $g[1] ?? '', $grouped);
preg_match_all("/'([A-Za-z ]+)' => \\[/", $g[1] ?? '', $names);
ok(count($names[1]) === 5, 'admin navigation has exactly five areas');
ok($links[1] && !array_diff($links[1], $grouped[1]) && !array_diff($grouped[1], $links[1]), 'every admin link sits in an area, none dropped or invented');
ok(count($grouped[1]) === count(array_unique($grouped[1])), 'no link appears in two areas');
ok(str_contains($adm, 'if ($links[$href][1])'), 'links are still filtered by each role check');
$app = file_get_contents(__DIR__ . '/../src/app.php'); $js = file_get_contents(__DIR__ . '/../public/assets/app.js'); $css = file_get_contents(__DIR__ . '/../public/assets/style.css');
ok(str_contains($app, 'data-skip>Skip animation') && str_contains($js, 'data-skip') && str_contains($css, '.noanim *'), 'recipient reveal has a working Skip animation control');
ok(strpos($app, 'value="free">Send cards for free') < strpos($app, '<details class="donate"'), 'UX24-03: review shows Send for free first, donation sits behind an explicit choice');
exit($GLOBALS['bad'] ?? 0);
