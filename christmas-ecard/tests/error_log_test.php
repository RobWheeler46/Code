<?php
putenv('APP_ENV=development');
// php tests/error_log_test.php : a crash is explained in data/error.log and shows a plain apology, not a blank page
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$work = sys_get_temp_dir() . '/ecard-err-' . getmypid(); mkdir($work, 0775, true); $log = $work . '/error.log'; $port = random_int(19100, 19900);
// a database path that is a folder: opening the database fails, exactly the kind of crash that used to give a blank page
$env = array_merge(getenv(), ['DB_PATH' => $work, 'ERROR_LOG_FILE' => $log, 'SCHEDULER' => 'off', 'APP_ENV' => 'development']);
$proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, $env);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
$ch = curl_init("http://127.0.0.1:$port/"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true]); $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
ok($c === 500 && str_contains($b, 'Something went wrong') && !str_contains($b, $work), 'a crash shows a plain apology with no technical detail');
$l = is_file($log) ? (string)file_get_contents($log) : ''; ok($l !== '' && preg_match('/^\d{4}-\d\d-\d\dT/', $l) && str_contains($l, 'PDOException'), 'and the reason is written to the error log with the time');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
