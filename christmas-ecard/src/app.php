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
require __DIR__ . '/styles.php';
require __DIR__ . '/bulk.php';
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
/** Drop downs above the gallery: occasion, style and (for a signed in sender) favourites only. A plain page address, so it works without scripts and can be shared. Empty when there is nothing to choose. */
function occasion_filter(string $want, string $style = '', bool $fav = false): string {
    $o = gallery_occasions(); $st = gallery_styles(); $can = (bool)user();
    if (count($o) < 2 && !$st && !($can && fav_slugs())) return '';
    $b = '<form method="get" action="/#gallery" class="gfilter">';
    if (count($o) >= 2) { $b .= '<label for="gocc">Show cards for</label><select id="gocc" name="occasion" data-autosubmit><option value="">All occasions</option>'; foreach ($o as $slug => $label) $b .= '<option value="' . h($slug) . '"' . ($want === $slug ? ' selected' : '') . '>' . h($label) . '</option>'; $b .= '</select>'; }
    if ($st) { $b .= '<label for="gsty">Style</label><select id="gsty" name="style" data-autosubmit><option value="">Any style</option>'; foreach ($st as $slug => $label) $b .= '<option value="' . h($slug) . '"' . ($style === $slug ? ' selected' : '') . '>' . h($label) . '</option>'; $b .= '</select>'; }
    if ($can) $b .= '<label class="opt"><input type="checkbox" name="fav" value="1" data-autosubmit' . ($fav ? ' checked' : '') . '> Only my favourites</label>';
    return $b . '<noscript><button class="btn alt">Show</button></noscript></form>';
}
/** "What's the occasion?": a picture tile for every occasion that has cards on show (with an All cards tile), only when there is more than one. Plain links, so they work without scripts. */
function occasion_tiles(string $want): string {
    $o = gallery_occasions(); if (count($o) < 2) return '';
    $first = []; foreach (gallery_cards() as $id => $c) $first[$c['cat'] ?? 'christmas'] ??= $id; $n = []; foreach (gallery_cards() as $c) $n[$c['cat'] ?? 'christmas'] = ($n[$c['cat'] ?? 'christmas'] ?? 0) + 1;
    $t = fn($href, $art, $label, $count, $cur) => '<li><a class="tile otile" href="' . $href . '#gallery"' . ($cur ? ' aria-current="true"' : '') . '>' . $art . '<span>' . h($label) . '<small>' . $count . ($count === 1 ? ' card' : ' cards') . '</small></span></a></li>';
    $b = '<h2>What is the occasion?</h2><ul class="grid otiles plain">' . $t('/', card_art(array_key_first(gallery_cards()), true), 'All cards', count(gallery_cards()), $want === '');
    foreach ($o as $slug => $label) $b .= $t('/?occasion=' . h($slug), card_art($first[$slug], true), $label, $n[$slug], $want === $slug);
    return $b . '</ul>';
}
/** Cards the Group has featured, up to four, in gallery order. Empty when none are featured. */
/** A short row of cards under a heading (up to four), with the Preview link and, for a signed in sender, the heart. */
function card_strip(string $heading, array $ids, string $cls, array $favs, string $back): string {
    if (!$ids) return '';
    $b = '<h2>' . h($heading) . '</h2><div class="grid">';
    foreach (array_slice($ids, 0, 4) as $id) { $c = gallery_cards()[$id]; $b .= '<div class="tilebox"><a class="tile ' . $cls . '" href="/compose?card=' . h($id) . '">' . card_art($id, true) . '<span>' . h($c['title']) . '</span><em class="tjoke">' . h($c['joke']) . '</em></a>' . preview_link($id, $c['title']) . (user() ? fav_button($id, $c['title'], in_array($id, $favs, true), $back) : '') . '</div>'; }
    return $b . '</div>';
}
/** Cards the Group has featured, in gallery order. */
function featured_strip(array $favs, string $back): string {
    return card_strip('Featured cards', array_values(array_filter(array_keys(gallery_cards()), fn($id) => in_array($id, featured_slugs(), true))), 'feat', $favs, $back);
}
/** Cards added through the eCard Library in the last 30 days, newest first, leaving out any already featured. The original Christmas set never counts as new. */
function new_strip(array $favs, string $back): string {
    if (setting('show_new_strip', '1') === '0') return '';
    try { $rows = all('select d.slug from campaign_designs cd join design_versions v on v.id=cd.published_version_id join designs d on d.id=cd.design_id where cd.state=\'published\' and v.full_key is not null and v.published_at>? order by v.published_at desc', [time() - 30 * 86400]); } catch (Throwable $e) { return ''; }
    $ids = array_values(array_filter(array_column($rows, 'slug'), fn($id) => isset(gallery_cards()[$id]) && !in_array($id, featured_slugs(), true)));
    return card_strip('New this month', $ids, 'newc', $favs, $back);
}
/** The small line above a card's title: its occasion and styles, such as "Christmas · Funny, Heartfelt". Occasion is left out when there is only one. */
function card_kicker(array $c, string $id, array $occ, array $stl, array $smap): string {
    $p = []; if (count($occ) > 1) $p[] = $occ[$c['cat'] ?? 'christmas'] ?? ''; $s = array_filter(array_map(fn($x) => $stl[$x] ?? '', $smap[$id] ?? [])); if ($s) $p[] = implode(', ', $s);
    return implode(' · ', array_filter($p));
}
function preview_link(string $id, string $title): string { return '<a class="tpreview" href="/card-preview?card=' . h($id) . '">Preview<span class="sr"> ' . h($title) . '</span></a>'; }
/** The whole card, large, before a sender commits to it. Only cards on show; anything else goes back to the gallery. */
function r_card_preview(): void {
    $id = (string)($_GET['card'] ?? ''); $c = gallery_cards()[$id] ?? null; if (!$c) redirect('/#gallery');
    page('Preview: ' . $c['title'], '<h1>' . h($c['title']) . '</h1><p class="lead">' . h($c['joke']) . '</p><div class="cardpreview">' . card_art($id) . '</div><p class="row"><a class="btn big" href="/compose?card=' . h($id) . '">Personalise this card</a> <a class="btn alt" href="/#gallery">Back to the cards</a></p><p class="note">This is the picture only. You add your own message and who it is for in the next step.</p>');
}
/** Who runs the service, as structured data. Only the town is given, never a street address. */
function org_ld(): array {
    $o = ['@context' => 'https://schema.org', '@type' => 'Organization', '@id' => base_url() . '/#org', 'name' => '7th Swindon Scouts', 'logo' => base_url() . '/assets/brand/7th-swindon-circle-blue.png', 'address' => ['@type' => 'PostalAddress', 'addressLocality' => 'Swindon', 'addressRegion' => 'Wiltshire', 'addressCountry' => 'GB']];
    if (group_link_url() !== '') { $o['url'] = group_link_url(); $o['sameAs'] = [group_link_url()]; }
    return $o;
}
/** What search engines and other crawlers may read: the public pages and pictures, nothing else. Card links, accounts and admin stay closed (and also say noindex themselves). */
function r_robots(): never {
    header('Content-Type: text/plain; charset=UTF-8'); header('Cache-Control: public, max-age=3600');
    echo "User-agent: *\nDisallow: /\nAllow: /\$\nAllow: /llms.txt\nAllow: /help\nAllow: /privacy\nAllow: /terms\nAllow: /art/\nAllow: /assets/\n\nSitemap: " . base_url() . "/sitemap.xml\n"; exit;
}
/** A short plain summary for AI tools (the llms.txt convention): what the service is and where the facts are. Built from the live settings, so it never goes out of date, and it says nothing that is not already on the public pages. */
function r_llms(): never {
    header('Content-Type: text/plain; charset=UTF-8'); header('Cache-Control: public, max-age=3600');
    $b = base_url(); $occ = array_values(gallery_occasions()); $g = group_link_url(); $mail = support_email();
    echo "# " . SITE_NAME . "\n\n"
        . "> Free Scout themed eCards from 7th Swindon Scouts, in Swindon, Wiltshire. A person chooses a design, writes a message and emails a private card to friends and family. Sending is always free" . (donations_enabled() ? ', and a donation to the Group is optional' : '') . ".\n\n"
        . "## What it is\n\n"
        . "- Illustrated, Scout themed cards" . ($occ ? ' for ' . implode(', ', $occ) : '') . ".\n"
        . "- Each card goes to up to " . max_recipients() . " people. Every person gets their own private link and opens an envelope; the link works for " . expiry_days() . " days.\n"
        . "- Cards are private. They are not listed or searchable, and a card link is never public.\n"
        . "- Run by 7th Swindon Scouts" . ($g !== '' ? " (website: $g)" : '') . ". Contact: $mail.\n\n"
        . "## Pages\n\n"
        . "- [Choose a card]($b/): the card designs, by occasion\n"
        . "- [Help and FAQ]($b/help): cost, when cards arrive, how long they last, privacy, what to do if a card does not arrive\n"
        . "- [Privacy and cookies]($b/privacy): what is kept and for how long\n"
        . "- [Terms and safeguarding]($b/terms): who can send, acceptable use and how young people are kept safe\n";
    exit;
}
/** The public pages, for search engines. Never a card link, a promotion label or anything private. */
function r_sitemap(): never {
    header('Content-Type: application/xml; charset=UTF-8'); header('Cache-Control: public, max-age=3600');
    echo '<?xml version="1.0" encoding="UTF-8"?>' . "\n" . '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
    foreach (['/', '/help', '/privacy', '/terms'] as $p) echo '<url><loc>' . htmlspecialchars(base_url() . $p, ENT_XML1) . '</loc></url>';
    echo '</urlset>'; exit;
}
function r_home(): void {
    seo(['desc' => 'Free Scout themed eCards from 7th Swindon Scouts in Swindon. Choose a design, write your message and email a private card to friends and family.', 'canonical' => '/', 'og_title' => 'Send a card, Scout style',
        'ld' => [org_ld(), ['@context' => 'https://schema.org', '@type' => 'WebSite', 'name' => SITE_NAME, 'url' => base_url() . '/', 'inLanguage' => 'en-GB', 'publisher' => ['@id' => base_url() . '/#org']]]]);
    if (preg_match('/^[a-z0-9-]{1,30}$/', (string)($_GET['ref'] ?? ''))) $_SESSION['ref'] = $_GET['ref']; // promotion source label only, never a person
    $st = sending_state(); $want = occasion_wanted(); $sty = style_wanted(); $fav = !empty($_GET['fav']) && user(); $favs = fav_slugs();
    $b = '<section class="hero"><div><p class="eyebrow">' . h(SITE_NAME) . '</p><h1>' . (($cs = current_season()) ? 'Send ' . card_phrase_for($cs[1] . ' card') . ', Scout style' : 'Send a card, Scout style') . '</h1><p class="lead">Pick a design, write your message and we will email a private card to your friends and family. Sending is free' . (donations_enabled() ? ', and a donation is optional' : '') . '.</p><p><a class="btn big" href="#gallery">Choose a card</a> <a class="btn ghost" href="#how">How it works</a></p></div><div class="heroart" aria-hidden="true">' . (($hero = hero_for_session()) ? card_art($hero) : '') . '</div></section>';
    if ($st === 'locked') $b .= '<p class="flash warn">Sending is not open yet. You can prepare a card now.</p>';
    $b .= '<h2 id="how">How it works</h2><ol class="how"><li><b>1</b><strong>Choose a design</strong><span class="hd">Illustrated Scout themed cards, from tents to campfires.</span></li><li><b>2</b><strong>Write your message</strong><span class="hd">Add up to ' . max_recipients() . ' people. Give anyone a personal note if you like.</span></li><li><b>3</b><strong>We send each card</strong><span class="hd">Everyone gets their own private link and opens an envelope.</span></li></ol>'
        . (!donations_enabled() ? '' : '<section class="cause"><h2>Every card helps local Scouting</h2><p>' . h(DONATION_PURPOSE) . '</p><p>Sending is always free. You never have to donate, and a donation never changes how your card looks.</p></section>')
        . occasion_tiles($want) . (($want === '' && $sty === '' && !$fav) ? featured_strip($favs, '') . new_strip($favs, '') : '') . '<h2 id="gallery">Pick a design</h2>' . occasion_filter($want, $sty, (bool)$fav);
    $smap = style_map(); $occ = gallery_occasions(); $stl = array_column(style_rows(true), 'label', 'slug');
    $show = array_filter(gallery_cards(), fn($c, $id) => ($want === '' || ($c['cat'] ?? 'christmas') === $want) && ($sty === '' || in_array($sty, $smap[$id] ?? [], true)) && (!$fav || in_array($id, $favs, true)), ARRAY_FILTER_USE_BOTH);
    uasort($show, fn($x, $y) => season_rank($x) <=> season_rank($y)); // cards for an occasion in season come first, then occasions with no season, then ones whose season is not on (the order within each stays as set)
    $back = http_build_query(array_filter(['occasion' => $want, 'style' => $sty, 'fav' => $fav ? '1' : '']));
    if ($want !== '' || $sty !== '' || $fav) $b .= '<p class="note" role="status">' . ($show ? count($show) . (count($show) === 1 ? ' card' : ' cards') . ' shown.' : 'No cards match those choices.') . ' <a href="/#gallery">Show all cards</a></p>';
    $b .= '<div class="grid">';
    foreach ($show as $id => $c)
        $b .= '<div class="tilebox"><a class="tile" href="/compose?card=' . h($id) . '">' . card_art($id, true) . (($k = card_kicker($c, $id, $occ, $stl, $smap)) !== '' ? '<small class="tkick">' . h($k) . '</small>' : '') . '<span>' . h($c['title']) . '</span><em class="tjoke">' . h($c['joke']) . '</em></a>' . preview_link($id, $c['title']) . (user() ? fav_button($id, $c['title'], in_array($id, $favs, true), $back) : '') . '</div>';
    page('Free Scout eCards to send by email', $b . '</div>');
}

function r_help(): void {
    $e = h(support_email());
    $faq = [
        'Is it really free?' => 'Yes. Sending is always free.' . (donations_enabled() ? ' A donation is optional and goes to 7th Swindon Scouts. ' . DONATION_PURPOSE : ''),
        'Can I choose when a card arrives?' => 'Yes. On the last step you can send straight away or choose a date and time. Scheduled cards can be cancelled from My cards until they are sent.',
        'I did not get the verification email' => 'Check your spam or junk folder, then sign in and ask for it again. If the address was wrong, register again with the right one.',
        'My recipient did not get their card' => 'Open "My cards" to see each card\'s status. If it shows Failed, correct the address and send again. Ask the recipient to check spam.',
        'What do the statuses mean?' => implode(' ', array_map(fn($k, $v) => status_label($k) . ": $v", array_keys(STATUS_HELP), STATUS_HELP)),
        'How long does a card last?' => 'A card link works for ' . expiry_days() . ' days after it is sent.',
        ...(donations_enabled() ? ['I have a question about a donation' => "Email $e and quote the reference from your receipt."] : []),
        'How do you decide a card was viewed?' => 'A card counts as Viewed only when the recipient deliberately presses Open your card. Opening the email, or a security scanner fetching the link, does not count. If someone reads the card without that step we cannot tell, so it shows as not confirmed. Viewed never means we know who read it.',
        'Can I delete my account?' => 'Yes, from the bottom of My cards. It cancels cards that have not started sending, deletes your saved contacts and groups, and switches off the links of the cards you sent. Finance records and opt-out records are kept separately.',
        'I received a card I do not want' => 'Open the card and use "Report this card", or use the "stop cards" link at the bottom of the email.',
    ];
    $b = '<h1>Help and FAQ</h1>'; $ld = [];
    foreach ($faq + faq_parse(setting('help_extra')) as $q => $a) $ld[] = ['@type' => 'Question', 'name' => $q, 'acceptedAnswer' => ['@type' => 'Answer', 'text' => trim(html_entity_decode(strip_tags($a), ENT_QUOTES))]];
    seo(['desc' => 'Answers about sending free eCards from 7th Swindon Scouts: what it costs, when cards arrive, how long they last, privacy, and what to do if a card does not arrive.', 'canonical' => '/help', 'og_title' => 'Help and FAQ', 'ld' => [['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $ld]]]);
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
        '/contacts/import' => 'r_contacts_import', '/favourite' => 'r_favourite', '/robots.txt' => 'r_robots', '/llms.txt' => 'r_llms', '/sitemap.xml' => 'r_sitemap', '/admin/bulk' => 'r_admin_bulk', '/card-preview' => 'r_card_preview', '/admin/design-styles' => 'r_admin_design_styles', '/compose' => 'r_compose', '/preview' => 'r_preview', '/email-preview' => 'r_email_preview', '/review' => 'r_review', '/pay-cancelled' => 'r_pay_cancelled', '/return' => 'r_return', '/dev/pay' => 'r_dev_pay', '/dashboard' => 'r_dashboard', '/send' => 'r_send', '/prefs' => 'r_prefs', '/remind-off' => 'r_remind_off', '/privacy' => 'r_privacy', '/terms' => 'r_terms', '/accept-terms' => 'r_accept_terms', '/account/delete' => 'r_account_delete', '/account' => 'r_account', '/admin/mail' => 'r_admin_mail', '/admin/platform' => 'r_admin_platform', '/invite' => 'r_invite', '/admin/invites' => 'r_admin_invites', '/account/confirm-email' => 'r_account_confirm_email', '/contacts' => 'r_contacts', '/contacts/edit' => 'r_contact_edit', '/contacts/delete-all' => 'r_contacts_delete_all', '/contacts/pick' => 'r_pick', '/contacts/save' => 'r_save_contact', '/groups' => 'r_groups', '/discard' => 'r_discard', '/change-email' => 'r_change_email', '/copy' => 'r_copy',
        '/hooks/tick' => 'r_tick_hook', '/mfa' => 'r_mfa', '/admin' => 'r_admin', '/admin/delivery' => 'r_admin_delivery', '/admin/finance' => 'r_admin_finance', '/admin/reports' => 'r_admin_reports', '/admin/site' => 'r_admin_site', '/admin/designs' => 'r_admin_designs', '/admin/occasions' => 'r_admin_occasions', '/admin/wording' => 'r_admin_wording', '/admin/app' => 'r_admin_app', '/admin/email' => 'r_admin_email', '/admin/privacy' => 'r_admin_privacy', '/admin/access' => 'r_admin_access', '/admin/health' => 'r_admin_health', '/admin/audit' => 'r_admin_audit', '/admin/audit/export' => 'r_admin_audit_export', '/admin/action' => 'r_admin_action', '/admin/senders' => 'r_admin_senders', '/admin/measures' => 'r_admin_measures', '/admin/giftaid' => 'r_admin_giftaid', '/admin/rehearsal' => 'r_admin_rehearsal', '/admin/library' => 'r_admin_library', '/admin/library/edit' => 'r_admin_library_edit', '/admin/library/save' => 'r_admin_library_save', '/admin/library/discard' => 'r_admin_library_discard', '/admin/library/preview' => 'r_admin_library_preview', '/admin/library/action' => 'r_admin_library_action', '/admin/qr' => 'r_admin_qr', '/admin/library/img' => 'r_admin_library_img', '/admin/export' => 'r_export', '/admin/message' => 'r_message', '/hooks/stripe' => 'r_stripe_hook', '/hooks/postmark' => 'r_postmark_hook'];
    if (post() && !str_starts_with($path, '/hooks/')) check_csrf();
    if (preg_match('#^/c/([a-f0-9]+)(?:/(open|report))?$#', $path, $m)) r_card($m[1], $m[2] ?? '');
    if (preg_match('#^/art/([a-z0-9.-]+)$#', $path, $m)) r_art($m[1]);
    if (preg_match('#^/optout/([a-f0-9]+)$#', $path, $m)) r_optout($m[1]);
    if (isset($routes[$path])) $routes[$path]();
    fail(404, 'Page not found.');
}
