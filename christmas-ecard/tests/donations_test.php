<?php
putenv('APP_ENV=development');
// php tests/donations_test.php : the site wide donations switch
$work = sys_get_temp_dir() . '/ecard-don-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }

ok(!donations_enabled(), 'donations are off unless the switch was turned on');
set_setting('donations_enabled', '1'); ok(donations_enabled(), 'and on once it is');
set_setting('donations_enabled', '0'); ok(!donations_enabled(), 'and off again');
ok(!giftaid_on(), 'Gift Aid is off by default');
$src = implode('', array_map('file_get_contents', glob(__DIR__ . '/../src/*.php')));
ok(str_contains($src, "if (!donations_enabled()) \$form .=") && str_contains($src, "\$do === 'donate' && !donations_enabled()"), 'the review screen and the server both check the switch');

file_put_contents($work . '/home.php', '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . '; r_home();'); $home = (string)shell_exec('php ' . escapeshellarg($work . '/home.php'));
ok(str_contains($home, 'Pick a design') && !str_contains($home, 'Every card helps local Scouting') && !str_contains($home, 'onation') && !str_contains($home, 'Raised so far'), 'the home page and footer say nothing about donating while it is off');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
