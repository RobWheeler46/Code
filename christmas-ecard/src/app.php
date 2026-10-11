<?php
require __DIR__ . '/lib.php';
require __DIR__ . '/cards.php';
require __DIR__ . '/core.php';
require __DIR__ . '/ops.php';
require __DIR__ . '/legal.php';
require __DIR__ . '/contacts.php';
require __DIR__ . '/admin.php';
require __DIR__ . '/admin2.php';
require __DIR__ . '/admin3.php';
require __DIR__ . '/giftaid.php';
require __DIR__ . '/resilience.php';
require __DIR__ . '/library.php';
require __DIR__ . '/uploads.php';
require __DIR__ . '/library_admin.php';
require __DIR__ . '/campaigns.php';
require __DIR__ . '/qr.php';
require __DIR__ . '/account.php';
require __DIR__ . '/invites.php';
require __DIR__ . '/smtp.php';
require __DIR__ . '/mailconfig.php';
require __DIR__ . '/workspace.php';

function post(): bool { return $_SERVER['REQUEST_METHOD'] === 'POST'; }
function field(string $k, int $max = 200): string { return mb_substr(trim((string)($_POST[$k] ?? '')), 0, $max); }
function support_email(): string { return setting('support_email') ?: env('SUPPORT_EMAIL', 'cards@7thswindon.org.uk'); }
/** Extra Help questions written in Admin: blocks separated by a blank line, the question on the first line and the answer below. */
function faq_parse(string $raw): array { $o = []; foreach (preg_split("/\n\s*\n/", trim(str_replace("\r", '', $raw))) as $blk) { $l = explode("\n", trim($blk), 2); if (count($l) === 2 && trim($l[0]) !== '' && trim($l[1]) !== '') $o[trim($l[0])] = trim($l[1]); } return $o; }
function when(?int $t): string { return $t ? date('j M Y H:i', $t) : ''; }
function fe(array $e, string $k): string { return empty($e[$k]) ? '' : '<span class="fe" id="e-' . $k . '">' . h(implode(' ', (array)$e[$k])) . '</span>'; }
function fa(array $e, string $k, bool &$first): string {
    if (empty($e[$k])) return '';
    $a = ' aria-invalid="true" aria-describedby="e-' . $k . '"' . ($first ? ' data-focus' : ''); $first = false; return $a;
}

function card_view(string $cardId, string $to, string $msg, string $from, string $note = '', ?string $artRef = null, ?int $vid = null): string {
    $c = card_meta($cardId, $vid) ?? cards()[$cardId]; // message is escaped plain text; URLs are never linked
    return '<article class="card">' . card_art($cardId, false, $artRef, $vid) . '<div class="inner">' . ($c['baked'] ? '' : '<h2>' . h($c['title']) . '</h2><p class="joke">' . h($c['joke']) . '</p>') . '<p class="to">Dear ' . h($to) . ',</p><p class="msg">' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong>' . h($from) . '</strong></p>' . ($note ? '<p class="note">' . h($note) . '</p>' : '') . '</div></article>';
}
function gone_page(array $r, string $title, string $why): never {
    page($title, '<h1>' . h($title) . '</h1><p>' . h($why) . '</p><p>If you have a question, email <a href="mailto:' . h(support_email()) . '">' . h(support_email()) . '</a> and quote reference <strong>' . h(support_ref($r)) . '</strong>.</p><p><a class="btn" href="/">Send a card of your own</a></p>', 410);
}
function progress(): int { return (int)one('select coalesce(sum(pence-refunded),0) n from donations')['n']; }

// ---------- public
function r_home(): void {
    if (preg_match('/^[a-z0-9-]{1,30}$/', (string)($_GET['ref'] ?? ''))) $_SESSION['ref'] = $_GET['ref']; // promotion source label only, never a person
    $st = campaign_state();
    $b = '<section class="hero"><div><p class="eyebrow">7th Swindon Scouts Christmas cards</p><h1>Send a little Christmas cheer, Scout style</h1><p class="lead">Pick a design, write your message and we will email a private card to your friends and family. Sending is free, and a donation is optional.</p><p><a class="btn big" href="#gallery">Choose a card</a> <a class="btn ghost" href="#how">How it works</a></p></div><div class="heroart" aria-hidden="true">' . (($hero = hero_for_session()) ? card_art($hero) : '') . '</div></section>';
    if ($st === 'locked') $b .= '<p class="flash warn">Sending is not open yet. You can prepare a card now.</p>';
    if ($st === 'before') $b .='<p class="flash warn">Sending opens on ' . h(date('j F Y \a\t H:i', strtotime(setting('opens')))) . '. You can prepare a card now.</p>';
    if ($st === 'closed') $b .= '<p class="flash warn">This year\'s card sending has closed. Cards already sent stay viewable until they expire.</p>';
    $t = (int)setting('target_pence');
    if (setting('show_progress') === '1' && $t) $b .= '<p class="progress">Raised so far: <strong>' . gbp(progress()) . '</strong> of ' . gbp($t) . ' target (confirmed donations, after refunds).</p>';
    $b .= '<h2 id="how">How it works</h2><ol class="how"><li><b>1</b><strong>Choose a design</strong>Illustrated Scout themed cards, from tents to campfires.</li><li><b>2</b><strong>Write your message</strong>Add up to ' . max_recipients() . ' people. Give anyone a personal note if you like.</li><li><b>3</b><strong>We send each card</strong>Everyone gets their own private link and opens a Christmas envelope.</li></ol>'
        . '<section class="cause"><h2>Every card helps local Scouting</h2><p>' . h(setting('donation_purpose') ?: 'Any donation goes straight to 7th Swindon Scouts.') . '</p><p>Sending is always free. You never have to donate, and a donation never changes how your card looks.</p></section>'
        . '<h2 id="gallery">Pick a design</h2><div class="grid">';
    foreach (gallery_cards() as $id => $c)
        $b .= '<a class="tile" href="/compose?card=' . h($id) . '">' . card_art($id, true) . '<span>' . h($c['title']) . '</span><em class="tjoke">' . h($c['joke']) . '</em></a>';
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
        'How do you decide a card was viewed?' => 'A card counts as Viewed only when the recipient deliberately presses Open your card. Opening the email, or a security scanner fetching the link, does not count. If someone reads the card without that step we cannot tell, so it shows as not confirmed. Viewed never means we know who read it.',
        'Can I delete my account?' => 'Yes, from the bottom of My cards. It cancels cards that have not started sending, deletes your saved contacts and groups, and switches off the links of the cards you sent. Finance records and opt-out records are kept separately.',
        'I received a card I do not want' => 'Open the card and use "Report this card", or use the "stop cards" link at the bottom of the email.',
    ];
    $b = '<h1>Help and FAQ</h1>';
    foreach ($faq as $q => $a) $b .= '<details><summary>' . h($q) . '</summary><p>' . (str_contains($a, $e) ? $a : h($a)) . '</p></details>';
    foreach (faq_parse(setting('help_extra')) as $q => $a) $b .= '<details><summary>' . h($q) . '</summary><p>' . nl2br(h($a)) . '</p></details>'; // extra questions are always escaped
    page('Help', $b . '<p>Still stuck? Email <a href="mailto:' . $e . '">' . $e . '</a>.</p>');
}

function r_register(): void {
    if (post()) {
        honeypot();
        limit('reg', 10, 3600);
        $n = field('name', 80); $e = strtolower(field('email')); $p = (string)($_POST['password'] ?? '');
        if (empty($_POST['accept'])) { flash('Please confirm you are 18 or over and accept the terms.', 'err'); redirect('/register'); }
        if (!$n || !filter_var($e, FILTER_VALIDATE_EMAIL) || strlen($p) < 10) { flash('Please give your name, a valid email and a password of at least 10 characters.', 'err'); redirect('/register'); }
        if (one('select 1 from users where email=?', [$e])) { flash('That email is already registered. Try signing in.', 'err'); redirect('/login'); }
        $t = token();
        q('insert into users(name,email,pass,verify_token,created,terms_version,terms_at,remind) values(?,?,?,?,?,?,?,?)', [$n, $e, password_hash($p, PASSWORD_DEFAULT), $t, time(), TERMS_VERSION, time(), empty($_POST['remind']) ? 0 : 1]);
        $uid = (int)db()->lastInsertId(); $keep = $_SESSION['drafts'] ?? [];
        session_regenerate_id(true); $_SESSION['uid'] = $uid; $_SESSION['drafts'] = $keep; claim_drafts($uid);
        mail_send($e, 'Confirm your email for 7th Swindon Scouts Christmas Cards', "Hello $n,\n\nPlease confirm your email address. We will take you back to your saved card.\n" . base_url() . "/verify?t=$t\n");
        flash('Welcome! Your card is saved. Check your email and click the link to verify before sending.');
        redirect(($d = one("select id from sends where user_id=? and status='draft' order by id desc", [$uid])) ? '/compose?id=' . $d['id'] : '/dashboard');
    }
    page('Register', '<h1>Register</h1><p>You need an account to send, so we can verify who is sending. Your card stays saved.</p><form method="post" class="stack">' . csrf() . '<label>Your name<input name="name" required maxlength="80" autocomplete="name"></label><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password (10+ characters)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label><label class="opt"><input type="checkbox" name="accept" value="1" required> I am 18 or over and I accept the <a href="/terms">terms and safeguarding statement</a> and have read the <a href="/privacy">privacy notice</a></label><label class="opt"><input type="checkbox" name="remind" value="1"> Email me once next year when the Christmas card service opens again (optional)</label>' . hp_field() . '<button class="btn">Create account</button></form><p>Already registered? <a href="/login">Sign in</a></p>');
}

function r_verify(): void {
    $u = one('select * from users where verify_token=? and verify_token<>\'\'', [(string)($_GET['t'] ?? '')]);
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
        $_SESSION['uid'] = (int)$u['id']; $_SESSION['mfa'] = false; bootstrap_admin((int)$u['id']); q('update users set last_login=? where id=?', [time(), $u['id']]); $_SESSION['drafts'] = $keep; claim_drafts((int)$u['id']);
        redirect(safe_next($_POST['next'] ?? ''));
    }
    page('Sign in', '<h1>Sign in</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="next" value="' . h($_GET['next'] ?? '') . '"><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Password<input type="password" name="password" required autocomplete="current-password"></label><button class="btn">Sign in</button></form><p><a href="/forgot">Forgotten your password?</a> &middot; <a href="/register">Register</a></p>');
}

function r_logout(): void { $_SESSION = []; session_destroy(); redirect('/'); }

function r_forgot(): void {
    if (post()) {
        honeypot();
        limit('forgot', 5, 3600); limit_for('forgot:' . strtolower(field('email')), 3, 3600);
        if ($u = one('select * from users where email=?', [strtolower(field('email'))])) {
            $t = token();
            q('update users set reset_token=?, reset_exp=? where id=?', [$t, time() + 3600, $u['id']]);
            mail_send($u['email'], 'Reset your password', "Reset your password (valid for one hour):\n" . base_url() . "/reset?t=$t\n");
        }
        flash('If that email is registered, a reset link is on its way.'); redirect('/login');
    }
    page('Forgotten password', '<h1>Forgotten password</h1><form method="post" class="stack">' . csrf() . '<label>Email<input type="email" name="email" required></label>' . hp_field() . '<button class="btn">Send reset link</button></form>');
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
        if (!(cards()[$card]['on'] ?? false)) { flash('Please choose an available design.', 'err'); redirect($s ? '/compose?id=' . (int)$s['id'] : '/'); }
        $act = $_POST['act'] ?? 'save';
        $from = trim((string)($_POST['sender_name'] ?? '')) ?: ($u['name'] ?? ''); $msg = trim((string)($_POST['message'] ?? ''));
        $names = array_values((array)($_POST['r_name'] ?? [])); $emails = array_values((array)($_POST['r_email'] ?? [])); $msgs = array_values((array)($_POST['r_msg'] ?? [])); $paste = (string)($_POST['paste'] ?? '');
        $stash = fn(array $extra = []) => $_SESSION['old'] = array_merge(['card' => $card, 'sender_name' => (string)($_POST['sender_name'] ?? ''), 'message' => (string)($_POST['message'] ?? ''), 'r_name' => $names, 'r_email' => $emails, 'r_msg' => $msgs, 'paste' => $paste], $extra);
        if ($act === 'addrow' || preg_match('/^remove_(\d+)$/', $act, $mm)) { // rows only: keep everything typed, change the row list, no validation yet
            if (isset($mm)) foreach (['names', 'emails', 'msgs'] as $v) { array_splice($$v, (int)$mm[1], 1); }
            $stash(['r_name' => $names, 'r_email' => $emails, 'r_msg' => $msgs, 'addrow' => $act === 'addrow' ? 1 : 0]);
            redirect('/compose?' . ($s ? 'id=' . $s['id'] : 'card=' . urlencode($card)) . '#recipients');
        }
        [$rows, $rowErrs] = parse_rows($names, $emails, $msgs);
        [$prows, $perrs] = parse_recipients($paste); $have = array_flip(array_map(fn($r) => strtolower($r[1]), $rows));
        foreach ($prows as $pr) if (!isset($have[strtolower($pr[1])])) { $have[strtolower($pr[1])] = 1; $rows[] = $pr; } else $perrs[] = $pr[1] . ' is already on the card';
        $errs = $rowErrs;
        if ($perrs) $errs['paste'] = $perrs;
        if (count($rows) > max_recipients()) $errs['recipients'] = ['You can send to at most ' . max_recipients() . ' people at once.'];
        if (mb_strlen($from) > name_max()) $errs['sender_name'] = 'Please use ' . name_max() . ' characters or fewer.';
        if (mb_strlen($msg) > msg_max()) $errs['message'] = 'Please use ' . msg_max() . ' characters or fewer (you have ' . mb_strlen($msg) . ').';
        if (!isset($errs['message']) && $msg !== '' && ($bad = abuse_check($msg))) $errs['message'] = ucfirst($bad);
        if (!isset($errs['sender_name']) && $from !== '' && ($bad = abuse_check($from))) $errs['sender_name'] = ucfirst($bad);
        if ($act === 'continue') {
            if ($from === '') $errs['sender_name'] ??= 'Please say who the card is from.';
            if ($msg === '') $errs['message'] ??= 'Please write a message.';
            if (!$rows && !$errs) $errs['recipients'] = ['Add at least one recipient.'];
        }
        if ($errs) { // nothing is saved; every field and row comes back as typed
            $stash(); $_SESSION['errs'] = $errs;
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
            sender_gate($u, "/compose?id=$sid");
            limit('test', max(1, (int)setting('test_per_hour', '3')), 3600); limit_for("test:{$u['id']}", max(1, (int)setting('test_per_hour', '3')), 3600);
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
    $gone = '';
    if (!(cards()[$card]['on'] ?? false)) { // a saved draft keeps its message and recipients when its design is held back; a direct link to an unavailable design goes home
        if (!$s || !gallery_cards()) { flash('That design is not available. Please choose another.', 'warn'); redirect('/#gallery'); }
        $gone = '<p class="flash warn" role="status">The design you first chose is no longer available. Pick another below. Your message and recipients are safe.</p>'; $card = (string)array_key_first(gallery_cards());
    }
    $back = !$s && !empty($_GET['back']) && preg_match('/^[a-f0-9]{48}$/', $_GET['back']) ? one('select s.sender_name from recipients r join sends s on s.id=r.send_id where r.token_hash=sha256(?)', [$_GET['back']]) : null;
    $f = true;
    $rowsIn = [];
    if ($old && isset($old['r_email'])) { foreach ($old['r_email'] as $i => $em) $rowsIn[] = [(string)($old['r_name'][$i] ?? ''), (string)$em, (string)($old['r_msg'][$i] ?? '')]; if (!empty($old['addrow'])) $rowsIn[] = ['', '', '']; }
    elseif ($s) foreach (all('select * from recipients where send_id=? order by id', [$s['id']]) as $r) $rowsIn[] = [$r['name'], $r['email'], (string)$r['own_msg']];
    elseif ($back) $rowsIn[] = [$back['sender_name'], '', ''];
    if (!$rowsIn) $rowsIn[] = ['', '', ''];
    $rowsHtml = ''; $nrows = count($rowsIn);
    foreach ($rowsIn as $i => [$rn, $re, $rm]) {
        $rowsHtml .= '<div class="rrow" role="group" aria-label="Recipient ' . ($i + 1) . '"><label>Name<input name="r_name[]" maxlength="100" value="' . h($rn) . '"' . fa($errs, "name$i", $f) . '>' . fe($errs, "name$i") . '</label>'
            . '<label>Email<input type="email" name="r_email[]" value="' . h($re) . '"' . fa($errs, "email$i", $f) . '>' . fe($errs, "email$i") . '</label>'
            . '<details class="wide"' . ($rm !== '' || isset($errs["msg$i"]) ? ' open' : '') . '><summary>Personal message for this person (optional)</summary><label>Message<textarea name="r_msg[]" rows="2"' . fa($errs, "msg$i", $f) . '>' . h($rm) . '</textarea>' . fe($errs, "msg$i") . '</label></details>'
            . ($nrows > 1 ? '<button class="btn alt" name="act" value="remove_' . $i . '" aria-label="Remove recipient ' . ($i + 1) . '">Remove</button>' : '') . '</div>';
    }
    $recipientsHtml = '<fieldset id="recipients"><legend>Who is it for? (up to ' . max_recipients() . ')</legend>' . fe($errs, 'recipients') . $rowsHtml
        . ($nrows < max_recipients() ? '<button class="btn alt" name="act" value="addrow">Add another recipient</button>' : '<p class="note">That is the most you can send at once (' . max_recipients() . ').</p>')
        . ' <small class="count" data-recipient-count>' . $nrows . ' of ' . max_recipients() . '</small>'
        . '<details' . (isset($errs['paste']) || ($old['paste'] ?? '') !== '' ? ' open' : '') . '><summary>Paste several at once</summary><label>One per line as <em>Name, email</em><textarea name="paste" rows="4" placeholder="Gran, gran@example.com&#10;Uncle Bob, bob@example.com"' . fa($errs, 'paste', $f) . '>' . h($old['paste'] ?? '') . '</textarea>' . fe($errs, 'paste') . '</label></details></fieldset>';
    $from = $old['sender_name'] ?? $s['sender_name'] ?? ($u['name'] ?? ''); $msg = $old['message'] ?? $s['message'] ?? '';
    $opts = '';
    foreach (cards() as $id => $c) if ($c['on']) $opts .= '<option value="' . h($id) . '"' . ($id === $card ? ' selected' : '') . '>' . h($c['title']) . '</option>';
    $saved = $s ? '<p class="note" role="status">Draft saved at ' . date('H:i', (int)$s['updated']) . '.</p>' : '<p class="note">Not saved yet. Use Save draft to keep your work' . ($u ? '.' : ' (you will register before sending).') . '</p>';
    page('Write your card', steps(2) . $gone . '<h1>Write something wonderful</h1><p class="lead">Your message and everyone you are sending it to, together in one place.</p>' . ($u ? '' : '<p class="note">You can prepare your card now. Before it is sent you will create a free account and verify your email, and your card will wait for you.</p>')
        . '<div class="two"><div class="card preview" aria-label="Live preview">' . card_art($card) . '<p class="center"><a class="btn alt" href="/#gallery">Change design</a></p><div class="inner"><p class="msg" data-preview-msg>' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong data-preview-from>' . h($from) . '</strong></p></div></div><form method="post" class="stack" data-dirty-warn>' . csrf()
        . '<label>Design<select name="card">' . $opts . '</select></label>'
        . '<label>From (your name or family name)<input name="sender_name" maxlength="' . (name_max() + 20) . '" data-max="' . name_max() . '" value="' . h($from) . '"' . fa($errs, 'sender_name', $f) . '><small class="count">Up to ' . name_max() . ' characters</small>' . fe($errs, 'sender_name') . '</label>'
        . '<label>Your message<textarea name="message" rows="5" data-max="' . msg_max() . '"' . fa($errs, 'message', $f) . '>' . h($msg) . '</textarea><small class="count">Up to ' . msg_max() . ' characters</small>' . fe($errs, 'message') . '</label>'
        . '<details><summary>Need ideas? Greeting examples</summary><p class="note">Examples only. Choosing one adds it to your message, which you can then edit.</p><ul class="starters">' . implode('', array_map(fn($t) => '<li>' . h($t) . ' <button type="button" class="link" data-starter="' . h($t) . '">Use this</button></li>', STARTERS)) . '</ul></details>'
        . ($back ? '<p class="note">Sending a card back to ' . h($back['sender_name']) . ': add their email address below.</p>' : '')
        . $recipientsHtml
        . ($s && $u && $u['verified'] ? '<p><button class="btn alt" name="act" value="pick">Choose from address book</button></p>' : ($u ? '<p class="note">Save your draft and verify your email to choose from your address book.</p>' : ''))
        . '<p class="note">Only you can see your full recipient list. Each person gets a private, individual message.</p>' . $saved . '<div class="row"><button class="btn" name="act" value="continue">Review your card</button><button class="btn alt" name="act" value="preview">Preview</button><button class="btn alt" name="act" value="save">Save draft</button><button class="btn alt" name="act" value="test">Email me a test</button></div></form></div>');
}

/** FR-138: what the recipient will receive. Built from the real templates but with a dummy token, so no link opens a real card. */
function r_email_preview(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $r = one('select * from recipients where send_id=? order by id limit 1 offset ?', [$s['id'], max(0, (int)($_GET['n'] ?? 0))]) ?: one('select * from recipients where send_id=? order by id limit 1', [$s['id']]);
    $d = ['id' => 0, 'name' => $r['name'] ?? 'Friend', 'email' => 'recipient@example.com', 'token' => str_repeat('0', 48)];
    page('Email preview', '<h1>Email preview</h1><p>This is what ' . h($d['name']) . ' will get. The links here are examples and do not open a real card.</p>'
        . '<dl class="facts"><dt>From</dt><dd>' . h($s['sender_name']) . ' via 7th Swindon Scouts (' . h(mail_cfg('MAIL_FROM', 'cards@7thswindon.org.uk')) . ')</dd><dt>Subject</dt><dd>' . h(email_subject($s)) . '</dd></dl>'
        . '<h2>As most people will see it</h2><div class="emailpreview">' . email_html($d, $s) . '</div><h2>Plain text version</h2><pre>' . h(email_body($d, $s)) . '</pre><p><a class="btn" href="/review?id=' . $s['id'] . '">Back to review</a></p>');
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
    if (($r['payment_status'] ?? '') === 'paid') { confirm_payment((int)$s['id'], $s['stripe_session'], (int)$r['amount_total'], env('STRIPE_ACCOUNT'), (string)($r['payment_intent'] ?? '')); return 'paid'; }
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
    return '<ol class="steps" aria-label="Progress">' . implode('', array_map(fn($t, $i) => '<li' . ($i + 1 === $n ? ' aria-current="step"' : '') . '><span class="sn">' . ($i + 1) . '.</span><span class="sl"> ' . h($t) . '</span></li>', $l, array_keys($l))) . '</ol>';
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
    if ($s['status'] === 'draft' && !(cards()[$s['card']]['on'] ?? false)) { flash('The design you chose is no longer available. Pick another and your message and recipients are kept.', 'warn'); redirect('/compose?id=' . (int)$s['id']); }
    $id = (int)$s['id'];
    $rs = all('select * from recipients where send_id=? order by id', [$id]);
    $pending = $s['status'] === 'awaiting_payment';
    if (post()) {
        $do = $_POST['do'] ?? '';
        if ($do === 'send') $do = ($_POST['mode'] ?? '') === 'donate' ? 'donate' : 'free'; // one button, the radio says which
        if ($do === 'donate' && !campaign_allows($s, 'donation')) { flash('This campaign does not take donations. You can send your cards for free.', 'warn'); redirect("/review?id=$id"); }
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
        sender_gate($u, "/review?id=$id");
        if (campaign_state() !== 'open') { flash('Card sending is not open right now, so your card cannot be submitted. Your draft is saved.', 'warn'); redirect("/review?id=$id"); }
        if (!$rs || count($rs) > max_recipients() || $s['message'] === '') { flash('Your card needs a message and 1 to ' . max_recipients() . ' recipients.', 'err'); redirect("/compose?id=$id"); }
        if ($pending) { flash('You have a payment waiting. Check its status or cancel it first. Cards are not sent until that is resolved.', 'warn'); redirect("/review?id=$id"); }
        if (repeats_for($s) && empty($_POST['repeat_ok'])) { flash('Some recipients already have a card from you. Tick the box to send again on purpose.', 'err'); redirect("/review?id=$id"); }
        limit_for("submit:{$u['id']}", 5, 3600); // proposed D-02 default: 5 submissions an hour per account
        if ($do === 'free') { giftaid_save_pending($id, null); queue_send($id); flash('Cards are queued for sending.'); redirect("/send?id=$id&done=1"); }
        $pick = (string)($_POST['amount'] ?? '');
        $pence = $pick === 'custom' ? (int)round((float)($_POST['custom'] ?? 0) * 100) : (int)$pick;
        if ($pence < 100 || $pence > 50000) { flash('Choose a donation amount between £1 and £500, or choose "Send cards for free".', 'err'); redirect("/review?id=$id"); }
        $ga = null;
        if (giftaid_on() && campaign_allows($s, 'giftaid') && !empty($_POST['giftaid'])) { [$ga, $gerr] = giftaid_validate($_POST); if ($gerr) { $_SESSION['ga_old'] = $_POST; flash(implode(' ', $gerr), 'err'); redirect("/review?id=$id"); } }
        // one submission intent: only the request that wins this update may start a checkout
        if (!q("update sends set donation=?, donation_note=?, status='awaiting_payment', updated=? where id=? and status='draft'", [$pence, empty($_POST['donation_note']) ? 0 : 1, time(), $id])->rowCount()) redirect("/review?id=$id");
        giftaid_save_pending($id, $ga); freeze_art($id);
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
    if ($state !== 'open') $b .= '<p class="flash warn">Card sending is ' . (in_array($state, ['before', 'locked']) ? 'not open yet' : 'closed') . ', so you cannot submit this card. Your draft is saved.</p>';
    if (setting('paused') === '1') $b .= '<p class="note">Sending is briefly paused. Cards you submit will be queued and go out when it resumes.</p>';
    $b .= card_view($s['card'], $rs[0]['name'] ?? 'Friend', $rs ? resolved_msg($rs[0], $s) : $s['message'], $s['sender_name']) . '<h2>Sending to ' . count($rs) . ' ' . (count($rs) === 1 ? 'person' : 'people') . '</h2><p class="note">From: ' . h($s['sender_name']) . '. Each person sees the greeting shown here for them.</p><ul class="rlist">' . $list . '</ul><p><a href="/compose?id=' . $id . '">Edit card, message or recipients</a> &middot; <a href="/email-preview?id=' . $id . '">Preview the email</a></p>';
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
        if (!campaign_allows($s, 'donation')) $form .= '<div class="row"><button class="btn big" name="do" value="send">Send my cards for free</button></div><p class="note">Sending is free.</p>';
        else { $form .= '<fieldset class="sendopts"><legend>How would you like to send?</legend>'
            . '<label class="optcard"><input type="radio" name="mode" value="free"' . ($rec ? '' : ' checked') . '> <strong>Send for free</strong><span>Your cards are free to send. No payment needed.</span></label>'
            . '<label class="optcard"><input type="radio" name="mode" value="donate"' . ($rec ? ' checked' : '') . '> <strong>Make an optional donation</strong><span>' . h(setting('donation_purpose', 'Donations support 7th Swindon Scouts.')) . '</span></label>'
            . '<div class="donatebox"><p>One donation covers all ' . count($rs) . ' of your cards.</p><div class="chips">';
        foreach (array_map('intval', explode(',', setting('amounts_pence', '200,500,1000'))) as $a) $form .= '<label class="opt"><input type="radio" name="amount" value="' . $a . '"> ' . gbp($a) . '</label>';
        $form .= '<label class="opt"><input type="radio" name="amount" value="custom"> Other amount (£) <input type="number" name="custom" min="1" max="500" step="0.01" aria-label="Custom amount in pounds"></label></div>'
            . '<label class="opt"><input type="checkbox" name="donation_note" value="1"> Add a line to the cards saying they came with a donation to 7th Swindon Scouts (no amount is shown; only after payment is confirmed)</label>'
            . (campaign_allows($s, 'giftaid') ? giftaid_form_block() : '') . '</div>'
            . '<p class="total">Total <strong data-total>£0.00</strong></p><button class="btn big" name="do" value="send" data-send-btn>Send my cards for free</button><p class="note">Sending is always free. Nothing is charged unless you choose to donate.</p></fieldset>'; }
    }
    page('Review and send', $b . $form . '</form>');
}

function r_return(): void {
    $s = own_send((int)($_GET['id'] ?? 0));
    $cs = (string)($_GET['cs'] ?? '');
    if (preg_match('/^cs_[A-Za-z0-9_]+$/', $cs)) {
        $r = stripe('GET', "/checkout/sessions/$cs");
        if (($r['payment_status'] ?? '') === 'paid' && (string)($r['client_reference_id'] ?? '') === (string)$s['id'])
            confirm_payment((int)$s['id'], $cs, (int)$r['amount_total'], env('STRIPE_ACCOUNT'), (string)($r['payment_intent'] ?? ''));
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
    set_setting('last_stripe_hook', (string)time());
    exit(stripe_handle_event(json_decode($body, true) ?: []));
}

function r_postmark_hook(): void {
    if (!env('POSTMARK_HOOK_KEY') || !hash_equals(env('POSTMARK_HOOK_KEY'), (string)($_GET['k'] ?? ''))) { http_response_code(403); exit; }
    $e = json_decode((string)file_get_contents('php://input'), true) ?: [];
    exit(postmark_handle_event($e));
}

// ---------- sender dashboard
function r_dashboard(): void {
    $u = need_login();
    $b = '<h1>My cards</h1>' . ($u['verified'] ? '' : '<p class="flash warn">Please verify your email: click the link we sent to ' . h($u['email']) . '. You need this before sending. <form method="post" action="/resend-verification" class="inline">' . csrf() . '<button class="link">Send it again</button></form><details><summary>Wrong email address?</summary><form method="post" action="/change-email" class="row">' . csrf() . '<label>Correct email<input type="email" name="email" required></label><button class="btn alt">Change and resend</button></form></details></p>') . '<p><a class="btn" href="/">Create a new card</a></p>'
        . '<details class="admincard"><summary>Email preferences</summary><form method="post" action="/prefs" class="row">' . csrf() . '<label>Optional status emails<select name="notify">' . implode('', array_map(fn($k, $l) => '<option value="' . $k . '"' . ($u['notify'] === $k ? ' selected' : '') . '>' . $l . '</option>', ['off', 'viewed', 'summary'], ['Off (default)', 'Email me when a card is opened', 'One daily summary'])) . '</select></label><label class="opt"><input type="checkbox" name="remind" value="1"' . ($u['remind'] ? ' checked' : '') . '> Remind me once a year when the service opens</label><button class="btn alt">Save</button></form></details>';
    $rows = '';
    foreach (all('select * from sends where user_id=? order by id desc', [$u['id']]) as $s) {
        $c = [];
        foreach (all('select * from recipients where send_id=?', [$s['id']]) as $r) { $k = rstatus($r); $c[$k] = ($c[$k] ?? 0) + 1; }
        $sum = implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($c), $c));
        $link = $s['status'] === 'draft' ? "/compose?id={$s['id']}" : ($s['status'] === 'awaiting_payment' ? "/review?id={$s['id']}" : "/send?id={$s['id']}");
        $act = $s['status'] === 'draft' ? '<a class="btn" href="' . $link . '">Keep writing</a> <form method="post" action="/discard" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><button class="link">Discard draft</button></form>' : '<a class="btn alt" href="' . $link . '">See how it is going</a> <a href="/copy?id=' . $s['id'] . '">Send it again to someone</a>';
        $don = donation_state($s) === 'No donation' ? '' : '<br><small>' . h(donation_state($s)) . '</small>';
        $rows .= '<li class="cardrow"><div class="thumb">' . card_art($s['card'], true, $s['art_ref'] ?? null) . '</div><div><h3>' . h(cards()[$s['card']]['title'] ?? $s['card']) . ($s['status'] === 'draft' ? ' <span class="pill">Draft</span>' : '') . '</h3><p class="note">' . date('j M Y', (int)$s['created']) . ($sum ? ' &middot; ' . h($sum) : '') . $don . '</p><p>' . $act . '</p></div></li>';
    }
    $b .= $rows ? '<ul class="plain cardlist">' . $rows . '</ul>' : '<section class="next"><h2>No cards yet</h2><p>Your first card is only a few minutes away.</p><p><a class="btn big" href="/">Choose a design</a></p></section>';
    $d = all('select * from donations where user_id=? order by id desc', [$u['id']]);
    if ($d) $b .= '<h2>Donation history</h2><table><tr><th>Date</th><th>Amount</th><th>Reference</th></tr>' . implode('', array_map(fn($x) => '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td></tr>', $d)) . '</table>';
    page('My cards', $b . '<p><a href="/contacts">Address book</a> &middot; <a href="/account/delete">Delete my account</a></p>');
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
            $e = field('email'); $unconfirmed = $r && rstatus($r) === 'Delivery unconfirmed';
            if ($r && $unconfirmed && empty($_POST['understand'])) flash('Please tick the box to confirm you understand the first email may already have arrived.', 'err');
            elseif ($r && requeue_recipient((int)$r['id'], $e, (int)$u['id'], 'sender')) { process_queue(); flash('Updated. A fresh private link was made and the old one no longer works.'); }
            else flash('Could not update that address.', 'err');
        }
        redirect("/send?id=$sid");
    }
    $rows = ''; $queued = 0;
    foreach (all('select * from recipients where send_id=? order by id', [$sid]) as $r) {
        $st = rstatus($r); if ($r['status'] === 'queued') $queued++;
        $act = '';
        if ($st === 'Delivery unconfirmed') $act = '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><input type="hidden" name="rid" value="' . $r['id'] . '"><input type="email" name="email" value="' . h($r['email']) . '" required aria-label="Email for ' . h($r['name']) . '"><label class="opt"><input type="checkbox" name="understand" value="1"> The first email may already have arrived. Send again with a new link.</label><button class="btn alt">Resend</button></form>';
        elseif ($st === 'Failed') $act = '<form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><input type="hidden" name="rid" value="' . $r['id'] . '"><input type="email" name="email" value="' . h($r['email']) . '" required aria-label="Corrected email for ' . h($r['name']) . '"><button class="btn alt">Fix and resend</button></form><small>' . h($r['error']) . '</small>';
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
    $r = preg_match('/^[a-f0-9]{48}$/', $t) ? one("select * from recipients where (token_hash=sha256(?) or (token_hash is null and token=?)) and status in ('sent','sending','queued','failed','bounced')", [$t, $t]) : null;
    return $r ?: fail(404, 'We could not find that card. Please check the link in your email, or visit the Help page.');
}

function r_card(string $t, string $act = ''): void {
    $GLOBALS['bare'] = true; // recipients see the brand only, not account links
    $r = recipient_by_token($t);
    $s = one('select * from sends where id=?', [$r['send_id']]);
    if ($r['withdrawn']) gone_page($r, 'This card has been withdrawn', 'The card is no longer available.');
    if ($r['sent_at'] && time() > expiry_ts($r)) gone_page($r, 'This card has expired', 'Cards stay viewable for ' . expiry_days() . ' days after they are sent.');
    if (post() && $act === 'open') { if (!is_scanner() && q('update recipients set viewed_at=? where id=? and viewed_at is null', [time(), $r['id']])->rowCount()) notify_view($r, $s); redirect("/c/$t?o=1"); } // human click, not a link scanner
    if (post() && $act === 'report') {
        honeypot();
        limit('report', 5, 3600); limit_for("report:$t", 3, 3600);
        q('insert into reports(recipient_id,reason,created) values(?,?,?)', [$r['id'], field('reason', 500), time()]);
        flash('Thank you. We have received your report and will look into it.'); redirect("/c/$t");
    }
    $stop = '<p class="center"><a href="/optout/' . h($t) . '">Stop cards from ' . h($s['sender_name']) . ' or from this service</a></p>';
    if (empty($_GET['o'])) {
        page('A card for you', '<section class="envelope-wrap"><div class="envelope" aria-hidden="true"><div class="flap"></div><div class="seal"></div><div class="stamp"></div><div class="to">To ' . h($r['name']) . '</div></div><h1>A Christmas card for ' . h($r['name']) . '</h1><p class="lead">From ' . h($s['sender_name']) . '</p><form method="post" action="/c/' . h($t) . '/open">' . csrf() . '<button class="btn big">Open your card</button></form><p class="note">Press the button to open it.</p></section>' . $stop);
    }
    page('Your Christmas card', '<p class="center skip"><button type="button" class="link" data-skip>Skip animation</button></p><div class="reveal">' . card_view($s['card'], $r['name'], resolved_msg($r, $s), $s['sender_name'], card_note($s), $s['art_ref'] ?? null, isset($s['design_version_id']) ? (int)$s['design_version_id'] : null) . '</div><section class="next"><h2>Want to say thank you?</h2><p>Send ' . h($s['sender_name']) . ' a card of your own. It is free, and it only takes a minute.</p><p><a class="btn big" href="/compose?card=' . h($s['card']) . '&amp;back=' . h($t) . '">Send a card back</a> <a class="btn alt" href="/">Make a card for someone else</a></p></section><p class="center"><a href="/c/' . h($t) . '">Replay the envelope</a> &middot; <button type="button" class="link" data-print>Print this card</button><br><small class="note">A printed copy stays with you after this link expires.</small></p>'
        . '<details class="center"><summary>Report this card</summary><form method="post" action="/c/' . h($t) . '/report" class="stack">' . csrf() . '' . hp_field() . '<label>What is wrong?<textarea name="reason" maxlength="500" required></textarea></label><button class="btn alt">Send report</button></form></details>' . $stop);
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
    page('Reported card', '<h1>Reported card</h1>' . card_view($s['card'], $rep['name'], resolved_msg(one('select * from recipients where id=?', [$rep['recipient_id']]), $s), $s['sender_name'], '', $s['art_ref'] ?? null, isset($s['design_version_id']) ? (int)$s['design_version_id'] : null) . '<p><a href="/admin">Back</a></p>');
}

function r_prefs(): void {
    $u = need_login();
    if (post()) { q('update users set notify=?, remind=? where id=?', [in_array($_POST['notify'] ?? '', ['viewed', 'summary']) ? $_POST['notify'] : 'off', empty($_POST['remind']) ? 0 : 1, $u['id']]); flash('Email preferences saved.'); }
    redirect(safe_next((string)($_POST['back'] ?? '')));
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
        if ($u['is_admin']) { flash('Ask a restricted administrator to remove your admin roles first.', 'warn'); redirect('/account/delete'); }
        if (empty($_POST['confirmed'])) { flash('Please tick the box to confirm.', 'err'); redirect('/account/delete'); }
        db()->beginTransaction();
        q("update recipients set status='cancelled', error='Account closed' where send_id in ($in) and status='queued'");   // unclaimed only
        q("update recipients set withdrawn=1 where send_id in ($in) and status<>'draft'");                                  // live links switched off
        q("delete from recipients where send_id in (select id from sends where user_id=? and status='draft')", [$uid]); q("delete from sends where user_id=? and status='draft'", [$uid]);
        q('delete from contact_groups where contact_id in (select id from contacts where user_id=?)', [$uid]); q('delete from contacts where user_id=?', [$uid]); q('delete from groups where user_id=?', [$uid]);
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

function dispatch(string $path): void {
    private_headers($path);
    $routes = ['/' => 'r_home', '/help' => 'r_help', '/register' => 'r_register', '/verify' => 'r_verify', '/resend-verification' => 'r_resend_verify', '/login' => 'r_login', '/logout' => 'r_logout', '/forgot' => 'r_forgot', '/reset' => 'r_reset',
        '/compose' => 'r_compose', '/preview' => 'r_preview', '/email-preview' => 'r_email_preview', '/review' => 'r_review', '/pay-cancelled' => 'r_pay_cancelled', '/return' => 'r_return', '/dev/pay' => 'r_dev_pay', '/dashboard' => 'r_dashboard', '/send' => 'r_send', '/prefs' => 'r_prefs', '/remind-off' => 'r_remind_off', '/privacy' => 'r_privacy', '/terms' => 'r_terms', '/accept-terms' => 'r_accept_terms', '/account/delete' => 'r_account_delete', '/account' => 'r_account', '/admin/mail' => 'r_admin_mail', '/admin/platform' => 'r_admin_platform', '/invite' => 'r_invite', '/admin/invites' => 'r_admin_invites', '/account/confirm-email' => 'r_account_confirm_email', '/contacts' => 'r_contacts', '/contacts/edit' => 'r_contact_edit', '/contacts/delete-all' => 'r_contacts_delete_all', '/contacts/pick' => 'r_pick', '/contacts/save' => 'r_save_contact', '/groups' => 'r_groups', '/discard' => 'r_discard', '/change-email' => 'r_change_email', '/copy' => 'r_copy',
        '/mfa' => 'r_mfa', '/admin' => 'r_admin', '/admin/delivery' => 'r_admin_delivery', '/admin/finance' => 'r_admin_finance', '/admin/reports' => 'r_admin_reports', '/admin/campaign' => 'r_admin_campaign', '/admin/wording' => 'r_admin_wording', '/admin/app' => 'r_admin_app', '/admin/email' => 'r_admin_email', '/admin/privacy' => 'r_admin_privacy', '/admin/access' => 'r_admin_access', '/admin/health' => 'r_admin_health', '/admin/audit' => 'r_admin_audit', '/admin/audit/export' => 'r_admin_audit_export', '/admin/action' => 'r_admin_action', '/admin/senders' => 'r_admin_senders', '/admin/launch' => 'r_admin_launch', '/admin/measures' => 'r_admin_measures', '/admin/giftaid' => 'r_admin_giftaid', '/admin/rehearsal' => 'r_admin_rehearsal', '/admin/library' => 'r_admin_library', '/admin/library/edit' => 'r_admin_library_edit', '/admin/library/save' => 'r_admin_library_save', '/admin/library/discard' => 'r_admin_library_discard', '/admin/library/preview' => 'r_admin_library_preview', '/admin/library/action' => 'r_admin_library_action', '/admin/campaigns' => 'r_admin_campaigns', '/admin/campaign-qr' => 'r_admin_campaign_qr', '/admin/campaigns/create' => 'r_admin_campaigns_create', '/admin/campaigns/view' => 'r_admin_campaigns_view', '/admin/campaigns/action' => 'r_admin_campaigns_action', '/admin/library/img' => 'r_admin_library_img', '/admin/export' => 'r_export', '/admin/message' => 'r_message', '/hooks/stripe' => 'r_stripe_hook', '/hooks/postmark' => 'r_postmark_hook'];
    if (post() && !str_starts_with($path, '/hooks/')) check_csrf();
    if (preg_match('#^/c/([a-f0-9]+)(?:/(open|report))?$#', $path, $m)) r_card($m[1], $m[2] ?? '');
    if (preg_match('#^/art/([a-z0-9.-]+)$#', $path, $m)) r_art($m[1]);
    if (preg_match('#^/optout/([a-f0-9]+)$#', $path, $m)) r_optout($m[1]);
    if (preg_match('#^/occasion/([a-z0-9-]{1,40})$#', $path, $m)) r_occasion($m[1]);
    if (isset($routes[$path])) $routes[$path]();
    fail(404, 'Page not found.');
}
