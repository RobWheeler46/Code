<?php
// Private sender address book and contact groups (FR-100 to FR-116). Every query is scoped to the signed-in verified owner.

function contacts_max(): int { return (int)setting('contacts_max', '200'); }  // proposed default D-02, pending approval
function groups_max(): int { return (int)setting('groups_max', '20'); }

/** Trim, lowercase the domain (ASCII form for IDN when available), keep the local part exactly as typed. */
function norm_email(string $e): string {
    $e = trim($e); $at = strrpos($e, '@');
    if ($at === false) return $e;
    $d = strtolower(substr($e, $at + 1));
    if (function_exists('idn_to_ascii') && preg_match('/[^\x20-\x7e]/', $d)) $d = idn_to_ascii($d) ?: $d;
    return substr($e, 0, $at) . '@' . $d;
}
/** Duplicate rule used everywhere: case-folded whole address; plus tags and dots are never stripped. */
function email_key(string $e): string { return strtolower(norm_email($e)); }

function need_verified(): array {
    $u = need_login();
    if (!$u['verified']) { flash('Verify your email to use your address book.', 'warn'); redirect('/dashboard'); }
    return $u;
}
function own_contact(int $id): array {
    $c = one('select * from contacts where id=? and user_id=?', [$id, user()['id']]);
    return $c ?: fail(404, 'Contact not found.');
}
function own_group(int $id): array {
    $g = one('select * from groups where id=? and user_id=?', [$id, user()['id']]);
    return $g ?: fail(404, 'Group not found.');
}
function contact_errors(string $name, string $email): array {
    $e = [];
    if ($name === '' || mb_strlen($name) > 100) $e['name'] = 'Enter a name of 1 to 100 characters.';
    elseif ($bad = abuse_check($name)) $e['name'] = ucfirst($bad);
    $n = norm_email($email);
    if (!filter_var($n, FILTER_VALIDATE_EMAIL) || strlen($n) > 254) $e['email'] = 'Enter a valid email address.';
    return $e;
}
function contact_dup(int $uid, string $email, int $except = 0): ?array {
    return one('select * from contacts where user_id=? and lower(email)=? and id<>?', [$uid, email_key($email), $except]);
}
function member_ids(int $cid): array { return array_map('intval', array_column(all('select group_id from contact_groups where contact_id=?', [$cid]), 'group_id')); }
function set_memberships(int $uid, int $cid, array $gids): void {
    q('delete from contact_groups where contact_id=?', [$cid]);
    foreach (array_unique(array_map('intval', $gids)) as $g) if (one('select 1 from groups where id=? and user_id=?', [$g, $uid])) q('insert or ignore into contact_groups values(?,?)', [$cid, $g]);
}
function group_name_ok(int $uid, string $name, int $except = 0): ?string {
    if ($name === '' || mb_strlen($name) > 50) return 'Enter a group name of 1 to 50 characters.';
    foreach (all('select id, name from groups where user_id=? and id<>?', [$uid, $except]) as $g)
        if (mb_strtolower(trim(preg_replace('/\s+/', ' ', $g['name']))) === mb_strtolower(trim(preg_replace('/\s+/', ' ', $name)))) return 'You already have a group with that name.';
    return null;
}
/** Contacts for the owner, filtered by search text and group ('all', 'none' for Ungrouped, or a group id). Each contact once. */
function contacts_for(int $uid, string $q = '', string $g = 'all'): array {
    $sql = 'select c.* from contacts c where c.user_id=?'; $a = [$uid];
    if ($q !== '') { $sql .= ' and (c.name like ? escape \'\\\' or c.email like ? escape \'\\\')'; $like = '%' . addcslashes($q, '%_\\') . '%'; array_push($a, $like, $like); }
    if ($g === 'none') $sql .= ' and not exists (select 1 from contact_groups x where x.contact_id=c.id)';
    elseif (ctype_digit($g)) { $sql .= ' and exists (select 1 from contact_groups x where x.contact_id=c.id and x.group_id=?)'; $a[] = (int)$g; }
    return all($sql . ' order by lower(c.name)', $a);
}
function group_filter_links(int $uid, string $g, string $q, string $base): string {
    $out = '<nav aria-label="Filter by group" class="row">';
    $items = ['all' => 'All contacts', 'none' => 'Ungrouped'];
    foreach (all('select * from groups where user_id=? order by lower(name)', [$uid]) as $x) $items[(string)$x['id']] = $x['name'];
    foreach ($items as $k => $l) $out .= '<a class="pill' . ((string)$k === $g ? ' viewed' : '') . '" href="' . $base . (str_contains($base, '?') ? '&amp;' : '?') . 'g=' . h((string)$k) . '&amp;q=' . h(urlencode($q)) . '"' . ((string)$k === $g ? ' aria-current="true"' : '') . '>' . h($l) . '</a> ';
    return $out . '</nav>';
}
function contact_fields(array $v, array $e, int $uid, array $have): string {
    $f = true;
    $b = '<label>Name<input name="name" maxlength="120" required value="' . h($v['name'] ?? '') . '"' . fa($e, 'name', $f) . '>' . fe($e, 'name') . '</label>'
        . '<label>Email<input type="email" name="email" required value="' . h($v['email'] ?? '') . '"' . fa($e, 'email', $f) . '>' . fe($e, 'email') . '</label>';
    $gs = all('select * from groups where user_id=? order by lower(name)', [$uid]);
    if ($gs) { $b .= '<fieldset><legend>Groups (optional)</legend>'; foreach ($gs as $g) $b .= '<label class="opt"><input type="checkbox" name="groups[]" value="' . $g['id'] . '"' . (in_array((int)$g['id'], $have, true) ? ' checked' : '') . '> ' . h($g['name']) . '</label>'; $b .= '</fieldset>'; }
    return $b;
}
function confirm_delete_page(string $title, string $what, array $hidden, string $back): never {
    $h = ''; foreach ($hidden as $k => $v) $h .= '<input type="hidden" name="' . h($k) . '" value="' . h((string)$v) . '">';
    page($title, '<h1>' . h($title) . '</h1><p>' . h($what) . '</p><form method="post" class="row">' . csrf() . $h . '<input type="hidden" name="confirmed" value="1"><button class="btn">Yes, delete</button><a class="btn alt" href="' . h($back) . '">Cancel</a></form>');
}

// ---------- S25 address book + add
function r_contacts(): void {
    $u = need_verified(); $uid = (int)$u['id'];
    $q = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 100); $g = (string)($_GET['g'] ?? 'all');
    $errs = $_SESSION['cerrs'] ?? []; $old = $_SESSION['cold'] ?? []; unset($_SESSION['cerrs'], $_SESSION['cold']);
    if (post()) {
        $name = trim(preg_replace('/\s+/', ' ', (string)($_POST['name'] ?? ''))); $email = norm_email((string)($_POST['email'] ?? ''));
        $e = contact_errors($name, $email);
        if (!$e && (int)one('select count(*) c from contacts where user_id=?', [$uid])['c'] >= contacts_max()) $e['name'] = 'Your address book is full (' . contacts_max() . ' contacts). Delete one to add another.';
        if (!$e && ($d = contact_dup($uid, $email))) $e['email'] = 'That address is already saved as ' . $d['name'] . '. Review that contact instead.';
        if ($e) { $_SESSION['cerrs'] = $e; $_SESSION['cold'] = $_POST; flash('Please check the highlighted fields.', 'warn'); redirect('/contacts'); }
        q('insert into contacts(user_id,name,email,created,updated) values(?,?,?,?,?)', [$uid, $name, $email, time(), time()]);
        set_memberships($uid, (int)db()->lastInsertId(), (array)($_POST['groups'] ?? []));
        flash('Contact saved.'); redirect('/contacts');
    }
    $rows = '';
    foreach (contacts_for($uid, $q, $g) as $c) {
        $gn = array_column(all('select g.name from groups g join contact_groups x on x.group_id=g.id where x.contact_id=? order by lower(g.name)', [$c['id']]), 'name');
        $rows .= '<tr><td>' . h($c['name']) . '</td><td>' . h($c['email']) . '</td><td>' . h(implode(', ', $gn)) . '</td><td><a href="/contacts/edit?id=' . $c['id'] . '">Edit</a></td></tr>';
    }
    $total = (int)one('select count(*) c from contacts where user_id=?', [$uid])['c'];
    $empty = $total === 0 ? '<p>Your address book is empty. Add someone below to get started.</p>' : '<p>No contacts match. Try a different search or group.</p>';
    $b = '<h1>Address book</h1><p class="note">Private to you. Only name and email are stored. Saving someone here does not email them.</p>'
        . '<form method="get" class="row" role="search"><label>Search<input type="search" name="q" value="' . h($q) . '"></label><input type="hidden" name="g" value="' . h($g) . '"><button class="btn alt">Search</button></form>'
        . group_filter_links($uid, $g, $q, '/contacts') . '<p><a href="/groups">Manage groups</a></p>'
        . ($rows ? '<table><tr><th>Name</th><th>Email</th><th>Groups</th><th></th></tr>' . $rows . '</table>' : $empty)
        . '<h2>Add a contact</h2><form method="post" class="stack">' . csrf() . contact_fields($old, $errs, $uid, array_map('intval', (array)($old['groups'] ?? []))) . '<button class="btn">Add contact</button></form>'
        . ($total ? '<p><a href="/contacts/delete-all">Delete all my contacts</a></p>' : '');
    page('Address book', $b);
}

// ---------- S26 edit / delete
function r_contact_edit(): void {
    $u = need_verified(); $uid = (int)$u['id']; $c = own_contact((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    $errs = $_SESSION['cerrs'] ?? []; $old = $_SESSION['cold'] ?? $c; unset($_SESSION['cerrs'], $_SESSION['cold']);
    if (post()) {
        if (($_POST['do'] ?? '') === 'delete') {
            if (empty($_POST['confirmed'])) confirm_delete_page('Delete this contact?', 'This removes ' . $c['name'] . ' from your address book only. It does not recall cards already sent, cancel queued cards, or clear any opt-out the recipient has chosen.', ['id' => $c['id'], 'do' => 'delete'], '/contacts/edit?id=' . $c['id']);
            q('delete from contact_groups where contact_id=?', [$c['id']]); q('delete from contacts where id=? and user_id=?', [$c['id'], $uid]);
            flash('Contact deleted.'); redirect('/contacts');
        }
        $name = trim(preg_replace('/\s+/', ' ', (string)($_POST['name'] ?? ''))); $email = norm_email((string)($_POST['email'] ?? ''));
        $e = contact_errors($name, $email);
        if (!$e && (string)$c['updated'] !== (string)($_POST['ver'] ?? '')) { $e['name'] = 'This contact was changed somewhere else. Reload to see the latest version; what you typed is kept below.'; }
        if (!$e && ($d = contact_dup($uid, $email, (int)$c['id']))) $e['email'] = 'That address is already saved as ' . $d['name'] . '.';
        if ($e) { $_SESSION['cerrs'] = $e; $_SESSION['cold'] = ['name' => $_POST['name'] ?? '', 'email' => $_POST['email'] ?? '', 'groups' => $_POST['groups'] ?? [], 'updated' => $_POST['ver'] ?? '']; flash('Please check the highlighted fields.', 'warn'); redirect('/contacts/edit?id=' . $c['id']); }
        q('update contacts set name=?, email=?, updated=? where id=?', [$name, $email, time(), $c['id']]);
        set_memberships($uid, (int)$c['id'], (array)($_POST['groups'] ?? []));
        flash('Contact saved. Cards already drafted or sent keep the details they had.'); redirect('/contacts');
    }
    $have = isset($old['groups']) ? array_map('intval', (array)$old['groups']) : member_ids((int)$c['id']);
    page('Edit contact', '<h1>Edit contact</h1><form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $c['id'] . '"><input type="hidden" name="ver" value="' . h((string)($old['updated'] ?? $c['updated'])) . '">' . contact_fields($old, $errs, $uid, $have)
        . '<div class="row"><button class="btn" name="do" value="save">Save</button><a class="btn alt" href="/contacts">Back</a><button class="btn alt" name="do" value="delete">Delete contact</button></div></form>');
}

function r_contacts_delete_all(): void {
    $u = need_verified(); $uid = (int)$u['id']; $n = (int)one('select count(*) c from contacts where user_id=?', [$uid])['c']; $g = (int)one('select count(*) c from groups where user_id=?', [$uid])['c'];
    if (post()) {
        if (empty($_POST['confirmed'])) confirm_delete_page('Delete all contacts?', "This deletes $n saved contacts and removes them from your $g groups (the groups stay). It does not recall cards already sent, cancel queued cards, change drafts, or clear anyone's opt-out.", [], '/contacts');
        q('delete from contact_groups where contact_id in (select id from contacts where user_id=?)', [$uid]); q('delete from contacts where user_id=?', [$uid]);
        audit($uid, 'contacts_delete_all', "$n contacts"); flash("Deleted $n contacts."); redirect('/contacts');
    }
    confirm_delete_page('Delete all contacts?', "This deletes $n saved contacts and removes them from your $g groups (the groups stay). It does not recall cards already sent, cancel queued cards, change drafts, or clear anyone's opt-out.", [], '/contacts');
}

// ---------- S28/S29 groups
function r_groups(): void {
    $u = need_verified(); $uid = (int)$u['id'];
    if (post()) {
        $do = $_POST['do'] ?? ''; $name = trim(preg_replace('/\s+/', ' ', (string)($_POST['name'] ?? '')));
        if ($do === 'create') {
            $e = group_name_ok($uid, $name);
            if (!$e && (int)one('select count(*) c from groups where user_id=?', [$uid])['c'] >= groups_max()) $e = 'You can have up to ' . groups_max() . ' groups.';
            if ($e) flash($e, 'err'); else { q('insert into groups(user_id,name) values(?,?)', [$uid, $name]); flash('Group created.'); }
        } elseif ($do === 'rename') {
            $g = own_group((int)($_POST['id'] ?? 0)); $e = group_name_ok($uid, $name, (int)$g['id']);
            if ($e) flash($e, 'err'); else { q('update groups set name=? where id=?', [$name, $g['id']]); flash('Group renamed.'); }
        } elseif ($do === 'delete') {
            $g = own_group((int)($_POST['id'] ?? 0));
            if (empty($_POST['confirmed'])) confirm_delete_page('Delete this group?', 'This removes the group "' . $g['name'] . '" and its memberships only. Your contacts, drafts, queued and sent cards are not changed.', ['id' => $g['id'], 'do' => 'delete'], '/groups');
            q('delete from contact_groups where group_id=?', [$g['id']]); q('delete from groups where id=?', [$g['id']]); flash('Group deleted.');
        }
        redirect('/groups');
    }
    $rows = '';
    foreach (all('select g.*, (select count(*) from contact_groups x where x.group_id=g.id) n from groups g where user_id=? order by lower(name)', [$uid]) as $g)
        $rows .= '<li><form method="post" class="row">' . csrf() . '<input type="hidden" name="id" value="' . $g['id'] . '"><label>Name<input name="name" maxlength="60" value="' . h($g['name']) . '"></label> <span>' . $g['n'] . ' contacts</span><button class="btn alt" name="do" value="rename">Rename</button><button class="btn alt" name="do" value="delete">Delete</button></form></li>';
    page('Contact groups', '<h1>Contact groups</h1><p class="note">Groups such as Family or Friends are just your own labels. They are private and never shown to recipients.</p>'
        . ($rows ? '<ul class="plain">' . $rows . '</ul>' : '<p>No groups yet.</p>') . '<h2>New group</h2><form method="post" class="row">' . csrf() . '<input type="hidden" name="do" value="create"><label>Group name<input name="name" maxlength="60" required></label><button class="btn">Create group</button></form><p><a href="/contacts">Back to address book</a></p>');
}

// ---------- S27 recipient picker
function r_pick(): void {
    $u = need_verified(); $uid = (int)$u['id']; $s = own_send((int)($_GET['id'] ?? $_POST['id'] ?? 0));
    if ($s['status'] !== 'draft') redirect('/send?id=' . $s['id']);
    $sid = (int)$s['id']; $existing = all("select * from recipients where send_id=? and status='draft' order by id", [$sid]);
    $room = max(0, max_recipients() - count($existing));
    $sel = $_SESSION['pick'][$sid] ?? [];
    $q = mb_substr(trim((string)($_REQUEST['q'] ?? '')), 0, 100); $g = (string)($_REQUEST['g'] ?? 'all');
    if (post()) {
        $shown = array_map('intval', (array)($_POST['shown'] ?? [])); $chosen = array_map('intval', (array)($_POST['sel'] ?? []));
        $sel = array_values(array_unique(array_merge(array_diff($sel, $shown), $chosen))); // changing a filter keeps earlier picks
        $_SESSION['pick'][$sid] = $sel;
        if (($_POST['act'] ?? '') === 'add') {
            $have = array_flip(array_map(fn($r) => email_key($r['email']), $existing)); $add = []; $dups = 0;
            foreach ($sel as $cid) if ($c = one('select * from contacts where id=? and user_id=?', [$cid, $uid])) {
                if (isset($have[email_key($c['email'])])) { $dups++; continue; }
                $have[email_key($c['email'])] = 1; $add[] = $c;
            }
            if (count($add) > $room) { flash('There is room for ' . $room . ' more ' . ($room === 1 ? 'recipient' : 'recipients') . ' (limit ' . max_recipients() . ') but you chose ' . count($add) . '. Untick some and try again. Nothing was added.', 'err'); redirect("/contacts/pick?id=$sid&g=" . urlencode($g) . '&q=' . urlencode($q)); }
            foreach ($add as $c) q('insert into recipients(send_id,name,email,token) values(?,?,?,?)', [$sid, $c['name'], $c['email'], token()]); // snapshot copy
            unset($_SESSION['pick'][$sid]);
            flash(count($add) . ' added to your card.' . ($dups ? " $dups already on the card, skipped." : '')); redirect('/compose?id=' . $sid);
        }
        redirect("/contacts/pick?id=$sid&g=" . urlencode($g) . '&q=' . urlencode($q));
    }
    $list = contacts_for($uid, $q, $g); $rows = ''; $shown = '';
    foreach ($list as $c) {
        $shown .= '<input type="hidden" name="shown[]" value="' . $c['id'] . '">';
        $rows .= '<li><label class="opt"><input type="checkbox" name="sel[]" value="' . $c['id'] . '"' . (in_array((int)$c['id'], $sel, true) ? ' checked' : '') . '> <strong>' . h($c['name']) . '</strong> ' . h($c['email']) . '</label></li>';
    }
    $total = (int)one('select count(*) c from contacts where user_id=?', [$uid])['c'];
    page('Choose contacts', '<h1>Choose from address book</h1><p><strong>' . count($existing) . '</strong> already on this card. Room for <strong>' . $room . '</strong> more (limit ' . max_recipients() . '). <strong data-picked>' . count($sel) . '</strong> chosen so far.</p>'
        . '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '">' . $shown
        . '<div class="row"><label>Search<input type="search" name="q" value="' . h($q) . '"></label><label>Group<select name="g">' . implode('', array_map(fn($k, $l) => '<option value="' . h((string)$k) . '"' . ((string)$k === $g ? ' selected' : '') . '>' . h($l) . '</option>', array_merge(['all', 'none'], array_column(all('select id from groups where user_id=?', [$uid]), 'id')), array_merge(['All contacts', 'Ungrouped'], array_column(all('select name from groups where user_id=?', [$uid]), 'name')))) . '</select></label><button class="btn alt" name="act" value="filter">Apply</button></div>'
        . ($rows ? '<ul class="plain">' . $rows . '</ul>' : '<p>' . ($total ? 'No contacts match.' : 'Your address book is empty. <a href="/contacts">Add contacts</a> first.') . '</p>')
        . '<div class="row"><button class="btn" name="act" value="add">Add selected recipients</button><a class="btn alt" href="/compose?id=' . $sid . '">Cancel</a></div></form>');
}

/** Explicit "save to address book" from a recipient already on a card. Never automatic. */
function r_save_contact(): void {
    $u = need_verified(); $uid = (int)$u['id'];
    if (post()) {
        $r = one('select r.* from recipients r join sends s on s.id=r.send_id where r.id=? and s.user_id=?', [(int)($_POST['rid'] ?? 0), $uid]);
        if ($r) {
            if (contact_dup($uid, $r['email'])) flash('That person is already in your address book.', 'warn');
            elseif ((int)one('select count(*) c from contacts where user_id=?', [$uid])['c'] >= contacts_max()) flash('Your address book is full.', 'err');
            else { q('insert into contacts(user_id,name,email,created,updated) values(?,?,?,?,?)', [$uid, $r['name'], norm_email($r['email']), time(), time()]); flash($r['name'] . ' saved to your address book.'); }
        }
    }
    redirect(safe_next($_POST['back'] ?? ''));
}
