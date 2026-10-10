<?php
// FRD 2.1 admin: sender suspension (S41), launch readiness (S42), alert acknowledgement, alert settings.

function reason_page(string $title, string $what, array $keep, string $back): never {
    $hid = ''; foreach ($keep as $k => $v) $hid .= '<input type="hidden" name="' . h($k) . '" value="' . h((string)$v) . '">';
    admin_page($title, '<h1>' . h($title) . '</h1><p>' . h($what) . '</p><p>This will be recorded in the audit trail.</p><form method="post" action="/admin/action" class="stack">' . csrf() . $hid . '<input type="hidden" name="confirmed" value="1"><label>Reason<input name="reason" required maxlength="300"></label><div class="row"><button class="btn">Confirm</button><a class="btn alt" href="' . h($back) . '">Cancel</a></div></form>');
}

/** Returns true when it handled the action. Roles are checked here on the server. */
function admin_action2(string $a, array $u): bool {
    $uid = (int)$u['id']; $back = safe_next($_POST['back'] ?? ''); $reason = trim((string)($_POST['reason'] ?? '')); $confirmed = !empty($_POST['confirmed']);
    switch ($a) {
        case 'suspend': case 'reinstate':
            if (!can_any('complaints', 'rolesadmin')) fail(403, 'You do not have permission for that.');
            $t = one('select * from users where id=?', [(int)($_POST['id'] ?? 0)]); if (!$t) fail(404, 'Account not found.');
            if (!$confirmed || $reason === '') reason_page(($a === 'suspend' ? 'Suspend ' : 'Reinstate ') . $t['name'], ($a === 'suspend' ? 'Stops new submissions and test sends and cancels cards that have not started sending. Cards already sent stay viewable unless you withdraw them separately.' : 'Allows this account to send again.') . ' Account: ' . $t['email'] . '.', ['do' => $a, 'id' => $t['id'], 'back' => '/admin/senders'], '/admin/senders');
            if ($a === 'suspend') { $n = suspend_sender((int)$t['id'], $reason, $uid); flash("Suspended. $n unsent deliveries cancelled."); } else { reinstate_sender((int)$t['id'], $reason, $uid); flash('Reinstated.'); }
            redirect('/admin/senders');
        case 'ack':
            if (!can_any('appadmin', 'rolesadmin', 'delivery', 'finance')) fail(403, 'You do not have permission for that.');
            q('update alerts set acked_by=?, acked_at=? where akey=? and acked_at is null', [$uid, time(), (string)($_POST['key'] ?? '')]); audit($uid, 'alert_ack', (string)($_POST['key'] ?? ''));
            flash('Acknowledged.'); redirect('/admin/health');
        case 'decision':
            if (!can('rolesadmin')) fail(403, 'You do not have permission for that.');
            $id = (string)($_POST['did'] ?? ''); if (!isset(DECISIONS[$id])) fail(400, 'Unknown decision.');
            $st = in_array($_POST['status'] ?? '', ['open', 'approved', 'deferred']) ? $_POST['status'] : 'open'; $ref = field('ref', 100);
            if ($st === 'approved' && ($ref === '' || field('value', 500) === '')) { flash('An approved decision needs the approved value and a reference.', 'err'); redirect('/admin/launch'); }
            q('insert into decisions(id,value,approver,approved_on,ref,status) values(?,?,?,?,?,?) on conflict(id) do update set value=excluded.value, approver=excluded.approver, approved_on=excluded.approved_on, ref=excluded.ref, status=excluded.status', [$id, field('value', 500), field('approver', 100), field('on', 20), $ref, $st]);
            audit($uid, 'decision_recorded', "$id: $st, ref $ref"); flash("$id saved."); redirect('/admin/launch');
        case 'override': case 'clear_override':
            if (!can('rolesadmin')) fail(403, 'You do not have permission for that.');
            if ($a === 'override') {
                if (!$confirmed || $reason === '') reason_page('Open the campaign with decisions still open', launch_blockers() . ' launch decisions are not approved. Overriding lets senders submit cards before they are.', ['do' => 'override', 'back' => '/admin/launch'], '/admin/launch');
                set_setting('launch_override', $reason); audit($uid, 'launch_override', $reason); flash('Override recorded.');
            } else { set_setting('launch_override', ''); audit($uid, 'launch_override_cleared'); flash('Override cleared.'); }
            redirect('/admin/launch');
    }
    return false;
}

// ---------- S41 senders
function r_admin_senders(): void {
    need_admin(); if (!can_any('complaints', 'rolesadmin')) fail(403, 'You do not have permission for that.');
    $q = trim((string)($_GET['q'] ?? ''));
    $b = '<h1>Senders</h1><p class="note">Suspend an account that keeps sending unwanted cards. This does not delete anything. Their address book is not shown to you.</p><form method="get" class="row" role="search"><label>Find by name or email<input type="search" name="q" value="' . h($q) . '"></label><button class="btn alt">Search</button></form>';
    if ($q !== '') {
        $like = '%' . addcslashes($q, '%_\\') . '%'; $b .= '<table class="stacked"><tr><th>Account</th><th>Cards</th><th>Status</th><th></th></tr>';
        foreach (all("select * from users where (name like ? escape '\\' or email like ? escape '\\') and email not like '%@deleted.invalid' limit 25", [$like, $like]) as $x) {
            $n = (int)one("select count(*) c from sends where user_id=? and status not in ('draft')", [$x['id']])['c'];
            $b .= '<tr><td>' . h($x['name']) . '<br>' . h($x['email']) . '</td><td>' . $n . '</td><td>' . ($x['suspended'] ? '<strong>Suspended</strong>: ' . h($x['suspend_reason']) : 'Active') . '</td><td><form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="id" value="' . $x['id'] . '"><input type="hidden" name="back" value="/admin/senders"><button class="link" name="do" value="' . ($x['suspended'] ? 'reinstate' : 'suspend') . '">' . ($x['suspended'] ? 'Reinstate' : 'Suspend') . '</button></form></td></tr>';
        }
        $b .= '</table>' . (str_ends_with($b, '</th></tr>') ? '<p class="note">No accounts match.</p>' : '');
    } else $b .= '<p class="note">Search to find an account.</p>';
    admin_page('Senders', $b);
}

// ---------- S42 launch readiness
function r_admin_launch(): void {
    need_admin(); $edit = can('rolesadmin'); $have = array_column(all('select * from decisions'), null, 'id'); $env = env('APP_ENV', 'development');
    $blockers = launch_blockers();
    $b = '<h1>Launch readiness</h1><dl class="facts"><dt>Environment</dt><dd><strong>' . h(strtoupper($env)) . '</strong>' . ($env === 'production' ? '' : ' (test mode, banner shown to everyone)') . '</dd><dt>Open launch decisions</dt><dd><strong>' . $blockers . '</strong></dd><dt>Campaign status</dt><dd>' . h(['open' => 'Open', 'before' => 'Not open yet', 'closed' => 'Closed', 'locked' => 'Locked until decisions are approved'][campaign_state()]) . '</dd><dt>Override</dt><dd>' . (setting('launch_override') !== '' ? 'Active: ' . h(setting('launch_override')) : 'None') . '</dd></dl>'
        . '<p class="note">In production the campaign stays locked while a required decision is Open, unless a restricted administrator records an override with a reason. Conditional decisions (D-11 to D-13) never block launch; record them as Deferred or Approved.</p>';
    if ($edit && $blockers) $b .= '<form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="override"><input type="hidden" name="back" value="/admin/launch"><button class="btn alt">Record an override</button></form> ';
    if ($edit && setting('launch_override') !== '') $b .= '<form method="post" action="/admin/action" class="inline">' . csrf() . '<input type="hidden" name="do" value="clear_override"><input type="hidden" name="back" value="/admin/launch"><button class="btn alt">Clear override</button></form>';
    $b .= '<h2>Decision register</h2>';
    foreach (DECISIONS as $id => [$label, $owner, $must]) {
        $d = $have[$id] ?? ['status' => 'open', 'value' => '', 'approver' => '', 'approved_on' => '', 'ref' => ''];
        $b .= '<form method="post" action="/admin/action" class="stack admincard">' . csrf() . '<input type="hidden" name="do" value="decision"><input type="hidden" name="did" value="' . $id . '"><input type="hidden" name="back" value="/admin/launch">'
            . '<p><strong>' . $id . '</strong> ' . h($label) . '<br><small>Owner: ' . h($owner) . ($must ? '' : ' (conditional)') . '</small> <span class="pill ' . ($d['status'] === 'approved' ? 'viewed' : '') . '">' . h(ucfirst($d['status'])) . '</span></p>';
        if ($edit) $b .= '<label>Approved value<input name="value" maxlength="500" value="' . h($d['value']) . '"></label><div class="row"><label>Approved by<input name="approver" value="' . h($d['approver']) . '"></label><label>Date<input name="on" type="date" value="' . h($d['approved_on']) . '"></label><label>Reference<input name="ref" value="' . h($d['ref']) . '"></label><label>Status<select name="status">' . implode('', array_map(fn($s) => '<option' . ($s === $d['status'] ? ' selected' : '') . '>' . $s . '</option>', ['open', 'approved', 'deferred'])) . '</select></label></div><button class="btn alt">Save ' . $id . '</button>';
        else $b .= '<p>' . ($d['value'] !== '' ? h($d['value']) . ' (' . h($d['approver']) . ', ' . h($d['approved_on']) . ', ref ' . h($d['ref']) . ')' : 'Nothing recorded yet.') . '</p>';
        $b .= '</form>';
    }
    admin_page('Launch readiness', $b);
}
