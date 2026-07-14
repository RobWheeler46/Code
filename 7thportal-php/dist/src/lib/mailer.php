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

// Returns false (without throwing) if SMTP isn't configured.
function sendInviteEmail(string $toEmail, string $firstName, string $setupUrl): bool
{
    $host = env('SMTP_HOST');
    $user = env('SMTP_USER');
    if (!$host || !$user) return false;

    $port = (int) (env('SMTP_PORT') ?: 587);
    $pass = env('SMTP_PASS') ?: '';
    $from = env('INVITE_EMAIL_FROM') ?: $user;
    $subject = '7thPortal - set up your parent/carer account';
    $body = "Hi $firstName,\n\nA 7th Swindon Scout Group leader has set up a 7thPortal account for you so you can view your child's information.\n\nSet your password here: $setupUrl\n\nThis link expires in 7 days.\n";

    $transportPrefix = $port === 465 ? 'ssl://' : 'tcp://';
    $fp = @stream_socket_client("$transportPrefix$host:$port", $errno, $errstr, 15);
    if (!$fp) throw new Exception("Could not connect to SMTP server: $errstr");

    try {
        smtpExpect($fp, '220');
        smtpCommand($fp, 'EHLO 7thportal.local', '250');
        if ($port !== 465) {
            smtpCommand($fp, 'STARTTLS', '220');
            if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                throw new Exception('STARTTLS negotiation failed.');
            }
            smtpCommand($fp, 'EHLO 7thportal.local', '250');
        }
        smtpCommand($fp, 'AUTH LOGIN', '334');
        smtpCommand($fp, base64_encode($user), '334');
        smtpCommand($fp, base64_encode($pass), '235');
        smtpCommand($fp, "MAIL FROM:<$from>", '250');
        smtpCommand($fp, "RCPT TO:<$toEmail>", '250');
        smtpCommand($fp, 'DATA', '354');
        $headers = "From: $from\r\nTo: $toEmail\r\nSubject: $subject\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n";
        fwrite($fp, $headers . $body . "\r\n.\r\n");
        smtpExpect($fp, '250');
        fwrite($fp, "QUIT\r\n");
        fclose($fp);
        return true;
    } catch (Throwable $e) {
        fclose($fp);
        throw $e;
    }
}
