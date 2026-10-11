<?php
// Gift Aid (FR-141). Off by default. Needs a charity name and the switch turned on.
// Declaration wording follows HMRC's model wording and is stored with every declaration. The Treasurer must confirm eligibility to claim.

const GIFTAID_VERSION = 'GA-1';

function giftaid_on(): bool { return setting('giftaid_enabled') === '1' && trim(setting('giftaid_charity')) !== ''; }
function giftaid_wording(): string {
    return 'I want to Gift Aid my donation of this amount, and any donations I make in the future or have made in the past 4 years, to ' . trim(setting('giftaid_charity'))
        . '. I am a UK taxpayer and understand that if I pay less Income Tax and/or Capital Gains Tax than the amount of Gift Aid claimed on all my donations in that tax year it is my responsibility to pay any difference.';
}
function giftaid_postcode(string $p): ?string {
    $p = strtoupper(preg_replace('/\s+/', '', trim($p)));
    return preg_match('/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/', $p) ? substr($p, 0, -3) . ' ' . substr($p, -3) : null;
}
/** Returns [clean data or null, error list]. Field lengths follow the HMRC schedule. */
function giftaid_validate(array $in): array {
    $e = []; $d = ['title' => mb_substr(trim((string)($in['ga_title'] ?? '')), 0, 4), 'first' => trim((string)($in['ga_first'] ?? '')), 'last' => trim((string)($in['ga_last'] ?? '')), 'house' => trim((string)($in['ga_house'] ?? ''))];
    if ($d['first'] === '' || mb_strlen($d['first']) > 35) $e[] = 'Gift Aid needs your first name (up to 35 characters).';
    if ($d['last'] === '' || mb_strlen($d['last']) > 35) $e[] = 'Gift Aid needs your last name (up to 35 characters).';
    if ($d['house'] === '' || mb_strlen($d['house']) > 40) $e[] = 'Gift Aid needs your house name or number (up to 40 characters).';
    $pc = giftaid_postcode((string)($in['ga_postcode'] ?? '')); if (!$pc) $e[] = 'Gift Aid needs a valid UK home postcode.'; $d['postcode'] = $pc;
    if (empty($in['ga_taxpayer'])) $e[] = 'Please confirm the Gift Aid declaration.';
    return [$e ? null : $d, $e];
}
/** Called while a donation is being started. $d null removes any earlier unused declaration for this card. */
function giftaid_save_pending(int $sid, ?array $d): void {
    q("delete from giftaid where send_id=? and status='pending'", [$sid]);
    if ($d) q("insert into giftaid(send_id,user_id,title,first_name,last_name,house,postcode,wording,declared_at,status) select ?,user_id,?,?,?,?,?,?,?,'pending' from sends where id=?", [$sid, $d['title'], $d['first'], $d['last'], $d['house'], $d['postcode'], giftaid_wording(), time(), $sid]);
}
/** Called once payment is verified and the donation row exists. */
function giftaid_link(int $sid, string $session): void {
    $d = one('select id from donations where stripe_session=?', [$session]);
    if ($d) q("update giftaid set donation_id=?, status='declared', declared_at=? where send_id=? and status='pending'", [$d['id'], time(), $sid]);
}
function giftaid_receipt_line(int $sid, int $pence): string {
    return one("select 1 from giftaid where send_id=? and status='pending'", [$sid]) ? 'You added Gift Aid, so the Group can claim an extra ' . gbp(intdiv($pence, 4)) . ' from HMRC at no cost to you. You can ask us to withdraw it at any time.' . "\n\n" : '';
}
function giftaid_form_block(): string {
    if (!giftaid_on()) return '';
    $o = $_SESSION['ga_old'] ?? []; unset($_SESSION['ga_old']); $v = fn($k) => h((string)($o[$k] ?? ''));
    return '<fieldset id="giftaid"><legend>Gift Aid (optional)</legend><label class="opt"><input type="checkbox" name="giftaid" value="1"' . (!empty($o['giftaid']) ? ' checked' : '') . '> Yes, add Gift Aid. It makes my donation worth 25% more, at no cost to me.</label>'
        . '<p class="note">' . h(giftaid_wording()) . '</p><label class="opt"><input type="checkbox" name="ga_taxpayer" value="1"' . (!empty($o['ga_taxpayer']) ? ' checked' : '') . '> I confirm this declaration</label>'
        . '<div class="row"><label>Title (optional)<input name="ga_title" maxlength="4" size="5" value="' . $v('ga_title') . '"></label><label>First name<input name="ga_first" maxlength="35" autocomplete="given-name" value="' . $v('ga_first') . '"></label><label>Last name<input name="ga_last" maxlength="35" autocomplete="family-name" value="' . $v('ga_last') . '"></label></div>'
        . '<div class="row"><label>House name or number<input name="ga_house" maxlength="40" autocomplete="address-line1" value="' . $v('ga_house') . '"></label><label>Home postcode<input name="ga_postcode" maxlength="10" autocomplete="postal-code" value="' . $v('ga_postcode') . '"></label></div>'
        . '<p class="note">We use these details only to claim Gift Aid. They are kept apart from your cards and seen only by the Group\'s finance volunteers. Ignore this box if you do not want Gift Aid.</p></fieldset>';
}

/** Declarations that can be claimed: declared, not withdrawn, not yet claimed, with money still left after refunds. Amount is net of refunds. */
function giftaid_eligible(string $from = '2000-01-01', string $to = '2999-12-31', bool $unclaimedOnly = true): array {
    return all("select g.*, d.created donated, d.pence - d.refunded amount from giftaid g join donations d on d.id=g.donation_id where g.status='declared' and d.pence - d.refunded > 0 and d.created>=? and d.created<?" . ($unclaimedOnly ? ' and g.claimed_at is null' : '') . ' order by d.created', [strtotime($from), strtotime($to) + 86400]);
}

function r_admin_giftaid(): void {
    $u = need_role('finance');
    $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? $_POST['from'] ?? '') ? ($_GET['from'] ?? $_POST['from']) : '2000-01-01'; $to = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to'] ?? $_POST['to'] ?? '') ? ($_GET['to'] ?? $_POST['to']) : '2999-12-31';
    if (isset($_GET['csv'])) {
        $rows = giftaid_eligible($from, $to); if (!$rows) page('Nothing to claim', '<h1>Nothing to claim</h1><p>No unclaimed Gift Aid donations in that range.</p><p><a class="btn" href="/admin/giftaid">Back</a></p>');
        audit((int)$u['id'], 'giftaid_export', "$from to $to, " . count($rows) . ' declarations');
        header('Content-Type: text/csv; charset=utf-8'); header('Content-Disposition: attachment; filename="gift-aid-schedule-' . date('Ymd') . '.csv"');
        $o = fopen('php://output', 'w'); fputcsv($o, ['Title', 'First name', 'Last name', 'House name or number', 'Postcode', 'Aggregated donations', 'Sponsored event', 'Donation date', 'Amount']);
        foreach ($rows as $r) fputcsv($o, [csv_text((string)$r['title']), csv_text($r['first_name']), csv_text($r['last_name']), csv_text($r['house']), csv_text($r['postcode']), '', '', date('d/m/y', (int)$r['donated']), number_format($r['amount'] / 100, 2, '.', '')]);
        exit;
    }
    if (post()) {
        $do = $_POST['do'] ?? '';
        if ($do === 'claimed') {
            $batch = trim((string)($_POST['batch'] ?? '')); if ($batch === '') { flash('Enter the HMRC claim reference or a note, so claimed rows can be traced.', 'err'); redirect('/admin/giftaid'); }
            $ids = array_column(giftaid_eligible($from, $to), 'id'); foreach ($ids as $i) q('update giftaid set claimed_at=?, claim_batch=? where id=? and claimed_at is null', [time(), mb_substr($batch, 0, 100), $i]);
            audit((int)$u['id'], 'giftaid_marked_claimed', count($ids) . " declarations, batch $batch"); flash(count($ids) . ' marked as claimed.'); redirect('/admin/giftaid');
        }
        if ($do === 'withdraw') { q("update giftaid set status='withdrawn' where id=? and claimed_at is null", [(int)($_POST['id'] ?? 0)]); audit((int)$u['id'], 'giftaid_withdrawn', 'declaration ' . (int)($_POST['id'] ?? 0)); flash('Declaration withdrawn. It will not be claimed.'); redirect('/admin/giftaid'); }
    }
    $el = giftaid_eligible($from, $to); $sum = array_sum(array_column($el, 'amount'));
    $b = '<h1>Gift Aid</h1><dl class="facts"><dt>Status</dt><dd>' . (giftaid_on() ? 'On' : 'Off') . '</dd><dt>Charity name used in the declaration</dt><dd>' . h(setting('giftaid_charity') ?: '(not set)') . '</dd></dl>'
        . '<p class="note">Donors are asked for their name and home address only if they tick Gift Aid. Turn the feature on under Campaign settings once the Treasurer has confirmed the Group can claim and approved the wording. Only unclaimed, undeclared-as-withdrawn donations still above zero after refunds are listed, using the amount after refunds.</p>'
        . '<h2>Ready to claim</h2><p><strong>' . count($el) . '</strong> declarations, <strong>' . gbp($sum) . '</strong> in donations. Estimated claim: <strong>' . gbp(intdiv($sum, 4)) . '</strong>.</p>';
    if ($el) $b .= '<p><a class="btn" href="/admin/giftaid?csv=1">Download the claim schedule (CSV)</a></p><form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="claimed"><label>HMRC claim reference or note<input name="batch" required maxlength="100"></label><button class="btn alt">Mark these as claimed</button></form><p class="note">Download first, submit to HMRC, then mark as claimed so they are not claimed twice.</p>';
    $b .= '<h2>Declarations</h2><table class="stacked"><tr><th>Donor</th><th>Amount after refunds</th><th>Status</th><th></th></tr>';
    foreach (all("select g.*, d.pence - d.refunded amount, d.created donated from giftaid g left join donations d on d.id=g.donation_id where g.status<>'pending' order by g.id desc limit 100") as $r)
        $b .= '<tr><td>' . h($r['first_name'] . ' ' . $r['last_name']) . '<br><small>' . h($r['house'] . ', ' . $r['postcode']) . '</small></td><td>' . gbp((int)$r['amount']) . '</td><td>' . h(ucfirst($r['status'])) . ($r['claimed_at'] ? ' and claimed (' . h($r['claim_batch']) . ')' : '') . '</td><td>' . (!$r['claimed_at'] && $r['status'] === 'declared' ? '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="withdraw"><input type="hidden" name="id" value="' . $r['id'] . '"><button class="link">Withdraw (donor asked)</button></form>' : '') . '</td></tr>';
    admin_page('Gift Aid', $b . '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No declarations yet.</p>' : ''));
}
