<?php
// Webhooks from Stripe and Postmark. No sign in: each one proves itself with a signature or a shared key.

function r_stripe_hook(): void {
    $body = (string)file_get_contents('php://input');
    if (!env('STRIPE_WEBHOOK_SECRET') || !stripe_sig_ok($body, $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '')) { http_response_code(400); exit('bad signature'); }
    set_setting('last_stripe_hook', (string)time());
    exit(stripe_handle_event(json_decode($body, true) ?: []));
}

function r_postmark_hook(): void {
    // The key belongs in the webhook's Basic Auth password (Postmark: https://user:KEY@host/hooks/postmark), which web server logs do not record. ?k= is the old way and still works.
    $given = (string)($_SERVER['PHP_AUTH_PW'] ?? '');
    if ($given === '' && preg_match('/^Basic (.+)$/i', (string)($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? ''), $m)) { $cred = explode(':', (string)base64_decode($m[1]), 2); $given = $cred[1] ?? ''; }
    if ($given === '') $given = (string)($_GET['k'] ?? '');
    if (!env('POSTMARK_HOOK_KEY') || !hash_equals(env('POSTMARK_HOOK_KEY'), $given)) { http_response_code(403); exit; }
    $e = json_decode((string)file_get_contents('php://input'), true) ?: [];
    exit(postmark_handle_event($e));
}
