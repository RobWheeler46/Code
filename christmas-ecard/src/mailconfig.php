<?php
// Email delivery settings in Admin: how email is sent (Postmark, the Group's own mail account, or not at all), the sender address, the logins,
// and a test email. What is saved here wins over the .env file. Passwords and tokens are write-only: they are never shown again, saving needs the
// administrator's own password, and the change history records which settings changed but never their values.

const MAIL_SECRETS = ['postmark_token' => 'POSTMARK_TOKEN', 'smtp_pass' => 'SMTP_PASS'];

function mail_status_lines(): array {
    $src = fn(string $k) => setting('mail_' . strtolower($k)) !== '' ? 'saved in Admin' : (env($k) !== '' ? 'from the .env file' : 'not set');
    return ['provider' => mail_provider(), 'token' => $src('POSTMARK_TOKEN'), 'smtp' => $src('SMTP_HOST'), 'pass' => $src('SMTP_PASS')];
}

/** Validates and saves the form. Returns [] on success or field => message. Blank secret fields keep what is stored. */
function mail_settings_save(array $in, array $user): array {
    $e = []; $set = [];
    $prov = (string)($in['provider'] ?? ''); if (!in_array($prov, ['', 'postmark', 'smtp', 'log'], true)) $e['provider'] = 'Choose how email is sent.';
    $from = trim((string)($in['from'] ?? '')); if ($from !== '' && !filter_var($from, FILTER_VALIDATE_EMAIL)) $e['from'] = 'Enter one email address, for example cards@7thswindon.org.uk.';
    $host = trim((string)($in['smtp_host'] ?? '')); if ($host !== '' && !preg_match('/^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/', $host)) $e['smtp_host'] = 'Enter just the server name, for example mail.7thswindon.org.uk (no http, no slashes).';
    $port = trim((string)($in['smtp_port'] ?? '')); if ($port !== '' && (!ctype_digit($port) || (int)$port < 1 || (int)$port > 65535)) $e['smtp_port'] = 'Enter a port number, usually 587 (or 465).';
    $sec = (string)($in['smtp_secure'] ?? 'tls'); if (!in_array($sec, ['tls', 'ssl', 'none'], true)) $e['smtp_secure'] = 'Choose tls, ssl or none.';
    $usr = trim((string)($in['smtp_user'] ?? '')); if (preg_match('/[\x00-\x1F\x7F]/', $usr) || strlen($usr) > 200) $e['smtp_user'] = 'That user name cannot be used.';
    $per = trim((string)($in['smtp_per_run'] ?? '')); if ($per !== '' && (!ctype_digit($per) || (int)$per < 1 || (int)$per > 200)) $e['smtp_per_run'] = 'Enter a number from 1 to 200.';
    $tok = (string)($in['postmark_token'] ?? ''); if (preg_match('/[\x00-\x20\x7F]/', $tok) || strlen($tok) > 200) $e['postmark_token'] = 'That token has characters it cannot have. Paste it again.';
    $pw = (string)($in['smtp_pass'] ?? ''); if (preg_match('/[\x00-\x1F\x7F]/', $pw) || strlen($pw) > 200) $e['smtp_pass'] = 'That password cannot be used.';
    if (!password_verify((string)($in['current'] ?? ''), (string)$user['pass'])) $e['current'] = 'Your own password was not right, so nothing was changed.';
    if ($prov === 'smtp' && $host === '' && mail_cfg('SMTP_HOST') === '') $e['smtp_host'] = 'Enter the mail server name to send through your own mail account.';
    if ($prov === 'postmark' && $tok === '' && mail_cfg('POSTMARK_TOKEN') === '' && empty($in['clear_postmark_token'])) $e['postmark_token'] = 'Enter the Postmark server token to send through Postmark.';
    if ($e) return $e;
    $before = array_map(fn($k) => setting($k), ['mail_provider', 'mail_mail_from', 'mail_smtp_host', 'mail_smtp_port', 'mail_smtp_secure', 'mail_smtp_user', 'mail_smtp_per_run']);
    $new = ['mail_provider' => $prov, 'mail_mail_from' => strtolower($from), 'mail_smtp_host' => strtolower($host), 'mail_smtp_port' => $port, 'mail_smtp_secure' => $sec, 'mail_smtp_user' => $usr, 'mail_smtp_per_run' => $per];
    $changed = []; foreach ($new as $k => $v) if ($v !== setting($k)) { set_setting($k, $v); $changed[] = $k; }
    if ($tok !== '') { set_setting('mail_postmark_token', $tok); $changed[] = 'mail_postmark_token'; } elseif (!empty($in['clear_postmark_token'])) { set_setting('mail_postmark_token', ''); $changed[] = 'mail_postmark_token cleared'; }
    if ($pw !== '') { set_setting('mail_smtp_pass', $pw); $changed[] = 'mail_smtp_pass'; } elseif (!empty($in['clear_smtp_pass'])) { set_setting('mail_smtp_pass', ''); $changed[] = 'mail_smtp_pass cleared'; }
    if ($changed) audit((int)$user['id'], 'mail_settings_changed', implode(', ', $changed)); // names only, never values
    return [];
}

/** Sends a test to the signed in administrator's own address, with what is saved now. Returns [ok, plain sentence]. */
function mail_test_send(array $user): array {
    $prov = mail_provider(); $name = ['postmark' => 'Postmark', 'smtp' => 'your own mail account', 'log' => 'the log only (nothing is sent)'][$prov];
    $err = mail_send($user['email'], 'Test email from the eCards service', "This is a test email from the 7th Swindon Scouts eCards service, sent through $name.\n\nIf you can read this, email sending works. You can ignore this message.");
    $ok = $err === null; $msg = $ok ? ($prov === 'log' ? 'Nothing was sent: email is set to "do not send", so the test was only written to the log.' : "The mail server accepted the test email for {$user['email']} (through $name). Check your inbox and your spam folder.")
        : 'The test did not go through. ' . preg_replace('/^(PERM|UNKNOWN):/', '', $err);
    set_setting('mail_test_result', ($ok ? 'ok' : 'failed') . '|' . time() . '|' . $prov); audit((int)$user['id'], 'mail_test', ($ok ? 'accepted' : 'failed') . " via $prov");
    return [$ok, $msg];
}

function r_admin_mail(): void {
    $u = need_admin(); if (!can('owner')) fail(403, 'You do not have permission for that.');
    $errs = $_SESSION['mail_errs'] ?? []; $old = $_SESSION['mail_old'] ?? null; unset($_SESSION['mail_errs'], $_SESSION['mail_old']);
    if (post()) {
        limit_for("mailcfg:{$u['id']}", 20, 3600);
        if (($_POST['do'] ?? '') === 'test') { limit_for("mailtest:{$u['id']}", 5, 3600); [$ok, $msg] = mail_test_send($u); flash($msg, $ok ? 'ok' : 'err'); redirect('/admin/mail'); }
        $e = mail_settings_save($_POST, $u);
        if ($e) { $_SESSION['mail_errs'] = $e; $_SESSION['mail_old'] = array_diff_key($_POST, ['smtp_pass' => 1, 'postmark_token' => 1, 'current' => 1]); flash('Nothing was saved. Please check the highlighted fields.', 'err'); redirect('/admin/mail'); }
        flash('Email settings saved. Use "Send a test email" to check them.'); redirect('/admin/mail');
    }
    $v = fn($k, $d = '') => h((string)($old[$k] ?? $d)); $first = true; $st = mail_status_lines();
    $res = explode('|', (string)setting('mail_test_result') . '||'); $last = $res[0] === '' ? 'No test has been sent yet.' : ('Last test: ' . ($res[0] === 'ok' ? 'accepted' : 'failed') . ' at ' . when((int)$res[1]) . ' (' . h($res[2]) . ').');
    $radio = fn($val, $label) => '<label class="opt"><input type="radio" name="provider" value="' . $val . '"' . (($old['provider'] ?? setting('mail_provider')) === $val ? ' checked' : '') . '> ' . $label . '</label>';
    $b = '<h1>Email delivery</h1><p class="lead">How the service sends email. What you save here takes the place of the values in the .env file.</p>'
        . '<section class="admincard"><h2>Now</h2><ul><li>Sending through: <strong>' . h(['postmark' => 'Postmark', 'smtp' => 'your own mail account (SMTP)', 'log' => 'nothing (emails are only written to a log)'][$st['provider']]) . '</strong></li><li>Postmark token: ' . h($st['token']) . '</li><li>Mail server: ' . h($st['smtp']) . '</li><li>Mail password: ' . h($st['pass']) . '</li><li>' . $last . '</li></ul>'
        . '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="test"><button class="btn">Send a test email to ' . h($u['email']) . '</button></form><p class="note">The test goes only to your own address and uses what is saved now.</p></section>'
        . '<form method="post" class="stack admincard" autocomplete="off">' . csrf() . '<h2>Change the settings</h2><fieldset><legend>How to send</legend>'
        . $radio('', 'Automatic (Postmark if a token is set, otherwise your own mail account if a server is set, otherwise log only)') . $radio('postmark', 'Postmark (best: bounce and delivery feedback)') . $radio('smtp', 'My own mail account (SMTP: no bounce or delivery feedback)') . $radio('log', 'Do not send, write to the log only (for testing)') . '</fieldset>'
        . '<label>Send from this address<input name="from" type="email" maxlength="200" value="' . $v('from', mail_cfg('MAIL_FROM', 'cards@7thswindon.org.uk')) . '"' . fa($errs, 'from', $first) . '>' . fe($errs, 'from') . '</label>'
        . '<section class="admincard"><h3>Postmark</h3><label>Server token (stored but never shown again; leave blank to keep the current one)<input name="postmark_token" type="password" autocomplete="new-password"' . fa($errs, 'postmark_token', $first) . '>' . fe($errs, 'postmark_token') . '</label><label class="opt"><input type="checkbox" name="clear_postmark_token" value="1"> Remove the saved token</label></section>'
        . '<section class="admincard"><h3>Your own mail account (SMTP)</h3><label>Mail server<input name="smtp_host" maxlength="253" value="' . $v('smtp_host', setting('mail_smtp_host') ?: env('SMTP_HOST')) . '" placeholder="mail.7thswindon.org.uk"' . fa($errs, 'smtp_host', $first) . '>' . fe($errs, 'smtp_host') . '</label>'
        . '<label>Port (usually 587, or 465 for ssl)<input name="smtp_port" inputmode="numeric" maxlength="5" value="' . $v('smtp_port', mail_cfg('SMTP_PORT', '587')) . '"' . fa($errs, 'smtp_port', $first) . '>' . fe($errs, 'smtp_port') . '</label>'
        . '<label>Connection security<select name="smtp_secure">' . implode('', array_map(fn($k, $l) => '<option value="' . $k . '"' . (($old['smtp_secure'] ?? strtolower(mail_cfg('SMTP_SECURE', 'tls'))) === $k ? ' selected' : '') . '>' . $l . '</option>', ['tls', 'ssl', 'none'], ['tls (port 587, the usual)', 'ssl (port 465)', 'none (not secure, only for testing)'])) . '</select></label>'
        . '<label>User name (usually the full mailbox address)<input name="smtp_user" maxlength="200" value="' . $v('smtp_user', mail_cfg('SMTP_USER')) . '"' . fa($errs, 'smtp_user', $first) . '>' . fe($errs, 'smtp_user') . '</label>'
        . '<label>Password (stored but never shown again; leave blank to keep the current one)<input name="smtp_pass" type="password" autocomplete="new-password"' . fa($errs, 'smtp_pass', $first) . '>' . fe($errs, 'smtp_pass') . '</label><label class="opt"><input type="checkbox" name="clear_smtp_pass" value="1"> Remove the saved password</label>'
        . '<label>Emails to send each time the queue runs (every 5 minutes; keep it under your host\'s hourly limit)<input name="smtp_per_run" inputmode="numeric" maxlength="3" value="' . $v('smtp_per_run', mail_cfg('SMTP_PER_RUN', '20')) . '"' . fa($errs, 'smtp_per_run', $first) . '>' . fe($errs, 'smtp_per_run') . '</label></section>'
        . '<label>Your own password, to confirm it is you<input name="current" type="password" autocomplete="current-password" required' . fa($errs, 'current', $first) . '>' . fe($errs, 'current') . '</label>'
        . '<p class="note">Saved passwords and tokens are kept in the service\'s database, outside the public web folder, and are included in the encrypted backup. They are never displayed again. The change history records which settings changed, never their values.</p><button class="btn">Save email settings</button></form>';
    admin_page('Email delivery', $b);
}
