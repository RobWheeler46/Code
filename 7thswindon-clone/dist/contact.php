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

respond(false, "Sorry, we couldn't send your message. Please email info@7thswindon.org.uk instead.", 500);
