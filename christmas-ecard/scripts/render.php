<?php
// Dev helper: render one page to a standalone HTML file for screenshots. php scripts/render.php /path out.html [admin] [uid]
// Uses a fake session, so it only works against a local test database.
$path = $argv[1] ?? '/'; $out = $argv[2] ?? 'out.html'; $admin = ($argv[3] ?? '') === 'admin';
chdir(__DIR__ . '/../public');
require __DIR__ . '/../src/app.php';
$_SERVER['REQUEST_METHOD'] = 'GET'; $_SERVER['REQUEST_URI'] = $path; $_SERVER['HTTP_HOST'] = 'localhost';
parse_str((string)parse_url($path, PHP_URL_QUERY), $_GET);
session_id('render'); @session_start(); $_SESSION['csrf'] = 'x'; $_SESSION['uid'] = (int)($argv[4] ?? 1); $_SESSION['mfa'] = $admin;
ob_start();
register_shutdown_function(function () use ($out) {
    $h = ob_get_clean(); $css = file_get_contents(__DIR__ . '/../public/assets/style.css');
    $css = str_replace('url(/assets/', 'url(' . 'file:///' . str_replace('\\', '/', realpath(__DIR__ . '/../public')) . '/assets/', $css);
    $h = preg_replace('~<link rel="stylesheet" href="/assets/style.css">~', '<style>' . $css . '</style>', $h);
    $h = str_replace('src="/assets/', 'src="file:///' . str_replace('\\', '/', realpath(__DIR__ . '/../public')) . '/assets/', $h);
    file_put_contents($out, $h);
});
dispatch(rtrim((string)parse_url($path, PHP_URL_PATH), '/') ?: '/');
