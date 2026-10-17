<?php
// FRD 2.1 Shoulds: site measures (FR-139, S45) and rehearsal sends (FR-136). Test sends are flagged and excluded from every count.

/** Small counts are shown as "fewer than N" so individuals cannot be picked out. N is decision D-16 (placeholder 5). */
function small_n(): int { return max(2, (int)setting('small_n', '5')); }
function masked(int $n): string { return ($n > 0 && $n < small_n()) ? 'fewer than ' . small_n() : (string)$n; }
function pct(int $a, int $b): string { return $b < small_n() ? 'not enough data' : round(100 * $a / $b) . '%'; }

/** Last 30 days and everything kept, side by side, with small numbers hidden. */
function engagement_block(): string {
    $a = engagement_totals(30); $z = engagement_totals(0); $cut = time() - 30 * 86400;
    $sub30 = (int)one("select count(*) n from sends where is_test=0 and queued_at>?", [$cut])['n']; $subAll = (int)one("select count(*) n from sends where is_test=0 and queued_at is not null")['n'];
    $rows = [['Home page views', $a['events']['visit'], $z['events']['visit']], ['A card chosen (write screen opened from the gallery)', $a['events']['card_chosen'], $z['events']['card_chosen']], ['Review page reached', $a['events']['review'], $z['events']['review']], ['Cards submitted', $sub30, $subAll]];
    $b = '<table class="stacked"><tr><th>Step</th><th>Last 30 days</th><th>All recorded</th></tr>'; foreach ($rows as [$l, $x, $y]) $b .= '<tr><td>' . h($l) . '</td><td>' . masked((int)$x) . '</td><td>' . masked((int)$y) . '</td></tr>'; $b .= '</table>';
    if ($a['designs']) { $b .= '<h3>Most chosen cards, last 30 days</h3><ul>'; foreach ($a['designs'] as $id => $n) $b .= '<li>' . h(cards()[$id]['title'] ?? $id) . ': ' . masked($n) . '</li>'; $b .= '</ul>'; }
    return $b;
}

function campaign_measures(): array {
    $sends = all('select * from sends where is_test=0'); $stage = ['Started, no message yet' => 0, 'Message written, not submitted' => 0, 'Waiting for payment' => 0, 'Submitted' => 0]; $senders = [];
    foreach ($sends as $s) {
        if ($s['status'] === 'draft') $stage[$s['message'] === '' ? 'Started, no message yet' : 'Message written, not submitted']++;
        elseif ($s['status'] === 'awaiting_payment') $stage['Waiting for payment']++;
        else { $stage['Submitted']++; $senders[$s['user_id']] = 1; }
    }
    $d = one('select count(*) n, count(distinct d.user_id) donors, coalesce(sum(d.pence),0) gross from donations d join sends s on s.id=d.send_id where s.is_test=0');
    $st = []; $sent = 0; $viewed = 0;
    foreach (all("select r.* from recipients r join sends s on s.id=r.send_id where s.is_test=0 and r.status not in ('draft')") as $r) { $k = rstatus($r); $st[$k] = ($st[$k] ?? 0) + 1; if (!in_array($k, ['Queued', 'Cancelled', 'Failed'])) $sent++; if ($k === 'Viewed') $viewed++; }
    $pop = []; foreach (all("select card, count(*) n from sends where is_test=0 and status not in ('draft','awaiting_payment') group by card order by n desc") as $x) $pop[$x['card']] = (int)$x['n'];
    return ['started' => count($sends), 'stage' => $stage, 'submitted' => $stage['Submitted'], 'senders' => count($senders), 'donations' => (int)$d['n'], 'donors' => (int)$d['donors'], 'gross' => (int)$d['gross'], 'status' => $st, 'sent' => $sent, 'viewed' => $viewed, 'designs' => $pop];
}

function r_admin_measures(): void {
    need_admin(); if (!can_any('campaign', 'finance', 'appadmin', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $m = campaign_measures();
    $b = '<h1>Measures</h1><p class="note">Totals only. Nothing here tracks individuals, and test cards are excluded. Counts below ' . small_n() . ' show as "fewer than ' . small_n() . '".</p><div class="cards">'
        . '<section class="statuscard"><h2>Cards started</h2><p>' . masked($m['started']) . '</p></section><section class="statuscard"><h2>Cards submitted</h2><p>' . masked($m['submitted']) . '</p></section>'
        . '<section class="statuscard"><h2>Senders who donated</h2><p>' . masked($m['donors']) . ' of ' . masked($m['senders']) . ' (' . pct($m['donors'], $m['senders']) . ')</p></section>'
        . '<section class="statuscard"><h2>Average donation</h2><p>' . ($m['donations'] >= small_n() ? gbp(intdiv($m['gross'], $m['donations'])) : 'not enough data') . '</p></section>'
        . '<section class="statuscard"><h2>Sent cards viewed</h2><p>' . pct($m['viewed'], $m['sent']) . '</p></section></div>'
        . '<h2>Visits and the journey</h2><p class="note">Page views, not people. Counted without cookies or anything that identifies anyone; search engine robots, signed in administrators and people whose browser asks not to be tracked are left out. Daily totals are kept for 24 months.</p>' . engagement_block()
        . '<h2>Where cards stop</h2><ul>';
    foreach ($m['stage'] as $k => $n) $b .= '<li>' . h($k) . ': ' . masked($n) . '</li>';
    $b .= '</ul><h2>Delivery status of recipients</h2><ul>';
    foreach ($m['status'] as $k => $n) $b .= '<li>' . h(status_label($k)) . ': ' . masked($n) . '</li>';
    $b .= '</ul><h2>Design popularity (submitted cards)</h2><ul>';
    foreach ($m['designs'] as $id => $n) $b .= '<li>' . h(cards()[$id]['title'] ?? $id) . ': ' . masked($n) . '</li>';
    $b .= '</ul><h2>Definitions</h2><ul><li><strong>Started:</strong> a draft was saved or sent, including unfinished ones.</li><li><strong>Submitted:</strong> the sender chose Send, with or without a donation.</li><li><strong>Viewed:</strong> a recipient pressed Open your card. It is a share of cards sent, not proof anyone read them.</li><li><strong>Where cards stop:</strong> the furthest point each unsent draft reached. We do not record the pages anyone visited.</li></ul>';
    admin_page('Measures', $b);
}

// ---------- rehearsal (S42 companion): real cards to allow-listed addresses only
function r_admin_rehearsal(): void {
    $u = need_admin(); if (!can_any('appadmin', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $allowed = alert_list('rehearsal_emails');
    if (post()) {
        if (($_POST['do'] ?? '') === 'result') {
            audit((int)$u['id'], 'uat_result', mb_substr(trim((string)($_POST['task'] ?? '')) . ': ' . trim((string)($_POST['result'] ?? '')), 0, 300)); flash('Result recorded.'); redirect('/admin/rehearsal');
        }
        $pick = array_values(array_intersect((array)($_POST['to'] ?? []), $allowed)); // server-side: anything outside the allow-list is dropped
        if (!$pick) { flash('Choose at least one address from the allow-list.', 'err'); redirect('/admin/rehearsal'); }
        $card = array_key_first(array_filter(cards(), fn($c) => $c['on'])) ?: 'santa';
        q("insert into sends(user_id,card,sender_name,message,created,updated,is_test) values(?,?,?,?,?,?,1)", [$u['id'], $card, 'Rehearsal', 'This is a rehearsal card from the Trustee test. Nothing to do.', time(), time()]); $sid = (int)db()->lastInsertId();
        foreach ($pick as $e) q('insert into recipients(send_id,name,email,token) values(?,?,?,?)', [$sid, 'Tester', $e, token()]);
        queue_send($sid); audit((int)$u['id'], 'rehearsal_send', count($pick) . ' allow-listed addresses'); flash('Rehearsal card sent to ' . count($pick) . ' allow-listed address(es). It is marked as a test and left out of all counts.'); redirect('/admin/rehearsal');
    }
    $b = '<h1>Rehearsal</h1><p>Send a real card, through the normal sending process, to addresses on the allow-list only. Use it on staging with payment in test mode. Test cards are labelled as tests and are never counted in totals.</p>';
    if (!$allowed) $b .= '<p class="flash warn">The allow-list is empty. Add addresses under Application settings (Rehearsal allow-list).</p>';
    else {
        $b .= '<form method="post" class="stack">' . csrf() . '<fieldset><legend>Send a rehearsal card to</legend>' . implode('', array_map(fn($e) => '<label class="opt"><input type="checkbox" name="to[]" value="' . h($e) . '" checked> ' . h($e) . '</label>', $allowed)) . '</fieldset><button class="btn">Send rehearsal card</button></form>'
            
            . '<h2>Record a result</h2><form method="post" class="stack">' . csrf() . '<input type="hidden" name="do" value="result"><label>Task or scenario (for example AC-46)<input name="task" required maxlength="100"></label><label>Result and notes<input name="result" required maxlength="200"></label><button class="btn alt">Record result</button></form>';
    }
    $b .= '<h2>Rehearsal history</h2><ul>';
    foreach (all("select * from audit where action in ('rehearsal_send','uat_result') order by id desc limit 30") as $x) $b .= '<li>' . when((int)$x['created']) . ' ' . h($x['action']) . ': ' . h($x['detail']) . '</li>';
    admin_page('Rehearsal', $b . '</ul>');
}
