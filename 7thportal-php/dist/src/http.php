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
