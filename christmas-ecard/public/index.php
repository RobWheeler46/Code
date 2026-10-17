<?php
// If anything crashes, say so kindly and write the reason (never the visitor's data) to data/error.log, so a blank error page can be explained.
// The same friendly page is shown while the site is being updated (a file at data/MAINTENANCE switches it on by hand) and, by itself, when an upload left the files half in place.
@ini_set("display_errors", "0"); // a visitor never sees a technical message; the reason goes to data/error.log
$appRoot = is_dir(__DIR__ . "/../app") ? __DIR__ . "/../app" : __DIR__ . "/..";
$errLog = function (string $m) use ($appRoot) {
    $f = getenv("ERROR_LOG_FILE") ?: $appRoot . "/data/error.log";
    if (is_file($f) && filesize($f) > 200000) @rename($f, $f . ".old");
    @file_put_contents($f, date("c") . " " . $m . "\n", FILE_APPEND);
};
$friendly = function () {
    if (headers_sent()) return;
    http_response_code(503); header("Content-Type: text/html; charset=UTF-8"); header("Retry-After: 60"); header("Cache-Control: no-store");
    echo '<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30"><title>Back in a minute</title><body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5"><h1>Back in a minute</h1><p>The 7th Swindon Scouts eCards site is having a short rest, perhaps because we are updating it. Your cards and drafts are safe.</p><p>This page tries again by itself every half minute, or you can come back in a minute or two.</p></body></html>';
};
if (is_file($appRoot . "/data/MAINTENANCE")) { $friendly(); exit; }
set_exception_handler(function (Throwable $e) use ($errLog, $friendly) {
    $errLog(get_class($e) . ": " . $e->getMessage() . " at " . basename($e->getFile()) . ":" . $e->getLine());
    $friendly();
});
register_shutdown_function(function () use ($errLog, $friendly) {
    $e = error_get_last();
    if ($e && in_array($e["type"], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) { $errLog("Fatal: " . $e["message"] . " at " . basename($e["file"]) . ":" . $e["line"]); $friendly(); }
});
require __DIR__ . "/../src/app.php";
$path = rtrim((string)parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH), "/") ?: "/";
if (PHP_SAPI === "cli-server" && $path !== "/" && is_file(__DIR__ . $path)) return false;
boot();
register_shutdown_function('scheduler_after_request');
dispatch($path);
