<?php
// Small helpers standing in for Express's req.body / res.json() ergonomics.

function requestBody(): array
{
    $raw = file_get_contents('php://input');
    if (!$raw) return [];
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// Mirrors res.json()/res.status().json() - always the last thing a handler
// does, so it exits immediately to guarantee exactly one response per request.
function jsonResponse($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function clientIp(): string
{
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

function queryParam(string $key, ?string $default = null): ?string
{
    return $_GET[$key] ?? $default;
}

// Debug logging for the login flows, deliberately verbose and server-side
// only - never written to a redirect URL or JSON response the browser sees
// (NFR-007: no technical detail to end users). Writes to two places: PHP's
// normal error_log() (works everywhere, but on shared hosting the file can
// be awkward to find/view), and data/login-debug.log - outside webroot/, so
// not web-accessible, but a plain file an admin can open directly via cPanel
// File Manager without hunting for where the host puts its PHP error log.
// Toggle off with LOGIN_DEBUG=false in .env once things are working.
function loginDebugEnabled(): bool
{
    return env('LOGIN_DEBUG', 'true') !== 'false';
}

function loginLog(string $message, $context = null): void
{
    if (!loginDebugEnabled()) return;
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message;
    if ($context !== null) $line .= ' ' . json_encode($context, JSON_UNESCAPED_SLASHES);
    error_log('[login] ' . $line);
    $logFile = __DIR__ . '/../data/login-debug.log';
    // Best-effort file write - if data/ isn't writable for some reason, the
    // error_log() call above still gets it, so this failing silently is fine.
    @file_put_contents($logFile, $line . "\n", FILE_APPEND | LOCK_EX);
}
