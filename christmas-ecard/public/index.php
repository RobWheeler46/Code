<?php
// If anything crashes, say so plainly and write the reason (never the visitor's data) to data/error.log, so a blank error page can be explained.
$appRoot = is_dir(__DIR__ . "/../app") ? __DIR__ . "/../app" : __DIR__ . "/..";
$errLog = function (string $m) use ($appRoot) {
    $f = getenv("ERROR_LOG_FILE") ?: $appRoot . "/data/error.log";
    if (is_file($f) && filesize($f) > 200000) @rename($f, $f . ".old");
    @file_put_contents($f, date("c") . " " . $m . "\n", FILE_APPEND);
};
set_exception_handler(function (Throwable $e) use ($errLog) {
    $errLog(get_class($e) . ": " . $e->getMessage() . " at " . basename($e->getFile()) . ":" . $e->getLine());
    if (!headers_sent()) { http_response_code(500); header("Content-Type: text/html; charset=UTF-8"); }
    echo '<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Something went wrong</title><body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1>Something went wrong</h1><p>Sorry, the service had a problem. Please try again in a few minutes.</p></body></html>';
});
register_shutdown_function(function () use ($errLog) {
    $e = error_get_last();
    if ($e && in_array($e["type"], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) $errLog("Fatal: " . $e["message"] . " at " . basename($e["file"]) . ":" . $e["line"]);
});
require __DIR__ . "/../src/app.php";
$path = rtrim((string)parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH), "/") ?: "/";
if (PHP_SAPI === "cli-server" && $path !== "/" && is_file(__DIR__ . $path)) return false;
boot();
register_shutdown_function('scheduler_after_request');
dispatch($path);
