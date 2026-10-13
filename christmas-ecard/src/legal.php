<?php
// FR-131 / FR-132: privacy notice, cookie statement, terms, acceptable use and safeguarding statement.
// Wording to be written or approved by the Trustees.

function legal_owner(): string { return 'The 7th Swindon Scout Group (the Group)'; }

function r_privacy(): void {
    $sup = h(support_email());
    page('Privacy and cookies', '<h1>Privacy and cookies</h1>
<p>' . h(legal_owner()) . ' runs this service. Contact us at <a href="mailto:' . $sup . '">' . $sup . '</a>.</p>
<h2>What we keep and why</h2>
<ul>
<li><strong>Your account:</strong> your name, email address and a protected form of your password, so you can sign in and so we can check you before cards are sent.</li>
<li><strong>Your cards:</strong> the design, your message, your display name, and each recipient\'s name and email address, so we can send the card, show you its status and let you fix mistakes.</li>
<li><strong>Your address book (optional):</strong> the names and emails you choose to save, kept private to you.</li>
<li><strong>Donations:</strong> the amount, date and the payment reference. Card details go straight to our payment provider and never reach us.</li>
<li><strong>Stop requests:</strong> if someone asks not to get cards, we keep their email address so we do not send them any. We never use it for marketing.</li>
<li><strong>Records of what happened:</strong> a log of important actions, for security and to resolve problems.</li>
<li><strong>Gift Aid (only if you tick the box):</strong> your name, home address and declaration, so the Group can claim Gift Aid from HMRC. Kept apart from your cards, seen only by finance volunteers, and kept for as long as the rules for claims require (the Treasurer will confirm the period).</li>
<li><strong>Yearly reminder (only if you tick the box):</strong> we email you once a year when the service reopens. You can stop it in one click from that email or in My cards. We send no other marketing.</li>
</ul>
<h2>Who sees it</h2>
<p>We use an email provider to send cards and a payment provider to take donations. Group volunteers with the right role can see what they need to run the service. The people you send cards to see your message and your display name, never your account email.</p>
<h2>Why recipients get an email</h2>
<p>A person you know asked us to send them a card. It is a single email and it can be stopped from the email or the card page without an account.</p>
<h2>How long we keep it</h2>
<p>Card links work for ' . expiry_days() . ' days after sending. Greetings and recipient details are deleted ' . (int)setting('retention_days', '90') . ' days after sending. Unused drafts are removed after 7 days if not linked to an account. Finance records and stop requests are kept longer, as described in the Group\'s retention schedule.</p>
<h2>Your rights</h2>
<p>You can ask to see, correct or delete your information. You can delete your account yourself from <em>My cards</em>. For anything else email <a href="mailto:' . $sup . '">' . $sup . '</a>.</p>
<h2>Cookies</h2>
<p>We set one essential cookie so you stay signed in and your forms are protected. We do not use analytics, advertising or tracking cookies. Our payment provider may set its own cookies on its payment page.</p>');
}

function r_terms(): void {
    $sup = h(support_email());
    page('Terms and safeguarding', '<h1>Terms of use and safeguarding</h1>
<h2>Who can send</h2>
<p>You must be 18 or over to create an account and send cards. If you are younger, ask a parent or carer to send the card for you.</p>
<h2>Acceptable use</h2>
<ul>
<li>Only send cards to people you know who would welcome them.</li>
<li>Do not send anything abusive, threatening, misleading or unlawful, and do not include web links. We may remove messages and suspend accounts that break these rules.</li>
<li>Do not use the service to contact children you do not know.</li>
<li>Sending is always free. A donation is optional and goes to ' . h(legal_owner()) . '.</li>
</ul>
<h2>Safeguarding</h2>
<p>This service does not ask for or store children\'s details and is not a way to contact young people. If you have a concern about a card or about a child\'s safety, tell us straight away at <a href="mailto:' . $sup . '">' . $sup . '</a> and, if a child is at risk, contact the police or your local children\'s services.</p>
<h2>Changes</h2>
<p>If these terms change in a way that matters we will ask you to accept them again before you next send a card. Current version: ' . h(TERMS_VERSION) . '.</p>');
}

/** Re-acceptance after a material change, before the next submission. */
function r_accept_terms(): void {
    $u = need_login();
    if (post()) {
        if (empty($_POST['accept'])) { flash('Please tick the box to continue.', 'err'); redirect('/accept-terms?next=' . urlencode((string)($_POST['next'] ?? ''))); }
        accept_terms((int)$u['id']); flash('Thank you.'); redirect(safe_next($_POST['next'] ?? ''));
    }
    page('Accept the terms', '<h1>Please accept the terms</h1><p>We have updated our <a href="/terms">terms of use and safeguarding statement</a> and <a href="/privacy">privacy notice</a>. Please accept them to carry on sending.</p><form method="post" class="stack">' . csrf() . '<input type="hidden" name="next" value="' . h($_GET['next'] ?? '') . '"><label class="opt"><input type="checkbox" name="accept" value="1" required> I am 18 or over and I accept the terms</label><button class="btn">Accept and continue</button></form>');
}

/** Gate used before any submission or test send. Returns nothing; redirects away when the sender may not continue. */
function sender_gate(array $u, string $back): void {
    if ($m = sender_blocked($u)) { flash($m, 'err'); redirect($back); }
    if (!terms_ok($u)) redirect('/accept-terms?next=' . urlencode($back));
}
