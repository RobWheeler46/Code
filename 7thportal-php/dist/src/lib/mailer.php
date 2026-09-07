<?php
// Ported from the Node version's src/lib/mailer.js. Node used nodemailer;
// PHP has no bundled SMTP client and this app avoids adding a Composer
// dependency (matches the zero-install "cut and paste" deploy story), so
// this is a small hand-rolled SMTP client (STARTTLS on 587, implicit TLS on
// 465, AUTH LOGIN) instead. Same behaviour: returns false without throwing
// if SMTP isn't configured, so the caller falls back to showing the invite
// link to copy/send manually.

function smtpReadResponse($fp): string
{
    $data = '';
    while (($line = fgets($fp, 515)) !== false) {
        $data .= $line;
        if (isset($line[3]) && $line[3] === ' ') break; // "250 " (final line) vs "250-" (multiline continues)
    }
    return $data;
}

function smtpExpect($fp, string $expectedPrefix): string
{
    $resp = smtpReadResponse($fp);
    if (strpos($resp, $expectedPrefix) !== 0) {
        throw new Exception("SMTP error, expected $expectedPrefix, got: $resp");
    }
    return $resp;
}

function smtpCommand($fp, string $cmd, string $expectedPrefix): string
{
    fwrite($fp, $cmd . "\r\n");
    return smtpExpect($fp, $expectedPrefix);
}

// Effective SMTP configuration. Settings saved in-app (settings table) take priority;
// .env values are the fallback so existing deployments keep working with no change.
// security: 'starttls' | 'ssl' | 'none' ('' = auto: implicit TLS on 465 else STARTTLS).
function smtpConfig(): array
{
    $s = [];
    if (function_exists('dbAll')) {
        foreach (dbAll("SELECT key, value FROM settings WHERE key IN ('smtp_host','smtp_port','smtp_security','smtp_user','smtp_pass','smtp_from','smtp_from_name','smtp_reply_to')") as $r) {
            if ($r['value'] !== null && $r['value'] !== '') $s[$r['key']] = $r['value'];
        }
    }
    $pick = fn($key, $envKey, $default = '') => $s[$key] ?? (env($envKey) ?: $default);
    $user = $pick('smtp_user', 'SMTP_USER', '');
    $port = (int) ($pick('smtp_port', 'SMTP_PORT', '587') ?: 587);
    $security = $s['smtp_security'] ?? '';
    if ($security === '' || !in_array($security, ['starttls', 'ssl', 'none'], true)) $security = $port === 465 ? 'ssl' : 'starttls';
    $from = $pick('smtp_from', 'INVITE_EMAIL_FROM', '') ?: $user;
    return [
        'host' => $pick('smtp_host', 'SMTP_HOST', ''),
        'port' => $port,
        'security' => $security,
        'user' => $user,
        'pass' => $pick('smtp_pass', 'SMTP_PASS', ''),
        'from' => $from,
        'fromName' => $s['smtp_from_name'] ?? (env('INVITE_EMAIL_FROM_NAME') ?: ''),
        'replyTo' => $s['smtp_reply_to'] ?? (env('SMTP_REPLY_TO') ?: ''),
    ];
}
function smtpConfigured(): bool { return smtpConfig()['host'] !== ''; }

// Build the RFC5322 From header value, quoting/stripping a display name safely.
function smtpFromHeader(array $cfg): string
{
    $name = trim(str_replace(["\r", "\n", '"'], '', (string) $cfg['fromName']));
    return $name !== '' ? '"' . $name . '" <' . $cfg['from'] . '>' : $cfg['from'];
}

// Low-level transport: open the connection, negotiate security, authenticate (only when
// a username is set, so open relays work), then send one already-built message to the
// given recipients. Throws on any protocol error; never leaks the password in messages.
function smtpDeliver(array $cfg, array $rcpts, string $data): void
{
    $prefix = $cfg['security'] === 'ssl' ? 'ssl://' : 'tcp://';
    $fp = @stream_socket_client("$prefix{$cfg['host']}:{$cfg['port']}", $errno, $errstr, 15);
    if (!$fp) throw new Exception('Could not connect to the mail server: ' . ($errstr ?: 'connection failed'));
    try {
        smtpExpect($fp, '220');
        smtpCommand($fp, 'EHLO 7thportal.local', '250');
        if ($cfg['security'] === 'starttls') {
            smtpCommand($fp, 'STARTTLS', '220');
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new Exception('STARTTLS negotiation failed.');
            smtpCommand($fp, 'EHLO 7thportal.local', '250');
        }
        if ($cfg['user'] !== '') {
            smtpCommand($fp, 'AUTH LOGIN', '334');
            smtpCommand($fp, base64_encode($cfg['user']), '334');
            smtpCommand($fp, base64_encode($cfg['pass']), '235');
        }
        smtpCommand($fp, 'MAIL FROM:<' . $cfg['from'] . '>', '250');
        foreach ($rcpts as $r) smtpCommand($fp, "RCPT TO:<$r>", '250');
        smtpCommand($fp, 'DATA', '354');
        $data = preg_replace('/^\./m', '..', $data); // SMTP dot-stuffing
        fwrite($fp, $data . "\r\n.\r\n");
        smtpExpect($fp, '250');
        fwrite($fp, "QUIT\r\n");
        fclose($fp);
    } catch (Throwable $e) {
        fclose($fp);
        throw $e;
    }
}

// Returns false (without throwing) if SMTP isn't configured.
function sendInviteEmail(string $toEmail, string $firstName, string $setupUrl): bool
{
    $subject = '7thPortal - set up your parent/carer account';
    $body = "Hi $firstName,\n\nA 7th Swindon Scout Group leader has set up a 7thPortal account for you so you can view your child's information.\n\nSet your password here: $setupUrl\n\nThis link expires in 7 days.\n";
    return sendEmail($toEmail, $subject, $body);
}

// MIME multipart send with file attachments (used by the DLV approval email). Same
// transport and graceful "false when unconfigured" behaviour as sendEmail; throws only
// on a live send error. $attachments: [['filename','content','mime']]. $opts: replyTo,
// cc[] (extra recipients). The evidence is never truncated here - size limits are
// enforced by the caller before it decides to send.
function sendEmailWithAttachments(string $toEmail, string $subject, string $body, array $attachments = [], array $opts = []): bool
{
    $cfg = smtpConfig();
    if ($cfg['host'] === '') return false;
    $replyTo = trim((string) ($opts['replyTo'] ?? '')) ?: (string) $cfg['replyTo'];
    $cc = array_values(array_filter(array_map('trim', $opts['cc'] ?? [])));

    $boundary = 'b_' . bin2hex(random_bytes(12));
    $msg = 'From: ' . smtpFromHeader($cfg) . "\r\nTo: $toEmail\r\n";
    if ($cc) $msg .= 'Cc: ' . implode(', ', $cc) . "\r\n";
    if ($replyTo !== '') $msg .= "Reply-To: $replyTo\r\n";
    $msg .= "Subject: $subject\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=\"$boundary\"\r\n\r\n";
    $msg .= "--$boundary\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" . $body . "\r\n";
    foreach ($attachments as $a) {
        $name = str_replace('"', '', (string) $a['filename']);
        $mime = $a['mime'] ?? 'application/octet-stream';
        $msg .= "--$boundary\r\nContent-Type: $mime; name=\"$name\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$name\"\r\n\r\n" . chunk_split(base64_encode((string) $a['content'])) . "\r\n";
    }
    $msg .= "--$boundary--\r\n";
    smtpDeliver($cfg, array_merge([$toEmail], $cc), $msg);
    return true;
}

// Generic plain-text SMTP send. Returns false (without throwing) when the mail server is
// not configured, so callers can degrade gracefully; throws only on a live send error.
function sendEmail(string $toEmail, string $subject, string $body): bool
{
    $cfg = smtpConfig();
    if ($cfg['host'] === '') return false;
    $msg = 'From: ' . smtpFromHeader($cfg) . "\r\nTo: $toEmail\r\nSubject: $subject\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n";
    if ($cfg['replyTo'] !== '') $msg .= 'Reply-To: ' . $cfg['replyTo'] . "\r\n";
    $msg .= "\r\n" . $body;
    smtpDeliver($cfg, [$toEmail], $msg);
    return true;
}

// Send a diagnostic test email to confirm the configured mail server works. Throws on a
// live error (the route turns it into a redacted message); returns false if unconfigured.
function sendTestEmail(string $toEmail): bool
{
    $when = gmdate('Y-m-d H:i') . ' UTC';
    return sendEmail($toEmail, '7thPortal test email', "This is a test email from 7thPortal.\n\nIf you can read this, your mail server settings are working.\n\nSent: $when\n");
}
