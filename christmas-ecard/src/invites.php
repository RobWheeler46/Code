<?php
// FR-088: restricted administrators invite people to be administrators by email. An invitation is for one email address and a fixed set
// of roles, works once and for seven days, and is accepted only by a signed in, verified account with that same address. The two step
// sign in is then set up the first time the new administrator opens Admin. Revoking is immediate.

const INVITE_DAYS = 7;

function invite_roles(array $in): array { return array_values(array_intersect(array_keys(ROLES), array_map('strval', $in))); }
function invite_pending(): array { return all('select i.*, u.name inviter from admin_invites i left join users u on u.id=i.invited_by where i.accepted_at is null and i.revoked_at is null and i.expires>? order by i.created desc', [time()]); }

/** Creates an invitation and emails the link. Returns ['ok'=>bool,'error'=>?,'id'=>?]. Needs the restricted administrator role, checked here as well as on the screen. */
function invite_create(string $email, array $roles, int $uid, bool $resendOf = false): array {
    $by = one('select * from users where id=?', [$uid]);
    if (!$by || !$by['is_admin'] || !in_array('rolesadmin', explode(',', (string)$by['roles']), true)) return ['ok' => false, 'error' => 'Only a restricted administrator can invite people.'];
    $email = strtolower(trim($email)); $roles = invite_roles($roles);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return ['ok' => false, 'error' => 'Enter a valid email address.'];
    if (!$roles) return ['ok' => false, 'error' => 'Choose at least one role.'];
    $ex = one('select * from users where email=?', [$email]);
    if ($ex && $ex['is_admin']) return ['ok' => false, 'error' => 'That person is already an administrator. Change their roles below instead.'];
    if (count(invite_pending()) >= 20) return ['ok' => false, 'error' => 'There are already 20 invitations waiting. Revoke some first.'];
    q('update admin_invites set revoked_at=? where lower(email)=? and accepted_at is null and revoked_at is null', [time(), $email]); // one live invitation per address
    $t = token(); q('insert into admin_invites(email,roles,token_hash,invited_by,created,expires) values(?,?,?,?,?,?)', [$email, implode(',', $roles), hash('sha256', $t), $uid, time(), time() + INVITE_DAYS * 86400]);
    $id = (int)db()->lastInsertId();
    mail_send($email, 'You are invited to help run the Christmas cards service', $by['name'] . " has invited you to help administer 7th Swindon Scouts Christmas Cards, with these roles: " . implode(', ', array_map(fn($r) => ROLES[$r], $roles)) . ".\n\nOpen this link and sign in (or register first) with this email address:\n" . base_url() . "/invite?t=$t\n\nIt works once and for " . INVITE_DAYS . " days. The first time you open Admin you will be asked to set up two step sign in. If you were not expecting this, ignore this email and nothing will happen.");
    audit($uid, $resendOf ? 'admin_invite_resent' : 'admin_invite_created', "invite $id: " . implode(',', $roles));
    return ['ok' => true, 'id' => $id];
}

function invite_revoke(int $id, int $uid): bool {
    $by = one('select roles, is_admin from users where id=?', [$uid]); if (!$by || !$by['is_admin'] || !in_array('rolesadmin', explode(',', (string)$by['roles']), true)) return false;
    $n = q('update admin_invites set revoked_at=? where id=? and accepted_at is null and revoked_at is null', [time(), $id])->rowCount();
    if ($n) audit($uid, 'admin_invite_revoked', "invite $id"); return (bool)$n;
}

/** Accepts for a signed in, verified user whose address is the invited one. Every refusal looks the same to the person, so the link reveals nothing to anyone else. */
function invite_accept(string $t, array $user): bool {
    if (!$user['verified'] || $t === '') return false;
    $i = one('select * from admin_invites where token_hash=? and accepted_at is null and revoked_at is null and expires>?', [hash('sha256', $t), time()]);
    if (!$i || strtolower((string)$user['email']) !== strtolower((string)$i['email'])) return false;
    $roles = array_values(array_unique(array_merge(array_filter(explode(',', (string)$user['roles'])), explode(',', (string)$i['roles']))));
    $p = db(); $p->beginTransaction();
    if (!q('update admin_invites set accepted_at=?, accepted_by=? where id=? and accepted_at is null', [time(), $user['id'], $i['id']])->rowCount()) { $p->rollBack(); return false; }
    q('update users set is_admin=1, roles=? where id=?', [implode(',', $roles), $user['id']]);
    audit((int)$user['id'], 'admin_invite_accepted', 'invite ' . (int)$i['id'] . ': ' . $i['roles']); $p->commit();
    return true;
}

function invites_panel(): string {
    $b = '<section class="admincard"><h2>Invite someone by email</h2><p>They need an account with the same email address. The invitation works once and for ' . INVITE_DAYS . ' days. They set up two step sign in the first time they open Admin.</p>'
        . '<form method="post" action="/admin/invites" class="stack">' . csrf() . '<input type="hidden" name="do" value="create"><label>Email address<input type="email" name="email" required maxlength="200"></label><fieldset><legend>Roles</legend>';
    foreach (ROLES as $k => $l) $b .= '<label class="opt"><input type="checkbox" name="roles[]" value="' . h($k) . '"> ' . h($l) . '</label>';
    $b .= '</fieldset><button class="btn">Send invitation</button></form>';
    $pend = invite_pending();
    if ($pend) { $b .= '<h3>Waiting for an answer</h3><table class="stacked"><tr><th>Email</th><th>Roles</th><th>Invited by</th><th>Expires</th><th></th></tr>';
        foreach ($pend as $i) $b .= '<tr><td>' . h($i['email']) . '</td><td>' . h(role_names($i['roles'])) . '</td><td>' . h((string)$i['inviter']) . '</td><td>' . h(when((int)$i['expires'])) . '</td><td>'
            . '<form method="post" action="/admin/invites" class="inline">' . csrf() . '<input type="hidden" name="do" value="resend"><input type="hidden" name="id" value="' . (int)$i['id'] . '"><button class="btn alt">Send again</button></form> '
            . '<form method="post" action="/admin/invites" class="inline">' . csrf() . '<input type="hidden" name="do" value="revoke"><input type="hidden" name="id" value="' . (int)$i['id'] . '"><button class="btn alt">Revoke</button></form></td></tr>';
        $b .= '</table>'; }
    return $b . '</section>';
}

function r_admin_invites(): void {
    $u = need_admin(); if (!can('rolesadmin')) fail(403, 'You do not have permission for that.'); if (!post()) redirect('/admin/access');
    limit_for("invites:{$u['id']}", 20, 3600); $do = (string)($_POST['do'] ?? ''); $uid = (int)$u['id'];
    if ($do === 'create') $r = invite_create((string)($_POST['email'] ?? ''), (array)($_POST['roles'] ?? []), $uid);
    elseif ($do === 'resend') { $i = one('select * from admin_invites where id=? and accepted_at is null and revoked_at is null', [(int)($_POST['id'] ?? 0)]); $r = $i ? invite_create($i['email'], explode(',', $i['roles']), $uid, true) : ['ok' => false, 'error' => 'That invitation is no longer waiting.']; }
    elseif ($do === 'revoke') $r = invite_revoke((int)($_POST['id'] ?? 0), $uid) ? ['ok' => true] : ['ok' => false, 'error' => 'That invitation is no longer waiting.'];
    else fail(400, 'Unknown action.');
    flash($r['ok'] ? ['create' => 'Invitation sent.', 'resend' => 'Invitation sent again. The old link no longer works.', 'revoke' => 'Invitation revoked. Its link no longer works.'][$do] : $r['error'], $r['ok'] ? 'ok' : 'err'); redirect('/admin/access');
}

/** The page the emailed link opens. */
function r_invite(): void {
    $t = (string)($_GET['t'] ?? $_POST['t'] ?? ''); $u = user(); $GLOBALS['bare'] = false;
    $i = $t !== '' ? one('select * from admin_invites where token_hash=? and accepted_at is null and revoked_at is null and expires>?', [hash('sha256', $t), time()]) : null;
    if (!$i) page('Invitation', '<h1>This invitation is not valid</h1><p>It may have been used, replaced, revoked or may have expired. Ask the person who invited you to send a new one.</p>', 404);
    if (!$u) page('Invitation', '<h1>You have been invited to help run the service</h1><p>Sign in, or register first, using the email address the invitation was sent to (<strong>' . h(acct_mask($i['email'])) . '</strong>), then open the link in the email again.</p><p><a class="btn" href="/login?next=' . h(urlencode('/invite?t=' . $t)) . '">Sign in</a> <a class="btn alt" href="/register">Register</a></p>');
    if (post()) {
        limit_for("invite:{$u['id']}", 10, 3600);
        if (invite_accept($t, $u)) { flash('You are now an administrator. Set up two step sign in to continue.'); redirect('/admin'); }
        flash('That invitation cannot be accepted with this account. Check you are signed in with the address it was sent to, and that the address is confirmed.', 'err'); redirect('/dashboard');
    }
    page('Invitation', '<h1>Accept the invitation</h1><p>You are signed in as <strong>' . h($u['email']) . '</strong>. Accepting gives this account these roles: <strong>' . h(role_names($i['roles'])) . '</strong>. You will be asked to set up two step sign in.</p><form method="post" class="stack">' . csrf() . '<input type="hidden" name="t" value="' . h($t) . '"><button class="btn">Accept and continue</button> <a class="btn alt" href="/dashboard">Not now</a></form>');
}

/** First time set up without a terminal: the person who registers and confirms the address in ADMIN_EMAIL becomes the first restricted administrator.
 *  It only works while there is no restricted administrator at all, needs the address to be confirmed (so the mailbox owner), has no default password,
 *  and the two step sign in is then set up the first time they open Admin. After that it does nothing. */
function bootstrap_admin(int $uid): void {
    $want = strtolower(trim(env('ADMIN_EMAIL'))); if ($want === '') return;
    $u = one('select * from users where id=?', [$uid]); if (!$u || !$u['verified'] || strtolower((string)$u['email']) !== $want) return;
    if ((int)one("select count(*) n from users where is_admin=1 and (',' || roles || ',') like '%,rolesadmin,%'")['n'] > 0) return;
    q('update users set is_admin=1, roles=? where id=?', [implode(',', array_keys(ROLES)), $uid]);
    audit($uid, 'admin_bootstrap', "user $uid became the first restricted administrator");
}
