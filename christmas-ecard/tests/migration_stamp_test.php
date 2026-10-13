<?php
putenv('APP_ENV=development');
// php tests/migration_stamp_test.php : migrations run once per deployed build, and the page style rule needs no inline styles
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$root = realpath(__DIR__ . '/..'); $ver = $root . '/VERSION'; $work = sys_get_temp_dir() . '/ecard-stamp-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
if (is_file($ver)) { echo "SKIP a VERSION file exists in the project root, not touching it\n"; exit(0); }
$script = $work . '/open.php'; file_put_contents($script, '<?php require ' . var_export($root . '/src/app.php', true) . '; db(); echo (string)setting("schema_stamp"), "|", (string)(new PDO("sqlite:" . getenv("DB_PATH")))->query("select count(*) from sqlite_master where name=\'rcpt_token_hash\'")->fetchColumn();');
$run = fn() => trim((string)shell_exec('php ' . escapeshellarg($script)));
putenv('DB_PATH=' . $dbf);
try {
    file_put_contents($ver, 'build-one');
    ok($run() === 'build-one|1', 'the first request of a build runs the migrations and remembers the build');
    (new PDO('sqlite:' . $dbf))->exec('drop index rcpt_token_hash');
    ok($run() === 'build-one|0', 'later requests of the same build skip the migrations (the dropped index stays dropped)');
    file_put_contents($ver, 'build-two');
    ok($run() === 'build-two|1', 'a new build runs them again');
    unlink($ver);
    (new PDO('sqlite:' . $dbf))->exec('drop index rcpt_token_hash');
    ok(str_ends_with($run(), '|1'), 'a development copy (no build stamp) always runs them');
} finally { @unlink($ver); }

$lib = file_get_contents($root . '/src/lib.php'); $css = file_get_contents($root . '/public/assets/style.css');
ok(!str_contains($lib, "style-src 'self' 'unsafe-inline'") && str_contains($lib, "style-src 'self';"), 'the page policy no longer allows inline styles');
ok(str_contains($css, '.fp0{') && str_contains($css, '.fp100{') && !preg_match('/style="/', file_get_contents($root . '/src/library_admin.php')), 'thumbnail focus uses classes, not an inline style');
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
