<?php
// FRD 2.1 admin: sender suspension (S41), alert acknowledgement, alert settings.

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

