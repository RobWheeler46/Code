<?php
// What a recipient sees: the envelope, the card, reporting it, and stopping cards.

function gone_page(array $r, string $title, string $why): never {
    page($title, '<h1>' . h($title) . '</h1><p>' . h($why) . '</p><p>If you have a question, email <a href="mailto:' . h(support_email()) . '">' . h(support_email()) . '</a> and quote reference <strong>' . h(support_ref($r)) . '</strong>.</p><p><a class="btn" href="/">Send a card of your own</a></p>', 410);
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
        page('A card for you', '<section class="envelope-wrap"><div class="envelope" aria-hidden="true"><div class="flap"></div><div class="seal"></div><div class="stamp"></div><div class="to">To ' . h($r['name']) . '</div></div><h1>' . h(ucfirst(card_phrase($s))) . ' for ' . h($r['name']) . '</h1><p class="lead">From ' . h($s['sender_name']) . '</p><form method="post" action="/c/' . h($t) . '/open">' . csrf() . '<button class="btn big">Open your card</button></form><p class="note">Press the button to open it.</p></section>' . $stop);
    }
    page('Your ' . card_word($s), '<p class="center skip"><button type="button" class="link" data-skip>Skip animation</button></p><div class="reveal">' . card_view($s['card'], $r['name'], resolved_msg($r, $s), $s['sender_name'], card_note($s), $s['art_ref'] ?? null, isset($s['design_version_id']) ? (int)$s['design_version_id'] : null) . '</div><section class="next"><h2>Want to say thank you?</h2><p>Send ' . h($s['sender_name']) . ' a card of your own. It is free, and it only takes a minute.</p><p><a class="btn big" href="/compose?card=' . h($s['card']) . '&amp;back=' . h($t) . '">Send a card back</a> <a class="btn alt" href="/">Make a card for someone else</a></p></section><p class="center"><a href="/c/' . h($t) . '">Replay the envelope</a> &middot; <button type="button" class="link" data-print>Print this card</button><br><small class="note">A printed copy stays with you after this link expires.</small></p>'
        . '<details class="center"><summary>Report this card</summary><form method="post" action="/c/' . h($t) . '/report" class="stack">' . csrf() . '' . hp_field() . '<label>What is wrong?<textarea name="reason" maxlength="500" required></textarea></label><button class="btn alt">Send report</button></form></details>' . $stop);
}

/** Opt-out needs a deliberate POST, so link scanners that only GET cannot opt anyone out. Same reply whatever the prior state. */
function r_optout(string $t): void {
    $r = recipient_by_token($t); $s = one('select * from sends where id=?', [$r['send_id']]);
    if (post()) {
        optout($r['email'], ($_POST['scope'] ?? '') === 'all' ? 0 : (int)$s['user_id']);
        page('Preference saved', '<h1>Thank you</h1><p>We will not send you more cards' . (($_POST['scope'] ?? '') === 'all' ? ' from this service' : ' from ' . h($s['sender_name'])) . '. This applies to cards not yet sent as well.</p>');
    }
    page('Stop cards', '<h1>Stop receiving cards</h1><form method="post" class="stack">' . csrf() . '<fieldset><legend>Choose what to stop</legend><label class="opt"><input type="radio" name="scope" value="sender" checked> Cards from ' . h($s['sender_name']) . '</label><label class="opt"><input type="radio" name="scope" value="all"> All cards from ' . h(SITE_NAME) . '</label></fieldset><button class="btn">Confirm</button></form>');
}
