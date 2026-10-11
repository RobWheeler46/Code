<?php
// FR-005: a sender's own account page. Name, email, password and email preferences in one place. Changing the email or the password
// asks for the current password, and an email change only takes effect once the new address has been confirmed.

function acct_mask(string $e): string { [$l, $d] = explode('@', $e . '@') + ['', '']; return substr($l, 0, 1) . str_repeat('*', max(1, strlen($l) - 1)) . '@' . $d; }

function r_account(): void {
    $u = need_login();
    if (post()) {
        $do = (string)($_POST['do'] ?? ''); $uid = (int)$u['id'];
        limit('account', 30, 3600); limit_for("account:$uid", 20, 3600);
        $pw = (string)($_POST['current'] ?? ''); $okPw = $pw !== '' && password_verify($pw, (string)$u['pass']);
        if ($do === 'name') {
            $n = field('name', 80);
            if ($n === '') flash('Please enter your name.', 'err'); else { q('update users set name=? where id=?', [$n, $uid]); flash('Your name has been saved.'); }
        } elseif ($do === 'email') {
            $e = strtolower(field('email'));
            if (!$okPw) flash('Your current password was not right, so nothing was changed.', 'err');
            elseif (!filter_var($e, FILTER_VALIDATE_EMAIL) || $e === $u['email'] || one('select 1 from users where email=? and id<>?', [$e, $uid])) flash('That email cannot be used. Check it and try again.', 'err');
            else {
                $t = token(); q('update users set pending_email=?, pending_token=?, pending_exp=? where id=?', [$e, hash('sha256', $t), time() + 3600, $uid]);
                mail_send($e, 'Confirm your new email address', "Please confirm this is your new email address for 7th Swindon Scouts Christmas Cards. The link works for one hour and only while you are signed in.\n" . base_url() . "/account/confirm-email?t=$t\n\nIf you did not ask for this, ignore this email and nothing will change.");
                mail_send($u['email'], 'A change of email address was requested', "Someone asked to change the email address on your 7th Swindon Scouts Christmas Cards account to " . acct_mask($e) . ". Nothing changes until that address is confirmed. If this was not you, change your password now and contact " . support_email() . '.');
                audit($uid, 'account_email_requested', "user $uid"); flash('We have sent a confirmation link to ' . $e . '. Your email stays the same until you open it.');
            }
        } elseif ($do === 'password') {
            $new = (string)($_POST['new'] ?? '');
            if (!$okPw) flash('Your current password was not right, so nothing was changed.', 'err');
            elseif (strlen($new) < 10) flash('Your new password must be at least 10 characters.', 'err');
            elseif ($new !== (string)($_POST['again'] ?? '')) flash('The two new passwords did not match.', 'err');
            elseif ($new === $pw) flash('Please choose a password you have not used here before.', 'err');
            else {
                q('update users set pass=? where id=?', [password_hash($new, PASSWORD_DEFAULT), $uid]); session_regenerate_id(true);
                mail_send($u['email'], 'Your password was changed', "The password on your 7th Swindon Scouts Christmas Cards account was just changed. If this was not you, reset it now from the sign in page and contact " . support_email() . '.');
                audit($uid, 'account_password_changed', "user $uid"); flash('Your password has been changed.');
            }
        }
        redirect('/account');
    }
    $u = one('select * from users where id=?', [$u['id']]);
    $b = '<h1>Your account</h1>'
        . '<section class="admincard"><h2>Your name</h2><form method="post" class="stack">' . csrf() . '<input type="hidden" name="do" value="name"><label>Name<input name="name" maxlength="80" value="' . h($u['name']) . '" required autocomplete="name"></label><button class="btn alt">Save name</button></form></section>'
        . '<section class="admincard"><h2>Your email address</h2><p>' . h($u['email']) . ($u['verified'] ? ' (confirmed)' : ' (not confirmed yet)') . '</p>'
        . ($u['pending_email'] && (int)$u['pending_exp'] > time() ? '<p class="flash warn" role="status">Waiting for you to confirm ' . h($u['pending_email']) . '. Open the link we emailed there.</p>' : '')
        . '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="do" value="email"><label>New email address<input type="email" name="email" required autocomplete="email"></label><label>Your current password (to confirm it is you)<input type="password" name="current" required autocomplete="current-password"></label><button class="btn alt">Change email address</button></form></section>'
        . '<section class="admincard"><h2>Your password</h2><form method="post" class="stack">' . csrf() . '<input type="hidden" name="do" value="password"><label>Current password<input type="password" name="current" required autocomplete="current-password"></label><label>New password (at least 10 characters)<input type="password" name="new" required minlength="10" autocomplete="new-password"></label><label>New password again<input type="password" name="again" required minlength="10" autocomplete="new-password"></label><button class="btn alt">Change password</button></form></section>'
        . '<section class="admincard"><h2>Email preferences</h2><form method="post" action="/prefs" class="stack">' . csrf() . '<input type="hidden" name="back" value="/account"><label>Optional status emails<select name="notify">'
        . implode('', array_map(fn($k, $l) => '<option value="' . $k . '"' . ($u['notify'] === $k ? ' selected' : '') . '>' . $l . '</option>', ['off', 'viewed', 'summary'], ['Off (default)', 'Email me when a card is opened', 'One daily summary']))
        . '</select></label><label class="opt"><input type="checkbox" name="remind" value="1"' . ($u['remind'] ? ' checked' : '') . '> Remind me once a year when the service opens</label><button class="btn alt">Save preferences</button></form></section>'
        . '<section class="admincard"><h2>Close your account</h2><p>You can delete your account, your address book and your drafts. <a href="/account/delete">Delete my account</a></p></section>'
        . '<p><a class="btn alt" href="/dashboard">Back to my cards</a></p>';
    page('Your account', $b);
}

/** The link in the confirmation email. Works once, for an hour, and only for the signed in person it was made for. */
function r_account_confirm_email(): void {
    $u = need_login(); $t = (string)($_GET['t'] ?? '');
    $ok = $t !== '' && $u['pending_token'] && hash_equals((string)$u['pending_token'], hash('sha256', $t)) && (int)$u['pending_exp'] > time() && $u['pending_email'];
    if (!$ok) { flash('That link is not valid any more. Ask for a new one from your account page.', 'err'); redirect('/account'); }
    $new = (string)$u['pending_email'];
    if (one('select 1 from users where email=? and id<>?', [$new, $u['id']])) { q("update users set pending_email=null, pending_token=null, pending_exp=0 where id=?", [$u['id']]); flash('That email address has been taken by someone else. Please choose another.', 'err'); redirect('/account'); }
    $old = $u['email']; q("update users set email=?, verified=1, verify_token='', pending_email=null, pending_token=null, pending_exp=0 where id=?", [$new, $u['id']]);
    mail_send($old, 'Your email address was changed', "The email address on your 7th Swindon Scouts Christmas Cards account was changed to " . acct_mask($new) . ". If this was not you, contact " . support_email() . ' straight away.');
    audit((int)$u['id'], 'account_email_changed', 'user ' . (int)$u['id']); flash('Your email address is now ' . $new . '.'); redirect('/account');
}
