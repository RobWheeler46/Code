<?php
/**
 * Contact form handler for the 7th Swindon Scouts website.
 *
 * Receives a POST from the "Contact Us" form (app.js sends it via fetch and
 * expects JSON back; a no-JS browser posts here directly and gets the same JSON).
 * Validates the input, blocks obvious spam and header injection, and emails the
 * enquiry to the group inbox with the visitor's address as Reply-To.
 *
 * Deliverability note: PHP mail() hands off to the server's local MTA. For
 * reliable delivery (SPF/DKIM aligned), set $FROM to a real mailbox on
 * 7thswindon.org.uk. If mail lands in spam, switch to SMTP (e.g. PHPMailer with
 * the group's SMTP credentials) — the validation/response logic below stays the same.
 */

header('Content-Type: application/json; charset=utf-8');

$FROM = 'website@7thswindon.org.uk';            // must be a mailbox on your domain

// Role-based routing (FRD CON-002): enquiry type → mailbox. Recipients live here
// on the server, never in the browser. Adjust freely — e.g. give Governance a
// dedicated chair@/secretary@ mailbox when one exists. Unknown types fall back
// to $DEFAULT_TO.
$ROUTES = [
    'Joining'                => 'info@7thswindon.org.uk',
    'Volunteering'           => 'glv@7thswindon.org.uk',
    'Additional support'     => 'glv@7thswindon.org.uk',
    'Existing member'        => 'info@7thswindon.org.uk',
    'Community and partnership' => 'info@7thswindon.org.uk',
    'Governance'             => 'trustees@7thswindon.org.uk',
    'Supporting us'          => 'glv@7thswindon.org.uk',
    'General'                => 'info@7thswindon.org.uk',
];
$DEFAULT_TO = 'info@7thswindon.org.uk';

function respond($ok, $message, $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok, 'message' => $message]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(false, 'Method not allowed.', 405);
}

// Honeypot — the hidden "website" field is invisible to people; bots fill it.
// Pretend success so automated submitters don't learn they were blocked.
if (trim($_POST['website'] ?? '') !== '') {
    respond(true, 'Thanks! Your message has been sent.');
}

// Time-trap: app.js reports how long the form took to fill. A real person takes
// more than a few seconds; a submission faster than 3s is a bot. Pretend success
// so the bot doesn't learn it was blocked. A no-JS submit sends no "elapsed"
// field and is let through — the honeypot above still applies to it.
$elapsed = isset($_POST['elapsed']) ? (int) $_POST['elapsed'] : -1;
if ($elapsed >= 0 && $elapsed < 3000) {
    respond(true, 'Thanks! Your message has been sent.');
}

// Cloudflare Turnstile. The secret never lives in the repo — it is read from,
// in order: the TURNSTILE_SECRET environment variable (getenv), the $_SERVER
// copy that Apache "SetEnv TURNSTILE_SECRET …" populates (getenv often can't
// see SetEnv vars), or a git-ignored turnstile-secret.php next to this file
// that returns the key. Set it by any one of those to activate.
// When no secret is configured, verification is skipped and the honeypot +
// time-trap above still apply.
$secret = getenv('TURNSTILE_SECRET') ?: ($_SERVER['TURNSTILE_SECRET'] ?? '');
if ($secret === '' && is_file(__DIR__ . '/turnstile-secret.php')) {
    $secret = trim((string) (include __DIR__ . '/turnstile-secret.php'));
}
if ($secret !== '') {
    $token = $_POST['cf-turnstile-response'] ?? '';
    // No token means the challenge wasn't completed — reject.
    if ($token === '') {
        respond(false, 'Please complete the anti-spam check and try again.', 422);
    }
    $postData  = http_build_query(['secret' => $secret, 'response' => $token, 'remoteip' => $_SERVER['REMOTE_ADDR'] ?? '']);
    $verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    $resp = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($verifyUrl);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $postData, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 5]);
        $resp = curl_exec($ch);
        curl_close($ch);
    } else {
        $resp = @file_get_contents($verifyUrl, false, stream_context_create(['http' => [
            'method'  => 'POST',
            'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => $postData,
            'timeout' => 5,
        ]]));
    }
    // Reject on a definite failure. If Cloudflare was genuinely unreachable
    // (empty/false response), fail open so an outage never blocks enquiries.
    if ($resp !== false && $resp !== null && $resp !== '') {
        $data = json_decode($resp, true);
        if (empty($data['success'])) {
            respond(false, 'Please complete the anti-spam check and try again.', 422);
        }
    }
}

$name    = trim($_POST['name'] ?? '');
$email   = trim($_POST['email'] ?? '');
$type    = trim($_POST['enquiryType'] ?? '');
$subject = trim($_POST['subject'] ?? '');
$message = trim($_POST['message'] ?? '');

if ($name === '' || $email === '' || $message === '') {
    respond(false, 'Please fill in your name, email and message.', 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'Please enter a valid email address.', 422);
}
// Reject CR/LF in any field that feeds a mail header — prevents header injection.
if (preg_match('/[\r\n]/', $name . $email . $subject . $type)) {
    respond(false, 'Invalid input.', 422);
}
if (mb_strlen($message) > 5000) {
    respond(false, 'Your message is too long (5000 characters max).', 422);
}

// Route by enquiry type (whitelist; unknown → default inbox).
$TO = $ROUTES[$type] ?? $DEFAULT_TO;
$typeLabel = isset($ROUTES[$type]) ? $type : 'General';

$subjectLine = "Website enquiry ({$typeLabel})" . ($subject !== '' ? ": {$subject}" : '');

$body  = "New enquiry from the 7th Swindon website\n";
$body .= "----------------------------------------\n\n";
$body .= "Type:    {$typeLabel}\n";
$body .= "Name:    {$name}\n";
$body .= "Email:   {$email}\n";
if ($subject !== '') {
    $body .= "Subject: {$subject}\n";
}
$body .= "\nMessage:\n{$message}\n";

$headers   = [];
$headers[] = "From: 7th Swindon Website <{$FROM}>";
$headers[] = "Reply-To: {$name} <{$email}>";
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
$headers[] = 'X-Mailer: PHP/' . phpversion();

$sent = @mail($TO, $subjectLine, $body, implode("\r\n", $headers));

if ($sent) {
    respond(true, "Thanks {$name}! Your message has been sent — we'll be in touch soon.");
}

respond(false, "Sorry, we couldn't send your message. Please try again in a moment.", 500);
