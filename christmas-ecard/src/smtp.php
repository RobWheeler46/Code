<?php
// A small SMTP sender, so the service can send through the Group's own mail account until Postmark is set up.
// It is used only when POSTMARK_TOKEN is empty and SMTP_HOST is set. SMTP gives no bounce or complaint feedback and no delivery receipts,
// so cards show "Delivery unconfirmed" rather than "Delivered", and a bounce comes back to the mailbox, not to the app.

function smtp_addr(string $s): string { return preg_match('/<([^<>]+)>/', $s, $m) ? trim($m[1]) : trim($s); }
function smtp_clean(string $s): string { return trim(preg_replace('/[\r\n]+/', ' ', $s)); }
function smtp_subject(string $s): string {
    $s = smtp_clean($s); if (!preg_match('/[^\x20-\x7E]/', $s)) return $s;
    return implode("\r\n ", array_map(fn($c) => '=?UTF-8?B?' . base64_encode($c) . '?=', mb_str_split($s, 18, 'UTF-8')));
}

/** Builds the whole message, with CRLF line ends. Text and HTML are quoted-printable, an attachment is base64. */
function smtp_message(string $from, string $to, string $subject, string $text, ?string $html, ?array $attach, string $host): string {
    $h = ['Date: ' . date('r'), 'From: ' . smtp_clean($from), 'To: ' . smtp_addr($to), 'Subject: ' . smtp_subject($subject), 'Message-ID: <' . bin2hex(random_bytes(12)) . '@' . $host . '>', 'MIME-Version: 1.0', 'Auto-Submitted: auto-generated'];
    $part = fn(string $type, string $body) => "Content-Type: $type; charset=UTF-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" . quoted_printable_encode(str_replace(["\r\n", "\r"], "\n", $body)) . "\r\n";
    $b1 = '=_a' . bin2hex(random_bytes(8)); $b2 = '=_m' . bin2hex(random_bytes(8));
    $alt = $html === null ? null : "--$b1\r\n" . $part('text/plain', $text) . "--$b1\r\n" . $part('text/html', $html) . "--$b1--\r\n";
    if (!$attach) return implode("\r\n", $h) . "\r\n" . ($alt === null ? $part('text/plain', $text) : "Content-Type: multipart/alternative; boundary=\"$b1\"\r\n\r\n" . $alt);
    $m = implode("\r\n", $h) . "\r\nContent-Type: multipart/mixed; boundary=\"$b2\"\r\n\r\n--$b2\r\n" . ($alt === null ? $part('text/plain', $text) : "Content-Type: multipart/alternative; boundary=\"$b1\"\r\n\r\n" . $alt);
    foreach ($attach as $a) { $n = preg_replace('/[^A-Za-z0-9._-]/', '_', (string)($a['Name'] ?? 'file')); $m .= "--$b2\r\nContent-Type: " . preg_replace('/[^A-Za-z0-9.+\/-]/', '', (string)($a['ContentType'] ?? 'application/octet-stream')) . "; name=\"$n\"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename=\"$n\"\r\n\r\n" . chunk_split((string)($a['Content'] ?? ''), 76, "\r\n"); }
    return $m . "--$b2--\r\n";
}

/** Sends one email. Returns null when accepted, or an error that starts PERM: (do not retry) or UNKNOWN: (may have been sent), or plain text (try again later). */
function smtp_send(string $from, string $to, string $subject, string $text, ?string $html = null, ?array $attach = null): ?string {
    $host = env('SMTP_HOST'); $secure = strtolower(env('SMTP_SECURE', 'tls')); $port = (int)env('SMTP_PORT', $secure === 'ssl' ? '465' : '587');
    $me = parse_url(env('APP_URL', 'http://localhost'), PHP_URL_HOST) ?: 'localhost';
    $s = @stream_socket_client(($secure === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port, $en, $es, 15);
    if (!$s) return 'The mail server could not be reached (' . smtp_clean((string)$es) . '). It will be tried again.';
    stream_set_timeout($s, 20);
    $read = function () use ($s): array { $t = ''; do { $l = fgets($s, 1024); if ($l === false) return [0, $t]; $t .= $l; } while (strlen($l) > 3 && $l[3] === '-'); return [(int)substr($t, 0, 3), trim(preg_replace('/\s+/', ' ', $t))]; };
    $cmd = function (string $c) use ($s, $read): array { fwrite($s, $c . "\r\n"); return $read(); };
    $fail = function (int $c, string $t, string $stage) use ($s): string { @fwrite($s, "QUIT\r\n"); @fclose($s); $why = "The mail server said: $t"; return ($c >= 500 && in_array($stage, ['rcpt', 'data'], true)) ? 'PERM:' . $why : $why; };
    [$c, $t] = $read(); if ($c !== 220) return $fail($c, $t, 'connect');
    [$c, $t] = $cmd('EHLO ' . $me); if ($c !== 250) return $fail($c, $t, 'ehlo');
    if ($secure === 'tls') {
        [$c, $t] = $cmd('STARTTLS'); if ($c !== 220) return $fail($c, $t, 'tls');
        if (!@stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) { @fclose($s); return 'A secure connection to the mail server could not be made. It will be tried again.'; }
        [$c, $t] = $cmd('EHLO ' . $me); if ($c !== 250) return $fail($c, $t, 'ehlo');
    }
    if (env('SMTP_USER') !== '') {
        [$c, $t] = $cmd('AUTH LOGIN'); if ($c !== 334) return $fail($c, $t, 'auth');
        [$c, $t] = $cmd(base64_encode(env('SMTP_USER'))); if ($c !== 334) return $fail($c, $t, 'auth');
        [$c, $t] = $cmd(base64_encode(env('SMTP_PASS'))); if ($c !== 235) return $fail($c, 'The user name or password was not accepted. Check SMTP_USER and SMTP_PASS.', 'auth');
    }
    [$c, $t] = $cmd('MAIL FROM:<' . smtp_addr($from) . '>'); if ($c !== 250) return $fail($c, $t, 'mail');
    [$c, $t] = $cmd('RCPT TO:<' . smtp_addr($to) . '>'); if ($c !== 250 && $c !== 251) return $fail($c, $t, 'rcpt');
    [$c, $t] = $cmd('DATA'); if ($c !== 354) return $fail($c, $t, 'data');
    $msg = smtp_message($from, $to, $subject, $text, $html, $attach, $me); $msg = preg_replace('/^\./m', '..', $msg);
    fwrite($s, $msg . "\r\n.\r\n"); [$c, $t] = $read();
    if ($c === 250) { @fwrite($s, "QUIT\r\n"); @fclose($s); set_setting('last_mail_ok', (string)time()); return null; }
    if ($c === 0) { @fclose($s); return 'UNKNOWN:The mail server did not confirm whether it accepted the email'; } // it may have been sent, so it is not simply resent
    return $fail($c, $t, 'data');
}
