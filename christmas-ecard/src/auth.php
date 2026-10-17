<?php
// Registering, signing in, passwords, two step sign in, email preferences and deleting an account.

/** Where a new sender goes after registering: back to the card they were sending, when they came from one. */
function register_next(): string { $n = (string)($_POST['next'] ?? $_GET['next'] ?? ''); return preg_match('#^/review\?id=\d+$#', $n) ? $n : ''; }
function r_register(): void {
    $next = register_next();
    if (post()) {
        honeypot();
        limit('reg', 10, 3600);
        $n = field('name', 80); $e = strtolower(field('email')); $p = (string)($_POST['password'] ?? '');
        if (empty($_POST['accept'])) { flash('Please confirm you are 18 or over and accept the terms.', 'err'); redirect('/register'); }
        if (!$n || !filter_var($e, FILTER_VALIDATE_EMAIL) || strlen($p) < 10) { flash('Please give your name, a valid email and a password of at least 10 characters.', 'err'); redirect('/register'); }
        if (one('select 1 from users where email=?', [$e])) { flash('That email is already registered. Try signing in.', 'err'); redirect('/login'); }
        $t = token();
        q('insert into users(name,email,pass,verify_token,created,terms_version,terms_at,remind) values(?,?,?,sha256(?),?,?,?,?)', [$n, $e, password_hash($p, PASSWORD_DEFAULT), $t, time(), TERMS_VERSION, time(), empty($_POST['remind']) ? 0 : 1]);
        $uid = (int)db()->lastInsertId(); $keep = $_SESSION['drafts'] ?? [];
        session_regenerate_id(true); $_SESSION['uid'] = $uid; $_SESSION['drafts'] = $keep; claim_drafts($uid);
        mail_send($e, 'Confirm your email for ' . SITE_NAME, "Hello $n,\n\nPlease confirm your email address. We will take you back to your saved card.\n" . base_url() . "/verify?t=$t\n");
        flash('Welcome! Your card is saved. Check your email and click the link to verify before sending.');
        redirect($next ?: (($d = one("select id from sends where user_id=? and status='draft' order by id desc", [$uid])) ? '/compose?id=' . $d['id'] : '/dashboard'));
    }
    page('Register', ($next ? '<h1>Create your free account</h1><p class="lead">Your card is saved and waiting. It takes a minute: a name, an email and a password. We then email you a link to confirm your address, and you can send your card.</p>' : '<h1>Register</h1><p>You need an account to send, so we can verify who is sending. Your card stays saved.</p>') . '<form method="post" class="stack">' . csrf() . ($next ? '<input type="hidden" name="next" value="' . h($next) . '">' : '') . '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password (10+ characters)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><label class="opt"><input type="checkbox" name="accept" value="1" required> I am 18 or over and I accept the <a href="/terms">terms and safeguarding statement</a> and have read the <a href="/privacy">privacy notice</a></label><label class="opt"><input type="checkbox" name="remind" value="1"> Email me once a year to remind me to send Christmas cards (optional)</label>' . hp_field() . '<button class="btn">Create account</button></form><p>Already registered? <a href="/login' . ($next ? '?next=' . urlencode($next) : '') . '">Sign in</a></p>');
}

function r_verify(): void {
    $u = one('select * from users where verify_token=sha256(?) and verify_token<>\'\'', [(string)($_GET['t'] ?? '')]);
    if (!$u) { flash('That verification link is not valid. Sign in to request a new one.', 'err'); redirect('/dashboard'); }
    q("update users set verified=1, verify_token='' where id=?", [$u['id']]);
    bootstrap_admin((int)$u['id']);
    flash('Email verified. You can now send your card.');
    $d = one("select id from sends where user_id=? and status='draft' order by updated desc", [$u['id']]);
    redirect($d ? '/review?id=' . $d['id'] : '/dashboard'); // back to the saved draft (need_login handles a new tab/browser)
}

function r_resend_verify(): void {
    $u = need_login(); limit('resendv', 3, 3600);
    if (!$u['verified']) {
        $t = token(); q('update users set verify_token=sha256(?) where id=?', [$t, $u['id']]);
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
        $_SESSION['uid'] = (int)$u['id']; $_SESSION['mfa'] = false; bootstrap_admin((int)$u['id']); q('update users set last_login=? where id=?', [time(), $u['id']]); $_SESSION['drafts'] = $keep; claim_drafts((int)$u['id']);
        redirect(safe_next($_POST['next'] ?? ''));
    }
    page('Sign in', '<h1>Sign in</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="next" value="' . h($_GET['next'] ?? '') . '"><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="btn">Sign in</button></form><p><a href="/forgot">Forgotten your password?</a> &middot; <a href="/register' . (preg_match('#^/review\?id=\d+$#', (string)($_GET['next'] ?? '')) ? '?next=' . urlencode($_GET['next']) : '') . '">Register</a></p>');
}

function r_logout(): void { $_SESSION = []; session_destroy(); redirect('/'); }

function r_forgot(): void {
    if (post()) {
        honeypot();
        limit('forgot', 5, 3600); limit_for('forgot:' . strtolower(field('email')), 3, 3600);
        if ($u = one('select * from users where email=?', [strtolower(field('email'))])) {
            $t = token();
            q('update users set reset_token=sha256(?), reset_exp=? where id=?', [$t, time() + 3600, $u['id']]);
            mail_send($u['email'], 'Reset your password', "Reset your password (valid for one hour):\n" . base_url() . "/reset?t=$t\n");
        }
        flash('If that email is registered, a reset link is on its way.'); redirect('/login');
    }
    page('Forgotten password', '<h1>Forgotten password</h1><form method="post" class="stack">' . csrf() . '<label>Email<input type="email" name="email" required></label>' . hp_field() . '<button class="btn">Send reset link</button></form>');
}

function r_reset(): void {
    $t = (string)($_GET['t'] ?? $_POST['t'] ?? '');
    $u = $t === '' ? null : one('select * from users where reset_token=sha256(?) and reset_exp>?', [$t, time()]);
    if (!$u) { flash('That reset link has expired.', 'err'); redirect('/forgot'); }
    if (post()) {
        $p = (string)($_POST['password'] ?? '');
        if (strlen($p) < 10) { flash('Password must be at least 10 characters.', 'err'); redirect('/reset?t=' . urlencode($t)); }
        q("update users set pass=?, reset_token='', reset_exp=0 where id=?", [password_hash($p, PASSWORD_DEFAULT), $u['id']]);
        flash('Password changed. Please sign in.'); redirect('/login');
    }
    page('Reset password', '<h1>Choose a new password</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="t" value="' . h($t) . '"><label>New password<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><button class="btn">Save password</button></form>');
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

function r_prefs(): void {
    $u = need_login();
    if (post()) { q('update users set notify=?, remind=? where id=?', [in_array($_POST['notify'] ?? '', ['viewed', 'summary']) ? $_POST['notify'] : 'off', empty($_POST['remind']) ? 0 : 1, $u['id']]); flash('Email preferences saved.'); }
    redirect(safe_next((string)($_POST['back'] ?? '')));
}

function r_change_email(): void { // wrong-address correction before verification
    $u = need_login();
    if (post() && !$u['verified']) {
        limit('chgmail', 5, 3600);
        $e = strtolower(field('email'));
        if (!filter_var($e, FILTER_VALIDATE_EMAIL) || one('select 1 from users where email=? and id<>?', [$e, $u['id']])) { flash('That email cannot be used. Check it and try again.', 'err'); redirect('/dashboard'); }
        $t = token(); q('update users set email=?, verify_token=sha256(?) where id=?', [$e, $t, $u['id']]);
        mail_send($e, 'Confirm your email', "Please confirm your email address. We will take you back to your saved card.\n" . base_url() . "/verify?t=$t\n");
        flash('Email changed to ' . $e . '. We have sent a new verification link there.');
    }
    redirect('/dashboard');
}

/** FR-127: authenticated account deletion with explicit impact, reauthentication and category-specific retention. */
function r_account_delete(): void {
    $u = need_login(); $uid = (int)$u['id'];
    $mine = array_column(all('select id from sends where user_id=?', [$uid]), 'id'); $in = $mine ? implode(',', array_map('intval', $mine)) : '0';
    $c = ['contacts' => (int)one('select count(*) c from contacts where user_id=?', [$uid])['c'], 'groups' => (int)one('select count(*) c from groups where user_id=?', [$uid])['c'],
        'drafts' => (int)one("select count(*) c from sends where user_id=? and status='draft'", [$uid])['c'],
        'queued' => (int)one("select count(*) c from recipients where send_id in ($in) and status='queued'")['c'],
        'claimed' => (int)one("select count(*) c from recipients where send_id in ($in) and status in ('sending','sent')")['c'],
        'pending' => (int)one("select count(*) c from sends where user_id=? and status='awaiting_payment'", [$uid])['c']];
    if (post()) {
        limit('acctdel', 5, 3600);
        if (!password_verify((string)($_POST['password'] ?? ''), $u['pass'])) { flash('That password is not right, so nothing was deleted.', 'err'); redirect('/account/delete'); }
        if ($c['pending']) { flash('You have a payment waiting. Resolve it from My cards first.', 'warn'); redirect('/account/delete'); }
        if ($u['is_admin']) { flash('Ask an owner to remove your administrator access first.', 'warn'); redirect('/account/delete'); }
        if (empty($_POST['confirmed'])) { flash('Please tick the box to confirm.', 'err'); redirect('/account/delete'); }
        db()->beginTransaction();
        q("update recipients set status='cancelled', error='Account closed' where send_id in ($in) and status='queued'");   // unclaimed only
        q("update recipients set withdrawn=1 where send_id in ($in) and status<>'draft'");                                  // live links switched off
        q("delete from recipients where send_id in (select id from sends where user_id=? and status='draft')", [$uid]); q("delete from sends where user_id=? and status='draft'", [$uid]);
        q('delete from contact_groups where contact_id in (select id from contacts where user_id=?)', [$uid]); q('delete from contacts where user_id=?', [$uid]); q('delete from groups where user_id=?', [$uid]); q('delete from user_favourite_designs where user_id=?', [$uid]);
        q("update users set name='Deleted account', email=?, pass='', verified=0, verify_token='', reset_token='', roles='', is_admin=0, totp_secret=null, notify='off' where id=?", ["deleted-$uid@deleted.invalid", $uid]);
        db()->commit();
        audit($uid, 'account_deleted', "contacts {$c['contacts']}, groups {$c['groups']}, drafts {$c['drafts']}, cancelled {$c['queued']}, withdrawn {$c['claimed']}");
        $_SESSION = []; session_destroy(); session_start(); flash('Your account has been closed. Unsent cards were cancelled and your saved details were deleted.'); redirect('/');
    }
    page('Delete my account', '<h1>Delete my account</h1><p>This closes your account and signs you out everywhere. It cannot be undone.</p><ul>'
        . '<li>Deleted: ' . $c['contacts'] . ' saved contacts, ' . $c['groups'] . ' groups and ' . $c['drafts'] . ' drafts.</li>'
        . '<li>Cancelled: ' . $c['queued'] . ' cards that have not started sending.</li>'
        . '<li>Switched off: the private links of ' . $c['claimed'] . ' cards already sent. Emails already sent cannot be recalled.</li></ul>'
        . '<p class="note">We keep, separately and protected: donation and finance records, an audit record that this happened, and opt-out records (so people who asked to stop are not emailed again). Your donations are not refunded.</p>'
        . ($c['pending'] ? '<p class="flash warn">You have a payment waiting. Resolve it first.</p>' : '')
        . '<form method="post" class="stack">' . csrf() . '<label>Your password (to confirm it is you)<input type="password" name="password" required autocomplete="current-password"></label><label class="opt"><input type="checkbox" name="confirmed" value="1"> I understand and want to delete my account</label><button class="btn">Delete my account</button><a class="btn alt" href="/dashboard">Keep my account</a></form>');
}
