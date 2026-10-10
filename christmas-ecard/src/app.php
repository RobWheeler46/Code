<?php
require __DIR__ . '/lib.php';
require __DIR__ . '/cards.php';
require __DIR__ . '/core.php';
require __DIR__ . '/contacts.php';

function post(): bool { return $_SERVER['REQUEST_METHOD'] === 'POST'; }
function field(string $k, int $max = 200): string { return mb_substr(trim((string)($_POST[$k] ?? '')), 0, $max); }
function support_email(): string { return env('SUPPORT_EMAIL', 'cards@7thswindon.org.uk'); }
function when(?int $t): string { return $t ? date('j M Y H:i', $t) : ''; }
function fe(array $e, string $k): string { return empty($e[$k]) ? '' : '<span class="fe" id="e-' . $k . '">' . h(implode(' ', (array)$e[$k])) . '</span>'; }
function fa(array $e, string $k, bool &$first): string {
    if (empty($e[$k])) return '';
    $a = ' aria-invalid="true" aria-describedby="e-' . $k . '"' . ($first ? ' data-focus' : ''); $first = false; return $a;
}

function card_view(string $cardId, string $to, string $msg, string $from, string $note = ''): string {
    $c = cards()[$cardId]; // message is escaped plain text; URLs are never linked
    return '<article class="card">' . card_art($cardId) . '<div class="inner"><h2>' . h($c['title']) . '</h2><p class="to">Dear ' . h($to) . ',</p><p class="msg">' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong>' . h($from) . '</strong></p>' . ($note ? '<p class="note">' . h($note) . '</p>' : '') . '</div></article>';
}
function gone_page(array $r, string $title, string $why): never {
    page($title, '<h1>' . h($title) . '</h1><p>' . h($why) . '</p><p>If you have a question, email <a href="mailto:' . h(support_email()) . '">' . h(support_email()) . '</a> and quote reference <strong>' . h(support_ref($r)) . '</strong>.</p><p><a class="btn" href="/">Send a card of your own</a></p>', 410);
}
function progress(): int { return (int)one('select coalesce(sum(pence-refunded),0) n from donations')['n']; }

// ---------- public
function r_home(): void {
    if (preg_match('/^[a-z0-9-]{1,30}$/', (string)($_GET['ref'] ?? ''))) $_SESSION['ref'] = $_GET['ref']; // promotion source label only, never a person
    $st = campaign_state();
    $b = '<section class="hero"><h1>Send a Scout Christmas card</h1><p>Sending is free. You can add an optional donation to support 7th Swindon Scouts.</p><p><a class="btn" href="#gallery">Choose a card</a></p></section>';
    if ($st === 'before') $b .= '<p class="flash warn">Sending opens on ' . h(date('j F Y \a\t H:i', strtotime(setting('opens')))) . '. You can prepare a card now.</p>';
    if ($st === 'closed') $b .= '<p class="flash warn">This year\'s card sending has closed. Cards already sent stay viewable until they expire.</p>';
    $t = (int)setting('target_pence');
    if (setting('show_progress') === '1' && $t) $b .= '<p class="progress">Raised so far: <strong>' . gbp(progress()) . '</strong> of ' . gbp($t) . ' target (confirmed donations, after refunds).</p>';
    $b .= '<h2 id="gallery">Pick a design</h2><div class="grid">';
    foreach (cards() as $id => $c) if ($c['on'])
        $b .= '<a class="tile" href="/compose?card=' . h($id) . '">' . card_art($id) . '<span>' . h($c['title']) . '</span></a>';
    page('Choose a card', $b . '</div>');
}

function r_help(): void {
    $e = h(support_email());
    $faq = [
        'Is it really free?' => 'Yes. Sending is always free. A donation is optional and goes to 7th Swindon Scouts. ' . setting('donation_purpose', 'Donations support 7th Swindon Scouts.'),
        'I did not get the verification email' => 'Check your spam or junk folder, then sign in and ask for it again. If the address was wrong, register again with the right one.',
        'My recipient did not get their card' => 'Open "My cards" to see each card\'s status. If it shows Failed, correct the address and send again. Ask the recipient to check spam.',
        'What do the statuses mean?' => implode(' ', array_map(fn($k, $v) => "$k: $v", array_keys(STATUS_HELP), STATUS_HELP)),
        'How long does a card last?' => 'A card link works for ' . expiry_days() . ' days after it is sent.',
        'I have a question about a donation' => "Email $e and quote the reference from your receipt.",
        'I received a card I do not want' => 'Open the card and use "Report this card", or use the "stop cards" link at the bottom of the email.',
    ];
    $b = '<h1>Help and FAQ</h1>';
    foreach ($faq as $q => $a) $b .= '<details><summary>' . h($q) . '</summary><p>' . (str_contains($a, $e) ? $a : h($a)) . '</p></details>';
    page('Help', $b . '<p>Still stuck? Email <a href="mailto:' . $e . '">' . $e . '</a>.</p>');
}

function r_register(): void {
    if (post()) {
        limit('reg', 10, 3600);
        $n = field('name', 80); $e = strtolower(field('email')); $p = (string)($_POST['password'] ?? '');
        if (!$n || !filter_var($e, FILTER_VALIDATE_EMAIL) || strlen($p) < 10) { flash('Please give your name, a valid email and a password of at least 10 characters.', 'err'); redirect('/register'); }
        if (one('select 1 from users where email=?', [$e])) { flash('That email is already registered. Try signing in.', 'err'); redirect('/login'); }
        $t = token();
        q('insert into users(name,email,pass,verify_token,created) values(?,?,?,?,?)', [$n, $e, password_hash($p, PASSWORD_DEFAULT), $t, time()]);
        $uid = (int)db()->lastInsertId(); $keep = $_SESSION['drafts'] ?? [];
        session_regenerate_id(true); $_SESSION['uid'] = $uid; $_SESSION['drafts'] = $keep; claim_drafts($uid);
        mail_send($e, 'Confirm your email for 7th Swindon Scouts Christmas Cards', "Hello $n,\n\nPlease confirm your email address. We will take you back to your saved card.\n" . base_url() . "/verify?t=$t\n");
        flash('Welcome! Your card is saved. Check your email and click the link to verify before sending.');
        redirect(($d = one("select id from sends where user_id=? and status='draft' order by id desc", [$uid])) ? '/compose?id=' . $d['id'] : '/dashboard');
    }
    page('Register', '<h1>Register</h1><p>You need an account to send, so we can verify who is sending. Your card stays saved.</p><form method="post" class="stack">' . csrf() . '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password (10+ characters)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><button class="btn">Create account</button></form><p>Already registered? <a href="/login">Sign in</a></p>');
}

function r_verify(): void {
    $u = one('select * from users where verify_token=? and verify_token<>\'\'', [(string)($_GET['t'] ?? '')]);
    if (!$u) { flash('That verification link is not valid. Sign in to request a new one.', 'err'); redirect('/dashboard'); }
    q("update users set verified=1, verify_token='' where id=?", [$u['id']]);
    flash('Email verified. You can now send your card.');
    $d = one("select id from sends where user_id=? and status='draft' order by updated desc", [$u['id']]);
    redirect($d ? '/review?id=' . $d['id'] : '/dashboard'); // back to the saved draft (need_login handles a new tab/browser)
}

function r_resend_verify(): void {
    $u = need_login(); limit('resendv', 3, 3600);
    if (!$u['verified']) {
        $t = token(); q('update users set verify_token=? where id=?', [$t, $u['id']]);
        mail_send($u['email'], 'Confirm your email', "Please confirm your email address:\n" . base_url() . "/verify?t=$t\n");
    }
    flash('Verification email sent to ' . $u['email'] . '. If that address is wrong, register again with the correct one.'); redirect('/dashboard');
}

function r_login(): void {
    if (post()) {
        limit('login', 10, 900);
        $u = one('select * from users where email=?', [strtolower(field('email'))]);
        if (!$u || !password_verify((string)($_POST['password'] ?? ''), $u['pass'])) { flash('Email or password not recognised.', 'err'); redirect('/login'); }
        $keep = $_SESSION['drafts'] ?? [];
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id']; $_SESSION['mfa'] = false; $_SESSION['drafts'] = $keep; claim_drafts((int)$u['id']);
        redirect(safe_next($_POST['next'] ?? ''));
    }
    page('Sign in', '<h1>Sign in</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="next" value="' . h($_GET['next'] ?? '') . '"><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="btn">Sign in</button></form><p><a href="/forgot">Forgotten your password?</a> &middot; <a href="/register">Register</a></p>');
}

function r_logout(): void { $_SESSION = []; session_destroy(); redirect('/'); }

function r_forgot(): void {
    if (post()) {
        limit('forgot', 5, 3600);
        if ($u = one('select * from users where email=?', [strtolower(field('email'))])) {
            $t = token();
            q('update users set reset_token=?, reset_exp=? where id=?', [$t, time() + 3600, $u['id']]);
            mail_send($u['email'], 'Reset your password', "Reset your password (valid for one hour):\n" . base_url() . "/reset?t=$t\n");
        }
        flash('If that email is registered, a reset link is on its way.'); redirect('/login');
    }
    page('Forgotten password', '<h1>Forgotten password</h1><form method="post" class="stack">' . csrf() . '<label>Email<input type="email" name="email" required></label><button class="btn">Send reset link</button></form>');
}

function r_reset(): void {
    $t = (string)($_GET['t'] ?? $_POST['t'] ?? '');
    $u = $t === '' ? null : one('select * from users where reset_token=? and reset_exp>?', [$t, time()]);
    if (!$u) { flash('That reset link has expired.', 'err'); redirect('/forgot'); }
    if (post()) {
        $p = (string)($_POST['password'] ?? '');
        if (strlen($p) < 10) { flash('Password must be at least 10 characters.', 'err'); redirect('/reset?t=' . urlencode($t)); }
        q("update users set pass=?, reset_token='', reset_exp=0 where id=?", [password_hash($p, PASSWORD_DEFAULT), $u['id']]);
        flash('Password changed. Please sign in.'); redirect('/login');
    }
    page('Reset password', '<h1>Choose a new password</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="t" value="' . h($t) . '"><label>New password<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><button class="btn">Save password</button></form>');
}

// ---------- compose, preview, review, pay
function r_compose(): void {
    $u = user();
    $s = isset($_GET['id']) ? own_send((int)$_GET['id']) : null;
    if ($s && $s['status'] !== 'draft') redirect($u ? '/send?id=' . $s['id'] : '/');
    if (post()) {
        $card = field('card', 40);
        if (!(cards()[$card]['on'] ?? false)) { flash('Please choose an available design.', 'err'); redirect('/'); }
        $act = $_POST['act'] ?? 'save';
        $from = trim((string)($_POST['sender_name'] ?? '')) ?: ($u['name'] ?? ''); $msg = trim((string)($_POST['message'] ?? '')); $text = (string)($_POST['recipients'] ?? '');
        [$rows, $rerrs] = parse_recipients($text);
        if (count($rows) > max_recipients()) $rerrs[] = 'You can send to at most ' . max_recipients() . ' people at once.';
        $errs = [];
        if (mb_strlen($from) > name_max()) $errs['sender_name'] = 'Please use ' . name_max() . ' characters or fewer.';
        if (mb_strlen($msg) > msg_max()) $errs['message'] = 'Please use ' . msg_max() . ' characters or fewer (you have ' . mb_strlen($msg) . ').';
        if (!isset($errs['message']) && $msg !== '' && ($bad = abuse_check($msg))) $errs['message'] = ucfirst($bad);
        if (!isset($errs['sender_name']) && $from !== '' && ($bad = abuse_check($from))) $errs['sender_name'] = ucfirst($bad);
        if ($rerrs) $errs['recipients'] = $rerrs;
        if ($act === 'continue') {
            if ($from === '') $errs['sender_name'] ??= 'Please say who the card is from.';
            if ($msg === '') $errs['message'] ??= 'Please write a message.';
            if (!$rows) $errs['recipients'] ??= ['Add at least one recipient.'];
        }
        if ($errs) { // nothing is saved; every field comes back as typed
            $_SESSION['old'] = ['card' => $card, 'sender_name' => (string)($_POST['sender_name'] ?? ''), 'message' => (string)($_POST['message'] ?? ''), 'recipients' => $text]; $_SESSION['errs'] = $errs;
            flash('Please check the highlighted fields. Nothing you typed has been lost.', 'warn');
            redirect('/compose?' . ($s ? 'id=' . $s['id'] : 'card=' . urlencode($card)));
        }
        if (!$s) {
            q('insert into sends(user_id,card,sender_name,message,created,updated,ref) values(?,?,?,?,?,?,?)', [$u['id'] ?? 0, $card, $from, $msg, time(), time(), $_SESSION['ref'] ?? null]); $sid = (int)db()->lastInsertId();
            if (!$u) $_SESSION['drafts'][] = $sid;
        } else { $sid = (int)$s['id']; q('update sends set card=?, sender_name=?, message=?, updated=? where id=?', [$card, $from, $msg, time(), $sid]); }
        q("delete from recipients where send_id=? and status='draft'", [$sid]);
        foreach ($rows as [$n, $e, $own]) q('insert into recipients(send_id,name,email,own_msg,token) values(?,?,?,?,?)', [$sid, $n, $e, $own, token()]);
        if ($act === 'test') {
            if (!$u || !$u['verified']) { flash('Verify your email first, then you can send yourself a test.', 'warn'); redirect("/compose?id=$sid"); }
            limit('test', 5, 3600);
            mail_send($u['email'], 'Test card preview', "Here is your private preview of the card:\n" . base_url() . "/preview?id=$sid\n(Sign in first if asked.)");
            flash('Test sent to ' . $u['email'] . '. Your draft is saved.'); redirect("/compose?id=$sid");
        }
        if ($act === 'preview') redirect("/preview?id=$sid");
        if ($act === 'pick') redirect("/contacts/pick?id=$sid");
        if ($act === 'continue') redirect("/review?id=$sid");
        flash('Draft saved at ' . date('H:i') . '.'); redirect("/compose?id=$sid");
    }
    $old = $_SESSION['old'] ?? null; $errs = $_SESSION['errs'] ?? []; unset($_SESSION['old'], $_SESSION['errs']);
    $card = $old['card'] ?? $s['card'] ?? (string)($_GET['card'] ?? '');
    if (!(cards()[$card]['on'] ?? false)) redirect('/');
    $back = !$s && !empty($_GET['back']) && preg_match('/^[a-f0-9]{48}$/', $_GET['back']) ? one('select s.sender_name from recipients r join sends s on s.id=r.send_id where r.token=?', [$_GET['back']]) : null;
    $rt = $old['recipients'] ?? ($s ? implode("\n", array_map(fn($r) => $r['name'] . ', ' . $r['email'] . ($r['own_msg'] ? ' | ' . $r['own_msg'] : ''), all('select * from recipients where send_id=? order by id', [$s['id']]))) : ($back ? $back['sender_name'] . ', ' : ''));
    $from = $old['sender_name'] ?? $s['sender_name'] ?? ($u['name'] ?? ''); $msg = $old['message'] ?? $s['message'] ?? '';
    $opts = '';
    foreach (cards() as $id => $c) if ($c['on']) $opts .= '<option value="' . h($id) . '"' . ($id === $card ? ' selected' : '') . '>' . h($c['title']) . '</option>';
    $f = true;
    $saved = $s ? '<p class="note" role="status">Draft saved at ' . date('H:i', (int)$s['updated']) . '.</p>' : '<p class="note">Not saved yet. Use Save draft to keep your work' . ($u ? '.' : ' (you will register before sending).') . '</p>';
    page('Write your card', steps(2) . '<h1>Write your card</h1>' . ($u ? '' : '<p class="note">You can prepare your card now. Before it is sent you will create a free account and verify your email, and your card will wait for you.</p>')
        . '<div class="two"><div class="card preview" aria-label="Live preview">' . card_art($card) . '<div class="inner"><p class="msg" data-preview-msg>' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong data-preview-from>' . h($from) . '</strong></p></div></div><form method="post" class="stack" data-dirty-warn>' . csrf()
        . '<label>Design<select name="card">' . $opts . '</select></label>'
        . '<label>From (your name or family name)<input name="sender_name" maxlength="' . (name_max() + 20) . '" data-max="' . name_max() . '" value="' . h($from) . '"' . fa($errs, 'sender_name', $f) . '><small class="count">Up to ' . name_max() . ' characters</small>' . fe($errs, 'sender_name') . '</label>'
        . '<label>Your message<textarea name="message" rows="5" data-max="' . msg_max() . '"' . fa($errs, 'message', $f) . '>' . h($msg) . '</textarea><small class="count">Up to ' . msg_max() . ' characters</small>' . fe($errs, 'message') . '</label>'
        . '<details><summary>Need ideas? Greeting examples</summary><p class="note">Examples only. Choosing one adds it to your message, which you can then edit.</p><ul class="starters">' . implode('', array_map(fn($t) => '<li>' . h($t) . ' <button type="button" class="link" data-starter="' . h($t) . '">Use this</button></li>', STARTERS)) . '</ul></details>'
        . ($back ? '<p class="note">Sending a card back to ' . h($back['sender_name']) . ': add their email address below.</p>' : '')
        . '<label>Recipients: one per line as <em>Name, email</em> (maximum ' . max_recipients() . '). To give one person a different message, add <em>| their message</em> after the email.<textarea name="recipients" rows="6" data-count-recipients placeholder="Gran, gran@example.com&#10;Uncle Bob, bob@example.com | Hope the knee is better!"' . fa($errs, 'recipients', $f) . '>' . h($rt) . '</textarea><small class="count" data-recipient-count>Up to ' . max_recipients() . ' recipients</small>' . fe($errs, 'recipients') . '</label>'
        . ($s && $u && $u['verified'] ? '<p><button class="btn alt" name="act" value="pick">Choose from address book</button></p>' : ($u ? '<p class="note">Save your draft and verify your email to choose from your address book.</p>' : ''))
        . $saved . '<div class="row"><button class="btn" name="act" value="continue">Continue</button><button class="btn alt" name="act" value="preview">Preview</button><button class="btn alt" name="act" value="save">Save draft</button><button class="btn alt" name="act" value="test">Email me a test</button></div></form></div>');
}

function r_preview(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $r = one('select * from recipients where send_id=? order by id limit 1', [$s['id']]);
    page('Preview', '<h1>Preview</h1><p>This is how your card will look' . ($r ? ' for ' . h($r['name']) : '') . '.</p>' . card_view($s['card'], $r['name'] ?? 'Friend', $r ? resolved_msg($r, $s) : $s['message'], $s['sender_name'], card_note($s)) . '<p><a class="btn" href="/compose?id=' . $s['id'] . '">Back to editing</a></p>');
}

/** Resolves a pending Stripe attempt. Returns 'paid', 'expired' or 'pending'. */
function pay_check(array $s): string {
    if (!env('STRIPE_SECRET') || !$s['stripe_session']) return 'pending';
    $r = stripe('GET', '/checkout/sessions/' . $s['stripe_session']);
    if (($r['payment_status'] ?? '') === 'paid') { confirm_payment((int)$s['id'], $s['stripe_session'], (int)$r['amount_total'], env('STRIPE_ACCOUNT')); return 'paid'; }
    return ($r['status'] ?? '') === 'expired' ? 'expired' : 'pending';
}
function back_to_draft(int $id): void { q("update sends set status='draft', stripe_session=null, updated=? where id=? and status='awaiting_payment'", [time(), $id]); }

/** Safely ends a pending attempt. 'cancelled' only when we know no charge can complete; 'unknown' keeps everything locked. */
function pay_cancel(array $s): string {
    if (!env('STRIPE_SECRET') || !$s['stripe_session']) { back_to_draft((int)$s['id']); return 'cancelled'; }
    $r = stripe('POST', '/checkout/sessions/' . $s['stripe_session'] . '/expire');
    $now = ($r['status'] ?? '') === 'expired' ? 'expired' : pay_check($s);
    if ($now === 'expired') { back_to_draft((int)$s['id']); return 'cancelled'; }
    return $now === 'paid' ? 'paid' : 'unknown';
}

function steps(int $n): string {
    $l = ['Choose a card', 'Message and recipients', 'Review and send'];
    return '<ol class="steps" aria-label="Progress">' . implode('', array_map(fn($t, $i) => '<li' . ($i + 1 === $n ? ' aria-current="step"' : '') . '>' . ($i + 1) . '. ' . h($t) . '</li>', $l, array_keys($l))) . '</ol>';
}

/** Recovery states S08/S09: cancelled or failed checkout vs unknown (pending). */
function r_pay_cancelled(): void { // Stripe cancel_url lands here
    $s = own_send((int)($_GET['id'] ?? 0));
    if ($s['status'] === 'awaiting_payment') {
        $r = pay_cancel($s);
        redirect($r === 'paid' ? '/send?id=' . $s['id'] . '&done=1' : '/review?id=' . $s['id'] . ($r === 'cancelled' ? '&recover=cancelled' : ''));
    }
    redirect('/review?id=' . $s['id']);
}

function r_review(): void {
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (!in_array($s['status'], ['draft', 'awaiting_payment'])) redirect('/send?id=' . $s['id']);
    $id = (int)$s['id'];
    $rs = all('select * from recipients where send_id=? order by id', [$id]);
    $pending = $s['status'] === 'awaiting_payment';
    if (post()) {
        $do = $_POST['do'] ?? '';
        if ($do === 'check' && $pending) {
            $r = pay_check($s);
            if ($r === 'expired') { back_to_draft($id); redirect("/review?id=$id&recover=failed"); }
            if ($r === 'paid') { flash('Payment confirmed.'); redirect("/send?id=$id&done=1"); }
            flash('Your payment is still being confirmed. Please do not pay again yet.', 'warn'); redirect("/review?id=$id");
        }
        if ($do === 'cancel_pay' && $pending) {
            $r = pay_cancel($s);
            if ($r === 'paid') { flash('Your payment had in fact gone through.'); redirect("/send?id=$id&done=1"); }
            if ($r === 'unknown') { flash('We could not safely cancel that payment yet, so nothing has changed. Please check again in a few minutes.', 'warn'); redirect("/review?id=$id"); }
            redirect("/review?id=$id&recover=cancelled");
        }
        if (!$u['verified']) { flash('Please verify your email before sending.', 'warn'); redirect("/review?id=$id"); }
        if (campaign_state() !== 'open') { flash('Card sending is not open right now, so your card cannot be submitted. Your draft is saved.', 'warn'); redirect("/review?id=$id"); }
        if (!$rs || count($rs) > max_recipients() || $s['message'] === '') { flash('Your card needs a message and 1 to ' . max_recipients() . ' recipients.', 'err'); redirect("/compose?id=$id"); }
        if ($pending) { flash('You have a payment waiting. Check its status or cancel it first. Cards are not sent until that is resolved.', 'warn'); redirect("/review?id=$id"); }
        if (repeats_for($s) && empty($_POST['repeat_ok'])) { flash('Some recipients already have a card from you. Tick the box to send again on purpose.', 'err'); redirect("/review?id=$id"); }
        if ($do === 'free') { queue_send($id); flash('Cards are queued for sending.'); redirect("/send?id=$id&done=1"); }
        $pick = (string)($_POST['amount'] ?? '');
        $pence = $pick === 'custom' ? (int)round((float)($_POST['custom'] ?? 0) * 100) : (int)$pick;
        if ($pence < 100 || $pence > 50000) { flash('Choose a donation amount between £1 and £500, or choose "Send cards for free".', 'err'); redirect("/review?id=$id"); }
        // one submission intent: only the request that wins this update may start a checkout
        if (!q("update sends set donation=?, donation_note=?, status='awaiting_payment', updated=? where id=? and status='draft'", [$pence, empty($_POST['donation_note']) ? 0 : 1, time(), $id])->rowCount()) redirect("/review?id=$id");
        if (!env('STRIPE_SECRET')) redirect('/dev/pay?id=' . $id);
        $r = stripe('POST', '/checkout/sessions', [
            'mode' => 'payment', 'client_reference_id' => $id, 'metadata' => ['send_id' => $id],
            'success_url' => base_url() . '/return?id=' . $id . '&cs={CHECKOUT_SESSION_ID}', 'cancel_url' => base_url() . '/pay-cancelled?id=' . $id,
            'line_items' => [['quantity' => 1, 'price_data' => ['currency' => 'gbp', 'unit_amount' => $pence, 'product_data' => ['name' => 'Donation to 7th Swindon Scouts']]]],
        ], "ecard-$id-$pence-" . intdiv(time(), 300));
        if (empty($r['url'])) { back_to_draft($id); redirect("/review?id=$id&recover=failed"); }
        q('update sends set stripe_session=? where id=?', [$r['id'], $id]);
        redirect($r['url']);
    }
    $list = implode('', array_map(fn($r) => '<li><strong>' . h($r['name']) . '</strong> (' . h($r['email']) . ')' . (trim((string)$r['own_msg']) !== '' ? ' <span class="pill">Personal message</span>' : '') . ' <form method="post" action="/contacts/save" class="inline">' . csrf() . '<input type="hidden" name="rid" value="' . $r['id'] . '"><input type="hidden" name="back" value="/review?id=' . $r['send_id'] . '"><button class="link">Save to address book</button></form><blockquote>' . nl2br(h(resolved_msg($r, $s))) . '</blockquote></li>', $rs));
    $state = campaign_state();
    $b = steps(3) . '<h1>Review and send</h1>';
    if (!$u['verified']) $b .= '<p class="flash warn">Verify your email (see the link we sent) before you can send. <form method="post" action="/resend-verification" class="inline">' . csrf() . '<button class="link">Send it again</button></form></p>';
    if ($state !== 'open') $b .= '<p class="flash warn">Card sending is ' . ($state === 'before' ? 'not open yet' : 'closed') . ', so you cannot submit this card. Your draft is saved.</p>';
    if (setting('paused') === '1') $b .= '<p class="note">Sending is briefly paused. Cards you submit will be queued and go out when it resumes.</p>';
    $b .= card_view($s['card'], $rs[0]['name'] ?? 'Friend', $rs ? resolved_msg($rs[0], $s) : $s['message'], $s['sender_name']) . '<h2>Sending to ' . count($rs) . ' ' . (count($rs) === 1 ? 'person' : 'people') . '</h2><p class="note">From: ' . h($s['sender_name']) . '. Each person sees the greeting shown here for them.</p><ul class="rlist">' . $list . '</ul><p><a href="/compose?id=' . $id . '">Edit card, message or recipients</a></p>';
    $rep = repeats_for($s);
    $form = '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $id . '">';
    if ($rep) $form .= '<p class="flash warn">You have already sent a card to: ' . h(implode(', ', $rep)) . '.</p><label class="opt"><input type="checkbox" name="repeat_ok" value="1"> Send to them again on purpose</label>';
    if ($pending) { // S09: outcome unknown, so no second charge and no free bypass until this attempt is resolved
        $form .= '<p class="flash warn" role="status"><strong>Your donation of ' . gbp((int)$s['donation']) . ' is waiting for payment confirmation.</strong> We do not yet know whether it went through, so your cards are not sent and you cannot pay again or switch to free until this is resolved.</p>'
            . (env('STRIPE_SECRET') ? '' : '<p><a href="/dev/pay?id=' . $id . '">Go to the test payment page</a></p>')
            . '<div class="row"><button class="btn" name="do" value="check">Check payment status</button><button class="btn alt" name="do" value="cancel_pay">Cancel this payment attempt</button></div><p class="note">Need help? <a href="/help">Help and FAQ</a> or email ' . h(support_email()) . ' with reference C-' . $id . '.</p>';
    } else {
        $rec = $_GET['recover'] ?? '';
        if ($rec === 'cancelled' || $rec === 'failed') $form .= '<p class="flash warn" role="status"><strong>' . ($rec === 'cancelled' ? 'Payment was cancelled.' : 'Payment did not go through.') . '</strong> Nothing was charged and your card and recipients are safe. You can try again, or choose to send for free. Cards are only sent when you press a send button below.</p>';
        $form .= '<fieldset><legend>Optional donation to 7th Swindon Scouts</legend><p>' . h(setting('donation_purpose', 'Donations support 7th Swindon Scouts.')) . ' One donation covers all ' . count($rs) . ' of your cards. Sending is free either way.</p>';
        foreach ([200, 500, 1000] as $a) $form .= '<label class="opt"><input type="radio" name="amount" value="' . $a . '"> ' . gbp($a) . '</label>';
        $form .= '<label class="opt"><input type="radio" name="amount" value="custom"> Other amount (£) <input type="number" name="custom" min="1" max="500" step="0.01" aria-label="Custom amount in pounds"></label>'
            . '<label class="opt"><input type="checkbox" name="donation_note" value="1"> Add a line to the cards saying they came with a donation to 7th Swindon Scouts (no amount is shown; only after payment is confirmed)</label></fieldset>'
            . '<div class="row"><button class="btn" name="do" value="donate">Donate and send cards</button><button class="btn" name="do" value="free">Send cards for free</button></div>';
    }
    page('Review and send', $b . $form . '</form>');
}

function r_return(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $cs = (string)($_GET['cs'] ?? '');
    if (preg_match('/^cs_[A-Za-z0-9_]+$/', $cs)) {
        $r = stripe('GET', "/checkout/sessions/$cs");
        if (($r['payment_status'] ?? '') === 'paid' && (string)($r['client_reference_id'] ?? '') === (string)$s['id'])
            confirm_payment((int)$s['id'], $cs, (int)$r['amount_total'], env('STRIPE_ACCOUNT'));
    }
    flash('Thank you. If your payment is confirmed your cards are queued; otherwise we will keep checking.');
    redirect(one('select status from sends where id=?', [$s['id']])['status'] === 'awaiting_payment' ? '/review?id=' . $s['id'] : '/send?id=' . $s['id'] . '&done=1');
}

function r_dev_pay(): void { // local stand-in for Stripe when STRIPE_SECRET is unset
    if (env('STRIPE_SECRET')) fail(404, 'Not found.');
    $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (post()) {
        $r = $_POST['result'] ?? '';
        if ($r === 'pay') confirm_payment((int)$s['id'], 'dev_' . token(), (int)$s['donation']);
        elseif ($r === 'fail') back_to_draft((int)$s['id']);
        redirect($r === 'pay' ? '/send?id=' . $s['id'] . '&done=1' : '/review?id=' . $s['id'] . ($r === 'fail' ? '&recover=failed' : '')); // 'later' leaves it pending
    }
    page('Test payment', '<h1>Test payment ' . gbp((int)$s['donation']) . '</h1><p>Stripe is not configured, so this simulates the payment page.</p><form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><button class="btn" name="result" value="pay">Simulate successful payment</button><button class="btn alt" name="result" value="fail">Simulate failure</button><button class="btn alt" name="result" value="later">Close the window (stays pending)</button></form>');
}

function r_stripe_hook(): void {
    $body = (string)file_get_contents('php://input');
    if (!env('STRIPE_WEBHOOK_SECRET') || !stripe_sig_ok($body, $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '')) { http_response_code(400); exit('bad signature'); }
    $e = json_decode($body, true); $o = $e['data']['object'] ?? [];
    if (($e['type'] ?? '') === 'checkout.session.completed' && ($o['payment_status'] ?? '') === 'paid')
        confirm_payment((int)($o['metadata']['send_id'] ?? 0), $o['id'], (int)$o['amount_total'], env('STRIPE_ACCOUNT'));
    exit('ok');
}

function r_postmark_hook(): void {
    if (!env('POSTMARK_HOOK_KEY') || !hash_equals(env('POSTMARK_HOOK_KEY'), (string)($_GET['k'] ?? ''))) { http_response_code(403); exit; }
    $e = json_decode((string)file_get_contents('php://input'), true) ?: [];
    $rid = (int)($e['Metadata']['rid'] ?? 0);
    match ($e['RecordType'] ?? '') {
        'Delivery' => q('update recipients set delivered_at=? where id=? and delivered_at is null', [time(), $rid]),
        'Bounce'   => q("update recipients set status='bounced', error=? where id=?", [substr((string)($e['Description'] ?? 'Bounced'), 0, 200), $rid]),
        'SpamComplaint' => q("update recipients set status='bounced', error='Spam complaint' where id=?", [$rid]),
        'Open'     => q('update recipients set opened_at=? where id=? and opened_at is null', [time(), $rid]), // email signal only, never "viewed"
        default    => null,
    };
    exit('ok');
}

// ---------- sender dashboard
function r_dashboard(): void {
    $u = need_login();
    $b = '<h1>My cards</h1>' . ($u['verified'] ? '' : '<p class="flash warn">Please verify your email: click the link we sent to ' . h($u['email']) . '. You need this before sending. <form method="post" action="/resend-verification" class="inline">' . csrf() . '<button class="link">Send it again</button></form><details><summary>Wrong email address?</summary><form method="post" action="/change-email" class="row">' . csrf() . '<label>Correct email<input type="email" name="email" required></label><button class="btn alt">Change and resend</button></form></details></p>') . '<p><a class="btn" href="/">Create a new card</a></p>'
        . '<form method="post" action="/prefs" class="row">' . csrf() . '<label>Optional status emails<select name="notify">' . implode('', array_map(fn($k, $l) => '<option value="' . $k . '"' . ($u['notify'] === $k ? ' selected' : '') . '>' . $l . '</option>', ['off', 'viewed', 'summary'], ['Off (default)', 'Email me when a card is opened', 'One daily summary'])) . '</select></label><button class="btn alt">Save</button></form>';
    $rows = '';
    foreach (all('select * from sends where user_id=? order by id desc', [$u['id']]) as $s) {
        $c = [];
        foreach (all('select * from recipients where send_id=?', [$s['id']]) as $r) { $k = rstatus($r); $c[$k] = ($c[$k] ?? 0) + 1; }
        $sum = implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($c), $c));
        $link = $s['status'] === 'draft' ? "/compose?id={$s['id']}" : ($s['status'] === 'awaiting_payment' ? "/review?id={$s['id']}" : "/send?id={$s['id']}");
        $rows .= '<tr><td>' . date('j M Y', (int)$s['created']) . '</td><td><a href="' . $link . '">' . h(cards()[$s['card']]['title'] ?? $s['card']) . '</a>' . ($s['status'] === 'draft' ? ' <form method="post" action="/discard" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><button class="link">Discard draft</button></form>' : ' <a href="/copy?id=' . $s['id'] . '">Copy as new draft</a>') . '</td><td>' . h(ucfirst(str_replace('_', ' ', $s['status']))) . '</td><td>' . h($sum) . '</td><td>' . h(donation_state($s) === 'No donation' ? '' : donation_state($s)) . '</td></tr>';
    }
    $b .= $rows ? '<table><caption class="sr">Your cards</caption><tr><th>Date</th><th>Card</th><th>State</th><th>Recipients</th><th>Donation</th></tr>' . $rows . '</table>' : '<p>No cards yet.</p>';
    $d = all('select * from donations where user_id=? order by id desc', [$u['id']]);
    if ($d) $b .= '<h2>Donation history</h2><table><tr><th>Date</th><th>Amount</th><th>Reference</th></tr>' . implode('', array_map(fn($x) => '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td></tr>', $d)) . '</table>';
    page('My cards', $b);
}

function r_send(): void {
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    $sid = (int)$s['id'];
    if (post()) {
        $do = $_POST['do'] ?? ''; $rid = (int)($_POST['rid'] ?? 0);
        if ($do === 'cancel' || $do === 'cancel_all') {
            $ids = $do === 'cancel' ? [$rid] : array_column(all("select id from recipients where send_id=? and status='queued'", [$sid]), 'id');
            $ok = 0; $late = 0;
            foreach ($ids as $i) if (one('select 1 from recipients where id=? and send_id=?', [$i, $sid])) cancel_recipient((int)$i) ? $ok++ : $late++;
            if ($ok) audit((int)$u['id'], 'cancel', "send $sid: $ok cancelled");
            flash($ok . ' cancelled.' . ($late ? " $late had already started sending and could not be stopped." : '') . ' Cancelling does not refund a donation.', $late ? 'warn' : 'ok');
        } else { // correct a failed address: a new, audited delivery attempt (failed/bounced rows only, so no duplicates)
            $r = one('select * from recipients where id=? and send_id=?', [$rid, $sid]);
            $e = strtolower(field('email'));
            if ($r && in_array($r['status'], ['failed', 'bounced']) && filter_var($e, FILTER_VALIDATE_EMAIL)) {
                q("update recipients set email=?, status='queued', tries=0, error=null, delivered_at=null where id=? and status in ('failed','bounced')", [$e, $r['id']]);
                audit((int)$u['id'], 'address_correction', "recipient {$r['id']}"); process_queue(); flash('Address updated and the card is queued again.');
            } else flash('Could not update that address.', 'err');
        }
        redirect("/send?id=$sid");
    }
    $rows = ''; $queued = 0;
    foreach (all('select * from recipients where send_id=? order by id', [$sid]) as $r) {
        $st = rstatus($r); if ($r['status'] === 'queued') $queued++;
        $act = '';
        if ($st === 'Failed') $act = '<form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><input type="hidden" name="rid" value="' . $r['id'] . '"><input type="email" name="email" value="' . h($r['email']) . '" required aria-label="Corrected email for ' . h($r['name']) . '"><button class="btn alt">Fix and resend</button></form><small>' . h($r['error']) . '</small>';
        elseif ($r['status'] === 'queued') $act = '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><input type="hidden" name="rid" value="' . $r['id'] . '"><button class="link" name="do" value="cancel">Cancel</button></form>';
        elseif ($st === 'Cancelled') $act = '<small>' . h($r['error']) . '</small>';
        $rows .= '<tr><td>' . h($r['name']) . '</td><td>' . h($r['email']) . '</td><td><span class="pill ' . strtolower(str_replace(' ', '-', $st)) . '">' . $st . '</span></td><td>' . $act . '</td></tr>';
    }
    $legend = '<details><summary>What do the statuses mean?</summary><ul>' . implode('', array_map(fn($k, $v) => '<li><strong>' . h($k) . ':</strong> ' . h($v) . '</li>', array_keys(STATUS_HELP), STATUS_HELP)) . '</ul></details>';
    $done = empty($_GET['done']) ? '' : '<section class="flash" role="status"><h2>Your cards are queued for sending</h2><p>Queued means accepted and waiting to go out. It does not mean delivered. Each status updates below as cards go out.</p><p><strong>Donation:</strong> ' . h(donation_state($s)) . ($s['donation'] && !one('select 1 from donations where send_id=?', [$s['id']]) ? ' (we will show it here once payment is confirmed)' : '') . '</p><p><a href="/dashboard">Go to my cards</a></p></section>';
    page('Card status', $done . '<h1>' . h(cards()[$s['card']]['title']) . '</h1><p><strong>Cards:</strong> ' . h(ucfirst(str_replace('_', ' ', $s['status']))) . '. <strong>Donation:</strong> ' . h(donation_state($s)) . '.</p>'
        . ($queued ? '<form method="post">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><button class="btn alt" name="do" value="cancel_all">Cancel unsent cards</button></form>' : '')
        . '<table><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr>' . $rows . '</table>' . $legend . '<p class="note">"Viewed" means the recipient opened the card themselves. Cancelled and withdrawn cards do not refund a donation.</p>');
}

// ---------- recipient
function recipient_by_token(string $t): array {
    $r = preg_match('/^[a-f0-9]{48}$/', $t) ? one("select * from recipients where token=? and status in ('sent','sending','queued','failed','bounced')", [$t]) : null;
    return $r ?: fail(404, 'We could not find that card. Please check the link in your email, or visit the Help page.');
}

function r_card(string $t, string $act = ''): void {
    $r = recipient_by_token($t);
    $s = one('select * from sends where id=?', [$r['send_id']]);
    if ($r['withdrawn']) gone_page($r, 'This card has been withdrawn', 'The card is no longer available.');
    if ($r['sent_at'] && time() > expiry_ts($r)) gone_page($r, 'This card has expired', 'Cards stay viewable for ' . expiry_days() . ' days after they are sent.');
    if (post() && $act === 'open') { if (q('update recipients set viewed_at=? where id=? and viewed_at is null', [time(), $r['id']])->rowCount()) notify_view($r, $s); redirect("/c/$t?o=1"); } // human click, not a link scanner
    if (post() && $act === 'report') {
        limit('report', 5, 3600);
        q('insert into reports(recipient_id,reason,created) values(?,?,?)', [$r['id'], field('reason', 500), time()]);
        flash('Thank you. We have received your report and will look into it.'); redirect("/c/$t");
    }
    $stop = '<p class="center"><a href="/optout/' . h($t) . '">Stop cards from ' . h($s['sender_name']) . ' or from this service</a></p>';
    if (empty($_GET['o'])) {
        page('A card for you', '<section class="envelope-wrap"><div class="envelope" aria-hidden="true"><div class="flap"></div><div class="to">To ' . h($r['name']) . '</div></div><h1>A Christmas card for ' . h($r['name']) . '</h1><p>From ' . h($s['sender_name']) . '</p><form method="post" action="/c/' . h($t) . '/open">' . csrf() . '<button class="btn">Open your card</button></form></section>' . $stop);
    }
    page('Your Christmas card', '<div class="reveal">' . card_view($s['card'], $r['name'], resolved_msg($r, $s), $s['sender_name'], card_note($s)) . '</div><p class="center"><a class="btn" href="/compose?card=' . h($s['card']) . '&amp;back=' . h($t) . '">Send a card back to ' . h($s['sender_name']) . '</a> <a class="btn alt" href="/">Create your own card</a></p><p class="center"><a href="/c/' . h($t) . '">Replay the envelope</a></p>'
        . '<details class="center"><summary>Report this card</summary><form method="post" action="/c/' . h($t) . '/report" class="stack">' . csrf() . '<label>What is wrong?<textarea name="reason" maxlength="500" required></textarea></label><button class="btn alt">Send report</button></form></details>' . $stop);
}

/** Opt-out needs a deliberate POST, so link scanners that only GET cannot opt anyone out. Same reply whatever the prior state. */
function r_optout(string $t): void {
    $r = recipient_by_token($t); $s = one('select * from sends where id=?', [$r['send_id']]);
    if (post()) {
        optout($r['email'], ($_POST['scope'] ?? '') === 'all' ? 0 : (int)$s['user_id']);
        page('Preference saved', '<h1>Thank you</h1><p>We will not send you more cards' . (($_POST['scope'] ?? '') === 'all' ? ' from this service' : ' from ' . h($s['sender_name'])) . '. This applies to cards not yet sent as well.</p>');
    }
    page('Stop cards', '<h1>Stop receiving cards</h1><form method="post" class="stack">' . csrf() . '<fieldset><legend>Choose what to stop</legend><label class="opt"><input type="radio" name="scope" value="sender" checked> Cards from ' . h($s['sender_name']) . '</label><label class="opt"><input type="radio" name="scope" value="all"> All cards from 7th Swindon Scouts Christmas Cards</label></fieldset><button class="btn">Confirm</button></form>');
}

// ---------- admin
function r_mfa(): void {
    $u = need_login();
    if (!$u['is_admin']) fail(403, 'Not allowed.');
    $new = empty($u['totp_secret']);
    $sec = $u['totp_secret'] ?: ($_SESSION['pending_totp'] ??= b32e(random_bytes(10)));
    if (post()) {
        limit('mfa', 8, 900);
        if (totp_ok($sec, field('code', 10))) {
            if ($new) { q('update users set totp_secret=? where id=?', [$sec, $u['id']]); unset($_SESSION['pending_totp']); audit((int)$u['id'], 'mfa_enrolled'); }
            $_SESSION['mfa'] = true; redirect('/admin');
        }
        flash('That code was not right.', 'err'); redirect('/mfa');
    }
    $enrol = $new ? '<p>First time: add this key to an authenticator app (time based, 6 digits):</p><p><code>' . h($sec) . '</code></p>' : '';
    page('Two-step sign in', '<h1>Administrator two-step sign in</h1>' . $enrol . '<form method="post" class="stack">' . csrf() . '<label>6-digit code<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button class="btn">Continue</button></form>');
}

function adminbtn(string $do, int $id, string $label): string {
    return '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="' . $do . '"><input type="hidden" name="id" value="' . $id . '"><button class="link">' . h($label) . '</button></form> ';
}
function set_int(string $k, string $v, int $min, int $max): void { if (ctype_digit($v) && (int)$v >= $min && (int)$v <= $max) set_setting($k, $v); }

/** FR-080: high-impact changes name the records they affect and need a second, deliberate click. */
function confirm_page(string $a, int $i): never {
    $rep = in_array($a, ['block', 'withdraw']) ? one('select r.id, x.email from reports r join recipients x on x.id=r.recipient_id where r.id=?', [$i]) : null;
    $what = match ($a) {
        'pause' => setting('paused') === '1' ? 'Resume all card sending. Queued cards will start going out.' : 'Pause all card dispatch. Nothing new will be sent until you resume. Queued cards stay queued.',
        'block' => 'Stop every future card to ' . ($rep['email'] ?? 'this recipient') . ' from every sender (report #' . $i . '). Cards already sent stay viewable.',
        'withdraw' => 'Withdraw the card sent to ' . ($rep['email'] ?? 'this recipient') . ' (report #' . $i . '). Their link will stop working. This does not refund any donation.',
        'roles' => 'Change roles for ' . strtolower(trim((string)($_POST['email'] ?? ''))) . ' to: ' . (implode(', ', array_map(fn($r) => ROLES[$r] ?? $r, (array)($_POST['roles'] ?? []))) ?: 'no roles (removes admin access)') . '.',
        default => 'Confirm this change.',
    };
    $hid = '';
    foreach ($_POST as $k => $v) if ($k !== '_c' && $k !== 'confirmed') foreach ((array)$v as $x) $hid .= '<input type="hidden" name="' . h($k) . (is_array($v) ? '[]' : '') . '" value="' . h((string)$x) . '">';
    page('Confirm change', '<h1>Please confirm</h1><p>' . h($what) . '</p><p>This will be recorded in the audit trail.</p><form method="post" class="row">' . csrf() . $hid . '<input type="hidden" name="confirmed" value="1"><button class="btn">Yes, do it</button><a class="btn alt" href="/admin">Cancel</a></form>');
}

function admin_post(array $u): void {
    $a = (string)($_POST['do'] ?? ''); $i = (int)($_POST['id'] ?? 0); $uid = (int)$u['id'];
    $need = ['pause' => 'delivery', 'resend' => 'delivery', 'money' => 'finance', 'target' => 'campaign', 'design' => 'campaign', 'settings' => 'campaign',
             'dismiss' => 'complaints', 'block' => 'complaints', 'withdraw' => 'complaints', 'roles' => 'rolesadmin'];
    if (!isset($need[$a])) fail(400, 'Unknown action.');
    if (!can($need[$a]) && !($a === 'pause' && can('campaign'))) fail(403, 'You do not have permission for that.');
    if (in_array($a, ['pause', 'block', 'withdraw', 'roles']) && empty($_POST['confirmed'])) confirm_page($a, $i);
    switch ($a) {
        case 'pause': set_setting('paused', setting('paused') === '1' ? '0' : '1'); audit($uid, 'pause_toggle', setting('paused')); break;
        case 'resend':
            q("update recipients set status='queued', tries=0, error=null where id=? and status in ('failed','bounced','sending')", [$i]);
            audit($uid, 'resend', "recipient $i"); process_queue(); break;
        case 'money': q('update donations set fee=?, refunded=? where id=?', [(int)round((float)$_POST['fee'] * 100), (int)round((float)$_POST['refunded'] * 100), $i]); audit($uid, 'reconcile', "donation $i fee {$_POST['fee']} refunded {$_POST['refunded']}"); break;
        case 'target': set_setting('target_pence', (string)(int)round((float)($_POST['target'] ?? 0) * 100)); audit($uid, 'target', field('target')); break;
        case 'design':
            if (isset(cards()[$_POST['card'] ?? ''])) { set_setting('off_' . $_POST['card'], cards()[$_POST['card']]['on'] ? '1' : '0'); audit($uid, 'design_toggle', $_POST['card']); } break;
        case 'settings':
            set_int('msg_max', field('msg_max', 5), 50, 2000); set_int('name_max', field('name_max', 3), 10, 100); set_int('expiry_days', field('expiry_days', 4), 1, 3650); set_int('retention_days', field('retention_days', 4), 1, 3650);
            foreach (['opens', 'closes'] as $k) { $v = field($k, 20); if ($v === '' || strtotime($v)) set_setting($k, $v); }
            set_setting('closure_queue', ($_POST['closure_queue'] ?? '') === 'hold' ? 'hold' : 'send');
            set_setting('show_progress', empty($_POST['show_progress']) ? '0' : '1');
            set_setting('abuse_terms', field('abuse_terms', 500)); set_setting('allow_urls', empty($_POST['allow_urls']) ? '0' : '1');
            set_setting('donation_purpose', field('donation_purpose', 300)); set_setting('campaign', field('campaign', 60) ?: 'Christmas 2026');
            audit($uid, 'campaign_settings', json_encode(array_intersect_key($_POST, array_flip(['msg_max', 'name_max', 'expiry_days', 'retention_days', 'opens', 'closes', 'closure_queue', 'show_progress'])))); break;
        case 'dismiss': case 'block': case 'withdraw':
            $rep = one('select r.*, x.email, x.send_id from reports r join recipients x on x.id=r.recipient_id where r.id=?', [$i]);
            if ($rep) {
                if ($a === 'block') optout($rep['email'], 0);
                if ($a === 'withdraw') q('update recipients set withdrawn=1 where id=?', [$rep['recipient_id']]);
                q("update reports set status='closed', decision=? where id=?", [['dismiss' => 'Dismissed', 'block' => 'Recipient blocked from further cards', 'withdraw' => 'Card withdrawn'][$a], $i]);
                audit($uid, "report_$a", "report $i");
            } break;
        case 'roles':
            $e = strtolower(field('email')); $t = one('select * from users where email=?', [$e]);
            if (!$t) { flash('No registered user with that email.', 'err'); redirect('/admin'); }
            $new = array_values(array_intersect(array_keys(ROLES), (array)($_POST['roles'] ?? [])));
            $others = (int)one("select count(*) c from users where id<>? and is_admin=1 and (',' || roles || ',') like '%,rolesadmin,%'", [$t['id']])['c'];
            if (!in_array('rolesadmin', $new) && !$others) { flash('There must always be at least one role administrator.', 'err'); redirect('/admin'); }
            q('update users set roles=?, is_admin=? where id=?', [implode(',', $new), $new ? 1 : 0, $t['id']]);
            audit($uid, 'role_change', "$e: [{$t['roles']}] -> [" . implode(',', $new) . ']'); break;
    }
    flash('Saved.'); redirect('/admin');
}

function r_admin(): void {
    $u = need_admin();
    if (post()) admin_post($u);
    $b = '<h1>Administration</h1><p class="note">Your roles: ' . h(implode(', ', array_map(fn($r) => ROLES[$r] ?? $r, array_filter(explode(',', $u['roles'])))) ?: 'none') . '</p>';
    $rc = []; foreach (all('select * from recipients') as $r) { $k = rstatus($r); $rc[$k] = ($rc[$k] ?? 0) + 1; }
    $b .= '<h2>Card activity</h2><p>' . h(implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($rc), $rc)) ?: 'Nothing sent yet') . '</p><ul>';
    foreach (all("select card, count(*) n from sends where status not in ('draft','awaiting_payment') group by card order by n desc") as $x) $b .= '<li>' . h(cards()[$x['card']]['title'] ?? $x['card']) . ': ' . $x['n'] . '</li>';
    $b .= '</ul>';
    if (can('finance') || can('campaign')) {
        $d = one('select count(*) n, coalesce(sum(pence),0) gross, coalesce(sum(fee),0) fee, coalesce(sum(refunded),0) ref from donations'); $tgt = (int)setting('target_pence');
        $b .= '<h2>Fundraising</h2><p>Confirmed gross donations: <strong>' . gbp((int)$d['gross']) . '</strong> from ' . $d['n'] . ' donations (average ' . gbp($d['n'] ? intdiv((int)$d['gross'], (int)$d['n']) : 0) . '). Fees ' . gbp((int)$d['fee']) . ', refunds ' . gbp((int)$d['ref']) . ', net after both ' . gbp((int)($d['gross'] - $d['fee'] - $d['ref'])) . ($tgt ? '. Target ' . gbp($tgt) . ' (public progress counts gross minus refunds)' : '') . '.</p>';
    }
    if (can('delivery')) {
        $old = one("select min(id) i, min(queued_at) q from sends where status='queued'"); $hb = (int)setting('last_queue');
        $b .= '<h2>Email operations</h2><p>Queued: ' . ($rc['Queued'] ?? 0) . '. Last cron run: ' . ($hb ? when($hb) . (time() - $hb > 900 ? ' <strong>(overdue: check cron)</strong>' : '') : '<strong>never</strong>') . '. Sending is <strong>' . (setting('paused') === '1' ? 'paused' : 'running') . '</strong> '
            . '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="pause"><button class="link">' . (setting('paused') === '1' ? 'Resume' : 'Pause') . '</button></form>. Cron: <code>php src/cli.php queue</code> every 5 minutes.</p><table><tr><th>Recipient</th><th>Status</th><th>Error</th><th></th></tr>';
        foreach (all("select * from recipients where status in ('failed','bounced','sending') order by id desc limit 50") as $r)
            $b .= '<tr><td>' . h($r['email']) . '</td><td>' . rstatus($r) . '</td><td>' . h($r['error']) . '</td><td>' . adminbtn('resend', (int)$r['id'], 'Resend') . '</td></tr>';
        $b .= '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No delivery exceptions. Nothing needs attention.</p>' : '');
    }
    if (can('finance')) {
        $b .= '<h2>Payments</h2><p><a href="/admin/export">Export finance CSV</a></p><table><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Fee / refunded (£)</th></tr>';
        foreach (all('select * from donations order by id desc limit 100') as $x)
            $b .= '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td><td><form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="money"><input type="hidden" name="id" value="' . $x['id'] . '"><input name="fee" size="5" value="' . number_format($x['fee'] / 100, 2, '.', '') . '" aria-label="Fee"><input name="refunded" size="5" value="' . number_format($x['refunded'] / 100, 2, '.', '') . '" aria-label="Refunded"><button class="btn alt">Save</button></form></td></tr>';
        $b .= '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No confirmed donations yet.</p>' : ''); $b .= '<p>Unpaid or mismatched:</p><ul>';
        foreach (all("select id, donation, updated from sends where status='awaiting_payment' and updated<? order by id desc", [time() - 3600]) as $x) $b .= '<li>Card #' . $x['id'] . ' awaiting payment of ' . gbp((int)$x['donation']) . ' since ' . when((int)$x['updated']) . '</li>';
        foreach (all("select * from audit where action='payment_mismatch' order by id desc limit 10") as $x) $b .= '<li>Mismatch: ' . h($x['detail']) . '</li>';
        $b .= '</ul>';
    }
    if (can('complaints')) {
        $b .= '<h2>Reports</h2><table><tr><th>Recipient</th><th>Reason</th><th>Status</th><th></th></tr>';
        foreach (all('select r.*, x.email from reports r join recipients x on x.id=r.recipient_id order by r.id desc limit 50') as $x)
            $b .= '<tr><td>' . h($x['email']) . '</td><td>' . h($x['reason']) . '</td><td>' . h($x['status'] === 'open' ? 'Open' : $x['decision']) . '</td><td><a href="/admin/message?report=' . $x['id'] . '">View card</a> ' . ($x['status'] === 'open' ? adminbtn('dismiss', (int)$x['id'], 'Dismiss') . adminbtn('block', (int)$x['id'], 'Block recipient') . adminbtn('withdraw', (int)$x['id'], 'Withdraw card') : '') . '</td></tr>';
        $b .= '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No reports. Nothing needs a decision.</p>' : '');
    }
    if (can('campaign')) {
        $tgt = (int)setting('target_pence'); $pub = base_url() . '/';
        $b .= '<h2>Share the campaign</h2><p>Public link: <code>' . h($pub) . '</code>. Add <code>?ref=newsletter</code> (letters, numbers, hyphens) to see which promotion works. It leads to the gallery and contains nothing private.</p>'
            . '<p><a href="https://api.qrserver.com/v1/create-qr-code/?size=800x800&amp;format=png&amp;data=' . h(urlencode($pub)) . '" download="christmas-cards-qr.png">Download QR code (PNG)</a></p><ul>';
        foreach (all("select coalesce(ref,'(no label)') r, count(*) n from sends where status not in ('draft') group by ref order by n desc") as $x) $b .= '<li>' . h($x['r']) . ': ' . $x['n'] . ' cards</li>';
        $b .= '</ul>';
        $b .= '<h2>Campaign settings</h2><p class="note">These are launch decisions for the Trustees to agree and record. Dates are UK time.</p><form method="post" class="stack">' . csrf() . '<input type="hidden" name="do" value="settings">'
            . '<label>Campaign name<input name="campaign" value="' . h(setting('campaign', 'Christmas 2026')) . '"></label>'
            . '<label>Sending opens<input type="datetime-local" name="opens" value="' . h(setting('opens')) . '"></label><label>Sending closes<input type="datetime-local" name="closes" value="' . h(setting('closes')) . '"></label>'
            . '<label>Cards already queued when sending closes<select name="closure_queue"><option value="send">Still send them</option><option value="hold"' . (setting('closure_queue') === 'hold' ? ' selected' : '') . '>Hold them</option></select></label>'
            . '<label>Card expiry (days after sending)<input name="expiry_days" value="' . expiry_days() . '"></label><label>Retention before content is deleted (days)<input name="retention_days" value="' . (int)setting('retention_days', '90') . '"></label>'
            . '<label>Message limit (characters)<input name="msg_max" value="' . msg_max() . '"></label><label>From name limit (characters)<input name="name_max" value="' . name_max() . '"></label>'
            . '<label>Donation purpose wording<textarea name="donation_purpose" rows="2">' . h(setting('donation_purpose')) . '</textarea></label>'
            . '<label>Blocked words in messages (comma separated)<input name="abuse_terms" value="' . h(setting('abuse_terms')) . '"></label>'
            . '<label class="opt"><input type="checkbox" name="allow_urls" value="1"' . (setting('allow_urls') === '1' ? ' checked' : '') . '> Allow web addresses in messages (they are never clickable)</label>'
            . '<label class="opt"><input type="checkbox" name="show_progress" value="1"' . (setting('show_progress') === '1' ? ' checked' : '') . '> Show fundraising progress publicly</label><button class="btn">Save settings</button></form>'
            . '<form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="target"><label>Fundraising target (£)<input name="target" value="' . number_format($tgt / 100, 2, '.', '') . '"></label><button class="btn alt">Save target</button></form><h3>Designs</h3><ul>';
        foreach (cards() as $id => $c) $b .= '<li>' . h($c['title']) . ' <form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="design"><input type="hidden" name="card" value="' . h($id) . '"><button class="link">' . ($c['on'] ? 'Disable' : 'Enable') . '</button></form></li>';
        $b .= '</ul>';
    }
    if (can('rolesadmin')) {
        $b .= '<h2>Roles</h2><p class="note">Only role administrators can change these. Every change is audited.</p>';
        $rows = all("select * from users where is_admin=1 or roles<>'' order by name");
        $rows[] = ['email' => '', 'roles' => '', 'name' => 'Add by email'];
        foreach ($rows as $x) {
            $have = explode(',', $x['roles']);
            $b .= '<form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="roles">' . ($x['email'] ? '<strong>' . h($x['name']) . '</strong> <input type="hidden" name="email" value="' . h($x['email']) . '">' . h($x['email']) : '<input type="email" name="email" placeholder="registered email" aria-label="Email of user to add" required>');
            foreach (ROLES as $k => $l) $b .= '<label class="opt"><input type="checkbox" name="roles[]" value="' . $k . '"' . (in_array($k, $have) ? ' checked' : '') . '> ' . h($l) . '</label>';
            $b .= '<button class="btn alt">Save</button></form>';
        }
    }
    $b .= '<h2>Audit trail</h2><ul>';
    foreach (all('select * from audit order by id desc limit 20') as $x) $b .= '<li>' . when((int)$x['created']) . ' ' . h($x['action']) . ' ' . h($x['detail']) . '</li>';
    page('Administration', $b . '</ul>');
}

function r_export(): void {
    $u = need_role('finance');
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : '2000-01-01'; $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to'] ?? '') ? $_GET['to'] : '2999-12-31';
    if (!isset($_GET['go'])) page('Export finance CSV', '<h1>Export finance CSV</h1><form method="get" class="stack"><input type="hidden" name="go" value="1"><label>From<input type="date" name="from"></label><label>To<input type="date" name="to"></label><label class="opt"><input type="checkbox" name="donors" value="1"> Include donor name and email (only if needed)</label><button class="btn">Download</button></form>');
    $donors = !empty($_GET['donors']);
    $rows = all('select d.*, u.name, u.email from donations d left join users u on u.id=d.user_id where d.created>=? and d.created<? order by d.id', [strtotime($from), strtotime($to) + 86400]);
    if (!$rows) page('No records', '<h1>No finance records in that range</h1><p>There are no confirmed donations between those dates. Try a wider range.</p><p><a class="btn" href="/admin/export">Choose dates again</a></p>');
    audit((int)$u['id'], 'finance_export', "$from to $to, " . count($rows) . ' rows' . ($donors ? ', with donors' : ''));
    header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="donations-' . date('Ymd') . '.csv"');
    $o = fopen('php://output', 'w');
    fputcsv($o, array_merge(['Campaign', 'Transaction reference', 'Date', 'Currency', 'Gross', 'Fees', 'Refunds', 'Net', 'Payment status'], $donors ? ['Donor name', 'Donor email'] : []));
    foreach ($rows as $x) {
        $st = $x['refunded'] >= $x['pence'] ? 'Refunded' : ($x['refunded'] > 0 ? 'Partially refunded' : 'Confirmed');
        $m = fn($p) => number_format($p / 100, 2, '.', '');
        fputcsv($o, array_merge([csv_text(setting('campaign', 'Christmas 2026')), csv_text((string)$x['stripe_session']), date('Y-m-d', (int)$x['created']), 'GBP', $m($x['pence']), $m($x['fee']), $m($x['refunded']), $m($x['pence'] - $x['fee'] - $x['refunded']), $st],
            $donors ? [csv_text((string)$x['name']), csv_text((string)$x['email'])] : []));
    }
    exit;
}

/** Private message access: complaints role, stated reason, audited. */
function r_message(): void {
    $u = need_role('complaints'); $rep = one('select r.*, x.name, x.send_id from reports r join recipients x on x.id=r.recipient_id where r.id=?', [(int)($_GET['report'] ?? 0)]);
    if (!$rep) fail(404, 'Report not found.');
    if (!post()) page('View reported card', '<h1>View reported card</h1><p>You are about to read a private message. This access is recorded.</p><form method="post" class="stack">' . csrf() . '<label>Reason for viewing<input name="reason" required maxlength="200"></label><button class="btn">View card</button></form>');
    $why = field('reason', 200); if ($why === '') fail(400, 'A reason is required.');
    audit((int)$u['id'], 'message_access', "report {$rep['id']}: $why");
    $s = one('select * from sends where id=?', [$rep['send_id']]);
    page('Reported card', '<h1>Reported card</h1>' . card_view($s['card'], $rep['name'], resolved_msg(one('select * from recipients where id=?', [$rep['recipient_id']]), $s), $s['sender_name']) . '<p><a href="/admin">Back</a></p>');
}

function r_prefs(): void {
    $u = need_login();
    if (post()) { q('update users set notify=? where id=?', [in_array($_POST['notify'] ?? '', ['viewed', 'summary']) ? $_POST['notify'] : 'off', $u['id']]); flash('Email preference saved.'); }
    redirect('/dashboard');
}

/** FR-059: copy a previous card into a fresh unsent draft; recipients are copied only if ticked. */
function r_copy(): void {
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (post()) {
        $new = copy_send((int)$s['id'], (int)$u['id'], array_slice((array)($_POST['rid'] ?? []), 0, max_recipients()));
        flash('Copied to a new draft. Nothing has been sent.'); redirect('/compose?id=' . $new);
    }
    $rows = '';
    foreach (all('select * from recipients where send_id=? order by id', [$s['id']]) as $r)
        $rows .= '<label class="opt"><input type="checkbox" name="rid[]" value="' . $r['id'] . '"> ' . h($r['name']) . ' (' . h($r['email']) . ')</label>';
    page('Copy card', '<h1>Copy this card</h1><p>The design, message and From name are copied to a new draft. Nothing is sent until you review and submit it. Tick anyone you want to send to again.</p><form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><fieldset><legend>Recipients to copy</legend>' . ($rows ?: '<p>None.</p>') . '</fieldset><button class="btn">Create draft</button></form>');
}

function r_discard(): void {
    $u = need_login();
    if (post()) {
        $s = own_send((int)($_POST['id'] ?? 0));
        if ($s['status'] === 'draft') { q('delete from recipients where send_id=?', [$s['id']]); q('delete from sends where id=?', [$s['id']]); audit((int)$u['id'], 'draft_discard', 'send ' . $s['id']); flash('Draft discarded.'); }
    }
    redirect('/dashboard');
}

function r_change_email(): void { // wrong-address correction before verification
    $u = need_login();
    if (post() && !$u['verified']) {
        limit('chgmail', 5, 3600);
        $e = strtolower(field('email'));
        if (!filter_var($e, FILTER_VALIDATE_EMAIL) || one('select 1 from users where email=? and id<>?', [$e, $u['id']])) { flash('That email cannot be used. Check it and try again.', 'err'); redirect('/dashboard'); }
        $t = token(); q('update users set email=?, verify_token=? where id=?', [$e, $t, $u['id']]);
        mail_send($e, 'Confirm your email', "Please confirm your email address. We will take you back to your saved card.\n" . base_url() . "/verify?t=$t\n");
        flash('Email changed to ' . $e . '. We have sent a new verification link there.');
    }
    redirect('/dashboard');
}

function dispatch(string $path): void {
    $routes = ['/' => 'r_home', '/help' => 'r_help', '/register' => 'r_register', '/verify' => 'r_verify', '/resend-verification' => 'r_resend_verify', '/login' => 'r_login', '/logout' => 'r_logout', '/forgot' => 'r_forgot', '/reset' => 'r_reset',
        '/compose' => 'r_compose', '/preview' => 'r_preview', '/review' => 'r_review', '/pay-cancelled' => 'r_pay_cancelled', '/return' => 'r_return', '/dev/pay' => 'r_dev_pay', '/dashboard' => 'r_dashboard', '/send' => 'r_send', '/prefs' => 'r_prefs', '/contacts' => 'r_contacts', '/contacts/edit' => 'r_contact_edit', '/contacts/delete-all' => 'r_contacts_delete_all', '/contacts/pick' => 'r_pick', '/contacts/save' => 'r_save_contact', '/groups' => 'r_groups', '/discard' => 'r_discard', '/change-email' => 'r_change_email', '/copy' => 'r_copy',
        '/mfa' => 'r_mfa', '/admin' => 'r_admin', '/admin/export' => 'r_export', '/admin/message' => 'r_message', '/hooks/stripe' => 'r_stripe_hook', '/hooks/postmark' => 'r_postmark_hook'];
    if (post() && !str_starts_with($path, '/hooks/')) check_csrf();
    if (preg_match('#^/c/([a-f0-9]+)(?:/(open|report))?$#', $path, $m)) r_card($m[1], $m[2] ?? '');
    if (preg_match('#^/optout/([a-f0-9]+)$#', $path, $m)) r_optout($m[1]);
    if (isset($routes[$path])) $routes[$path]();
    fail(404, 'Page not found.');
}
