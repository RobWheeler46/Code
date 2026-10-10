<?php
declare(strict_types=1);
const ROOT = __DIR__ . '/..';
date_default_timezone_set('Europe/London'); // campaign dates and displayed times are UK local

function env(string $k, string $d = ''): string {
    static $e;
    if ($e === null) {
        $e = [];
        $f = ROOT . '/.env';
        if (is_file($f)) foreach (file($f, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $l) {
            if ($l[0] === '#' || !str_contains($l, '=')) continue;
            [$a, $b] = explode('=', $l, 2);
            $e[trim($a)] = trim($b);
        }
    }
    return (getenv($k) ?: ($e[$k] ?? '')) ?: $d;
}

const SCHEMA = <<<'SQL'
create table if not exists users(id integer primary key autoincrement, name text, email text unique, pass text, verified int default 0, verify_token text, reset_token text, reset_exp int default 0, is_admin int default 0, totp_secret text, created int);
create table if not exists sends(id integer primary key autoincrement, user_id int, card text, sender_name text, message text default '', donation int default 0, status text default 'draft', created int, updated int, queued_at int);
create table if not exists recipients(id integer primary key autoincrement, send_id int, name text, email text, token text unique, status text default 'draft', error text, tries int default 0, sent_at int, delivered_at int, opened_at int, viewed_at int);
create table if not exists donations(id integer primary key autoincrement, send_id int, user_id int, pence int, stripe_session text unique, account text, fee int default 0, refunded int default 0, created int);
create table if not exists reports(id integer primary key autoincrement, recipient_id int, reason text, status text default 'open', decision text, created int);
create table if not exists optouts(email text, user_id int, created int, primary key(email, user_id));
create table if not exists settings(k text primary key, v text);
create table if not exists attempts(k text, t int);
create table if not exists contacts(id integer primary key autoincrement, user_id int, name text, email text, created int, updated int);
create table if not exists groups(id integer primary key autoincrement, user_id int, name text);
create table if not exists contact_groups(contact_id int, group_id int, primary key(contact_id, group_id));
create table if not exists audit(id integer primary key autoincrement, user_id int, action text, detail text, created int);
SQL;

function db(): PDO {
    static $p;
    if ($p) return $p;
    $f = env('DB_PATH', ROOT . '/data/ecard.sqlite');
    @mkdir(dirname($f), 0775, true);
    $p = new PDO('sqlite:' . $f, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
    $p->exec('pragma busy_timeout=5000');
    $p->exec(SCHEMA);
    foreach ([['users', "roles text default ''"], ['users', "notify text default 'off'"], ['sends', 'stripe_session text'], ['sends', 'donation_note int default 0'], ['sends', 'ref text'], ['recipients', 'withdrawn int default 0'], ['recipients', 'own_msg text']] as [$t, $def]) {
        if (!in_array(explode(' ', $def)[0], array_column($p->query("pragma table_info($t)")->fetchAll(), 'name'))) $p->exec("alter table $t add column $def");
    }
    return $p;
}
function q(string $sql, array $a = []): PDOStatement { $s = db()->prepare($sql); $s->execute($a); return $s; }
function one(string $sql, array $a = []): ?array { return q($sql, $a)->fetch() ?: null; }
function all(string $sql, array $a = []): array { return q($sql, $a)->fetchAll(); }
function setting(string $k, string $d = ''): string { $r = one('select v from settings where k=?', [$k]); return $r ? $r['v'] : $d; }
function set_setting(string $k, string $v): void { q('insert into settings(k,v) values(?,?) on conflict(k) do update set v=excluded.v', [$k, $v]); }
function audit(?int $uid, string $action, string $detail = ''): void { q('insert into audit(user_id,action,detail,created) values(?,?,?,?)', [$uid, $action, $detail, time()]); }

function h(?string $s): string { return htmlspecialchars((string)$s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'); }
function gbp(int $p): string { return '£' . number_format($p / 100, 2); }
function base_url(): string { return rtrim(env('APP_URL', 'http://localhost:8060'), '/'); }
function token(): string { return bin2hex(random_bytes(24)); }

// ---- session, csrf, flash, rate limit
function boot(): void {
    session_name('ecard');
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])]);
    session_start();
    $_SESSION['csrf'] ??= bin2hex(random_bytes(16));
    header('X-Frame-Options: DENY');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: same-origin'); // keeps card tokens out of Referer
    header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; form-action 'self' https://checkout.stripe.com");
}
function csrf(): string { return '<input type="hidden" name="_c" value="' . $_SESSION['csrf'] . '">'; }
function check_csrf(): void { if (!hash_equals($_SESSION['csrf'], (string)($_POST['_c'] ?? ''))) fail(403, 'Your session expired. Please go back, refresh and try again.'); }
function flash(?string $msg = null, string $type = 'ok'): ?array {
    if ($msg !== null) { $_SESSION['flash'] = [$type, $msg]; return null; }
    $f = $_SESSION['flash'] ?? null; unset($_SESSION['flash']); return $f;
}
function limit(string $key, int $max, int $secs): void {
    $k = $key . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'cli');
    q('delete from attempts where t<?', [time() - 86400]);
    if ((int)one('select count(*) c from attempts where k=? and t>?', [$k, time() - $secs])['c'] >= $max) fail(429, 'Too many attempts. Please wait a few minutes and try again.');
    q('insert into attempts(k,t) values(?,?)', [$k, time()]);
}
function redirect(string $to): never { header('Location: ' . $to); exit; }
function safe_next(?string $n): string { return ($n && preg_match('#^/[A-Za-z0-9_/?=&.-]*$#', $n)) ? $n : '/dashboard'; }

function user(): ?array {
    static $u = false;
    if ($u === false) $u = empty($_SESSION['uid']) ? null : one('select * from users where id=?', [$_SESSION['uid']]);
    return $u;
}
function need_login(): array {
    $u = user();
    if (!$u) { flash('Please sign in or register to continue.', 'warn'); redirect('/login?next=' . urlencode($_SERVER['REQUEST_URI'])); }
    return $u;
}
const ROLES = ['finance' => 'Finance', 'delivery' => 'Delivery support', 'campaign' => 'Campaign management', 'complaints' => 'Complaints', 'rolesadmin' => 'Role administrator'];
function can(string $role): bool { return in_array($role, explode(',', (string)(user()['roles'] ?? ''))); }
function need_role(string $role): array { $u = need_admin(); if (!can($role)) fail(403, 'You do not have permission for that.'); return $u; }
function need_admin(): array {
    $u = need_login();
    if (!$u['is_admin']) fail(403, 'Not allowed.');
    if (empty($_SESSION['mfa'])) redirect('/mfa');
    return $u;
}

// ---- totp (admin MFA)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32e(string $s): string {
    $b = ''; foreach (str_split($s) as $c) $b .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    return implode('', array_map(fn($x) => B32[bindec(str_pad($x, 5, '0'))], str_split($b, 5)));
}
function b32d(string $s): string {
    $b = ''; foreach (str_split(strtoupper($s)) as $c) if (($p = strpos(B32, $c)) !== false) $b .= str_pad(decbin($p), 5, '0', STR_PAD_LEFT);
    $o = ''; foreach (str_split($b, 8) as $x) if (strlen($x) === 8) $o .= chr(bindec($x));
    return $o;
}
function totp(string $secret, int $t): string {
    $h = hash_hmac('sha1', pack('J', intdiv($t, 30)), b32d($secret), true);
    $o = ord($h[19]) & 15;
    return sprintf('%06d', (unpack('N', substr($h, $o, 4))[1] & 0x7fffffff) % 1000000);
}
function totp_ok(string $secret, string $code): bool {
    foreach ([-30, 0, 30] as $d) if (hash_equals(totp($secret, time() + $d), trim($code))) return true;
    return false;
}

// ---- email (Postmark, or data/outbox.log when no token is set)
function mail_send(string $to, string $subject, string $text, array $meta = [], ?string $html = null, ?string $fromName = null): ?string {
    $from = env('MAIL_FROM', 'cards@7thswindon.org.uk'); // always our own verified address, never the sender's
    if ($fromName) $from = '"' . trim(preg_replace('/[^\p{L}\p{N} .,\'&-]/u', '', $fromName)) . ' via 7th Swindon Scouts" <' . $from . '>';
    if (!env('POSTMARK_TOKEN')) {
        file_put_contents(ROOT . '/data/outbox.log', json_encode(['t' => date('c'), 'to' => $to, 'from' => $from, 'subject' => $subject, 'text' => $text, 'html' => $html !== null]) . "\n", FILE_APPEND);
        return null;
    }
    $ch = curl_init('https://api.postmarkapp.com/email');
    curl_setopt_array($ch, [CURLOPT_POST => 1, CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'X-Postmark-Server-Token: ' . env('POSTMARK_TOKEN')],
        CURLOPT_POSTFIELDS => json_encode(array_filter(['From' => $from, 'To' => $to, 'Subject' => $subject, 'TextBody' => $text, 'HtmlBody' => $html, 'MessageStream' => env('POSTMARK_STREAM', 'outbound'), 'TrackOpens' => false, 'Metadata' => $meta ?: null], fn($v) => $v !== null))]);
    $r = json_decode((string)curl_exec($ch), true);
    return (($r['ErrorCode'] ?? 1) === 0) ? null : ($r['Message'] ?? 'Mail provider unreachable');
}

// ---- stripe
function stripe(string $m, string $path, array $f = [], string $idem = ''): array {
    $ch = curl_init('https://api.stripe.com/v1' . $path);
    $h = ['Authorization: Bearer ' . env('STRIPE_SECRET')];
    if ($a = env('STRIPE_ACCOUNT')) $h[] = 'Stripe-Account: ' . $a; // verified 7th Swindon beneficiary (Connect account)
    if ($idem) $h[] = 'Idempotency-Key: ' . $idem;
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $m, CURLOPT_RETURNTRANSFER => 1, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 20]);
    if ($f) curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($f));
    return json_decode((string)curl_exec($ch), true) ?: [];
}
function stripe_sig_ok(string $payload, string $hdr): bool {
    parse_str(str_replace(',', '&', $hdr), $p);
    $t = (int)($p['t'] ?? 0);
    return abs(time() - $t) < 300 && hash_equals(hash_hmac('sha256', $t . '.' . $payload, env('STRIPE_WEBHOOK_SECRET')), (string)($p['v1'] ?? ''));
}

// ---- layout
function fail(int $code, string $msg): never { page('Sorry', '<p>' . h($msg) . '</p><p><a href="/">Back to the home page</a></p>', $code); }
function page(string $title, string $body, int $code = 200): never {
    http_response_code($code);
    $u = user(); $f = flash();
    $nav = '<a href="/">Cards</a>';
    if ($u) {
        $nav .= '<a href="/dashboard">My cards</a><a href="/contacts">Address book</a>' . ($u['is_admin'] ? '<a href="/admin">Admin</a>' : '')
            . '<form method="post" action="/logout" class="inline">' . csrf() . '<button class="link">Sign out</button></form>';
    } else $nav .= '<a href="/login">Sign in</a><a href="/register">Register</a>';
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<title>' . h($title) . ' | 7th Swindon Scouts Christmas Cards</title>'
        . '<link rel="stylesheet" href="/assets/style.css"></head><body><a class="skip" href="#main">Skip to content</a>'
        . '<header><a class="brand" href="/"><img src="/assets/brand/7th-swindon-stacked-purple.svg" alt="7th Swindon Scouts" width="64" height="61"><span>Christmas Cards</span></a><nav aria-label="Main">' . $nav . '</nav></header>'
        . '<main id="main">' . ($f ? '<p class="flash ' . h($f[0]) . '" role="' . ($f[0] === 'err' ? 'alert" tabindex="-1" data-focus' : 'status"') . '>' . h($f[1]) . '</p>' : '') . $body . '</main>'
        . '<footer>Sending is free; donations are optional and support 7th Swindon Scouts. Cards stay viewable for ' . (int)setting('expiry_days', '60') . ' days after sending. <a href="/help">Help and FAQ</a></footer><script src="/assets/app.js"></script></body></html>';
    exit;
}
