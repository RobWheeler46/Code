<?php
putenv('APP_ENV=development');
// php tests/maintenance_test.php : while the site is being updated, visitors see a friendly page, not an error
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$work = sys_get_temp_dir() . '/ecard-maint-' . getmypid(); mkdir($work, 0775, true); $port = random_int(19100, 19900);
$flag = realpath(__DIR__ . '/..') . '/data/MAINTENANCE'; @mkdir(dirname($flag), 0775, true); @unlink($flag);
$env = array_merge(getenv(), ['DB_PATH' => $work . '/t.sqlite', 'SCHEDULER' => 'off', 'APP_ENV' => 'development', 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '']);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, $env);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function get(string $p): array { global $port; $ch = curl_init("http://127.0.0.1:$port$p"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]); $r = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch); return [$c, substr($r, $hs), substr($r, 0, $hs)]; }
[$c, $b] = get('/'); ok($c === 200 && str_contains($b, 'Choose a card'), 'normally the site is open');
file_put_contents($flag, 'updating');
[$c, $b, $h] = get('/'); ok($c === 503 && str_contains($b, 'Back in a minute') && stripos($h, 'retry-after: 60') !== false && stripos($h, 'no-store') !== false, 'with the maintenance file in place, the home page shows the friendly page with a retry time');
[$c, $b] = get('/help'); ok($c === 503 && str_contains($b, 'Your cards and drafts are safe'), 'so does every other page, and it says drafts are safe');
[$c] = get('/hooks/stripe'); ok($c === 503, 'and the payment and email webhooks are told to try again later');
@unlink($flag);
[$c, $b] = get('/'); ok($c === 200 && str_contains($b, 'Choose a card'), 'removing the file opens the site again at once');
// an upload that left a file out: the site still shows the friendly page, not a blank error
$half = $work . '/half'; mkdir("$half/public", 0775, true); mkdir("$half/src", 0775, true); mkdir("$half/data", 0775, true);
copy(__DIR__ . '/../public/index.php', "$half/public/index.php"); foreach (glob(__DIR__ . '/../src/*.php') as $sf) if (basename($sf) !== 'styles.php') copy($sf, "$half/src/" . basename($sf)); // styles.php is the missing file
$port2 = random_int(19100, 19900); $p2 = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port2", '-t', "$half/public", "$half/public/index.php"], [1 => ['file', $work . '/srv2.log', 'w'], 2 => ['file', $work . '/srv2.log', 'a']], $pipes2, null, array_merge($env, ['DB_PATH' => "$half/data/t.sqlite", 'ERROR_LOG_FILE' => "$half/data/error.log"]));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port2); $i++) usleep(100000);
$ch = curl_init("http://127.0.0.1:$port2/"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]); $r = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
ok($c === 503 && str_contains($r, 'Back in a minute') && !str_contains($r, 'styles.php') && !str_contains($r, 'Fatal'), 'a half finished upload (a file missing) shows the friendly page and no technical detail');
ok(is_file("$half/data/error.log") && str_contains((string)file_get_contents("$half/data/error.log"), 'styles.php'), 'and the missing file is named in the error log');
proc_terminate($p2); proc_close($p2);
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
@unlink($flag);
exit($GLOBALS['bad'] ?? 0);
