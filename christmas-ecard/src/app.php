<?php
require __DIR__ . '/lib.php';
require __DIR__ . '/cards.php';
require __DIR__ . '/core.php';

function post(): bool { return $_SERVER['REQUEST_METHOD'] === 'POST'; }
function field(string $k, int $max = 200): string { return mb_substr(trim((string)($_POST[$k] ?? '')), 0, $max); }

function card_view(string $cardId, string $to, string $msg, string $from): string {
    $c = cards()[$cardId];
    return '<article class="card">' . card_art($cardId) . '<div class="inner"><h2>' . h($c['title']) . '</h2><p class="to">Dear ' . h($to) . ',</p><p class="msg">' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong>' . h($from) . '</strong></p></div></article>';
}

// ---------- public
function r_home(): void {
    $b = '<section class="hero"><h1>Send a Scout Christmas card</h1><p>Free to send. Add an optional donation to support 7th Swindon Scouts.</p><p><a class="btn" href="#gallery">Choose a card</a></p></section><h2 id="gallery">Pick a design</h2><div class="grid">';
    foreach (cards() as $id => $c) if ($c['on'])
        $b .= '<a class="tile" href="/compose?card=' . h($id) . '">' . card_art($id) . '<span>' . h($c['title']) . '</span></a>';
    page('Choose a card', $b . '</div>');
}

function r_register(): void {
    if (post()) {
        limit('reg', 10, 3600);
        $n = field('name', 80); $e = strtolower(field('email')); $p = (string)($_POST['password'] ?? '');
        if (!$n || !filter_var($e, FILTER_VALIDATE_EMAIL) || strlen($p) < 10) { flash('Please give your name, a valid email and a password of at least 10 characters.', 'err'); redirect('/register'); }
        if (one('select 1 from users where email=?', [$e])) { flash('That email is already registered. Try signing in.', 'err'); redirect('/login'); }
        $t = token();
        q('insert into users(name,email,pass,verify_token,created) values(?,?,?,?,?)', [$n, $e, password_hash($p, PASSWORD_DEFAULT), $t, time()]);
        $_SESSION['uid'] = (int)db()->lastInsertId(); session_regenerate_id(true);
        mail_send($e, 'Confirm your email for 7th Swindon Scouts Christmas Cards', "Hello $n,\n\nPlease confirm your email address:\n" . base_url() . "/verify?t=$t\n");
        flash('Welcome! Check your email and click the link to verify before sending.');
        redirect('/dashboard');
    }
    page('Register', '<h1>Register</h1><form method="post" class="stack">' . csrf() . '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password (10+ characters)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><button class="btn">Create account</button></form>');
}

function r_verify(): void {
    $u = one('select * from users where verify_token=? and verify_token<>\'\'', [(string)($_GET['t'] ?? '')]);
    if ($u) { q("update users set verified=1, verify_token='' where id=?", [$u['id']]); flash('Email verified. You can now send cards.'); }
    else flash('That verification link is not valid.', 'err');
    redirect('/dashboard');
}

function r_login(): void {
    if (post()) {
        limit('login', 10, 900);
        $u = one('select * from users where email=?', [strtolower(field('email'))]);
        if (!$u || !password_verify((string)($_POST['password'] ?? ''), $u['pass'])) { flash('Email or password not recognised.', 'err'); redirect('/login'); }
        session_regenerate_id(true);
        $_SESSION['uid'] = (int)$u['id']; $_SESSION['mfa'] = false;
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
    $u = need_login();
    $s = isset($_GET['id']) ? own_send((int)$_GET['id']) : null;
    if ($s && $s['status'] !== 'draft') redirect('/send?id=' . $s['id']);
    if (post()) {
        $card = field('card', 40);
        if (!(cards()[$card]['on'] ?? false)) { flash('Please choose an available design.', 'err'); redirect('/'); }
        $from = field('sender_name', 80) ?: $u['name']; $msg = field('message', 500);
        [$rows, $errs] = parse_recipients((string)($_POST['recipients'] ?? ''));
        if (count($rows) > MAX_RECIPIENTS) { $errs[] = 'You can send to at most ' . MAX_RECIPIENTS . ' people at once. Recipients were not saved.'; $rows = null; }
        if (!$s) { q('insert into sends(user_id,card,sender_name,message,created,updated) values(?,?,?,?,?,?)', [$u['id'], $card, $from, $msg, time(), time()]); $sid = (int)db()->lastInsertId(); }
        else { $sid = (int)$s['id']; q('update sends set card=?, sender_name=?, message=?, updated=? where id=?', [$card, $from, $msg, time(), $sid]); }
        if ($rows !== null) {
            q("delete from recipients where send_id=? and status='draft'", [$sid]);
            foreach ($rows as [$n, $e]) q('insert into recipients(send_id,name,email,token) values(?,?,?,?)', [$sid, $n, $e, token()]);
        }
        $act = $_POST['act'] ?? 'save';
        if ($errs) { flash(implode(' ', $errs), 'err'); redirect("/compose?id=$sid"); }
        if ($act === 'test') {
            if (!$u['verified']) { flash('Verify your email first, then you can send yourself a test.', 'warn'); redirect("/compose?id=$sid"); }
            limit('test', 5, 3600);
            mail_send($u['email'], 'Test card preview', "Here is your private preview of the card:\n" . base_url() . "/preview?id=$sid\n(Sign in first if asked.)");
            flash('Test sent to ' . $u['email'] . '.'); redirect("/compose?id=$sid");
        }
        if ($act === 'preview') redirect("/preview?id=$sid");
        if ($act === 'continue') {
            if ($msg === '' || !$rows) { flash('Add a message and at least one recipient to continue.', 'err'); redirect("/compose?id=$sid"); }
            redirect("/review?id=$sid");
        }
        flash('Draft saved.'); redirect("/compose?id=$sid");
    }
    $card = $s['card'] ?? (string)($_GET['card'] ?? '');
    if (!(cards()[$card]['on'] ?? false)) redirect('/');
    $rt = $s ? implode("\n", array_map(fn($r) => $r['name'] . ', ' . $r['email'], all('select * from recipients where send_id=? order by id', [$s['id']]))) : '';
    $opts = '';
    foreach (cards() as $id => $c) if ($c['on']) $opts .= '<option value="' . h($id) . '"' . ($id === $card ? ' selected' : '') . '>' . h($c['title']) . '</option>';
    page('Write your card', '<h1>Write your card</h1><div class="two"><div>' . card_art($card) . '</div><form method="post" class="stack">' . csrf()
        . '<label>Design<select name="card">' . $opts . '</select></label>'
        . '<label>Your name or family name (shown on the card)<input name="sender_name" maxlength="80" value="' . h($s['sender_name'] ?? $u['name']) . '"></label>'
        . '<label>Your message (up to 500 characters)<textarea name="message" rows="5" maxlength="500">' . h($s['message'] ?? '') . '</textarea></label>'
        . '<label>Recipients, one per line as <em>Name, email</em> (maximum ' . MAX_RECIPIENTS . ')<textarea name="recipients" rows="6" placeholder="Gran, gran@example.com">' . h($rt) . '</textarea></label>'
        . '<div class="row"><button class="btn" name="act" value="continue">Continue</button><button class="btn alt" name="act" value="preview">Preview</button><button class="btn alt" name="act" value="save">Save draft</button><button class="btn alt" name="act" value="test">Email me a test</button></div></form></div>');
}

function r_preview(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $r = one('select * from recipients where send_id=? order by id limit 1', [$s['id']]);
    page('Preview', '<h1>Preview</h1><p>This is how your card will look.</p>' . card_view($s['card'], $r['name'] ?? 'Friend', $s['message'], $s['sender_name']) . '<p><a class="btn" href="/compose?id=' . $s['id'] . '">Back to editing</a></p>');
}

function r_review(): void {
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if ($s['status'] !== 'draft') redirect('/send?id=' . $s['id']);
    $rs = all('select * from recipients where send_id=? order by id', [$s['id']]);
    if (post()) {
        if (!$u['verified']) { flash('Please verify your email before sending.', 'warn'); redirect('/review?id=' . $s['id']); }
        if (setting('paused') === '1') { flash('Sending is paused for a short while. Your draft is saved.', 'warn'); redirect('/review?id=' . $s['id']); }
        if (!$rs || count($rs) > MAX_RECIPIENTS || $s['message'] === '') { flash('Your card needs a message and 1 to ' . MAX_RECIPIENTS . ' recipients.', 'err'); redirect('/compose?id=' . $s['id']); }
        $pick = (string)($_POST['amount'] ?? '0');
        $pence = $pick === 'custom' ? (int)round((float)($_POST['custom'] ?? 0) * 100) : (int)$pick;
        if ($pence !== 0 && ($pence < 100 || $pence > 50000)) { flash('Donations are between £1 and £500, or choose no donation.', 'err'); redirect('/review?id=' . $s['id']); }
        if ($pence === 0) { queue_send((int)$s['id']); flash('Your cards are being sent.'); redirect('/send?id=' . $s['id']); }
        q("update sends set donation=?, status='awaiting_payment', updated=? where id=? and status='draft'", [$pence, time(), $s['id']]);
        if (!env('STRIPE_SECRET')) redirect('/dev/pay?id=' . $s['id']);
        $r = stripe('POST', '/checkout/sessions', [
            'mode' => 'payment', 'client_reference_id' => $s['id'], 'metadata' => ['send_id' => $s['id']],
            'success_url' => base_url() . '/return?id=' . $s['id'] . '&cs={CHECKOUT_SESSION_ID}', 'cancel_url' => base_url() . '/review?id=' . $s['id'],
            'line_items' => [['quantity' => 1, 'price_data' => ['currency' => 'gbp', 'unit_amount' => $pence, 'product_data' => ['name' => 'Donation to 7th Swindon Scouts']]]],
        ], "ecard-{$s['id']}-$pence-" . time() % 100000);
        if (empty($r['url'])) { q("update sends set status='draft' where id=?", [$s['id']]); flash('Payment could not be started. Nothing was charged.', 'err'); redirect('/review?id=' . $s['id']); }
        redirect($r['url']);
    }
    $list = implode('', array_map(fn($r) => '<li>' . h($r['name']) . ' (' . h($r['email']) . ')</li>', $rs));
    $amts = '<label class="opt"><input type="radio" name="amount" value="0" checked> No donation, send for free</label>';
    foreach ([200, 500, 1000] as $a) $amts .= '<label class="opt"><input type="radio" name="amount" value="' . $a . '"> ' . gbp($a) . '</label>';
    $amts .= '<label class="opt"><input type="radio" name="amount" value="custom"> Other amount <input type="number" name="custom" min="1" max="500" step="0.01" aria-label="Custom amount in pounds"></label>';
    $warn = $u['verified'] ? '' : '<p class="flash warn">Verify your email (see the link we sent) before you can send.</p>';
    page('Review and send', '<h1>Review and send</h1>' . $warn . card_view($s['card'], $rs[0]['name'] ?? 'Friend', $s['message'], $s['sender_name'])
        . '<h2>Sending to ' . count($rs) . '</h2><ul>' . $list . '</ul><p><a href="/compose?id=' . $s['id'] . '">Edit</a></p>'
        . '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><fieldset><legend>Optional donation to 7th Swindon Scouts</legend>' . $amts . '</fieldset><button class="btn">Send my cards</button></form>');
}

function r_return(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $cs = (string)($_GET['cs'] ?? '');
    if (preg_match('/^cs_[A-Za-z0-9_]+$/', $cs)) {
        $r = stripe('GET', "/checkout/sessions/$cs");
        if (($r['payment_status'] ?? '') === 'paid' && (string)($r['client_reference_id'] ?? '') === (string)$s['id'])
            confirm_payment((int)$s['id'], $cs, (int)$r['amount_total'], env('STRIPE_ACCOUNT'));
    }
    flash('Thank you! Your payment is being confirmed and your cards will be sent.');
    redirect('/send?id=' . $s['id']);
}

function r_dev_pay(): void { // local stand-in for Stripe when STRIPE_SECRET is unset
    if (env('STRIPE_SECRET')) fail(404, 'Not found.');
    $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (post()) {
        if (($_POST['result'] ?? '') === 'pay') confirm_payment((int)$s['id'], 'dev_' . token(), (int)$s['donation']);
        else q("update sends set status='draft' where id=? and status='awaiting_payment'", [$s['id']]);
        redirect($_POST['result'] === 'pay' ? '/send?id=' . $s['id'] : '/review?id=' . $s['id']);
    }
    page('Test payment', '<h1>Test payment ' . gbp((int)$s['donation']) . '</h1><p>Stripe is not configured, so this simulates the payment page.</p><form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><button class="btn" name="result" value="pay">Simulate successful payment</button><button class="btn alt" name="result" value="fail">Simulate failure</button></form>');
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
    $b = '<h1>My cards</h1>' . ($u['verified'] ? '' : '<p class="flash warn">Please verify your email: click the link we sent to ' . h($u['email']) . '. You need this before sending.</p>') . '<p><a class="btn" href="/">Create a new card</a></p>';
    $rows = '';
    foreach (all('select * from sends where user_id=? order by id desc', [$u['id']]) as $s) {
        $c = [];
        foreach (all('select * from recipients where send_id=?', [$s['id']]) as $r) { $k = rstatus($r); $c[$k] = ($c[$k] ?? 0) + 1; }
        $sum = implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($c), $c));
        $link = $s['status'] === 'draft' ? "/compose?id={$s['id']}" : "/send?id={$s['id']}";
        $rows .= '<tr><td>' . date('j M Y', (int)$s['created']) . '</td><td><a href="' . $link . '">' . h(cards()[$s['card']]['title'] ?? $s['card']) . '</a></td><td>' . h(ucfirst(str_replace('_', ' ', $s['status']))) . '</td><td>' . h($sum) . '</td><td>' . ($s['donation'] && $s['status'] !== 'awaiting_payment' ? gbp((int)$s['donation']) : '') . '</td></tr>';
    }
    $b .= $rows ? '<table><caption class="sr">Your cards</caption><tr><th>Date</th><th>Card</th><th>State</th><th>Recipients</th><th>Donation</th></tr>' . $rows . '</table>' : '<p>No cards yet.</p>';
    $d = all('select d.*, s.card from donations d join sends s on s.id=d.send_id where d.user_id=? order by d.id desc', [$u['id']]);
    if ($d) $b .= '<h2>Donation history</h2><table><tr><th>Date</th><th>Amount</th><th>Reference</th></tr>' . implode('', array_map(fn($x) => '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td></tr>', $d)) . '</table>';
    page('My cards', $b);
}

function r_send(): void {
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (post()) { // correct a failed address and requeue (only failed/bounced rows, so no duplicates)
        $r = one('select * from recipients where id=? and send_id=?', [(int)($_POST['rid'] ?? 0), $s['id']]);
        $e = strtolower(field('email'));
        if ($r && in_array($r['status'], ['failed', 'bounced']) && filter_var($e, FILTER_VALIDATE_EMAIL)) {
            q("update recipients set email=?, status='queued', tries=0, error=null, delivered_at=null where id=? and status in ('failed','bounced')", [$e, $r['id']]);
            process_queue(); flash('Address updated and card re-sent.');
        } else flash('Could not update that address.', 'err');
        redirect('/send?id=' . $s['id']);
    }
    $rows = '';
    foreach (all('select * from recipients where send_id=? order by id', [$s['id']]) as $r) {
        $st = rstatus($r);
        $fix = $st === 'Failed' ? '<form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><input type="hidden" name="rid" value="' . $r['id'] . '"><input type="email" name="email" value="' . h($r['email']) . '" required aria-label="Corrected email for ' . h($r['name']) . '"><button class="btn alt">Fix and resend</button></form><small>' . h($r['error']) . '</small>' : '';
        $rows .= '<tr><td>' . h($r['name']) . '</td><td>' . h($r['email']) . '</td><td><span class="pill ' . strtolower($st) . '">' . $st . '</span></td><td>' . $fix . '</td></tr>';
    }
    page('Card status', '<h1>' . h(cards()[$s['card']]['title']) . '</h1><p>' . h(ucfirst(str_replace('_', ' ', $s['status']))) . ($s['donation'] ? ' &middot; donation ' . gbp((int)$s['donation']) : '') . '</p><p class="note">"Viewed" means the recipient opened the card themselves. "Delivered" only means the email reached their inbox.</p><table><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr>' . $rows . '</table>');
}

// ---------- recipient
function recipient_by_token(string $t): array {
    $r = preg_match('/^[a-f0-9]{48}$/', $t) ? one("select * from recipients where token=? and status in ('sent','sending','queued','failed','bounced')", [$t]) : null;
    return $r ?: fail(404, 'We could not find that card. Please check the link in your email.');
}

function r_card(string $t, string $act = ''): void {
    $r = recipient_by_token($t);
    $s = one('select * from sends where id=?', [$r['send_id']]);
    if (one('select 1 from suppressed where email=?', [$r['email']])) fail(410, 'This card is no longer available.');
    if ($r['sent_at'] && time() > expiry_ts($r)) fail(410, 'Sorry, this card has expired.');
    if (post() && $act === 'open') { q('update recipients set viewed_at=? where id=? and viewed_at is null', [time(), $r['id']]); redirect("/c/$t?o=1"); } // human click, not a link scanner
    if (post() && $act === 'report') {
        limit('report', 5, 3600);
        q('insert into reports(recipient_id,reason,created) values(?,?,?)', [$r['id'], field('reason', 500), time()]);
        flash('Thank you. We have received your report and will look into it.'); redirect("/c/$t");
    }
    if (empty($_GET['o'])) {
        page('A card for you', '<section class="envelope-wrap"><div class="envelope" aria-hidden="true"><div class="flap"></div><div class="to">To ' . h($r['name']) . '</div></div><h1>A Christmas card for ' . h($r['name']) . '</h1><p>From ' . h($s['sender_name']) . '</p><form method="post" action="/c/' . h($t) . '/open">' . csrf() . '<button class="btn">Open your card</button></form></section>');
    }
    page('Your Christmas card', '<div class="reveal">' . card_view($s['card'], $r['name'], $s['message'], $s['sender_name']) . '</div><p class="center"><a class="btn" href="/">Send a card of your own</a></p>'
        . '<details class="center"><summary>Report this card</summary><form method="post" action="/c/' . h($t) . '/report" class="stack">' . csrf() . '<label>What is wrong?<textarea name="reason" maxlength="500" required></textarea></label><button class="btn alt">Send report</button></form></details>');
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

function r_admin(): void {
    $u = need_admin();
    if (post()) {
        $a = $_POST['do'] ?? ''; $i = (int)($_POST['id'] ?? 0);
        if ($a === 'pause') { set_setting('paused', setting('paused') === '1' ? '0' : '1'); audit((int)$u['id'], 'pause_toggle', setting('paused')); }
        if ($a === 'target') { set_setting('target_pence', (string)(int)round((float)($_POST['target'] ?? 0) * 100)); audit((int)$u['id'], 'target', field('target')); }
        if ($a === 'design' && isset(cards()[$_POST['card'] ?? ''])) { set_setting('off_' . $_POST['card'], cards()[$_POST['card']]['on'] ? '1' : '0'); audit((int)$u['id'], 'design_toggle', $_POST['card']); }
        if ($a === 'money') { q('update donations set fee=?, refunded=? where id=?', [(int)round((float)$_POST['fee'] * 100), (int)round((float)$_POST['refunded'] * 100), $i]); audit((int)$u['id'], 'reconcile', "donation $i"); }
        if ($a === 'resend') { q("update recipients set status='queued', tries=0, error=null where id=? and status in ('failed','bounced','sending')", [$i]); audit((int)$u['id'], 'resend', "recipient $i"); process_queue(); }
        if ($a === 'dismiss' || $a === 'block') {
            $rep = one('select r.*, x.email from reports r join recipients x on x.id=r.recipient_id where r.id=?', [$i]);
            if ($rep) {
                if ($a === 'block') q('insert or ignore into suppressed(email,created) values(?,?)', [$rep['email'], time()]);
                q("update reports set status='closed', decision=? where id=?", [$a === 'block' ? 'Blocked recipient from further cards' : 'Dismissed', $i]);
                audit((int)$u['id'], "report_$a", "report $i");
            }
        }
        flash('Saved.'); redirect('/admin');
    }
    $d = one('select count(*) n, coalesce(sum(pence),0) gross, coalesce(sum(fee),0) fee, coalesce(sum(refunded),0) ref from donations');
    $rc = []; foreach (all('select * from recipients') as $r) { $k = rstatus($r); $rc[$k] = ($rc[$k] ?? 0) + 1; }
    $tgt = (int)setting('target_pence'); $net = $d['gross'] - $d['ref'];
    $b = '<h1>Administration</h1><h2>Fundraising</h2><p>Confirmed donations: <strong>' . gbp((int)$d['gross']) . '</strong> from ' . $d['n'] . ' donors (average ' . gbp($d['n'] ? intdiv((int)$d['gross'], (int)$d['n']) : 0) . '). Fees ' . gbp((int)$d['fee']) . ', refunds ' . gbp((int)$d['ref']) . ', net ' . gbp((int)$net) . ($tgt ? ' of target ' . gbp($tgt) : '') . '</p>'
        . '<h2>Card activity</h2><p>' . h(implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($rc), $rc)) ?: 'Nothing sent yet') . '</p><ul>';
    foreach (all("select card, count(*) n from sends where status<>'draft' group by card order by n desc") as $x) $b .= '<li>' . h(cards()[$x['card']]['title'] ?? $x['card']) . ': ' . $x['n'] . '</li>';
    $b .= '</ul><h2>Email operations</h2><p>Queued: ' . ($rc['Queued'] ?? 0) . '. Cron: <code>php src/cli.php queue</code> every 5 minutes.</p><table><tr><th>Recipient</th><th>Status</th><th>Error</th><th></th></tr>';
    foreach (all("select * from recipients where status in ('failed','bounced','sending') order by id desc limit 50") as $r)
        $b .= '<tr><td>' . h($r['email']) . '</td><td>' . rstatus($r) . '</td><td>' . h($r['error']) . '</td><td>' . adminbtn('resend', (int)$r['id'], 'Resend') . '</td></tr>';
    $b .= '</table><h2>Payments</h2><table><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Fee / refunded (£)</th></tr>';
    foreach (all('select * from donations order by id desc limit 100') as $x)
        $b .= '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td><td><form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="money"><input type="hidden" name="id" value="' . $x['id'] . '"><input name="fee" size="5" value="' . number_format($x['fee'] / 100, 2, '.', '') . '" aria-label="Fee"><input name="refunded" size="5" value="' . number_format($x['refunded'] / 100, 2, '.', '') . '" aria-label="Refunded"><button class="btn alt">Save</button></form></td></tr>';
    $b .= '</table><p>Unpaid or mismatched:</p><ul>';
    foreach (all("select id, donation, updated from sends where status='awaiting_payment' and updated<? order by id desc", [time() - 3600]) as $x) $b .= '<li>Card #' . $x['id'] . ' awaiting payment of ' . gbp((int)$x['donation']) . ' since ' . date('j M H:i', (int)$x['updated']) . '</li>';
    foreach (all("select * from audit where action='payment_mismatch' order by id desc limit 10") as $x) $b .= '<li>Mismatch: ' . h($x['detail']) . '</li>';
    $b .= '</ul><h2>Reports</h2><table><tr><th>Recipient</th><th>Reason</th><th>Status</th><th></th></tr>';
    foreach (all('select r.*, x.email from reports r join recipients x on x.id=r.recipient_id order by r.id desc limit 50') as $x)
        $b .= '<tr><td>' . h($x['email']) . '</td><td>' . h($x['reason']) . '</td><td>' . h($x['status'] === 'open' ? 'Open' : $x['decision']) . '</td><td>' . ($x['status'] === 'open' ? adminbtn('dismiss', (int)$x['id'], 'Dismiss') . adminbtn('block', (int)$x['id'], 'Block recipient') : '') . '</td></tr>';
    $b .= '</table><h2>Campaign controls</h2><form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="pause"><button class="btn alt">' . (setting('paused') === '1' ? 'Resume sending (currently paused)' : 'Pause all sending') . '</button></form>'
        . '<form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="target"><label>Fundraising target (£)<input name="target" value="' . number_format($tgt / 100, 2, '.', '') . '"></label><button class="btn alt">Save target</button></form><h3>Designs</h3><ul>';
    foreach (cards() as $id => $c) $b .= '<li>' . h($c['title']) . ' ' . '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="design"><input type="hidden" name="card" value="' . h($id) . '"><button class="link">' . ($c['on'] ? 'Disable' : 'Enable') . '</button></form></li>';
    $b .= '</ul><h2>Audit trail</h2><ul>';
    foreach (all('select * from audit order by id desc limit 20') as $x) $b .= '<li>' . date('j M H:i', (int)$x['created']) . ' ' . h($x['action']) . ' ' . h($x['detail']) . '</li>';
    page('Administration', $b . '</ul>');
}
function adminbtn(string $do, int $id, string $label): string {
    return '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="' . $do . '"><input type="hidden" name="id" value="' . $id . '"><button class="link">' . h($label) . '</button></form> ';
}

function dispatch(string $path): void {
    $routes = ['/' => 'r_home', '/register' => 'r_register', '/verify' => 'r_verify', '/login' => 'r_login', '/logout' => 'r_logout', '/forgot' => 'r_forgot', '/reset' => 'r_reset',
        '/compose' => 'r_compose', '/preview' => 'r_preview', '/review' => 'r_review', '/return' => 'r_return', '/dev/pay' => 'r_dev_pay', '/dashboard' => 'r_dashboard', '/send' => 'r_send',
        '/mfa' => 'r_mfa', '/admin' => 'r_admin', '/hooks/stripe' => 'r_stripe_hook', '/hooks/postmark' => 'r_postmark_hook'];
    if (post() && !str_starts_with($path, '/hooks/')) check_csrf();
    if (preg_match('#^/c/([a-f0-9]+)(?:/(open|report))?$#', $path, $m)) r_card($m[1], $m[2] ?? '');
    if (isset($routes[$path])) $routes[$path]();
    fail(404, 'Page not found.');
}
