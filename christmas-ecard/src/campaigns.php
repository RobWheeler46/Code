<?php
// EC-06 and EC-07 (build pack v2.7): occasions and draft campaigns. Draft only, on purpose: nothing here can open a campaign to senders.
// Christmas 2026 stays the one live campaign. Activating another campaign needs Trustee approval (ED-04 to ED-08), so there is no activate button.

const CAMPAIGN_STATES = ['draft' => 'Draft (not public)', 'active' => 'Live', 'closed' => 'Closed'];
const DONATION_MODES = ['optional' => 'Optional donations (free sending stays the first choice)', 'none' => 'Greeting only, no donations'];

function campaign_rows(): array {
    return all('select c.*, o.label occasion, o.slug oslug, (select count(*) from campaign_designs cd where cd.campaign_id=c.id) n from campaigns c join occasions o on o.id=c.occasion_id where c.group_id=? order by c.id', [owner_group()]);
}
function campaign_row(int $id): ?array { foreach (campaign_rows() as $c) if ((int)$c['id'] === $id) return $c; return null; }

/** The campaign a send belongs to (Christmas when none is recorded yet). Donations and Gift Aid are decided per campaign, never globally by accident. */
function campaign_for_send(array $s): array {
    $c = !empty($s['campaign_id']) ? campaign_row((int)$s['campaign_id']) : null;
    return $c ?: (campaign_row(lib_campaign()) ?? ['donation_mode' => 'optional', 'giftaid' => 1]);
}
/** The site wide donations switch (Campaign settings). Off until the Trustees are ready: no donation option, no Gift Aid and no public fundraising wording. */
function donations_enabled(): bool { return setting('donations_enabled') === '1'; }
/** [slug, label] of the occasion a send belongs to (Christmas when it has no campaign yet). */
function occasion_of(array $s): array { $c = campaign_for_send($s); return [(string)($c['oslug'] ?? 'christmas'), (string)($c['occasion'] ?? 'Christmas')]; }
/** The occasion as it reads in a sentence: "Christmas card", "birthday card", "thank you card". */
function card_word(array $s): string { [$slug, $label] = occasion_of($s); return ($slug === 'christmas' ? 'Christmas' : strtolower($label)) . ' card'; }
function campaign_allows(array $s, string $what): bool {
    if (!donations_enabled()) return false;
    $c = campaign_for_send($s);
    return match ($what) { 'donation' => ($c['donation_mode'] ?? 'optional') === 'optional', 'giftaid' => ($c['donation_mode'] ?? 'optional') === 'optional' && !empty($c['giftaid']), default => false };
}

/** Creates a draft campaign. Never live, never visible to senders, never touches the Christmas campaign. */
function campaign_create(array $in, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'errors' => ['form' => 'You do not have permission for that.']];
    $e = []; $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 80); $occ = one('select * from occasions where id=?', [(int)($in['occasion'] ?? 0)]);
    $mode = isset(DONATION_MODES[$in['mode'] ?? '']) ? $in['mode'] : 'optional'; $ben = mb_substr(trim((string)($in['beneficiary'] ?? '')), 0, 200);
    if ($name === '') $e['name'] = 'Give the campaign a name, for example "Thank you 2027".';
    if (!$occ) $e['occasion'] = 'Choose an occasion.';
    if ($name !== '' && one('select 1 x from campaigns where group_id=? and lower(name)=lower(?)', [owner_group(), $name])) $e['name'] = 'There is already a campaign with that name.';
    if ($mode === 'optional' && $ben === '') $e['beneficiary'] = 'Say who donations would support, or choose "Greeting only".';
    if ($e) return ['ok' => false, 'errors' => $e];
    q("insert into campaigns(group_id,occasion_id,name,status,beneficiary,donation_mode,giftaid,revision,created) values(?,?,?,'draft',?,?,0,1,?)", [owner_group(), $occ['id'], $name, $mode === 'none' ? null : $ben, $mode, time()]);
    $id = (int)db()->lastInsertId(); audit($uid, 'campaign_draft_created', "campaign $id: $name ({$occ['slug']}), $mode");
    return ['ok' => true, 'id' => $id];
}

function campaign_update(int $id, array $in, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'error' => 'You do not have permission for that.'];
    $c = campaign_row($id); if (!$c) return ['ok' => false, 'error' => 'We could not find that campaign.'];
    if ($c['status'] !== 'draft') return ['ok' => false, 'error' => 'Only draft campaigns can be changed here.'];
    if ((int)($in['rev'] ?? 0) !== (int)$c['revision']) return ['ok' => false, 'conflict' => true, 'error' => 'Someone else changed this campaign. Reload the page and try again.'];
    $name = mb_substr(trim((string)($in['name'] ?? '')), 0, 80); $mode = isset(DONATION_MODES[$in['mode'] ?? '']) ? $in['mode'] : 'optional'; $ben = mb_substr(trim((string)($in['beneficiary'] ?? '')), 0, 200);
    if ($name === '') return ['ok' => false, 'error' => 'Give the campaign a name.'];
    if ($mode === 'optional' && $ben === '') return ['ok' => false, 'error' => 'Say who donations would support, or choose "Greeting only".'];
    q('update campaigns set name=?, donation_mode=?, beneficiary=?, revision=revision+1 where id=?', [$name, $mode, $mode === 'none' ? null : $ben, $id]);
    audit($uid, 'campaign_draft_updated', "campaign $id: {$c['donation_mode']} to $mode");
    return ['ok' => true];
}

/** Reuses an already published design in a draft campaign by pointing at its current version. No picture is copied. The sender of the change confirms the wording and year suit this campaign. */
function campaign_attach(int $cid, int $did, bool $reviewed, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'error' => 'You do not have permission for that.'];
    $c = campaign_row($cid); $d = lib_row($did); if (!$c || !$d) return ['ok' => false, 'error' => 'We could not find that.'];
    if ($c['status'] !== 'draft') return ['ok' => false, 'error' => 'Only draft campaigns can be changed here.'];
    if (!$d['pub_vid']) return ['ok' => false, 'error' => 'Only published designs can be reused.'];
    if (!$reviewed) return ['ok' => false, 'error' => 'Please confirm you have checked the wording and year suit this campaign.'];
    if (one('select 1 x from campaign_designs where campaign_id=? and design_id=?', [$cid, $did])) return ['ok' => true, 'same' => true];
    $rank = (int)one('select coalesce(max(order_rank),0)+1 n from campaign_designs where campaign_id=?', [$cid])['n'];
    q("insert into campaign_designs(campaign_id,design_id,published_version_id,state,order_rank,approved_at) values(?,?,?,'draft',?,?)", [$cid, $did, $d['pub_vid'], $rank, time()]);
    audit($uid, 'campaign_design_attached', "campaign $cid: design $did version {$d['pub_no']}, wording and year reviewed");
    return ['ok' => true];
}
function campaign_detach(int $cid, int $did, int $uid): array {
    if (!lib_user_can($uid, 'manage')) return ['ok' => false, 'error' => 'You do not have permission for that.'];
    $c = campaign_row($cid); if (!$c || $c['status'] !== 'draft') return ['ok' => false, 'error' => 'Only draft campaigns can be changed here.'];
    if (!q('delete from campaign_designs where campaign_id=? and design_id=?', [$cid, $did])->rowCount()) return ['ok' => true, 'same' => true];
    audit($uid, 'campaign_design_detached', "campaign $cid: design $did"); return ['ok' => true];
}

// ---------- screens
function r_admin_campaigns(): void {
    need_admin(); lib_role();
    $old = $_SESSION['camp_old'] ?? null; $errs = $_SESSION['camp_errs'] ?? []; unset($_SESSION['camp_old'], $_SESSION['camp_errs']); $f = true;
    $b = '<h1>Occasions and campaigns</h1><p class="lead">Christmas 2026 is the only live campaign. You can prepare drafts for other occasions here. A draft is private: senders cannot reach it, and nothing here can make it live.</p><table class="stacked"><tr><th>Campaign</th><th>Occasion</th><th>Status</th><th>Designs</th><th>Donations</th><th></th></tr>';
    foreach (campaign_rows() as $c) $b .= '<tr><td>' . h($c['name']) . '</td><td>' . h($c['occasion']) . '</td><td>' . h(CAMPAIGN_STATES[$c['status']] ?? $c['status']) . '</td><td>' . (int)$c['n'] . '</td><td>' . ($c['donation_mode'] === 'none' ? 'None' : 'Optional') . '</td><td><a href="/admin/campaigns/view?id=' . (int)$c['id'] . '">' . ($c['status'] === 'draft' ? 'Open' : 'View') . '</a></td></tr>';
    $b .= '</table><h2>Create a draft campaign</h2>';
    if ($errs) { $b .= '<div class="flash err" role="alert" tabindex="-1"><strong>Please fix ' . count($errs) . ' thing' . (count($errs) === 1 ? '' : 's') . ':</strong><ul>'; foreach ($errs as $k => $m) $b .= '<li>' . h($m) . '</li>'; $b .= '</ul></div>'; }
    $b .= '<form method="post" action="/admin/campaigns/create" class="stack admincard" data-dirty-warn>' . csrf()
        . '<label>Campaign name<input name="name" maxlength="80" value="' . h((string)($old['name'] ?? '')) . '"' . fa($errs, 'name', $f) . '>' . fe($errs, 'name') . '</label>'
        . '<label>Occasion<select name="occasion"' . fa($errs, 'occasion', $f) . '><option value="">Choose</option>';
    foreach (all('select * from occasions order by id') as $o) $b .= '<option value="' . (int)$o['id'] . '"' . ((int)($old['occasion'] ?? 0) === (int)$o['id'] ? ' selected' : '') . '>' . h($o['label']) . '</option>';
    $b .= '</select>' . fe($errs, 'occasion') . '</label><fieldset><legend>Donations</legend>';
    foreach (DONATION_MODES as $k => $label) $b .= '<label class="opt"><input type="radio" name="mode" value="' . h($k) . '"' . ((($old['mode'] ?? 'optional') === $k) ? ' checked' : '') . '> ' . h($label) . '</label>';
    $b .= '</fieldset><label>Who donations would support (leave blank for greeting only)<input name="beneficiary" maxlength="200" value="' . h((string)($old['beneficiary'] ?? '')) . '"' . fa($errs, 'beneficiary', $f) . '>' . fe($errs, 'beneficiary') . '</label>'
        . '<p class="note">Making a campaign live needs Trustee approval of its purpose, beneficiary, wording and dates. That step is deliberately not available yet. Gift Aid stays off for every new campaign.</p><button class="btn">Create draft</button></form>';
    admin_page('Occasions and campaigns', $b);
}

function r_admin_campaigns_create(): void {
    $u = need_admin(); lib_role(); if (!post()) redirect('/admin/campaigns');
    limit_for("campaigns:{$u['id']}", 20, 3600);
    $r = campaign_create($_POST, (int)$u['id']);
    if (!$r['ok']) { $_SESSION['camp_old'] = $_POST; $_SESSION['camp_errs'] = $r['errors']; redirect('/admin/campaigns'); }
    flash('Draft campaign created. It is private.'); redirect('/admin/campaigns/view?id=' . $r['id']);
}

function r_admin_campaigns_view(): void {
    $u = need_admin(); lib_role(); $c = campaign_row((int)($_GET['id'] ?? 0)); if (!$c) fail(404, 'We could not find that campaign.');
    $cid = (int)$c['id']; $draft = $c['status'] === 'draft';
    $b = '<h1>' . h($c['name']) . '</h1><p><span class="pill st-draft">' . h(CAMPAIGN_STATES[$c['status']] ?? $c['status']) . '</span> ' . h($c['occasion']) . '</p>'
        . ($draft ? '<p class="flash warn">This campaign is private. Senders cannot reach it, and it cannot be made live from here.</p>' : '');
    if ($draft) $b .= '<form method="post" action="/admin/campaigns/action" class="stack admincard">' . csrf() . '<input type="hidden" name="do" value="update"><input type="hidden" name="id" value="' . $cid . '"><input type="hidden" name="rev" value="' . (int)$c['revision'] . '"><h2>Settings</h2>'
        . '<label>Campaign name<input name="name" maxlength="80" value="' . h($c['name']) . '"></label><fieldset><legend>Donations</legend>';
    if ($draft) { foreach (DONATION_MODES as $k => $label) $b .= '<label class="opt"><input type="radio" name="mode" value="' . h($k) . '"' . ($c['donation_mode'] === $k ? ' checked' : '') . '> ' . h($label) . '</label>';
        $b .= '</fieldset><label>Who donations would support<input name="beneficiary" maxlength="200" value="' . h((string)$c['beneficiary']) . '"></label><p class="note">Gift Aid is off for this campaign and needs its own approval.</p><button class="btn">Save settings</button></form>'; }
    $b .= '<section class="admincard"><h2>Designs in this campaign</h2>';
    $rows = all('select cd.design_id, cd.order_rank, d.internal_name, v.version_no from campaign_designs cd join designs d on d.id=cd.design_id left join design_versions v on v.id=cd.published_version_id where cd.campaign_id=? and d.owner_group_id=? order by cd.order_rank', [$cid, owner_group()]);
    $b .= $rows ? '<ul class="plain">' : '<p>None yet.</p>';
    foreach ($rows as $r) $b .= '<li>' . h($r['internal_name']) . ' (version ' . (int)$r['version_no'] . ')' . ($draft ? ' <form method="post" action="/admin/campaigns/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="detach"><input type="hidden" name="id" value="' . $cid . '"><input type="hidden" name="design" value="' . (int)$r['design_id'] . '"><button class="btn alt">Remove</button></form>' : '') . '</li>';
    if ($rows) $b .= '</ul>';
    if ($draft) {
        $have = array_column($rows, 'design_id'); $opts = '';
        foreach (lib_rows('published') as $d) if (!in_array($d['did'], $have, true)) $opts .= '<option value="' . (int)$d['did'] . '">' . h($d['internal_name']) . ' (version ' . (int)$d['pub_no'] . ')</option>';
        $b .= $opts ? '<form method="post" action="/admin/campaigns/action" class="stack">' . csrf() . '<input type="hidden" name="do" value="attach"><input type="hidden" name="id" value="' . $cid . '"><label>Reuse a published design<select name="design">' . $opts . '</select></label>'
            . '<label class="opt"><input type="checkbox" name="reviewed" value="1" required> I have checked the wording and year on this design suit this campaign</label><button class="btn alt">Add to campaign</button></form><p class="note">The same approved picture and version are used. Nothing is copied.</p>' : '<p class="note">Every published design is already included.</p>';
    }
    admin_page('Campaign', $b . '</section><p><a class="btn alt" href="/admin/campaigns">Back to campaigns</a></p>');
}

function r_admin_campaigns_action(): void {
    $u = need_admin(); lib_role(); if (!post()) redirect('/admin/campaigns'); $uid = (int)$u['id']; $id = (int)($_POST['id'] ?? 0); $do = (string)($_POST['do'] ?? '');
    limit_for("campaigns:$uid", 60, 3600);
    $res = match ($do) { 'update' => campaign_update($id, $_POST, $uid), 'attach' => campaign_attach($id, (int)($_POST['design'] ?? 0), !empty($_POST['reviewed']), $uid), 'detach' => campaign_detach($id, (int)($_POST['design'] ?? 0), $uid), default => fail(400, 'Unknown action.') };
    if (!$res['ok']) { flash($res['error'], 'err'); redirect('/admin/campaigns/view?id=' . $id); }
    flash(!empty($res['same']) ? 'Nothing to change.' : 'Saved.'); redirect('/admin/campaigns/view?id=' . $id);
}

/** Public: a way into an occasion. Only an approved, open campaign would ever show cards; today that is Christmas, which is the home page. Everything else gets a calm "not open" page, never a half empty gallery. */
function r_occasion(string $slug): void {
    $o = one('select * from occasions where slug=?', [$slug]);
    if ($o && $o['slug'] === 'christmas') redirect('/#gallery');
    $GLOBALS['bare'] = false;
    page('Not open yet', '<h1>Not open yet</h1><p>We are not sending cards for this occasion at the moment. You are welcome to <a href="/">send a card</a>.</p>', 404);
}
