<?php
/**
 * Volunteer expression-of-interest handler for 7th Swindon Scouts.
 *
 * Receives the lightweight EoI from the Volunteer journey (volunteer.js posts it
 * via fetch and expects JSON back; a no-JS browser posts here directly and gets
 * the same JSON). Validates, blocks spam and header injection, and emails the
 * interest to the volunteering inbox with the person's address as Reply-To.
 *
 * Deliverability: PHP mail() hands off to the server's local MTA. For reliable
 * delivery set $FROM to a real mailbox on 7thswindon.org.uk; switch to SMTP if
 * mail lands in spam. No DBS/references/appointment data is collected here.
 */

header('Content-Type: application/json; charset=utf-8');

$TO   = 'glv@7thswindon.org.uk';                 // volunteering enquiries
$FROM = 'website@7thswindon.org.uk';             // must be a mailbox on your domain

function respond($ok, $message, $code = 200) {
    http_response_code($code);
    echo json_encode(['ok' => $ok, 'message' => $message]);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    respond(false, 'Method not allowed.', 405);
}

// Honeypot — hidden field; bots fill it. Pretend success.
if (trim($_POST['website'] ?? '') !== '') {
    respond(true, 'Thanks! Your interest has been sent.');
}

$name     = trim($_POST['name'] ?? '');
$email    = trim($_POST['email'] ?? '');
$phone    = trim($_POST['phone'] ?? '');
$interest = trim($_POST['interest'] ?? '');
$message  = trim($_POST['message'] ?? '');

if ($name === '' || $email === '') {
    respond(false, 'Please add your name and email so we can get back to you.', 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    respond(false, 'Please enter a valid email address.', 422);
}
if (preg_match('/[\r\n]/', $name . $email . $phone . $interest)) {
    respond(false, 'Invalid input.', 422);
}
if (mb_strlen($message) > 5000) {
    respond(false, 'Your message is too long (5000 characters max).', 422);
}

$subjectLine = $interest !== '' ? "Volunteer interest: {$interest}" : 'Volunteer interest';

$body  = "New volunteer expression of interest from the 7th Swindon website\n";
$body .= "----------------------------------------------------------------\n\n";
$body .= "Name:     {$name}\n";
$body .= "Email:    {$email}\n";
if ($phone !== '')    $body .= "Phone:    {$phone}\n";
if ($interest !== '') $body .= "Interest: {$interest}\n";
$body .= "\nMessage:\n" . ($message !== '' ? $message : '(none provided)') . "\n";

$headers   = [];
$headers[] = "From: 7th Swindon Website <{$FROM}>";
$headers[] = "Reply-To: {$name} <{$email}>";
$headers[] = 'Content-Type: text/plain; charset=UTF-8';
$headers[] = 'X-Mailer: PHP/' . phpversion();

$sent = @mail($TO, $subjectLine, $body, implode("\r\n", $headers));

if ($sent) {
    respond(true, "Thanks {$name}! We've got your interest and we'll be in touch to have an informal chat.");
}

respond(false, "Sorry, we couldn't send your interest. Please email glv@7thswindon.org.uk instead.", 500);
