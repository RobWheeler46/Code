<?php
// The card journey: write, preview, review, send, pay, and the sender's own list of cards.

// ---------- compose, preview, review, pay
function r_compose(): void {
    $u = user();
    $s = isset($_GET['id']) ? own_send((int)$_GET['id']) : null;
    if ($s && $s['status'] !== 'draft') redirect($u ? '/send?id=' . $s['id'] : '/');
    if ($s && !empty($s['bulk'])) redirect('/admin/bulk?id=' . $s['id']); // a bulk draft has its own screen
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
            redirect('/compose?' . ($s ? 'id=' . $s['id'] : 'card=' . urlencode($card)) . ($act === 'addrow' ? '#newrow' : '#recipients')); // a new row lands in view, not the top of the list
        }
        if ($act === 'addpaste') { // turn the pasted list into rows you can see and fix; whatever could not be read stays in the box
            [$prows, $perrs, $bad] = parse_recipients($paste);
            $keep = array_values(array_filter(array_keys($emails + $names + $msgs), fn($i) => trim((string)($emails[$i] ?? '')) . trim((string)($names[$i] ?? '')) . trim((string)($msgs[$i] ?? '')) !== ''));
            $n2 = array_map(fn($i) => (string)($names[$i] ?? ''), $keep); $e2 = array_map(fn($i) => (string)($emails[$i] ?? ''), $keep); $m2 = array_map(fn($i) => (string)($msgs[$i] ?? ''), $keep);
            $have = array_flip(array_map(fn($x) => strtolower(norm_email($x)), $e2)); $added = 0; $dupes = 0; $over = 0;
            foreach ($prows as [$pn, $pe, $po]) {
                if (isset($have[strtolower($pe)])) { $dupes++; continue; }
                if (count($e2) >= max_recipients()) { $over++; continue; }
                $n2[] = $pn; $e2[] = $pe; $m2[] = $po; $have[strtolower($pe)] = 1; $added++;
            }
            $stash(['r_name' => $n2, 'r_email' => $e2, 'r_msg' => $m2, 'paste' => implode("\n", $bad), 'addrow' => 0]);
            if ($perrs) $_SESSION['errs'] = ['paste' => $perrs];
            flash(($added ? "Added $added " . ($added === 1 ? 'person' : 'people') . ' to your list. Check the names, then carry on.' : 'No one was added.') . ($dupes ? " $dupes already on the card " . ($dupes === 1 ? 'was' : 'were') . ' skipped.' : '') . ($over ? " $over would go over the limit of " . max_recipients() . ' and ' . ($over === 1 ? 'was' : 'were') . ' left out.' : '') . ($bad ? ' Lines that could not be read are left in the box.' : ''), $added && !$bad && !$over ? 'ok' : 'warn');
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
        $gone = '<p class="flash warn" role="status">The design you first chose is no longer available. Use Change design to pick another. Your message and recipients are safe.</p>'; $card = (string)array_key_first(gallery_cards());
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
        $rowsHtml .= '<div class="rrow"' . ($i === $nrows - 1 && !empty($old['addrow']) ? ' id="newrow"' : '') . ' role="group" aria-label="Recipient ' . ($i + 1) . '"><label>Name<input name="r_name[]" maxlength="100" value="' . h($rn) . '"' . fa($errs, "name$i", $f) . '>' . fe($errs, "name$i") . '</label>'
            . '<label>Email<input type="email" name="r_email[]" value="' . h($re) . '"' . fa($errs, "email$i", $f) . '>' . fe($errs, "email$i") . '</label>'
            . '<details class="wide"' . ($rm !== '' || isset($errs["msg$i"]) ? ' open' : '') . '><summary>Personal message for this person (optional)</summary><label>Message<textarea name="r_msg[]" rows="2"' . fa($errs, "msg$i", $f) . '>' . h($rm) . '</textarea>' . fe($errs, "msg$i") . '</label></details>'
            . ($nrows > 1 ? '<button class="btn alt" name="act" value="remove_' . $i . '" aria-label="Remove recipient ' . ($i + 1) . '">Remove</button>' : '') . '</div>';
    }
    $recipientsHtml = '<fieldset id="recipients"><legend>Who is it for? (up to ' . max_recipients() . ')</legend>' . fe($errs, 'recipients') . $rowsHtml
        . ($nrows < max_recipients() ? '<button class="btn alt" name="act" value="addrow">Add another recipient</button>' : '<p class="note">That is the most you can send at once (' . max_recipients() . ').</p>')
        . ' <small class="count" data-recipient-count>' . $nrows . ' of ' . max_recipients() . '</small>'
        . '<details' . (isset($errs['paste']) || ($old['paste'] ?? '') !== '' ? ' open' : '') . '><summary>Add many people at once</summary><label>Paste a list from a spreadsheet or an email: <em>Name, email</em> on each line, or just email addresses<textarea name="paste" rows="4" placeholder="Gran, gran@example.com&#10;Uncle Bob, bob@example.com&#10;or: aunt.sue@example.com, cousin@example.com"' . fa($errs, 'paste', $f) . '>' . h($old['paste'] ?? '') . '</textarea>' . fe($errs, 'paste') . '</label><button class="btn alt" name="act" value="addpaste">Add these people to the list</button></details></fieldset>';
    $from = $old['sender_name'] ?? $s['sender_name'] ?? ($u['name'] ?? ''); $msg = $old['message'] ?? $s['message'] ?? '';
    $saved = $s ? '<p class="note" role="status">Draft saved at ' . date('H:i', (int)$s['updated']) . '.</p>' : '<p class="note">Not saved yet. Use Save draft to keep your work.' . ($u ? '' : ' Before it is sent you will create a free account and verify your email, and your card will wait for you.') . '</p>';
    page('Write your card', steps(2) . $gone . '<h1>Write something wonderful</h1><p class="lead">Your message and everyone you are sending it to, together in one place.</p>'
        . '<div class="two cmp"><div class="card preview compact" aria-label="Live preview">' . card_art($card) . '<p class="cardname"><strong>' . h(cards()[$card]['title'] ?? '') . '</strong></p><p class="center"><a class="btn alt" href="/#gallery">Change design</a></p><div class="inner"><p class="msg" data-preview-msg>' . nl2br(h($msg)) . '</p><p class="from">With love from<br><strong data-preview-from>' . h($from) . '</strong></p></div></div><form method="post" class="stack" data-dirty-warn>' . csrf()
        . '<input type="hidden" name="card" value="' . h($card) . '">'
        . '<label>From (your name or family name)<input name="sender_name" maxlength="' . (name_max() + 20) . '" data-max="' . name_max() . '" value="' . h($from) . '"' . fa($errs, 'sender_name', $f) . '><small class="count">Up to ' . name_max() . ' characters</small>' . fe($errs, 'sender_name') . '</label>'
        . '<label>Your message<textarea name="message" rows="5" data-max="' . msg_max() . '"' . fa($errs, 'message', $f) . '>' . h($msg) . '</textarea><small class="count">Up to ' . msg_max() . ' characters</small>' . fe($errs, 'message') . '</label>'
        . '<details><summary>Need ideas? Greeting examples</summary><p class="note">Examples only. Choosing one adds it to your message, which you can then edit.</p><ul class="starters">' . implode('', array_map(fn($t) => '<li data-tone="' . h(starter_tone($t)) . '">' . h($t) . ' <small>(' . h(starter_tone($t)) . ')</small> <button type="button" class="link" data-starter="' . h($t) . '">Use this</button></li>', starters($s ?: []))) . '</ul></details>'
        . ($back ? '<p class="note">Sending a card back to ' . h($back['sender_name']) . ': add their email address below.</p>' : '')
        . $recipientsHtml
        . ($s && $u && $u['verified'] ? '<p><button class="btn alt" name="act" value="pick">Choose from address book</button></p>' : ($u ? '<p class="note">Save your draft and verify your email to choose from your address book.</p>' : ''))
        . '<p class="note">Only you can see your full recipient list. Each person gets a private, individual message.</p>' . $saved . '<div class="row"><button class="btn" name="act" value="continue">Review your card</button><button class="btn alt" name="act" value="save">Save draft</button></div><p class="morelinks"><button class="link" name="act" value="preview">Preview the full card</button> &middot; <button class="link" name="act" value="test">Email me a test</button></p></form></div>');
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
    page('Preview', '<h1>Preview</h1><p>This is how your card will look' . ($r ? ' for ' . h($r['name']) : '') . '.</p>' . card_view($s['card'], $r['name'] ?? 'Friend', $r ? resolved_msg($r, $s) : $s['message'], $s['sender_name'], card_note($s)) . '<p class="sendbar"><a class="btn alt" href="/compose?id=' . $s['id'] . '">Back to editing</a> <a class="btn" href="/review?id=' . $s['id'] . '">Review and send</a></p>');
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
    return '<p class="stepof" aria-hidden="true">Step ' . $n . ' of 3</p><ol class="steps" aria-label="Progress">' . implode('', array_map(fn($t, $i) => '<li' . ($i + 1 === $n ? ' aria-current="step"' : '') . '><span class="sn">' . ($i + 1) . '.</span><span class="sl"> ' . h($t) . '</span></li>', $l, array_keys($l))) . '</ol>';
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
    if (!user()) { $rid = (int)($_GET['id'] ?? $_POST['id'] ?? 0); own_send($rid); flash('Your card is saved. Create a free account to send it, or sign in if you already have one.', 'warn'); redirect('/register?next=' . urlencode('/review?id=' . $rid)); }
    $u = need_login(); $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if (!in_array($s['status'], ['draft', 'awaiting_payment'])) redirect('/send?id=' . $s['id']);
    if (!empty($s['bulk'])) redirect('/admin/bulk?id=' . $s['id']);
    if ($s['status'] === 'draft' && !(cards()[$s['card']]['on'] ?? false)) { flash('The design you chose is no longer available. Pick another and your message and recipients are kept.', 'warn'); redirect('/compose?id=' . (int)$s['id']); }
    $id = (int)$s['id'];
    $rs = all('select * from recipients where send_id=? order by id', [$id]);
    $pending = $s['status'] === 'awaiting_payment';
    if (post()) {
        $do = $_POST['do'] ?? '';
        if ($do === 'send') $do = ($_POST['mode'] ?? '') === 'donate' ? 'donate' : 'free'; // one button, the radio says which
        if ($do === 'donate' && !donations_enabled()) { flash('We are not taking donations at the moment. You can send your cards for free.', 'warn'); redirect("/review?id=$id"); }
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
        if (sending_state() !== 'open') { flash('Card sending is not open right now, so your card cannot be submitted. Your draft is saved.', 'warn'); redirect("/review?id=$id"); }
        if (!$rs || count($rs) > max_recipients() || $s['message'] === '') { flash('Your card needs a message and 1 to ' . max_recipients() . ' recipients.', 'err'); redirect("/compose?id=$id"); }
        if ($pending) { flash('You have a payment waiting. Check its status or cancel it first. Cards are not sent until that is resolved.', 'warn'); redirect("/review?id=$id"); }
        if (repeats_for($s) && empty($_POST['repeat_ok'])) { flash('Some recipients already have a card from you. Tick the box to send again on purpose.', 'err'); redirect("/review?id=$id"); }
        limit_for("submit:{$u['id']}", 5, 3600); // proposed D-02 default: 5 submissions an hour per account
        $at = schedule_parse($_POST); if ($at === false) { flash('Choose a delivery time that is at least an hour from now and within 90 days, or send straight away.', 'err'); redirect("/review?id=$id"); }
        q('update sends set send_at=? where id=?', [$at, $id]); // kept on the card so a donation that is confirmed later uses the same time
        if ($do === 'free') { giftaid_save_pending($id, null); queue_send($id); flash($at ? 'Your cards are scheduled for ' . date('j F \a\t H:i', $at) . '.' : 'Cards are queued for sending.'); redirect("/send?id=$id&done=1"); }
        $pick = (string)($_POST['amount'] ?? '');
        $pence = $pick === 'custom' ? (int)round((float)($_POST['custom'] ?? 0) * 100) : (int)$pick;
        if ($pence < 100 || $pence > 50000) { flash('Choose a donation amount between £1 and £500, or choose "Send cards for free".', 'err'); redirect("/review?id=$id"); }
        $ga = null;
        if (giftaid_on() && !empty($_POST['giftaid'])) { [$ga, $gerr] = giftaid_validate($_POST); if ($gerr) { $_SESSION['ga_old'] = $_POST; flash(implode(' ', $gerr), 'err'); redirect("/review?id=$id"); } }
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
    $list = implode('', array_map(fn($r) => '<li><strong>' . h($r['name']) . '</strong> (' . h($r['email']) . ')' . (trim((string)$r['own_msg']) !== '' ? ' <span class="pill">Personal message</span>' : '') . ' <form method="post" action="/contacts/save" class="inline">' . csrf() . '<input type="hidden" name="rid" value="' . $r['id'] . '"><input type="hidden" name="back" value="/review?id=' . $r['send_id'] . '"><button class="link">Save to address book</button></form>' . (trim((string)$r['own_msg']) !== '' ? '<blockquote>' . nl2br(h(resolved_msg($r, $s))) . '</blockquote>' : '') . '</li>', $rs));
    $state = sending_state();
    $b = steps(3) . '<h1>Review and send</h1>';
    if (!$u['verified']) $b .= '<p class="flash warn">Verify your email (see the link we sent) before you can send. <form method="post" action="/resend-verification" class="inline">' . csrf() . '<button class="link">Send it again</button></form></p>';
    if ($state !== 'open') $b .= '<p class="flash warn">Card sending is ' . 'not open yet' . ', so you cannot submit this card. Your draft is saved.' . (($u = user()) && $u['is_admin'] && ($why = sending_block_reason()) ? '<br><small><strong>Administrator note:</strong> ' . h($why) . '</small>' : '') . '</p>';
    if (setting('paused') === '1') $b .= '<p class="note">Sending is briefly paused. Cards you submit will be queued and go out when it resumes.</p>';
    // a small card beside the details, the message once, and the full card only if asked for
    $left = '<div class="card preview compact">' . card_art($s['card'], true) . '<p class="cardname"><strong>' . h(cards()[$s['card']]['title'] ?? '') . '</strong><br><small>From ' . h($s['sender_name']) . '</small></p><p class="center"><a href="/compose?id=' . $id . '">Edit message or recipients</a></p>'
        . '<blockquote class="yourmsg">' . nl2br(h($s['message'])) . '</blockquote><details><summary>See the full card</summary>' . card_view($s['card'], $rs[0]['name'] ?? 'Friend', $rs ? resolved_msg($rs[0], $s) : $s['message'], $s['sender_name']) . '</details></div>';
    // a short list is open; a long one is folded so the delivery choice and the Send button stay near the top
    $mid = '<details class="rcpts"' . (count($rs) <= 3 ? ' open' : '') . '><summary><strong>Sending to ' . count($rs) . ' ' . (count($rs) === 1 ? 'person' : 'people') . '</strong></summary><ul class="rlist">' . $list . '</ul><p class="note"><a href="/email-preview?id=' . $id . '">Preview the email</a></p></details>';
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
        $form .= schedule_picker($s);
        if (!donations_enabled()) $form .= '<div class="row sendbar"><button class="btn big" name="do" value="send">Send my cards</button></div><p class="note">Sending is free.</p>';
        else { $form .= '<fieldset class="sendopts"><legend>How would you like to send?</legend>'
            . '<label class="optcard"><input type="radio" name="mode" value="free"' . ($rec ? '' : ' checked') . '> <strong>Send for free</strong><span>Your cards are free to send. No payment needed.</span></label>'
            . '<label class="optcard"><input type="radio" name="mode" value="donate"' . ($rec ? ' checked' : '') . '> <strong>Make an optional donation</strong><span>' . h(DONATION_PURPOSE) . '</span></label>'
            . '<div class="donatebox"><p>One donation covers all ' . count($rs) . ' of your cards.</p><div class="chips">';
        $am = array_map('intval', explode(',', setting('amounts_pence', '200,500,1000'))); $sug = $am[min(count($am) - 1, count($rs) > 10 ? 2 : (count($rs) > 3 ? 1 : 0))] ?? 0; // more cards, a larger suggestion
        foreach ($am as $a) $form .= '<label class="opt"><input type="radio" name="amount" value="' . $a . '"' . ($a === $sug ? ' checked' : '') . '> ' . gbp($a) . ($a === $sug ? ' <small>(suggested)</small>' : '') . '</label>';
        $form .= '<label class="opt"><input type="radio" name="amount" value="custom"> Other amount (£) <input type="number" name="custom" min="1" max="500" step="0.01" aria-label="Custom amount in pounds"></label></div>'
            . '<label class="opt"><input type="checkbox" name="donation_note" value="1"> Add a line to the cards saying they came with a donation to 7th Swindon Scouts (no amount is shown; only after payment is confirmed)</label>'
            . (giftaid_on() ? giftaid_form_block() : '') . '</div>'
            . '<p class="total">Total <strong data-total>£0.00</strong></p><button class="btn big" name="do" value="send" data-send-btn>Send my cards for free</button><p class="note">Sending is always free. Nothing is charged unless you choose to donate.</p></fieldset>'; }
    }
    page('Review and send', $b . '<div class="two cmp">' . $left . '<div>' . $mid . $form . '</form></div></div>');
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

// ---------- sender dashboard
function r_dashboard(): void {
    $u = need_login();
    $b = '<h1>My cards</h1>' . ($u['verified'] ? '' : '<p class="flash warn">Please verify your email: click the link we sent to ' . h($u['email']) . '. You need this before sending. <form method="post" action="/resend-verification" class="inline">' . csrf() . '<button class="link">Send it again</button></form><details><summary>Wrong email address?</summary><form method="post" action="/change-email" class="row">' . csrf() . '<label>Correct email<input type="email" name="email" required></label><button class="btn alt">Change and resend</button></form></details></p>') . '<p><a class="btn" href="/">Create a new card</a></p>'
        . '<details class="admincard"><summary>Email preferences</summary><form method="post" action="/prefs" class="row">' . csrf() . '<label>Optional status emails<select name="notify">' . implode('', array_map(fn($k, $l) => '<option value="' . $k . '"' . ($u['notify'] === $k ? ' selected' : '') . '>' . $l . '</option>', ['off', 'viewed', 'summary'], ['Off (default)', 'Email me when a card is opened', 'One daily summary'])) . '</select></label><label class="opt"><input type="checkbox" name="remind" value="1"' . ($u['remind'] ? ' checked' : '') . '> Remind me once a year when the service opens</label><button class="btn alt">Save</button></form></details>';
    $groups = ['Drafts' => '', 'Scheduled' => '', 'Sent' => ''];
    foreach (all('select * from sends where user_id=? order by id desc', [$u['id']]) as $s) {
        $c = [];
        $gone = 0; $went = 0;
        foreach (all('select * from recipients where send_id=?', [$s['id']]) as $r) { $k = rstatus($r); $c[$k] = ($c[$k] ?? 0) + 1; if ($r['sent_at']) { $went++; if (expiry_ts($r) < time()) $gone++; } }
        $state = $s['status'] === 'draft' ? ['Draft', 'draft'] : ($went && $gone === $went ? ['Links expired', 'expired'] : (!empty($c['Scheduled']) ? ['Scheduled', 'scheduled'] : ($went ? ['Sent', 'sent'] : ['Waiting to send', 'queued'])));
        $sum = implode(', ', array_map(fn($k, $v) => "$v " . status_label($k), array_keys($c), $c));
        $link = $s['status'] === 'draft' ? (!empty($s['bulk']) ? "/admin/bulk?id={$s['id']}" : "/compose?id={$s['id']}") : ($s['status'] === 'awaiting_payment' ? "/review?id={$s['id']}" : "/send?id={$s['id']}");
        $act = $s['status'] === 'draft' ? '<a class="btn" href="' . $link . '">Keep writing</a> <form method="post" action="/discard" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . $s['id'] . '"><button class="link">Discard draft</button></form>' : '<a class="btn alt" href="' . $link . '">See how it is going</a> <a href="/copy?id=' . $s['id'] . '">Send it again to someone</a>';
        $don = donation_state($s) === 'No donation' ? '' : '<br><small>' . h(donation_state($s)) . '</small>';
        $groups[$state[1] === 'draft' ? 'Drafts' : ($state[1] === 'scheduled' ? 'Scheduled' : 'Sent')] .= '<li class="cardrow"><div class="thumb">' . card_art($s['card'], true, $s['art_ref'] ?? null) . '</div><div><h3>' . h(cards()[$s['card']]['title'] ?? $s['card']) . ' <span class="pill ' . $state[1] . '">' . $state[0] . '</span></h3><p class="note">' . date('j M Y', (int)$s['created']) . ($sum ? ' &middot; ' . h($sum) : '') . $don . '</p><p>' . $act . '</p></div></li>';
    }
    $rows = implode('', $groups); $b .= $rows ? implode('', array_map(fn($h, $li) => $li === '' ? '' : '<h2>' . $h . '</h2><ul class="plain cardlist">' . $li . '</ul>', array_keys($groups), $groups)) : '<section class="next"><h2>No cards yet</h2><p>Your first card is only a few minutes away.</p><p><a class="btn big" href="/">Choose a design</a></p></section>';
    $b .= favourites_section();
    $d = all('select * from donations where user_id=? order by id desc', [$u['id']]);
    if ($d) $b .= '<h2>Donation history</h2><table><tr><th>Date</th><th>Amount</th><th>Reference</th></tr>' . implode('', array_map(fn($x) => '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td></tr>', $d)) . '</table>';
    page('My cards', $b . '<p><a href="/contacts">Address book</a> &middot; <a href="/account/delete">Delete my account</a></p>');
}

/** "Tell a friend" after sending: the public link with a promotion label, so Measures can show it working. */
function share_block(): string {
    $link = base_url() . '/?ref=sendshare'; $msg = 'I sent a card with 7th Swindon Scouts. You can send one too: ' . $link;
    return '<section class="admincard"><h2>Tell a friend</h2><p>Know someone who would like to send a card too?</p><p class="row"><a class="btn alt" href="https://wa.me/?text=' . rawurlencode($msg) . '">Share on WhatsApp</a> <a class="btn alt" href="mailto:?subject=' . rawurlencode('Send a card with 7th Swindon Scouts') . '&amp;body=' . rawurlencode($msg) . '">Share by email</a></p><p class="note">Or copy the link: <code>' . h($link) . '</code></p></section>';
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
        } elseif ($do === 'reschedule') { // only cards that are still waiting for their scheduled time
            $at = schedule_parse($_POST);
            if ($at === false || (int)$s['send_at'] <= time()) flash('Please choose a time at least an hour from now and within 90 days.', 'err');
            else {
                $n = q('update recipients set next_at=? where send_id=? and status=\'queued\' and tries=0 and next_at>?', [$at, $sid, time()])->rowCount();
                q('update sends set send_at=? where id=?', [$at, $sid]); audit((int)$u['id'], 'reschedule', "send $sid: $n moved");
                flash($at ? 'Delivery time changed to ' . date('l j F \a	 H:i', $at) . '.' : 'Sending now.'); if (!$at) process_queue();
            }
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
        $rows .= '<tr><td>' . h($r['name']) . '</td><td>' . h($r['email']) . '</td><td><span class="pill ' . strtolower(str_replace(' ', '-', $st)) . '">' . h(status_label($st)) . '</span></td><td>' . $act . '</td></tr>';
    }
    $legend = '<details><summary>What do the statuses mean?</summary><ul>' . implode('', array_map(fn($k, $v) => '<li><strong>' . h(status_label($k)) . ':</strong> ' . h($v) . '</li>', array_keys(STATUS_HELP), STATUS_HELP)) . '</ul></details>';
    $sched = (int)$s['send_at'] > time() ? 'Scheduled for ' . date('l j F \a\t H:i', (int)$s['send_at']) . '. ' : '';
    $done = empty($_GET['done']) ? '' : '<section class="flash" role="status"><h2>' . ($sched ? 'Your cards are scheduled' : 'Your cards are queued for sending') . '</h2>' . ($sched ? '<p>' . h($sched) . 'You can cancel any card until then.</p>' : '') . '<p>Queued means waiting to go out, not delivered yet. The statuses below update as cards go out.</p>' . (donation_state($s) === 'No donation' ? '' : '<p><strong>Donation:</strong> ' . h(donation_state($s)) . ($s['donation'] && !one('select 1 from donations where send_id=?', [$s['id']]) ? ' (we will show it here once payment is confirmed)' : '') . '</p>') . '<p><a href="/dashboard">Go to my cards</a></p></section>' . share_block();
    page('Card status', $done . '<h1>' . h(cards()[$s['card']]['title']) . '</h1>' . ($sched && empty($_GET['done']) ? '<p class="note">' . h($sched) . '</p>' : '') . '<p><strong>Cards:</strong> ' . h(ucfirst(str_replace('_', ' ', $s['status']))) . '. <strong>Donation:</strong> ' . h(donation_state($s)) . '.</p>'
        . ($sched && $queued ? '<details class="admincard"><summary>Change the delivery time</summary><form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '">' . schedule_picker($s) . '<button class="btn alt" name="do" value="reschedule">Change delivery time</button></form></details>' : '')
        . ($queued ? '<form method="post">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '"><button class="btn alt" name="do" value="cancel_all">Cancel unsent cards</button></form>' : '')
        . '<table class="stacked"><tr><th>Name</th><th>Email</th><th>Status</th><th></th></tr>' . $rows . '</table>' . $legend . '<p class="note">"Viewed" means the recipient opened the card themselves. Cancelled and withdrawn cards do not refund a donation.</p>');
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
