<?php
require __DIR__ . "/../src/app.php";
$path = rtrim((string)parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH), "/") ?: "/";
if (PHP_SAPI === "cli-server" && $path !== "/" && is_file(__DIR__ . $path)) return false;
boot();
dispatch($path);
