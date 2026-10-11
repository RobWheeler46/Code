<?php
// Administration (FRD 2.0 section 8): role-limited task views S30 to S39, review-before-save configuration,
// optimistic version check, audit trail, health evidence. Every handler re-checks roles on the server.

function can_any(string ...$roles): bool { foreach ($roles as $r) if (can($r)) return true; return false; }
function adminbtn(string $do, int $id, string $label): string {
    return '<form method="post" class="inline">' . csrf() . '<input type="hidden" name="do" value="' . $do . '"><input type="hidden" name="id" value="' . $id . '"><button class="link">' . h($label) . '</button></form> ';
}
function admin_page(string $title, string $body): never {
    $u = user();
    $links = ['/admin' => ['Overview', true], '/admin/delivery' => ['Delivery', can_any('delivery', 'appadmin', 'rolesadmin')], '/admin/finance' => ['Finance', can('finance')],
        '/admin/reports' => ['Reports', can('complaints')], '/admin/campaign' => ['Campaign settings', can_any('campaign', 'appadmin', 'finance', 'delivery', 'rolesadmin')],
        '/admin/app' => ['Application settings', can_any('appadmin', 'campaign', 'delivery', 'rolesadmin')], '/admin/email' => ['Email and help', can_any('appadmin', 'rolesadmin')], '/admin/wording' => ['Email and help wording', can_any('appadmin', 'rolesadmin')],
        '/admin/privacy' => ['Privacy and retention', can_any('rolesadmin', 'campaign', 'appadmin', 'finance', 'delivery')], '/admin/access' => ['Administrator access', can('rolesadmin')],
        '/admin/senders' => ['Senders', can_any('complaints', 'rolesadmin')], '/admin/launch' => ['Launch readiness', true], '/admin/giftaid' => ['Gift Aid', can('finance')], '/admin/measures' => ['Measures', can_any('campaign', 'finance', 'appadmin', 'rolesadmin')], '/admin/rehearsal' => ['Rehearsal', can_any('appadmin', 'rolesadmin')], '/admin/library' => ['eCard Library', can_any('campaign', 'rolesadmin')], '/admin/campaigns' => ['Occasions and campaigns', can_any('campaign', 'rolesadmin')], '/admin/private-features' => ['Private features', can('rolesadmin')], '/private/trustee-greetings' => ['Trustee greetings', pf_on('private_trustee_greetings') && tg_can()], '/admin/health' => ['System health', true], '/admin/audit' => ['Change history', true]];
    $here = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
    $groups = ['Overview' => ['/admin'], 'Cards and delivery' => ['/private/trustee-greetings', '/admin/delivery', '/admin/reports', '/admin/senders', '/admin/rehearsal'], 'Fundraising' => ['/admin/finance', '/admin/giftaid', '/admin/measures'],
        'Campaign setup' => ['/admin/campaign', '/admin/library', '/admin/campaigns', '/admin/launch', '/admin/email', '/admin/wording', '/admin/privacy'], 'Administration' => ['/admin/app', '/admin/private-features', '/admin/access', '/admin/health', '/admin/audit']]; // five areas; each link still passes its own server side role check
    $nav = '<nav class="adminmenu" aria-label="Administration"><details open><summary>Menu</summary>';
    foreach ($groups as $g => $hrefs) {
        $li = ''; foreach ($hrefs as $href) if ($links[$href][1]) $li .= '<li><a href="' . $href . '"' . ($href === $here ? ' aria-current="page"' : '') . '>' . h($links[$href][0]) . '</a></li>';
        if ($li !== '') $nav .= '<p class="navgroup">' . h($g) . '</p><ul class="plain">' . $li . '</ul>';
    }
    $nav .= '</details></nav>';
    page($title, $nav . '<p class="note">Signed in as ' . h($u['name']) . ' (' . h(implode(', ', array_map(fn($r) => ROLES[$r] ?? $r, array_filter(explode(',', $u['roles'])))) ?: 'no roles') . ')</p>' . $body);
}
function role_names(string $csv): string { return implode(', ', array_map(fn($r) => ROLES[$r] ?? $r, array_filter(explode(',', $csv)))) ?: 'no roles'; }

// ---------- configuration engine
function config_spec(string $area): array {
    $specs = [
        'campaign' => ['edit' => ['campaign', 'rolesadmin'], 'title' => 'Campaign settings', 'when' => 'New submissions after you confirm. Cards already submitted are not changed. Closing dates do not expire existing cards.', 'fields' => [
            'campaign' => ['Campaign name', 'text', 'max' => 60, 'def' => 'Christmas 2026'],
            'opens' => ['Sending opens (UK time)', 'datetime', 'def' => ''], 'closes' => ['Sending closes (UK time)', 'datetime', 'def' => ''],
            'closure_queue' => ['Cards already queued when sending closes', 'choice', 'opts' => ['send' => 'Still send them', 'hold' => 'Hold them for review'], 'def' => 'send'],
            'donation_purpose' => ['Approved purpose of donations', 'text', 'max' => 300, 'def' => ''],
            'target_pence' => ['Fundraising target in pounds (blank for none)', 'money', 'def' => ''],
            'amounts_pence' => ['Suggested donation amounts in pounds, comma separated (up to 5, £1 to £500)', 'amounts', 'def' => '200,500,1000'],
            'show_progress' => ['Show fundraising progress publicly', 'bool', 'def' => '0'],
            'giftaid_charity' => ['Charity name used in the Gift Aid declaration (as HMRC knows it)', 'text', 'max' => 100, 'def' => ''],
            'giftaid_enabled' => ['Offer Gift Aid on donations (needs decision D-12 approved)', 'bool', 'def' => '0']]],
        'app' => ['edit' => ['appadmin', 'rolesadmin'], 'title' => 'Application settings', 'when' => 'Applies to new entries straight away. Existing drafts are kept; a draft above a new limit must be corrected before submission. Accepted batches are unchanged.', 'fields' => [
            'max_recipients' => ['Recipients per card (1 to 20)', 'int', 'min' => 1, 'max' => 20, 'def' => '20'],
            'msg_max' => ['Greeting limit (characters)', 'int', 'min' => 50, 'max' => 2000, 'def' => '500'],
            'name_max' => ['Display name limit (characters)', 'int', 'min' => 10, 'max' => 100, 'def' => '60'],
            'contacts_max' => ['Address book contacts per account', 'int', 'min' => 1, 'max' => 5000, 'def' => '200'],
            'groups_max' => ['Contact groups per account', 'int', 'min' => 1, 'max' => 100, 'def' => '20'],
            'test_per_hour' => ['Test cards per account per hour', 'int', 'min' => 1, 'max' => 20, 'def' => '3'],
            'abuse_terms' => ['Blocked words in messages (comma separated)', 'text', 'max' => 500, 'def' => ''],
            'small_n' => ['Show counts below this number as "fewer than N"', 'int', 'min' => 2, 'max' => 50, 'def' => '5'],
            'rehearsal_emails' => ['Rehearsal allow-list (emails, comma separated)', 'emails', 'def' => ''],
            'alert_emails' => ['Who receives operational alerts (emails, comma separated)', 'emails', 'def' => ''],
            'alert_escalate_emails' => ['Who receives an alert nobody acknowledged (emails)', 'emails', 'def' => ''],
            'alert_escalate_minutes' => ['Escalate unacknowledged alerts after (minutes)', 'int', 'min' => 5, 'max' => 1440, 'def' => '60'],
            'allow_urls' => ['Allow web addresses in messages (never clickable)', 'bool', 'def' => '0']]],
        'wording' => ['edit' => ['appadmin', 'rolesadmin'], 'title' => 'Email and help wording', 'when' => 'Used by new emails and the Help page straight away. Emails already sent are not changed. The private link, the stop and report routes and the privacy link always stay in every email.', 'fields' => [
            'email_subject' => ['Subject of the card email ({sender} is the sender name)', 'tpl', 'max' => 100, 'allow' => ['{sender}'], 'need' => '{sender}', 'def' => '{sender} sent you a Christmas card'],
            'email_intro' => ['Opening line of the card email ({sender} is the sender name)', 'tpl', 'max' => 160, 'allow' => ['{sender}'], 'need' => '{sender}', 'def' => '{sender} has sent you a Christmas card.'],
            'email_button' => ['Words on the button in the email', 'tpl', 'max' => 30, 'allow' => [], 'def' => 'Open your card'],
            'support_email' => ['Support email address shown on the Help page and in emails (blank uses the server setting)', 'email1', 'def' => ''],
            'help_extra' => ['Extra questions for the Help page. Put the question on the first line and the answer under it, with a blank line between questions (up to 10)', 'faq', 'def' => '']]],
        'privacy' => ['edit' => ['rolesadmin'], 'title' => 'Privacy, expiry and retention', 'when' => 'Expiry changes affect existing card links from the moment you confirm. Retention changes take effect at the next scheduled clean-up. Saving a draft deletes nothing.', 'reason' => true, 'fields' => [
            'expiry_days' => ['Card links stay viewable for (days after sending)', 'int', 'min' => 1, 'max' => 3650, 'def' => '60'],
            'retention_days' => ['Greetings and recipient details kept for (days after sending)', 'int', 'min' => 1, 'max' => 3650, 'def' => '90']]],
    ];
    return $specs[$area] ?? fail(404, 'Not found.');
}
function cfg_current(string $key, array $f): string { return setting($key, $f['def']); }
/** Returns [stored value, error]. */
function cfg_validate(array $f, string $raw): array {
    $raw = trim($raw);
    switch ($f[1]) {
        case 'text': return mb_strlen($raw) > $f['max'] ? [$raw, 'Use ' . $f['max'] . ' characters or fewer.'] : [$raw, null];
        case 'int': return (ctype_digit($raw) && (int)$raw >= $f['min'] && (int)$raw <= $f['max']) ? [(string)(int)$raw, null] : [$raw, 'Enter a whole number from ' . $f['min'] . ' to ' . $f['max'] . '.'];
        case 'datetime': return ($raw === '' || (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/', $raw) && strtotime($raw))) ? [$raw, null] : [$raw, 'Enter a valid UK date and time.'];
        case 'choice': return isset($f['opts'][$raw]) ? [$raw, null] : [$raw, 'Choose one of the options.'];
        case 'bool': return [$raw === '1' ? '1' : '0', null];
        case 'tpl': // one line of wording with only the placeholders allowed here, so it can never carry markup, line breaks or anything else
            $raw = preg_replace('/\s+/', ' ', $raw);
            if ($raw === '') return [$raw, 'This cannot be empty.'];
            if (mb_strlen($raw) > $f['max']) return [$raw, 'Use ' . $f['max'] . ' characters or fewer.'];
            if (preg_match('/[\x00-\x1F\x7F<>]/', $raw)) return [$raw, 'Use plain words only: no markup.'];
            preg_match_all('/\{[^{}]*\}|[{}]/', $raw, $br); foreach ($br[0] as $t) if (!in_array($t, $f['allow'], true)) return [$raw, $f['allow'] ? 'The only placeholder you can use is ' . implode(' ', $f['allow']) . '.' : 'Placeholders such as { } cannot be used here.'];
            if (!empty($f['need']) && !str_contains($raw, $f['need'])) return [$raw, 'This must include ' . $f['need'] . ' so the person knows who it is from.'];
            return [$raw, null];
        case 'email1': return ($raw === '' || filter_var($raw, FILTER_VALIDATE_EMAIL)) ? [strtolower($raw), null] : [$raw, 'Enter one valid email address, or leave it blank.'];
        case 'faq':
            $raw = trim(preg_replace("/\r\n?/", "\n", $raw)); if ($raw === '') return ['', null];
            if (count(preg_split("/
s*
/", $raw)) > 10) return [$raw, 'Up to 10 extra questions.'];
            foreach (explode("\n\n", preg_replace("/\n{3,}/", "\n\n", $raw)) as $blk) { $l = explode("\n", trim($blk), 2); if (count($l) < 2 || trim($l[1]) === '') return [$raw, 'Every question needs an answer on the lines below it.']; if (mb_strlen(trim($l[0])) > 120) return [$raw, 'A question can be at most 120 characters.']; if (mb_strlen(trim($l[1])) > 600) return [$raw, 'An answer can be at most 600 characters.']; }
            if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $raw)) return [$raw, 'Use plain text only.'];
            return [preg_replace("/\n{3,}/", "\n\n", $raw), null];
        case 'emails':
            $l = array_filter(array_map('trim', explode(',', $raw)), 'strlen');
            foreach ($l as $x) if (!filter_var($x, FILTER_VALIDATE_EMAIL)) return [$raw, "'$x' is not a valid email address."];
            return [implode(',', $l), null];
        case 'money':
            if ($raw === '') return ['', null];
            return (preg_match('/^\d{1,5}(\.\d{1,2})?$/', $raw) && (float)$raw >= 1 && (float)$raw <= 100000) ? [(string)(int)round((float)$raw * 100), null] : [$raw, 'Enter an amount in pounds, for example 500 or 500.00.'];
        case 'amounts':
            $out = [];
            foreach (array_filter(array_map('trim', explode(',', $raw)), 'strlen') as $p) { if (!preg_match('/^\d{1,3}(\.\d{1,2})?$/', $p) || (float)$p < 1 || (float)$p > 500) return [$raw, 'Each amount must be between £1 and £500.']; $out[] = (int)round((float)$p * 100); }
            return (count($out) >= 1 && count($out) <= 5) ? [implode(',', array_unique($out)), null] : [$raw, 'Give between one and five amounts.'];
    }
    return [$raw, 'Unsupported field.'];
}
function cfg_show(array $f, string $stored): string { // stored -> human text
    return match ($f[1]) { 'money' => $stored === '' ? '(none)' : gbp((int)$stored), 'amounts' => implode(', ', array_map(fn($p) => gbp((int)$p), array_filter(explode(',', $stored), 'strlen'))), 'bool' => $stored === '1' ? 'Yes' : 'No',
        'choice' => $f['opts'][$stored] ?? $stored, 'datetime' => $stored === '' ? '(none)' : date('j M Y H:i', strtotime($stored)) . ' UK time', default => $stored === '' ? '(none)' : $stored };
}
function cfg_input(string $key, array $f, string $val, ?string $err, bool $edit, bool &$first): string {
    $a = ($edit ? '' : ' disabled') . fa($err ? [$key => $err] : [], $key, $first);
    $id = 'f_' . $key; $lab = '<label>' . h($f[0]);
    $in = match ($f[1]) {
        'bool' => '<input type="hidden" name="' . $id . '" value="0"><input type="checkbox" name="' . $id . '" value="1"' . ($val === '1' ? ' checked' : '') . $a . '>',
        'choice' => '<select name="' . $id . '"' . $a . '>' . implode('', array_map(fn($k, $l) => '<option value="' . h($k) . '"' . ($k === $val ? ' selected' : '') . '>' . h($l) . '</option>', array_keys($f['opts']), $f['opts'])) . '</select>',
        'datetime' => '<input type="datetime-local" name="' . $id . '" value="' . h($val) . '"' . $a . '>',
        'faq' => '<textarea name="' . $id . '" rows="8"' . $a . '>' . h($val) . '</textarea>',
        default => '<input name="' . $id . '" value="' . h($val) . '"' . $a . '>',
    };
    return ($f[1] === 'bool' ? '<label class="opt">' . $in . ' ' . h($f[0]) . fe($err ? [$key => $err] : [], $key) . '</label>' : $lab . $in . fe($err ? [$key => $err] : [], $key) . '</label>');
}
/** Form values to display: proposed (kept after an error or conflict) or current effective ones, shown as form text. */
function cfg_form_value(string $key, array $f): string {
    $s = setting($key, $f['def']);
    return match ($f[1]) { 'money' => $s === '' ? '' : number_format((int)$s / 100, 2, '.', ''), 'amounts' => implode(', ', array_map(fn($p) => rtrim(rtrim(number_format((int)$p / 100, 2, '.', ''), '0'), '.'), array_filter(explode(',', $s), 'strlen'))), default => $s };
}
function privacy_impact(array $new): array {
    $now = time(); $o = expiry_days(); $n = (int)($new['expiry_days'] ?? $o); $ro = (int)setting('retention_days', '90'); $rn = (int)($new['retention_days'] ?? $ro); $lines = [];
    if ($n < $o) $lines[] = (int)one('select count(*) c from recipients where sent_at is not null and sent_at<? and sent_at>=?', [$now - $n * 86400, $now - $o * 86400])['c'] . ' cards that are viewable now would stop working immediately.';
    if ($n > $o) $lines[] = 'Cards that already expired stay expired for anyone who saw the expiry page; links still within the new period work again.';
    if ($rn < $ro) $lines[] = (int)one("select count(*) c from sends where queued_at is not null and queued_at<? and message<>''", [$now - $rn * 86400])['c'] . ' sent cards would have their greeting and recipient details deleted at the next clean-up.';
    $lines[] = 'Finance records, audit history and opt-out records follow their own rules and are not changed by this setting.';
    return $lines;
}

function r_admin_config(string $area): void {
    $u = need_admin(); $spec = config_spec($area);
    $edit = can_any(...$spec['edit']); $viewRoles = ['campaign', 'appadmin', 'finance', 'delivery', 'rolesadmin'];
    if (!$edit && !can_any(...$viewRoles)) fail(403, 'You do not have permission for that.');
    $path = '/admin/' . $area; $first = true;
    if (post()) {
        if (!$edit) fail(403, 'You do not have permission for that.');
        $prop = []; $errs = [];
        foreach ($spec['fields'] as $k => $f) { [$v, $e] = cfg_validate($f, (string)($_POST['f_' . $k] ?? '')); $prop[$k] = $v; if ($e) $errs[$k] = $e; }
        if ($area === 'campaign' && ($prop['giftaid_enabled'] ?? '0') === '1') {
            if (!giftaid_approved()) $errs['giftaid_enabled'] = 'Record decision D-12 as approved, with its reference, in Launch readiness first.';
            if (trim((string)($prop['giftaid_charity'] ?? '')) === '') $errs['giftaid_charity'] = 'Enter the charity name as it appears on the HMRC declaration.';
        }
        $reason = trim((string)($_POST['reason'] ?? '')); $ref = trim((string)($_POST['approval'] ?? ''));
        $diff = []; foreach ($spec['fields'] as $k => $f) if ($prop[$k] !== cfg_current($k, $f)) $diff[$k] = [cfg_current($k, $f), $prop[$k]];
        $confirmed = !empty($_POST['confirmed']);
        if (!$errs && !empty($spec['reason']) && $confirmed && ($reason === '' || $ref === '')) $errs['reason'] = 'A reason and an approval reference are needed.';
        if (!$errs && $confirmed && (string)($_POST['ver'] ?? '') !== setting('cfg_version', '0')) { // someone else saved first: keep what was typed
            $_SESSION['cfg_old'][$area] = $_POST; flash('Another administrator changed these settings while you were editing. Reload shows the latest values; what you typed is kept in the form for you to compare and re-submit.', 'err'); redirect($path);
        }
        if ($errs) { $_SESSION['cfg_old'][$area] = $_POST; $_SESSION['cfg_err'][$area] = $errs; if (isset($errs['reason'])) { flash($errs['reason'], 'err'); } else flash('Please check the highlighted fields. Your entries are kept.', 'warn'); redirect($path); }
        if (!$diff) { flash('Nothing was changed.'); redirect($path); }
        if ($confirmed) {
            db()->beginTransaction();
            foreach ($diff as $k => [, $new]) set_setting($k, $new);
            set_setting('cfg_version', (string)((int)setting('cfg_version', '0') + 1));
            db()->commit();
            audit((int)$u['id'], "config_$area", json_encode(['changes' => array_map(fn($d) => ['from' => $d[0], 'to' => $d[1]], $diff), 'reason' => $reason, 'approval' => $ref], JSON_UNESCAPED_UNICODE));
            flash('Saved. These settings are now version ' . setting('cfg_version') . '.'); redirect($path);
        }
        $rows = ''; foreach ($diff as $k => [$old, $new]) $rows .= '<tr><th scope="row">' . h($spec['fields'][$k][0]) . '</th><td><span class="sr">Old value: </span>' . h(cfg_show($spec['fields'][$k], $old)) . '</td><td><span class="sr">New value: </span><strong>' . h(cfg_show($spec['fields'][$k], $new)) . '</strong></td></tr>';
        $hid = ''; foreach ($spec['fields'] as $k => $f) $hid .= '<input type="hidden" name="f_' . $k . '" value="' . h((string)($_POST['f_' . $k] ?? '')) . '">';
        $impact = $area === 'privacy' ? '<h2>Impact</h2><ul>' . implode('', array_map(fn($l) => '<li>' . h($l) . '</li>', privacy_impact($prop))) . '</ul>' : '';
        admin_page('Review changes', '<h1>Review changes: ' . h($spec['title']) . '</h1><p>' . h($spec['when']) . '</p><table class="stacked"><tr><th>Setting</th><th>Old</th><th>New</th></tr>' . $rows . '</table>' . $impact
            . '<form method="post" class="stack">' . csrf() . $hid . '<input type="hidden" name="ver" value="' . h((string)($_POST['ver'] ?? setting('cfg_version', '0'))) . '"><input type="hidden" name="confirmed" value="1">'
            . (!empty($spec['reason']) ? '<label>Reason for the change<input name="reason" required maxlength="300"></label><label>Approval reference (for example a Trustee minute)<input name="approval" required maxlength="100"></label>' : '<label>Reason (optional)<input name="reason" maxlength="300"></label>')
            . '<div class="row"><button class="btn">Confirm and save</button><a class="btn alt" href="' . $path . '">Cancel, change nothing</a></div></form>');
    }
    $old = $_SESSION['cfg_old'][$area] ?? null; $errs = $_SESSION['cfg_err'][$area] ?? []; unset($_SESSION['cfg_old'][$area], $_SESSION['cfg_err'][$area]);
    $b = '<h1>' . h($spec['title']) . '</h1><p class="note">' . h($spec['when']) . ' Version ' . h(setting('cfg_version', '0')) . '.</p>' . (!$edit ? '<p class="flash warn">You can view these settings but not change them.</p>' : '') . '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="ver" value="' . h(setting('cfg_version', '0')) . '">';
    foreach ($spec['fields'] as $k => $f) $b .= cfg_input($k, $f, $old ? (string)($old['f_' . $k] ?? '') : cfg_form_value($k, $f), $errs[$k] ?? null, $edit, $first);
    if ($area === 'privacy') $b .= '<p class="note">Changing a period shows the affected records first and needs a reason and approval reference.</p>';
    if ($area === 'wording') $b .= '<p class="note"><a href="/admin/email">Preview the email and send yourself a test</a> once you have saved.</p>';
    if ($area === 'campaign') $b .= '<p class="note">Free sending is always available. Payments cannot be made mandatory here.</p>';
    admin_page($spec['title'], $b . ($edit ? '<button class="btn">Review changes</button>' : '') . '</form>' . ($area === 'campaign' ? admin_designs_and_share() : ''));
}
function r_admin_campaign(): void { r_admin_config('campaign'); }
function r_admin_wording(): void { r_admin_config('wording'); }
function r_admin_app(): void { r_admin_config('app'); }
function r_admin_privacy(): void { r_admin_config('privacy'); }

// ---------- S32 designs (order, enable, accessible description) and campaign sharing
function admin_designs_and_share(): string {
    $edit = can_any('campaign', 'rolesadmin'); $b = '<h2>Approved card designs</h2><p class="note">Changes apply to new cards. Cards already submitted keep the artwork they were sent with.</p><ul class="plain">';
    $ids = array_keys(cards()); $n = count($ids);
    foreach ($ids as $i => $id) {
        $c = cards()[$id];
        $b .= '<li class="designrow">' . card_art($id) . '<div><strong>' . h($c['title']) . '</strong> ' . ($c['on'] ? '' : '<span class="pill">Disabled</span>');
        if ($edit) $b .= '<form method="post" action="/admin/action" class="stack">' . csrf() . '<input type="hidden" name="back" value="/admin/campaign"><input type="hidden" name="card" value="' . h($id) . '"><label>Accessible description<input name="desc" maxlength="200" value="' . h(setting("desc_$id")) . '" placeholder="' . h($c['title']) . '"></label><div class="row">'
            . '<button class="btn alt" name="do" value="design_desc">Save description</button><button class="btn alt" name="do" value="design">' . ($c['on'] ? 'Disable' : 'Enable') . '</button>'
            . ($i > 0 ? '<button class="btn alt" name="do" value="design_up">Move up</button>' : '') . ($i < $n - 1 ? '<button class="btn alt" name="do" value="design_down">Move down</button>' : '') . '</div></form>';
        $b .= '</div></li>';
    }
    $b .= '</ul><h2>Share the campaign</h2><p>Public link: <code>' . h(base_url() . '/') . '</code>. Add <code>?ref=newsletter</code> (letters, numbers, hyphens) to see which promotion works. It leads to the gallery and contains nothing private.</p>'
        . '<div class="qrbox">' . qr_svg(base_url() . '/', 200) . '</div><p><a href="/admin/campaign-qr" download>Download the QR code (SVG, prints at any size)</a></p><p class="note">Made here, so the address is not sent to any other website.</p><ul>';
    foreach (all("select coalesce(ref,'(no label)') r, count(*) n from sends where status not in ('draft') group by ref order by n desc") as $x) $b .= '<li>' . h($x['r']) . ': ' . $x['n'] . ' cards</li>';
    return $b . '</ul>';
}

// ---------- actions that are not configuration forms
function admin_pause_counts(): array {
    return ['queued' => (int)one("select count(*) c from recipients where status='queued'")['c'], 'claimed' => (int)one("select count(*) c from recipients where status='sending'")['c'],
        'delayed' => (int)one("select count(*) c from recipients r join sends s on s.id=r.send_id where r.status='queued' and s.queued_at<?", [time() - 86400])['c'], 'at' => time()];
}
function confirm_page(string $a, int $i): never {
    $rep = in_array($a, ['block', 'withdraw']) ? one('select r.id, x.email from reports r join recipients x on x.id=r.recipient_id where r.id=?', [$i]) : null;
    $extra = '';
    $what = match ($a) {
        'pause' => (setting('paused') === '1' ? 'Resume dispatch.' : 'Pause all card dispatch. Nothing new will be sent until you resume.'),
        'block' => 'Stop every future card to ' . ($rep['email'] ?? 'this recipient') . ' from every sender (report #' . $i . '). Cards already sent stay viewable.',
        'withdraw' => 'Withdraw the card sent to ' . ($rep['email'] ?? 'this recipient') . ' (report #' . $i . '). Their link will stop working. This does not refund any donation.',
        'roles' => 'Change roles for ' . strtolower(trim((string)($_POST['email'] ?? ''))) . ' to: ' . role_names(implode(',', (array)($_POST['roles'] ?? []))) . '.',
        default => 'Confirm this change.',
    };
    if ($a === 'pause') {
        $c = admin_pause_counts();
        $extra = '<h2>Queue impact at ' . date('H:i:s', $c['at']) . '</h2><ul><li>' . $c['queued'] . ' queued deliveries are eligible and would ' . (setting('paused') === '1' ? 'start going out' : 'wait') . '.</li><li>' . $c['claimed'] . ' deliveries are already claimed for dispatch and cannot be stopped.</li><li>' . $c['delayed'] . ' have been waiting over 24 hours' . (setting('paused') === '1' ? ' and need review before sending (late-send policy)' : '') . '.</li></ul><p class="note">Counts are rechecked when you confirm. Sent emails cannot be recalled. Campaign closure and card expiry are not affected.</p>'
            . '<label>Reason<input name="reason" required maxlength="300"></label>';
    }
    $hid = '';
    foreach ($_POST as $k => $v) if (!in_array($k, ['_c', 'confirmed'])) foreach ((array)$v as $x) $hid .= '<input type="hidden" name="' . h($k) . (is_array($v) ? '[]' : '') . '" value="' . h((string)$x) . '">';
    admin_page('Confirm change', '<h1>Please confirm</h1><p>' . h($what) . '</p>' . $extra . '<p>This will be recorded in the audit trail.</p><form method="post" action="/admin/action" class="stack">' . csrf() . $hid . '<input type="hidden" name="confirmed" value="1"><div class="row"><button class="btn">Yes, do it</button><a class="btn alt" href="/admin">Cancel</a></div></form>');
}
function r_admin_action(): void {
    $u = need_admin(); if (!post()) redirect('/admin');
    $a = (string)($_POST['do'] ?? ''); $i = (int)($_POST['id'] ?? 0); $uid = (int)$u['id']; $back = safe_next($_POST['back'] ?? '');
    if (in_array($a, ['suspend', 'reinstate', 'ack', 'decision', 'override', 'clear_override']) && admin_action2($a, $u)) return;
    $need = ['pause' => ['appadmin', 'rolesadmin'], 'resend' => ['delivery', 'appadmin', 'rolesadmin'], 'money' => ['finance'], 'design' => ['campaign', 'rolesadmin'], 'design_desc' => ['campaign', 'rolesadmin'], 'design_up' => ['campaign', 'rolesadmin'], 'design_down' => ['campaign', 'rolesadmin'],
             'dismiss' => ['complaints'], 'block' => ['complaints'], 'withdraw' => ['complaints'], 'roles' => ['rolesadmin'], 'resolve_event' => ['finance'], 'access_review' => ['rolesadmin']];
    if (!isset($need[$a])) fail(400, 'Unknown action.');
    if (!can_any(...$need[$a])) fail(403, 'You do not have permission for that.');
    if (in_array($a, ['pause', 'block', 'withdraw', 'roles']) && empty($_POST['confirmed'])) confirm_page($a, $i);
    switch ($a) {
        case 'pause':
            $why = trim((string)($_POST['reason'] ?? '')); if ($why === '') fail(400, 'A reason is required.');
            $c = admin_pause_counts(); set_setting('paused', setting('paused') === '1' ? '0' : '1');
            audit($uid, 'dispatch_' . (setting('paused') === '1' ? 'paused' : 'resumed'), "reason: $why; queued {$c['queued']}, claimed {$c['claimed']}, delayed {$c['delayed']}"); if (setting('paused') !== '1') process_queue();
            break;
        case 'resend':
            $r = one('select * from recipients where id=?', [$i]); $st = $r ? rstatus($r) : '';
            if ($r && (in_array($r['status'], ['failed', 'bounced']) || $st === 'Delivery unconfirmed')) { if (requeue_recipient($i, null, $uid, 'delivery support')) process_queue(); }
            break;
        case 'resolve_event':
            $note = field('note', 300); if ($note === '') { flash('Say what was done about it.', 'err'); redirect('/admin/finance'); }
            q('update stripe_events set resolved_at=?, note=? where id=? and resolved_at is null', [time(), $note, (string)($_POST['eid'] ?? '')]); audit($uid, 'payment_exception_resolved', ($_POST['eid'] ?? '') . ': ' . $note); break;
        case 'access_review':
            set_setting('access_review_at', (string)time()); audit($uid, 'access_review', count(all('select id from users where is_admin=1')) . ' administrators reviewed'); break;
        case 'money':
            q('update donations set fee=?, refunded=?, refund_status=? where id=?', [(int)round((float)$_POST['fee'] * 100), (int)round((float)$_POST['refunded'] * 100), in_array($_POST['refund_status'] ?? '', ['none', 'requested', 'pending', 'confirmed', 'failed']) ? $_POST['refund_status'] : 'none', $i]);
            audit($uid, 'reconcile', "donation $i fee {$_POST['fee']} refunded {$_POST['refunded']} status {$_POST['refund_status']}"); break;
        case 'design':
            if (isset(cards()[$_POST['card'] ?? ''])) { set_setting('off_' . $_POST['card'], cards()[$_POST['card']]['on'] ? '1' : '0'); audit($uid, 'design_toggle', $_POST['card']); } break;
        case 'design_desc':
            if (isset(cards()[$_POST['card'] ?? ''])) { set_setting('desc_' . $_POST['card'], field('desc', 200)); audit($uid, 'design_description', $_POST['card']); } break;
        case 'design_up': case 'design_down':
            design_move((string)($_POST['card'] ?? ''), $a === 'design_up' ? -1 : 1, $uid); break;
        case 'dismiss': case 'block': case 'withdraw':
            $rep = one('select r.*, x.email, x.send_id from reports r join recipients x on x.id=r.recipient_id where r.id=?', [$i]);
            if ($rep) {
                if ($a === 'block') optout($rep['email'], 0);
                if ($a === 'withdraw') q('update recipients set withdrawn=1 where id=?', [$rep['recipient_id']]);
                q("update reports set status='closed', decision=? where id=?", [['dismiss' => 'Dismissed', 'block' => 'Recipient blocked from further cards', 'withdraw' => 'Card withdrawn'][$a], $i]);
                audit($uid, "report_$a", "report $i");
            } break;
        case 'roles':
            $e = strtolower(field('email')); $t = one('select * from users where email=?', [$e]);
            if (!$t) { flash('No registered user with that email.', 'err'); redirect('/admin/access'); }
            $new = array_values(array_intersect(array_keys(ROLES), (array)($_POST['roles'] ?? [])));
            $others = (int)one("select count(*) c from users where id<>? and is_admin=1 and (',' || roles || ',') like '%,rolesadmin,%'", [$t['id']])['c'];
            if (!in_array('rolesadmin', $new) && !$others && in_array('rolesadmin', explode(',', $t['roles']))) { flash('There must always be at least one restricted administrator.', 'err'); redirect('/admin/access'); }
            q('update users set roles=?, is_admin=? where id=?', [implode(',', $new), $new ? 1 : 0, $t['id']]);
            audit($uid, 'role_change', "$e: [{$t['roles']}] -> [" . implode(',', $new) . ']'); break;
    }
    flash('Saved.'); redirect($back === '/dashboard' ? '/admin' : $back);
}

// ---------- S30 overview
function r_admin(): void {
    $u = need_admin(); $st = campaign_state(); $c = admin_pause_counts();
    $nc = (int)one("select count(*) n from sends where is_test=0 and status not in ('draft','awaiting_payment')")['n']; $na = count(health_alerts());
    $b = '<h1>Administration</h1><div class="cards stats"><section class="statuscard"><h2>Cards requested</h2><p class="big">' . $nc . '</p></section>'
        . (can_any('finance', 'campaign') ? '<section class="statuscard"><h2>Donations recorded</h2><p class="big">' . gbp((int)one('select coalesce(sum(pence-refunded),0) n from donations')['n']) . '</p></section>' : '')
        . '<section class="statuscard"><h2>Needs attention</h2><p class="big">' . $na . '</p></section></div><div class="cards">'
        . '<section class="statuscard"><h2>Campaign</h2><p>' . ['open' => 'Open for new cards', 'before' => 'Not open yet', 'closed' => 'Closed to new cards', 'locked' => 'Locked until launch decisions are approved'][$st] . '</p></section>'
        . '<section class="statuscard"><h2>Dispatch</h2><p>' . (setting('paused') === '1' ? '<strong>Paused</strong>' : 'Running') . '. ' . $c['queued'] . ' queued.</p></section>';
    $alerts = health_alerts();
    $b .= '<section class="statuscard"><h2>Alerts</h2><p>' . ($alerts ? '<strong>' . count($alerts) . ' need attention</strong>' : 'None found') . '</p><a href="/admin/health">System health</a></section></div>';
    if ($alerts) { // UX24-07: each exception names where to act; people without that role see who owns it, never the private detail
        $go = ['cron' => ['/admin/health', 'appadmin,rolesadmin', 'Application administrator'], 'backup' => ['/admin/health', 'appadmin,rolesadmin', 'Application administrator'], 'offsite' => ['/admin/health', 'appadmin,rolesadmin', 'Application administrator'], 'restore' => ['/admin/health', 'appadmin,rolesadmin', 'Application administrator'],
            'queue' => ['/admin/delivery', 'delivery,appadmin,rolesadmin', 'Delivery support'], 'failed' => ['/admin/delivery', 'delivery,appadmin,rolesadmin', 'Delivery support'], 'pay15' => ['/admin/finance', 'finance', 'Finance administrator'], 'pay24' => ['/admin/finance', 'finance', 'Finance administrator'], 'payexc' => ['/admin/finance', 'finance', 'Finance administrator'],
            'complaint' => ['/admin/reports', 'complaints', 'Complaints reviewer'], 'abuse' => ['/admin/senders', 'complaints,rolesadmin', 'Complaints reviewer'], 'access' => ['/admin/access', 'rolesadmin', 'Restricted administrator'], 'launch' => ['/admin/launch', '', 'Campaign manager']];
        $b .= '<h2>Needs attention first</h2><ul class="tasks">';
        foreach ($alerts as $k => $a) { [$href, $roles, $owner] = $go[$k] ?? ['/admin/health', '', 'Application administrator']; $mine = $roles === '' || can_any(...explode(',', $roles));
            $b .= '<li>' . h($a) . ' ' . ($mine ? '<a class="btn alt" href="' . $href . '">Open</a>' : '<span class="note">Owner: ' . h($owner) . '</span>') . '</li>'; }
        $b .= '</ul>';
    } else $b .= '<p class="note">Nothing needs attention right now.</p>';
    $rc = []; foreach (all('select r.* from recipients r join sends s on s.id=r.send_id where s.is_test=0') as $r) { $k = rstatus($r); $rc[$k] = ($rc[$k] ?? 0) + 1; }
    $b .= '<h2>Card activity</h2><p>' . h(implode(', ', array_map(fn($k, $v) => "$v $k", array_keys($rc), $rc)) ?: 'Nothing sent yet.') . '</p><ul>';
    foreach (all("select card, count(*) n from sends where is_test=0 and status not in ('draft','awaiting_payment') group by card order by n desc") as $x) $b .= '<li>' . h(cards()[$x['card']]['title'] ?? $x['card']) . ': ' . $x['n'] . '</li>';
    $b .= '</ul>';
    if (can_any('finance', 'campaign')) {
        $d = one('select count(*) n, coalesce(sum(pence),0) gross, coalesce(sum(fee),0) fee, coalesce(sum(refunded),0) ref from donations'); $tgt = (int)setting('target_pence');
        $b .= '<h2>Fundraising</h2><p>Confirmed gross donations: <strong>' . gbp((int)$d['gross']) . '</strong> from ' . $d['n'] . ' donations (average ' . gbp($d['n'] ? intdiv((int)$d['gross'], (int)$d['n']) : 0) . '). Fees ' . gbp((int)$d['fee']) . ', refunds ' . gbp((int)$d['ref']) . ', net after both ' . gbp((int)($d['gross'] - $d['fee'] - $d['ref'])) . ($tgt ? '. Target ' . gbp($tgt) . ' (public progress counts gross minus refunds)' : '') . '.</p>';
    }
    admin_page('Administration', $b);
}

// ---------- delivery (S20)
function r_admin_delivery(): void {
    need_admin(); if (!can_any('delivery', 'appadmin', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $c = admin_pause_counts(); $hb = (int)setting('last_queue'); $paused = setting('paused') === '1';
    $b = '<h1>Delivery</h1><p>Queued: ' . $c['queued'] . '. Being sent: ' . $c['claimed'] . '. Last scheduled run: ' . ($hb ? when($hb) . (time() - $hb > 900 ? ' <strong>(stale: check cron)</strong>' : '') : '<strong>Unknown</strong> (never run)') . '. Dispatch is <strong>' . ($paused ? 'paused' : 'running') . '</strong>.</p>';
    if (can_any('appadmin', 'rolesadmin')) $b .= '<form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="pause"><input type="hidden" name="back" value="/admin/delivery"><button class="btn alt">' . ($paused ? 'Resume dispatch' : 'Pause dispatch') . '</button></form>';
    else $b .= '<p class="note">Only application and restricted administrators can pause or resume dispatch.</p>';
    $b .= '<h2>Needs attention</h2><table class="stacked"><tr><th>Recipient</th><th>Status</th><th>Detail</th><th></th></tr>';
    foreach (all("select * from recipients where status in ('failed','bounced','sending') or (status='sent' and delivered_at is null and sent_at<?) order by id desc limit 50", [time() - 172800]) as $r)
        $b .= '<tr><td>' . h($r['email']) . '</td><td>' . rstatus($r) . '</td><td>' . h($r['error']) . '</td><td>' . adminbtn('resend', (int)$r['id'], 'Resend with a fresh link') . '</td></tr>';
    admin_page('Delivery', $b . '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No delivery exceptions. Nothing needs attention.</p>' : '') . '<p class="note">Resending creates a new private link and switches the old one off. For an unconfirmed delivery the first email may already have arrived.</p>');
}

// ---------- finance (S21, S36)
function r_admin_finance(): void {
    need_role('finance'); $acct = env('STRIPE_ACCOUNT'); $key = env('STRIPE_SECRET');
    $b = '<h1>Finance</h1><h2>Beneficiary and payment connection</h2><dl class="facts"><dt>Beneficiary</dt><dd>7th Swindon Scouts</dd><dt>Account</dt><dd>' . ($acct ? h(substr($acct, 0, 5) . str_repeat('•', 6) . substr($acct, -4)) : 'Not set') . '</dd><dt>Currency</dt><dd>GBP</dd>'
        . '<dt>Connection</dt><dd>' . ($key ? 'Configured (' . (str_starts_with($key, 'sk_live') || str_starts_with($key, 'rk_live') ? 'live mode' : 'test mode') . ')' : 'Not configured: simulated payments only') . '</dd><dt>Last webhook received</dt><dd>' . (setting('last_stripe_hook') ? when((int)setting('last_stripe_hook')) : 'Unknown (none yet)') . '</dd></dl>'
        . '<p class="note">The destination account cannot be edited here. Changing the beneficiary needs the separate restricted verification process and recorded Treasurer or Trustee approval.</p>'
        . '<h2>Donations</h2><p><a href="/admin/export">Export finance CSV</a>. Refunds are made in the Stripe dashboard by the approved role; record the verified outcome below.</p><table class="stacked"><tr><th>Date</th><th>Amount</th><th>Reference</th><th>Fee, refunded (£), refund status</th></tr>';
    foreach (all('select * from donations order by id desc limit 100') as $x)
        $b .= '<tr><td>' . date('j M Y', (int)$x['created']) . '</td><td>' . gbp((int)$x['pence']) . '</td><td>' . h($x['stripe_session']) . '</td><td><form method="post" action="/admin/action" class="row">' . csrf() . '<input type="hidden" name="back" value="/admin/finance"><input type="hidden" name="do" value="money"><input type="hidden" name="id" value="' . $x['id'] . '"><input name="fee" size="5" value="' . number_format($x['fee'] / 100, 2, '.', '') . '" aria-label="Fee"><input name="refunded" size="5" value="' . number_format($x['refunded'] / 100, 2, '.', '') . '" aria-label="Refunded"><select name="refund_status" aria-label="Refund status">' . implode('', array_map(fn($s) => '<option' . ($s === ($x['refund_status'] ?? 'none') ? ' selected' : '') . '>' . $s . '</option>', ['none', 'requested', 'pending', 'confirmed', 'failed'])) . '</select><button class="btn alt">Save</button></form></td></tr>';
    $b .= '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No confirmed donations yet.</p>' : '') . '<h2>Pending or mismatched payments</h2><ul>';
    foreach (all("select id, donation, updated from sends where status='awaiting_payment' and updated<? order by updated", [time() - 900]) as $x) $b .= '<li>Card C-' . $x['id'] . ': ' . gbp((int)$x['donation']) . ' pending since ' . when((int)$x['updated']) . (time() - (int)$x['updated'] > 86400 ? ' <strong>(over 24 hours: escalate to the Treasurer)</strong>' : ' (investigating; it is not failed and no new charge is invited)') . '</li>';
    foreach (all("select * from audit where action='payment_mismatch' order by id desc limit 10") as $x) $b .= '<li>Mismatch: ' . h($x['detail']) . '</li>';
    $none = str_ends_with($b, '<ul>'); $b .= '</ul>' . ($none ? '<p class="note">Nothing needs attention.</p>' : '');
    $ex = payment_exceptions(); $b .= '<h2>Payment exceptions</h2><p class="note">Events from the payment provider that did not apply cleanly, and gifts received for cards that were never sent. Nothing is repeated or refunded automatically.</p><ul class="plain">';
    foreach ($ex['events'] as $x) $b .= '<li class="admincard"><strong>' . h($x['detail'] ?: $x['type']) . '</strong> <small>(' . h($x['type']) . ', ' . when((int)$x['received']) . ', ' . h($x['id']) . ')</small><form method="post" action="/admin/action" class="row">' . csrf() . '<input type="hidden" name="do" value="resolve_event"><input type="hidden" name="back" value="/admin/finance"><input type="hidden" name="eid" value="' . h($x['id']) . '"><label>What was done<input name="note" required maxlength="300"></label><button class="btn alt">Mark resolved</button></form></li>';
    foreach ($ex['orphans'] as $x) $b .= '<li class="admincard"><strong>Gift of ' . gbp((int)$x['pence']) . ' received, but card C-' . $x['send_id'] . ' has not been sent</strong> <small>(' . h($x['stripe_session']) . ', ' . when((int)$x['created']) . '). The sender can still choose to send it; no charge is repeated.</small></li>';
    admin_page('Finance', $b . '</ul>' . (!$ex['events'] && !$ex['orphans'] ? '<p class="note">No payment exceptions.</p>' : ''));
}

// ---------- reports
function r_admin_reports(): void {
    need_role('complaints');
    $b = '<h1>Reports</h1><table class="stacked"><tr><th>Recipient</th><th>Reason</th><th>Status</th><th></th></tr>';
    foreach (all('select r.*, x.email from reports r join recipients x on x.id=r.recipient_id order by r.id desc limit 50') as $x)
        $b .= '<tr><td>' . h($x['email']) . '</td><td>' . h($x['reason']) . '</td><td>' . h($x['status'] === 'open' ? 'Open' : $x['decision']) . '</td><td><a href="/admin/message?report=' . $x['id'] . '">View card</a> ' . ($x['status'] === 'open' ? adminbtn('dismiss', (int)$x['id'], 'Dismiss') . adminbtn('block', (int)$x['id'], 'Block recipient') . adminbtn('withdraw', (int)$x['id'], 'Withdraw card') : '') . '</td></tr>';
    admin_page('Reports', str_replace('<form method="post" class="inline">', '<form method="post" action="/admin/action" class="inline">', $b) . '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No reports. Nothing needs a decision.</p>' : ''));
}

// ---------- S37 access
function r_admin_access(): void {
    need_role('rolesadmin');
    $b = '<h1>Administrator access</h1><p class="note">Only restricted administrators can change this. Every change is audited and takes effect on the person\'s next request. Roles do not grant access to private address books or donor records unless listed.</p>';
    $rv = (int)setting('access_review_at'); $b .= '<section class="admincard"><h2>Access review</h2><p>Last reviewed: <strong>' . ($rv ? when($rv) : 'never') . '</strong>. Review who has access at least every 90 days (placeholder until the Trustees set it).</p><table class="stacked"><tr><th>Administrator</th><th>Roles</th><th>Last signed in</th><th>Two-step</th></tr>';
    foreach (all('select * from users where is_admin=1 order by name') as $x) $b .= '<tr><td>' . h($x['name']) . ' ' . h($x['email']) . '</td><td>' . h(role_names($x['roles'])) . '</td><td>' . ($x['last_login'] ? when((int)$x['last_login']) : 'Unknown') . '</td><td>' . ($x['totp_secret'] ? 'Set up' : '<strong>Not set up</strong>') . '</td></tr>';
    $b .= '</table><form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="access_review"><input type="hidden" name="back" value="/admin/access"><button class="btn alt">Record that I reviewed this list</button></form></section>';
    $b .= invites_panel();
    $b .= '<h2>Roles for people who already have an account</h2>';
    $rows = all("select * from users where is_admin=1 or roles<>'' order by name"); $rows[] = ['email' => '', 'roles' => '', 'name' => 'Give roles to a registered user by email', 'totp_secret' => null, 'verified' => 1];
    foreach ($rows as $x) {
        $have = explode(',', $x['roles']);
        $b .= '<form method="post" action="/admin/action" class="stack admincard">' . csrf() . '<input type="hidden" name="do" value="roles"><input type="hidden" name="back" value="/admin/access">' . ($x['email'] ? '<p><strong>' . h($x['name']) . '</strong> ' . h($x['email']) . '<br>Two-step sign-in: ' . ($x['totp_secret'] ? 'set up' : '<strong>not set up yet</strong>') . '</p><input type="hidden" name="email" value="' . h($x['email']) . '">' : '<label>Registered email of a verified user<input type="email" name="email" required></label>');
        foreach (ROLES as $k => $l) $b .= '<label class="opt"><input type="checkbox" name="roles[]" value="' . $k . '"' . (in_array($k, $have) ? ' checked' : '') . '> ' . h($l) . '</label>';
        $b .= '<button class="btn alt">' . ($x['email'] ? 'Save roles for ' . h($x['name']) : 'Give roles') . '</button></form>';
    }
    admin_page('Administrator access', $b);
}

// ---------- S34 email and help
function r_admin_email(): void {
    $u = need_admin(); if (!can_any('appadmin', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $demoR = ['id' => 0, 'name' => 'Sample Recipient', 'token' => str_repeat('0', 48), 'email' => 'sample@example.com']; $demoS = ['sender_name' => 'The Sample Family'];
    if (post()) {
        limit('emailtest', 3, 3600);
        mail_send($u['email'], 'TEST: ' . email_subject($demoS), email_body($demoR, $demoS), [], email_html($demoR, $demoS), 'The Sample Family');
        audit((int)$u['id'], 'email_test', 'to administrator'); flash('Test sent only to ' . $u['email'] . '.'); redirect('/admin/email');
    }
    admin_page('Email and help', '<h1>Email and help</h1><p>Recipient emails use a fixed approved template (<a href="/admin/wording">change the wording</a>): purple header, a clear Open button, plain text alternative, report and opt-out routes. They are sent from our verified address with the sender\'s display name. Nothing here accepts custom HTML.</p>'
        . '<h2>HTML preview</h2><div class="emailpreview">' . email_html($demoR, $demoS) . '</div><h2>Plain text preview</h2><pre>' . h(email_body($demoR, $demoS)) . '</pre>'
        . '<form method="post" class="row">' . csrf() . '<button class="btn alt">Send a test to ' . h($u['email']) . '</button></form><p class="note">Support contact (set by <code>SUPPORT_EMAIL</code>): ' . h(support_email()) . '</p>');
}

// ---------- S38 health
function r_admin_health(): void {
    need_admin(); $now = time(); $env = env('STRIPE_SECRET') ? (str_contains(env('STRIPE_SECRET'), '_live_') ? 'LIVE' : 'TEST') : 'SIMULATED';
    $st = fn(int $t, int $max) => !$t ? '<strong>Unknown</strong>' : ($now - $t > $max ? '<strong>Stale</strong> (' . when($t) . ')' : 'OK (' . when($t) . ')');
    $rows = [
        ['Scheduled queue job', $st((int)setting('last_queue'), 300), 'delivery'], ['Email provider', env('POSTMARK_TOKEN') ? 'Configured. Last accepted send: ' . ((int)setting('last_mail_ok') ? when((int)setting('last_mail_ok')) : 'Unknown') : 'Not configured: emails are written to a local log', 'delivery'],
        ['Payment provider (' . $env . ' mode)', env('STRIPE_SECRET') ? 'Configured. Last webhook: ' . ((int)setting('last_stripe_hook') ? when((int)setting('last_stripe_hook')) : 'Unknown') : 'Not configured: payments are simulated', 'finance'],
        ['Backup', $st((int)setting('last_backup'), 129600), 'appadmin'], ['Campaign availability', ['open' => 'Open', 'before' => 'Not open yet', 'closed' => 'Closed', 'locked' => 'Locked (launch decisions open)'][campaign_state()], 'campaign'],
        ['Dispatch', setting('paused') === '1' ? 'Paused' : 'Running', 'delivery']];
    $full = can_any('appadmin', 'rolesadmin'); $b = '<h1>System health</h1><p class="note">Checked at ' . date('j M Y H:i:s', $now) . '. Missing or old evidence is shown as Unknown or Stale, never Healthy. This page shows no secrets or private messages.</p><div class="cards">';
    foreach ($rows as [$l, $v, $who]) if ($full || can($who) || ($who === 'campaign' && can('campaign'))) $b .= '<section class="statuscard"><h2>' . h($l) . '</h2><p>' . $v . '</p></section>';
    $al = health_alerts(); $b .= '</div><h2>Unresolved alerts</h2>';
    if (!$al) $b .= '<p>None found.</p>'; else {
        $b .= '<ul class="plain">';
        foreach ($al as $k => $text) {
            $row = one('select * from alerts where akey=? and resolved_at is null', [$k]);
            $b .= '<li class="admincard"><strong>' . h($text) . '</strong><br><small>' . ($row ? 'First seen ' . when((int)$row['first_seen']) . ($row['acked_at'] ? '. Acknowledged ' . when((int)$row['acked_at']) : ($row['escalated'] ? '. <strong>Escalated, not acknowledged</strong>' : '. Not acknowledged')) : 'Will be notified at the next scheduled check') . '</small>'
                . ($row && !$row['acked_at'] && can_any('appadmin', 'rolesadmin', 'delivery', 'finance') ? ' <form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="ack"><input type="hidden" name="key" value="' . h($k) . '"><button class="link">Acknowledge</button></form>' : '') . '</li>';
        }
        $b .= '</ul><p class="note">Alerts are emailed to the people named under Application settings. This page is the second route: check it at least daily while the campaign is live.</p>';
    }
    admin_page('System health', $b);
}

// ---------- S39 change history
function r_admin_audit(): void {
    need_admin();
    $map = ['finance' => ['reconcile', 'finance_export', 'payment_mismatch', 'config_privacy'], 'delivery' => ['resend', 'dispatch_paused', 'dispatch_resumed', 'cancel', 'address_correction', 'email_test'], 'campaign' => ['config_campaign', 'design_', 'target'], 'complaints' => ['message_access', 'report_'], 'appadmin' => ['config_app', 'dispatch_', 'email_test'], 'rolesadmin' => ['']];
    $prefixes = []; foreach ($map as $r => $p) if (can($r)) $prefixes = array_merge($prefixes, $p);
    $b = '<h1>Change history</h1><p class="note">Append-only. You see the entries relevant to your roles.</p><ul class="plain">'; $n = 0;
    foreach (all('select a.*, u.name from audit a left join users u on u.id=a.user_id order by a.id desc limit 300') as $x) {
        $ok = false; foreach ($prefixes as $p) if ($p === '' || str_starts_with($x['action'], $p)) { $ok = true; break; }
        if (!$ok) continue; if (++$n > 100) break;
        $d = json_decode($x['detail'], true);
        $b .= '<li><strong>' . h($x['action']) . '</strong> by ' . h($x['name'] ?? 'system') . ' at ' . when((int)$x['created']) . ($d && isset($d['changes']) ? ': ' . h(implode('; ', array_map(fn($k, $c) => "$k: {$c['from']} to {$c['to']}", array_keys($d['changes']), $d['changes']))) . ($d['reason'] ? ' (reason: ' . h($d['reason']) . ($d['approval'] ? ', ref ' . h($d['approval']) : '') . ')' : '') : ' ' . h($x['detail'])) . '</li>';
    }
    admin_page('Change history', $b . '</ul>' . ($n ? '' : '<p>No entries yet.</p>'));
}

/** The campaign QR code as a download. An optional promotion label, like the link itself, may only be letters, numbers and hyphens. */
function r_admin_campaign_qr(): void {
    need_admin(); if (!can_any('campaign', 'appadmin', 'finance', 'delivery', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $ref = preg_match('/^[a-z0-9-]{1,30}$/', (string)($_GET['ref'] ?? '')) ? '?ref=' . $_GET['ref'] : '';
    header('Content-Type: image/svg+xml'); header('Content-Disposition: attachment; filename="7th-swindon-christmas-cards-qr.svg"'); header('X-Content-Type-Options: nosniff');
    echo qr_svg(base_url() . '/' . $ref, 1000); exit;
}
