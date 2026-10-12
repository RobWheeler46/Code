<?php
declare(strict_types=1);
const ROOT = __DIR__ . '/..';
/** The build stamp written by scripts/build-dist.sh, so you can tell which version is deployed. */
function app_version(): string { $f = ROOT . '/VERSION'; return is_file($f) ? trim((string)file_get_contents($f)) : 'development'; }
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
create table if not exists admin_invites(id integer primary key autoincrement, email text not null, roles text not null, token_hash text unique, invited_by int, created int, expires int, accepted_at int, accepted_by int, revoked_at int);
create table if not exists attempts(k text, t int);
create table if not exists contacts(id integer primary key autoincrement, user_id int, name text, email text, created int, updated int);
create table if not exists groups(id integer primary key autoincrement, user_id int, name text);
create table if not exists contact_groups(contact_id int, group_id int, primary key(contact_id, group_id));
create table if not exists alerts(akey text primary key, text text, severity text, first_seen int, last_notified int, acked_by int, acked_at int, escalated int default 0, resolved_at int);
create table if not exists decisions(id text primary key, value text, approver text, approved_on text, ref text, status text default 'open');
create table if not exists giftaid(id integer primary key autoincrement, send_id int unique, donation_id int, user_id int, title text, first_name text, last_name text, house text, postcode text, wording text, declared_at int, status text default 'pending', claim_batch text, claimed_at int);
create table if not exists stripe_events(id text primary key, type text, received int, outcome text, detail text, resolved_at int, note text);
create table if not exists bounces(email text primary key, kind text, detail text, at int);
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
    foreach ([['users', 'pending_email text'], ['users', 'pending_token text'], ['users', 'pending_exp int default 0'], ['users', "roles text default ''"], ['users', "notify text default 'off'"], ['sends', 'stripe_session text'], ['sends', 'donation_note int default 0'], ['sends', 'ref text'], ['recipients', 'withdrawn int default 0'], ['recipients', 'token_hash text'], ['recipients', 'own_msg text'], ['recipients', 'next_at int default 0'], ['donations', "refund_status text default 'none'"], ['sends', 'is_test int default 0'], ['users', 'remind int default 0'], ['users', 'remind_year int'], ['sends', 'art_ref text'], ['donations', 'payment_intent text'], ['users', 'last_login int'], ['users', 'terms_version text'], ['users', 'terms_at int'], ['users', 'suspended int default 0'], ['users', 'suspend_reason text']] as [$t, $def]) {
        if (!in_array(explode(' ', $def)[0], array_column($p->query("pragma table_info($t)")->fetchAll(), 'name'))) $p->exec("alter table $t add column $def");
    }
    // Private card links are kept only as a SHA-256 hash once mailed, so a copy of the database cannot open anyone's card.
    $p->sqliteCreateFunction('sha256', fn($v) => hash('sha256', (string)$v), 1);
    $p->exec('create index if not exists rcpt_token_hash on recipients(token_hash)');
    $p->exec("update recipients set token_hash=sha256(token) where token_hash is null and token is not null and token not like 'gone-%'");
    $p->exec("update recipients set token=null where token_hash is not null and status in ('sent','failed','bounced')");
    if (function_exists('library_migrate')) library_migrate($p);
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

/** Search engines must never index, and browsers and proxies must never keep, anything that is not a public page: card links, accounts, drafts and every admin and private screen. */
function private_headers(string $path): void {
    if (in_array($path, ['/', '/help', '/privacy', '/terms'], true) || str_starts_with($path, '/art/') || str_starts_with($path, '/occasion/')) return;
    header('X-Robots-Tag: noindex, nofollow, noarchive');
    header('Cache-Control: private, no-store');
}

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
function limit(string $key, int $max, int $secs): void { limit_for($key . '|' . ($_SERVER['REMOTE_ADDR'] ?? 'cli'), $max, $secs); }
/** Rate limit on an exact key (an account, an email, a token), not just the visitor's address. Blocked attempts leave an audit signal. */
function limit_for(string $k, int $max, int $secs): void {
    q('delete from attempts where t<?', [time() - 86400]);
    $n = (int)one('select count(*) c from attempts where k=? and t>?', [$k, time() - $secs])['c'];
    if ($n >= $max) { if ($n === $max) audit(null, 'rate_limited', explode('|', $k)[0] . (str_contains($k, '|') ? '' : ' (account or key)')); fail(429, 'Too many attempts. Please wait a few minutes and try again.'); }
    q('insert into attempts(k,t) values(?,?)', [$k, time()]);
}
/** Hidden trap field for simple bots. People never see or fill it. */
function hp_field(): string { return '<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>'; }
function honeypot(): void { if (trim((string)($_POST['website'] ?? '')) !== '') { audit(null, 'honeypot', (string)($_SERVER['REMOTE_ADDR'] ?? '')); fail(400, 'Something went wrong. Please try again.'); } }
function redirect(string $to): never { header('Location: ' . $to); exit; }
function safe_next(?string $n): string { return ($n && preg_match('#^/[A-Za-z0-9_/?=&.-]*$#', $n)) ? $n : '/dashboard'; }

function user(): ?array {
    static $u = false;
    if ($u === false) { $u = empty($_SESSION['uid']) ? null : one('select * from users where id=?', [$_SESSION['uid']]); if ($u && str_ends_with($u['email'], '@deleted.invalid')) $u = null; }
    return $u;
}
function need_login(): array {
    $u = user();
    if (!$u) { flash('Please sign in or register to continue.', 'warn'); redirect('/login?next=' . urlencode($_SERVER['REQUEST_URI'])); }
    return $u;
}
const ROLES = ['campaign' => 'Campaign manager', 'appadmin' => 'Application administrator', 'finance' => 'Finance administrator', 'delivery' => 'Delivery support', 'complaints' => 'Complaints reviewer', 'rolesadmin' => 'Restricted administrator'];
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
/** Mail settings: what an administrator saved in Admin wins, otherwise the .env value. */
function mail_cfg(string $k, string $d = ''): string { $s = setting('mail_' . strtolower($k)); return $s !== '' ? $s : env($k, $d); }
/** postmark, smtp or log (write to a file, send nothing). Left on automatic it follows what is configured. */
function mail_provider(): string {
    $p = setting('mail_provider'); if (in_array($p, ['postmark', 'smtp', 'log'], true)) return $p;
    return mail_cfg('POSTMARK_TOKEN') !== '' ? 'postmark' : (mail_cfg('SMTP_HOST') !== '' ? 'smtp' : 'log');
}
function mail_send(string $to, string $subject, string $text, array $meta = [], ?string $html = null, ?string $fromName = null, ?array $attachments = null): ?string {
    $from = mail_cfg('MAIL_FROM', 'cards@7thswindon.org.uk'); // always our own verified address, never the sender's
    if ($fromName) $from = '"' . trim(preg_replace('/[^\p{L}\p{N} .,\'&-]/u', '', $fromName)) . ' via 7th Swindon Scouts" <' . $from . '>';
    $prov = mail_provider();
    if ($prov === 'smtp') return mail_cfg('SMTP_HOST') === '' ? 'Email is set to use your own mail account, but no mail server has been entered yet.' : smtp_send($from, $to, $subject, $text, $html, $attachments); // the Group's own mail account (src/smtp.php)
    if ($prov === 'postmark' && mail_cfg('POSTMARK_TOKEN') === '') return 'Email is set to use Postmark, but no Postmark token has been entered yet.';
    if ($prov === 'log') {
        @mkdir(ROOT . '/data', 0775, true);
        file_put_contents(ROOT . '/data/outbox.log', json_encode(['t' => date('c'), 'to' => $to, 'from' => $from, 'subject' => $subject, 'text' => $text, 'html' => $html !== null]) . "\n", FILE_APPEND);
        return null;
    }
    $ch = curl_init('https://api.postmarkapp.com/email');
    curl_setopt_array($ch, [CURLOPT_POST => 1, CURLOPT_RETURNTRANSFER => 1, CURLOPT_TIMEOUT => 20,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'X-Postmark-Server-Token: ' . mail_cfg('POSTMARK_TOKEN')],
        CURLOPT_POSTFIELDS => json_encode(array_filter(['From' => $from, 'To' => $to, 'Subject' => $subject, 'TextBody' => $text, 'HtmlBody' => $html, 'MessageStream' => env('POSTMARK_STREAM', 'outbound'), 'TrackOpens' => false, 'Metadata' => $meta ?: null, 'Attachments' => $attachments], fn($v) => $v !== null))]);
    $raw = curl_exec($ch); $r = json_decode((string)$raw, true);
    if (!is_array($r)) return 'UNKNOWN:Provider did not answer, so we cannot tell whether the email was accepted';
    if (($r['ErrorCode'] ?? 1) === 0) { set_setting('last_mail_ok', (string)time()); return null; }
    return (in_array($r['ErrorCode'] ?? 0, [300, 406]) ? 'PERM:' : '') . ($r['Message'] ?? 'Mail provider refused the email'); // 300 invalid address, 406 inactive recipient
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
    if (!empty($GLOBALS['bare'])) $nav = ''; // recipient pages: just the brand, no account links
    elseif ($u) {
        $nav .= '<a href="/dashboard">My cards</a><a href="/contacts">Address book</a><a href="/account">Account</a>' . ($u['is_admin'] ? '<a href="/admin">Admin</a>' : '')
            . '<form method="post" action="/logout" class="inline">' . csrf() . '<button class="link">Sign out</button></form>';
    } else $nav .= '<a href="/login">Sign in</a><a href="/register">Register</a>';
    echo '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">'
        . '<title>' . h($title) . ' | 7th Swindon Scouts Christmas Cards</title>'
        . '<link rel="stylesheet" href="/assets/style.css"></head><body><a class="skip" href="#main">Skip to content</a>'
        . (env('APP_ENV', 'development') !== 'production' ? '<p class="envbanner" role="note">' . h(strtoupper(env('APP_ENV', 'development'))) . ' environment. Test mode: nothing here is real. Do not enter real details.</p>' : '') . '<header><a class="brand" href="/"><img src="/assets/brand/7th-swindon-circle-blue.png" alt="7th Swindon Scouts" width="64" height="64"><span>Christmas Cards</span></a><nav aria-label="Main">' . $nav . '</nav></header>'
        . '<main id="main">' . ($f ? '<p class="flash ' . h($f[0]) . '" role="' . ($f[0] === 'err' ? 'alert" tabindex="-1" data-focus' : 'status"') . '>' . h($f[1]) . '</p>' : '') . $body . '</main>'
        . '<footer><img class="footlogo" src="/assets/brand/7th-swindon-circle-blue.png" alt="7th Swindon Scouts" width="56" height="56"><a href="/privacy">Privacy and cookies</a> &middot; <a href="/terms">Terms and safeguarding</a> &middot; <a href="/help">Help and FAQ</a><br>Sending is free' . (donations_enabled() ? '; donations are optional and support 7th Swindon Scouts' : '') . '. Cards stay viewable for ' . (int)setting('expiry_days', '60') . ' days after sending.<br><small class="ver">Version ' . h(app_version()) . '</small></footer><script src="/assets/app.js"></script></body></html>';
    exit;
}
