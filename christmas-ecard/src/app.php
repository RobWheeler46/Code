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
require __DIR__ . '/occasions.php';
require __DIR__ . '/qr.php';
require __DIR__ . '/account.php';
require __DIR__ . '/invites.php';
require __DIR__ . '/smtp.php';
require __DIR__ . '/mailconfig.php';
require __DIR__ . '/workspace.php';
require __DIR__ . '/scheduler.php';
require __DIR__ . '/send.php';
require __DIR__ . '/hooks.php';
require __DIR__ . '/recipient.php';
require __DIR__ . '/auth.php';

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

// ---------- public
/** The occasions that have at least one card on show: [slug => label]. */
function gallery_occasions(): array {
    $n = []; foreach (gallery_cards() as $c) $n[$c['cat'] ?? 'christmas'] = 1;
    try { $all = array_column(all('select slug, label from occasions order by sort, id'), 'label', 'slug'); } catch (Throwable $e) { $all = ['christmas' => 'Christmas']; }
    return array_intersect_key($all, $n);
}
/** The occasion asked for in the address, or '' for all. Anything that is not an occasion with cards on show is ignored. */
function occasion_wanted(): string { $w = (string)($_GET['occasion'] ?? ''); return isset(gallery_occasions()[$w]) ? $w : ''; }
/** A drop down above the gallery to show the cards for one occasion, only when there is more than one occasion to choose from. A plain page address, so it works without scripts and can be shared. */
function occasion_filter(string $want): string {
    $o = gallery_occasions(); if (count($o) < 2) return '';
    $b = '<form method="get" action="/#gallery" class="gfilter"><label for="gocc">Show cards for</label><select id="gocc" name="occasion" data-autosubmit><option value="">All occasions</option>';
    foreach ($o as $slug => $label) $b .= '<option value="' . h($slug) . '"' . ($want === $slug ? ' selected' : '') . '>' . h($label) . '</option>';
    return $b . '</select><noscript><button class="btn alt">Show</button></noscript></form>';
}
function r_home(): void {
    if (preg_match('/^[a-z0-9-]{1,30}$/', (string)($_GET['ref'] ?? ''))) $_SESSION['ref'] = $_GET['ref']; // promotion source label only, never a person
    $st = sending_state(); $want = occasion_wanted();
    $b = '<section class="hero"><div><p class="eyebrow">' . h(SITE_NAME) . '</p><h1>' . (($cs = current_season()) ? 'Send ' . card_phrase_for($cs[1] . ' card') . ', Scout style' : 'Send a card, Scout style') . '</h1><p class="lead">Pick a design, write your message and we will email a private card to your friends and family. Sending is free' . (donations_enabled() ? ', and a donation is optional' : '') . '.</p><p><a class="btn big" href="#gallery">Choose a card</a> <a class="btn ghost" href="#how">How it works</a></p></div><div class="heroart" aria-hidden="true">' . (($hero = hero_for_session()) ? card_art($hero) : '') . '</div></section>';
    if ($st === 'locked') $b .= '<p class="flash warn">Sending is not open yet. You can prepare a card now.</p>';
    $b .= '<h2 id="how">How it works</h2><ol class="how"><li><b>1</b><strong>Choose a design</strong>Illustrated Scout themed cards, from tents to campfires.</li><li><b>2</b><strong>Write your message</strong>Add up to ' . max_recipients() . ' people. Give anyone a personal note if you like.</li><li><b>3</b><strong>We send each card</strong>Everyone gets their own private link and opens an envelope.</li></ol>'
        . (!donations_enabled() ? '' : '<section class="cause"><h2>Every card helps local Scouting</h2><p>' . h(DONATION_PURPOSE) . '</p><p>Sending is always free. You never have to donate, and a donation never changes how your card looks.</p></section>')
        . '<h2 id="gallery">Pick a design</h2>' . occasion_filter($want);
    $show = array_filter(gallery_cards(), fn($c) => $want === '' || ($c['cat'] ?? 'christmas') === $want);
    uasort($show, fn($x, $y) => season_rank($x) <=> season_rank($y)); // cards for an occasion in season come first, then occasions with no season, then ones whose season is not on (the order within each stays as set)
    if ($want !== '') $b .= '<p class="note" role="status">' . count($show) . (count($show) === 1 ? ' card' : ' cards') . ' shown. <a href="/#gallery">Show all cards</a></p>';
    $b .= '<div class="grid">';
    foreach ($show as $id => $c)
        $b .= '<a class="tile" href="/compose?card=' . h($id) . '">' . card_art($id, true) . '<span>' . h($c['title']) . '</span><em class="tjoke">' . h($c['joke']) . '</em></a>';
    page('Choose a card', $b . '</div>');
}

function r_help(): void {
    $e = h(support_email());
    $faq = [
        'Is it really free?' => 'Yes. Sending is always free.' . (donations_enabled() ? ' A donation is optional and goes to 7th Swindon Scouts. ' . DONATION_PURPOSE : ''),
        'Can I choose when a card arrives?' => 'Yes. On the last step you can send straight away or choose a date and time. Scheduled cards can be cancelled from My cards until they are sent.',
        'I did not get the verification email' => 'Check your spam or junk folder, then sign in and ask for it again. If the address was wrong, register again with the right one.',
        'My recipient did not get their card' => 'Open "My cards" to see each card\'s status. If it shows Failed, correct the address and send again. Ask the recipient to check spam.',
        'What do the statuses mean?' => implode(' ', array_map(fn($k, $v) => "$k: $v", array_keys(STATUS_HELP), STATUS_HELP)),
        'How long does a card last?' => 'A card link works for ' . expiry_days() . ' days after it is sent.',
        ...(donations_enabled() ? ['I have a question about a donation' => "Email $e and quote the reference from your receipt."] : []),
        'How do you decide a card was viewed?' => 'A card counts as Viewed only when the recipient deliberately presses Open your card. Opening the email, or a security scanner fetching the link, does not count. If someone reads the card without that step we cannot tell, so it shows as not confirmed. Viewed never means we know who read it.',
        'Can I delete my account?' => 'Yes, from the bottom of My cards. It cancels cards that have not started sending, deletes your saved contacts and groups, and switches off the links of the cards you sent. Finance records and opt-out records are kept separately.',
        'I received a card I do not want' => 'Open the card and use "Report this card", or use the "stop cards" link at the bottom of the email.',
    ];
    $b = '<h1>Help and FAQ</h1>';
    foreach ($faq as $q => $a) $b .= '<details><summary>' . h($q) . '</summary><p>' . (str_contains($a, $e) ? $a : h($a)) . '</p></details>';
    foreach (faq_parse(setting('help_extra')) as $q => $a) $b .= '<details><summary>' . h($q) . '</summary><p>' . nl2br(h($a)) . '</p></details>'; // extra questions are always escaped
    page('Help', $b . '<p>Still stuck? Email <a href="mailto:' . $e . '">' . $e . '</a>.</p>');
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
        fputcsv($o, array_merge([csv_text('eCards'), csv_text((string)$x['stripe_session']), date('Y-m-d', (int)$x['created']), 'GBP', $m($x['pence']), $m($x['fee']), $m($x['refunded']), $m($x['pence'] - $x['fee'] - $x['refunded']), $st],
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

function dispatch(string $path): void {
    private_headers($path);
    $routes = ['/' => 'r_home', '/help' => 'r_help', '/register' => 'r_register', '/verify' => 'r_verify', '/resend-verification' => 'r_resend_verify', '/login' => 'r_login', '/logout' => 'r_logout', '/forgot' => 'r_forgot', '/reset' => 'r_reset',
        '/contacts/import' => 'r_contacts_import', '/compose' => 'r_compose', '/preview' => 'r_preview', '/email-preview' => 'r_email_preview', '/review' => 'r_review', '/pay-cancelled' => 'r_pay_cancelled', '/return' => 'r_return', '/dev/pay' => 'r_dev_pay', '/dashboard' => 'r_dashboard', '/send' => 'r_send', '/prefs' => 'r_prefs', '/remind-off' => 'r_remind_off', '/privacy' => 'r_privacy', '/terms' => 'r_terms', '/accept-terms' => 'r_accept_terms', '/account/delete' => 'r_account_delete', '/account' => 'r_account', '/admin/mail' => 'r_admin_mail', '/admin/platform' => 'r_admin_platform', '/invite' => 'r_invite', '/admin/invites' => 'r_admin_invites', '/account/confirm-email' => 'r_account_confirm_email', '/contacts' => 'r_contacts', '/contacts/edit' => 'r_contact_edit', '/contacts/delete-all' => 'r_contacts_delete_all', '/contacts/pick' => 'r_pick', '/contacts/save' => 'r_save_contact', '/groups' => 'r_groups', '/discard' => 'r_discard', '/change-email' => 'r_change_email', '/copy' => 'r_copy',
        '/hooks/tick' => 'r_tick_hook', '/mfa' => 'r_mfa', '/admin' => 'r_admin', '/admin/delivery' => 'r_admin_delivery', '/admin/finance' => 'r_admin_finance', '/admin/reports' => 'r_admin_reports', '/admin/site' => 'r_admin_site', '/admin/designs' => 'r_admin_designs', '/admin/occasions' => 'r_admin_occasions', '/admin/wording' => 'r_admin_wording', '/admin/app' => 'r_admin_app', '/admin/email' => 'r_admin_email', '/admin/privacy' => 'r_admin_privacy', '/admin/access' => 'r_admin_access', '/admin/health' => 'r_admin_health', '/admin/audit' => 'r_admin_audit', '/admin/audit/export' => 'r_admin_audit_export', '/admin/action' => 'r_admin_action', '/admin/senders' => 'r_admin_senders', '/admin/measures' => 'r_admin_measures', '/admin/giftaid' => 'r_admin_giftaid', '/admin/rehearsal' => 'r_admin_rehearsal', '/admin/library' => 'r_admin_library', '/admin/library/edit' => 'r_admin_library_edit', '/admin/library/save' => 'r_admin_library_save', '/admin/library/discard' => 'r_admin_library_discard', '/admin/library/preview' => 'r_admin_library_preview', '/admin/library/action' => 'r_admin_library_action', '/admin/qr' => 'r_admin_qr', '/admin/library/img' => 'r_admin_library_img', '/admin/export' => 'r_export', '/admin/message' => 'r_message', '/hooks/stripe' => 'r_stripe_hook', '/hooks/postmark' => 'r_postmark_hook'];
    if (post() && !str_starts_with($path, '/hooks/')) check_csrf();
    if (preg_match('#^/c/([a-f0-9]+)(?:/(open|report))?$#', $path, $m)) r_card($m[1], $m[2] ?? '');
    if (preg_match('#^/art/([a-z0-9.-]+)$#', $path, $m)) r_art($m[1]);
    if (preg_match('#^/optout/([a-f0-9]+)$#', $path, $m)) r_optout($m[1]);
    if (isset($routes[$path])) $routes[$path]();
    fail(404, 'Page not found.');
}
