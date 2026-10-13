<?php
putenv('APP_ENV=development');
// php tests/ux24_test.php : UX24-06 skip control and UX24-07 five area admin navigation (source level checks)
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$adm = file_get_contents(__DIR__ . '/../src/admin.php');
// v2.10: one workspace manifest feeds the menu, the overview shortcuts and the breadcrumbs (role by role checks are in tests/workspace_test.php)
putenv('DB_PATH=' . sys_get_temp_dir() . '/ux24-' . getmypid() . '.sqlite'); require __DIR__ . '/../src/app.php';
$m = workspace_manifest(); $hrefs = []; foreach ($m as $items) foreach ($items as $i) $hrefs[] = $i[1]; foreach (platform_manifest() as $c) $hrefs[] = $c[1];
ok(array_keys($m) === ['Start', 'Cards', 'Support and delivery', 'Fundraising', 'Administration'], 'the workspace menu is grouped by what people do');
ok(count($hrefs) === count(array_unique($hrefs)) && !array_filter($hrefs, fn($h) => !preg_match('#^/(admin|private)/?#', $h)), 'no destination appears twice, and all are admin or private routes');
ok(str_contains($adm, 'function admin_page(string $title, string $body): never { workspace_shell($title, $body); }'), 'every admin page uses the one shell');
@unlink(env('DB_PATH'));
$app = file_get_contents(__DIR__ . '/../src/app.php'); $js = file_get_contents(__DIR__ . '/../public/assets/app.js'); $css = file_get_contents(__DIR__ . '/../public/assets/style.css');
ok(str_contains($app, 'data-skip>Skip animation') && str_contains($js, 'data-skip') && str_contains($css, '.noanim *'), 'recipient reveal has a working Skip animation control');
ok(str_contains($app, 'name="mode" value="free"') && str_contains($app, 'value="send" data-send-btn') && strpos($app, 'name="mode" value="free"') < strpos($app, 'name="mode" value="donate"'), 'UX24-03: review offers free first (chosen unless recovering), donation as an explicit second choice, one send button');
preg_match_all("/\$a\['([a-z0-9]+)'\]/", file_get_contents(__DIR__ . '/../src/ops.php'), $ak);
$missing = array_filter(array_unique($ak[1]), fn($k) => !str_contains($adm, "'$k' => ['/admin"));
ok(!$missing, 'UX24-07: every alert type on the Overview says where to act (' . implode(',', $missing) . ')');
ok(str_contains($app, "if (\$do === 'send') \$do = (\$_POST['mode'] ?? '') === 'donate'"),'the single send button maps the chosen option to the existing free or donate paths');
$sh = __DIR__ . '/../public/assets/share.jpg'; $sz = is_file($sh) ? getimagesize($sh) : [0, 0];
ok($sz[0] === 1200 && $sz[1] === 630 && filesize($sh) < 400000 && str_contains(share_tags(), 'og:image') && str_contains(share_tags(), '/assets/share.jpg'), 'the share preview image is 1200 by 630, small, and linked from every page');
exit($GLOBALS['bad'] ?? 0);
