<?php
// SL-01 to SL-09 (build pack v2.9): section leaders suggest wording for the members of their own section, a Trustee decides.
// Safe defaults from docs/V29_GAP_ANALYSIS.md are used where the Trustees have not decided (D-T5: one current assignment per leader, one suggestion per member;
// D-T7: a deadline per section). The roster holds first names only: no surname, age, address, guardian or email, so a leader can never see contact details.
// Switched off by default. The tables are only created once the switch is on, so an install that never uses this holds no member data.

const SL_DEFAULT_WORDS = 80;

function sl_can(?array $u = null): bool { $u ??= user(); return $u && $u['is_admin'] && in_array('slleader', explode(',', (string)$u['roles']), true); }
/** Roles that may see the roster and the queue: every Trustee greeting role except the private dispatch operator. */
function sl_trustee_view(): bool { return can_any('tgeditor', 'tgreviewer', 'tgapprover'); }
function sl_on(): bool { return pf_on('private_trustee_greetings') && pf_on('private_section_greetings'); }
function sl_words(): int { return max(10, min(300, (int)(setting('sl_max_words') ?: SL_DEFAULT_WORDS))); }

function sl_schema(): void {
    static $done = false; if ($done) return; $done = true;
    foreach ([
        'create table if not exists gm_section(id integer primary key autoincrement, name text unique, deadline int, closed int default 0)',
        'create table if not exists gm_person(id integer primary key autoincrement, section_id int, first_name text, eligible int default 1, unique(section_id, first_name))',
        'create table if not exists gm_assign(user_id int primary key, section_id int, until int, created int)',
        'create table if not exists gm_sugg(id integer primary key autoincrement, person_id int unique, status text default \'draft\', rev int default 0, updated int)',
        'create table if not exists gm_rev(id integer primary key autoincrement, sugg_id int, rev int, body text, created int, unique(sugg_id, rev))',
        'create table if not exists gm_decision(id integer primary key autoincrement, sugg_id int, rev int, user_id int, outcome text, feedback text, created int)',
        'create table if not exists gm_draft(person_id int primary key, body text, sugg_id int, rev int, created int)',
    ] as $s) db()->exec($s);
}

/** Leader gate. Anyone not allowed gets the same "Page not found" as a page that does not exist. */
function sl_leader_gate(): array {
    $u = user(); if (!$u || !sl_can($u) || !sl_on()) fail(404, 'Page not found.');
    need_admin(); sl_schema(); return $u;
}
function sl_trustee_gate(string ...$roles): array {
    $u = user(); if (!$u || !$u['is_admin'] || !sl_on() || !($roles ? can_any(...$roles) : sl_trustee_view())) fail(404, 'Page not found.');
    need_admin(); sl_schema(); return $u;
}
/** The leader's one current section, checked on the server every time. A lapsed or removed assignment gives nothing. */
function sl_section(int $uid): ?array {
    return one('select s.* from gm_assign a join gm_section s on s.id=a.section_id where a.user_id=? and (a.until is null or a.until>?)', [$uid, time()]);
}
function sl_open(array $sec): bool { return !$sec['closed'] && (!$sec['deadline'] || (int)$sec['deadline'] > time()); }
function sl_clean(string $t): string { return trim(preg_replace('/[^\P{C}\n]+/u', '', str_replace("\r", '', $t))); }
function sl_wordcount(string $t): int { return count(preg_split('/\s+/u', trim($t), -1, PREG_SPLIT_NO_EMPTY)); }
/** Submitted suggestions still waiting for a decision. A batch approval (TG-07) must refuse while this is above zero. */
function sl_pending_count(): int { sl_schema(); return (int)one("select count(*) n from gm_sugg where status='submitted'")['n']; }
function sl_status_label(string $s): string { return ['none' => 'Not started', 'draft' => 'Draft', 'submitted' => 'Waiting for a Trustee', 'changes' => 'Changes requested', 'accepted' => 'Accepted', 'declined' => 'Declined'][$s] ?? $s; }
function sl_latest(int $sid): ?array { return one('select r.* from gm_rev r join gm_sugg s on s.id=r.sugg_id and r.rev=s.rev where s.id=?', [$sid]); }

// ---------- leader screens
function r_sl_list(): void {
    $u = sl_leader_gate(); $sec = sl_section((int)$u['id']);
    if (!$sec) admin_page('Suggest messages', '<h1>Suggest messages</h1><p class="flash warn" role="status">You are not assigned to a section at the moment. A Trustee can assign you.</p>');
    $rows = all('select p.id, p.first_name, s.status, s.id sid from gm_person p left join gm_sugg s on s.person_id=p.id where p.section_id=? and p.eligible=1 order by p.first_name', [$sec['id']]);
    $b = '<h1>Suggest messages</h1><p class="lead">Your section: <strong>' . h($sec['name']) . '</strong>. Suggest a short, kind message for each member. A Trustee reads every suggestion and decides. Nothing is sent because you wrote it.</p>'
        . '<p class="note">' . (sl_open($sec) ? ($sec['deadline'] ? 'Suggestions close on ' . h(when((int)$sec['deadline'])) . '.' : 'No deadline has been set.') : '<strong>Suggestions are closed for your section.</strong> A Trustee can reopen them.') . '</p>';
    if (!$rows) $b .= '<p class="note">No members have been added to your section yet.</p>';
    else { $b .= '<ul class="wscards plain">'; foreach ($rows as $r) $b .= '<li><a class="wscard" href="/private/section-suggestions/edit?p=' . (int)$r['id'] . '"><strong>' . h($r['first_name']) . '</strong><span>' . h(sl_status_label($r['status'] ?? 'none')) . '</span></a></li>'; $b .= '</ul>'; }
    admin_page('Suggest messages', $b);
}

function sl_person_for(array $u, int $pid): array { // the leader's own section only: anything else looks like a missing page
    $sec = sl_section((int)$u['id']); $p = $sec ? one('select * from gm_person where id=? and section_id=? and eligible=1', [$pid, $sec['id']]) : null;
    if (!$p) fail(404, 'Page not found.'); return [$sec, $p];
}

function r_sl_edit(): void {
    $u = sl_leader_gate(); [$sec, $p] = sl_person_for($u, (int)($_GET['p'] ?? 0));
    $s = one('select * from gm_sugg where person_id=?', [$p['id']]) ?: ['id' => 0, 'status' => 'none', 'rev' => 0]; $cur = $s['id'] ? sl_latest((int)$s['id']) : null;
    $editable = in_array($s['status'], ['none', 'draft', 'changes'], true) && sl_open($sec);
    $b = '<h1>Message for ' . h($p['first_name']) . '</h1><p><a href="/private/section-suggestions">Back to your section</a></p><p><strong>Status:</strong> ' . h(sl_status_label($s['status'])) . '</p>';
    if ($s['status'] === 'changes' && ($d = one('select feedback from gm_decision where sugg_id=? order by id desc', [$s['id']]))) $b .= '<section class="admincard"><h2>Trustee feedback</h2><p>' . nl2br(h($d['feedback'])) . '</p></section>';
    if ($editable) $b .= '<form method="post" action="/private/section-suggestions/save" class="stack">' . csrf() . '<input type="hidden" name="p" value="' . (int)$p['id'] . '"><input type="hidden" name="rev" value="' . (int)$s['rev'] . '">'
        . '<label>Your suggested message (up to ' . sl_words() . ' words)<textarea name="body" rows="6" required>' . h($cur['body'] ?? '') . '</textarea></label><p class="note">Plain text only. Do not add surnames, addresses or contact details.</p>'
        . '<button class="btn alt" name="do" value="save">Save draft</button> <button class="btn" name="do" value="submit">Submit to the Trustees</button></form>';
    else $b .= ($cur ? '<section class="admincard"><h2>Your message</h2><p>' . nl2br(h($cur['body'])) . '</p></section>' : '') . '<p class="note">' . (sl_open($sec) ? 'This suggestion is with the Trustees, so it cannot be changed now.' : 'Suggestions are closed for your section.') . '</p>';
    admin_page('Message for ' . $p['first_name'], $b);
}

function r_sl_save(): void {
    $u = sl_leader_gate(); if (!post()) redirect('/private/section-suggestions'); [$sec, $p] = sl_person_for($u, (int)($_POST['p'] ?? 0));
    $back = '/private/section-suggestions/edit?p=' . (int)$p['id']; $body = sl_clean((string)($_POST['body'] ?? '')); $submit = ($_POST['do'] ?? '') === 'submit';
    $s = one('select * from gm_sugg where person_id=?', [$p['id']]);
    if (!sl_open($sec)) { flash('Suggestions are closed for your section.', 'err'); redirect($back); }
    if ($s && !in_array($s['status'], ['draft', 'changes'], true)) { flash('This suggestion cannot be changed now.', 'err'); redirect($back); }
    if ((int)($_POST['rev'] ?? -1) !== (int)($s['rev'] ?? 0)) { flash('This message changed while you were editing. Reload it and try again.', 'err'); redirect($back); }
    if ($body === '' || sl_wordcount($body) > sl_words() || mb_strlen($body) > 1200) { flash('Write a message of up to ' . sl_words() . ' words.', 'err'); redirect($back); }
    if (preg_match('/@|https?:|www\./i', $body)) { flash('Please remove email addresses and links.', 'err'); redirect($back); }
    db()->beginTransaction();
    if (!$s) { q('insert into gm_sugg(person_id,status,rev,updated) values(?,?,0,?)', [$p['id'], 'draft', time()]); $s = one('select * from gm_sugg where person_id=?', [$p['id']]); }
    $rev = (int)$s['rev'] + 1; q('insert into gm_rev(sugg_id,rev,body,created) values(?,?,?,?)', [$s['id'], $rev, $body, time()]);
    q('update gm_sugg set rev=?, status=?, updated=? where id=?', [$rev, $submit ? 'submitted' : 'draft', time(), $s['id']]);
    audit((int)$u['id'], $submit ? 'sl_submit' : 'sl_save', "suggestion {$s['id']} revision $rev"); db()->commit();
    flash($submit ? 'Submitted to the Trustees.' : 'Draft saved.'); redirect($submit ? '/private/section-suggestions' : $back);
}

// ---------- Trustee screens
function r_sl_queue(): void {
    $u = sl_trustee_gate(); $manage = can_any('tgeditor', 'tgapprover'); $decide = can_any('tgreviewer', 'tgapprover');
    $b = '<h1>Section leader suggestions</h1><p><a href="/private/trustee-greetings">Back to Trustee greetings</a></p><p class="lead">Nothing a leader writes is used until a Trustee accepts it, and accepting only places it in a draft. It is never sent from here.</p>'
        . '<h2>Progress by section</h2>';
    $secs = all('select * from gm_section order by name');
    if (!$secs) $b .= '<p class="note">No sections yet.' . ($manage ? ' Add the roster below.' : '') . '</p>';
    else { $b .= '<table class="stacked"><tr><th>Section</th><th>Members</th><th>Submitted</th><th>Accepted</th><th>Changes asked</th><th>Declined</th><th>Not started</th><th>Closes</th></tr>';
        foreach ($secs as $s) { $c = array_column(all('select coalesce(g.status,\'none\') st, count(*) n from gm_person p left join gm_sugg g on g.person_id=p.id where p.section_id=? and p.eligible=1 group by st', [$s['id']]), 'n', 'st'); $n = array_sum($c);
            $b .= '<tr><td>' . h($s['name']) . '</td><td>' . $n . '</td><td>' . (int)($c['submitted'] ?? 0) . '</td><td>' . (int)($c['accepted'] ?? 0) . '</td><td>' . (int)($c['changes'] ?? 0) . '</td><td>' . (int)($c['declined'] ?? 0) . '</td><td>' . ((int)($c['none'] ?? 0) + (int)($c['draft'] ?? 0)) . '</td><td>' . h($s['closed'] ? 'Closed' : ($s['deadline'] ? when((int)$s['deadline']) : 'No deadline')) . '</td></tr>'; }
        $b .= '</table>'; }
    $b .= '<h2>Waiting for a decision</h2>';
    $q = all("select g.id, g.rev, p.first_name, s.name section, r.body from gm_sugg g join gm_person p on p.id=g.person_id join gm_section s on s.id=p.section_id join gm_rev r on r.sugg_id=g.id and r.rev=g.rev where g.status='submitted' order by s.name, p.first_name");
    if (!$q) $b .= '<p class="note">Nothing is waiting.</p>';
    foreach ($q as $r) {
        $b .= '<section class="admincard"><h3>' . h($r['first_name']) . ' <small>(' . h($r['section']) . ')</small></h3><blockquote>' . nl2br(h($r['body'])) . '</blockquote>';
        $b .= $decide ? '<form method="post" action="/private/trustee-greetings/suggestions/decide" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . (int)$r['id'] . '"><input type="hidden" name="rev" value="' . (int)$r['rev'] . '"><label>Feedback to the leader (needed to ask for changes or decline)<textarea name="feedback" rows="2" maxlength="500"></textarea></label>'
            . '<button class="btn" name="outcome" value="accept">Accept into a draft</button> <button class="btn alt" name="outcome" value="changes">Ask for changes</button> <button class="btn alt" name="outcome" value="decline">Decline</button></form>' : '<p class="note">Your role can read this but not decide.</p>';
        $b .= '</section>';
    }
    if ($manage) {
        $b .= '<h2>Roster</h2><form method="post" action="/private/trustee-greetings/suggestions/roster" class="stack">' . csrf() . '<label>One member per line: section, then first name (for example <code>Cubs, Sam</code>). First names only. No surnames, ages, addresses or email addresses.<textarea name="roster" rows="6" required></textarea></label><button class="btn alt">Add to the roster</button></form>'
            . '<h2>Assign a leader</h2><form method="post" action="/private/trustee-greetings/suggestions/assign" class="stack">' . csrf() . '<label>Leader\'s sign in email (they must hold the Section leader role)<input type="email" name="email" required></label><label>Section<select name="section_id">';
        foreach ($secs as $s) $b .= '<option value="' . (int)$s['id'] . '">' . h($s['name']) . '</option>';
        $b .= '</select></label><label>Until (optional)<input type="date" name="until"></label><button class="btn alt">Assign</button> <button class="btn alt" name="remove" value="1">Remove assignment</button></form>';
        if ($secs) { $b .= '<h2>Deadline</h2><form method="post" action="/private/trustee-greetings/suggestions/deadline" class="stack">' . csrf() . '<label>Section<select name="section_id">'; foreach ($secs as $s) $b .= '<option value="' . (int)$s['id'] . '">' . h($s['name']) . '</option>';
            $b .= '</select></label><label>Closes on (blank for no deadline)<input type="datetime-local" name="deadline"></label><button class="btn alt" name="do" value="set">Set deadline</button> <button class="btn alt" name="do" value="close">Close now</button> <button class="btn alt" name="do" value="reopen">Reopen</button></form>'; }
    }
    if (can('tgapprover')) $b .= '<h2>Erase</h2><form method="post" action="/private/trustee-greetings/suggestions/erase" class="stack">' . csrf() . '<p>Removes the whole roster, every suggestion, decision and draft. It cannot be undone.</p><label>Type ERASE to confirm<input name="confirm" autocomplete="off"></label><button class="btn alt">Erase everything</button></form>';
    admin_page('Section leader suggestions', $b);
}

function r_sl_decide(): void {
    $u = sl_trustee_gate('tgreviewer', 'tgapprover'); if (!post()) redirect('/private/trustee-greetings/suggestions');
    $id = (int)($_POST['id'] ?? 0); $rev = (int)($_POST['rev'] ?? 0); $out = (string)($_POST['outcome'] ?? ''); $fb = sl_clean(field('feedback', 500)); $back = '/private/trustee-greetings/suggestions';
    $map = ['accept' => 'accepted', 'changes' => 'changes', 'decline' => 'declined'];
    if (!isset($map[$out])) fail(400, 'Unknown decision.');
    if ($out !== 'accept' && $fb === '') { flash('Say why, so the leader knows what to do.', 'err'); redirect($back); }
    db()->beginTransaction();
    $s = one("select * from gm_sugg where id=? and status='submitted' and rev=?", [$id, $rev]); // decisions apply to the exact revision that was read
    if (!$s) { db()->rollBack(); flash('That suggestion has changed or was already decided.', 'err'); redirect($back); }
    $body = sl_latest($id)['body'];
    q('update gm_sugg set status=?, updated=? where id=?', [$map[$out], time(), $id]); q('insert into gm_decision(sugg_id,rev,user_id,outcome,feedback,created) values(?,?,?,?,?,?)', [$id, $rev, $u['id'], $out, $fb, time()]);
    if ($out === 'accept') q('insert or replace into gm_draft(person_id,body,sugg_id,rev,created) values(?,?,?,?,?)', [$s['person_id'], $body, $id, $rev, time()]);
    audit((int)$u['id'], 'sl_decision', "suggestion $id revision $rev: $out"); db()->commit();
    flash('Recorded.'); redirect($back);
}

function r_sl_roster(): void {
    $u = sl_trustee_gate('tgeditor', 'tgapprover'); if (!post()) redirect('/private/trustee-greetings/suggestions'); $n = 0; $bad = 0; $lines = array_slice(preg_split('/\R/', (string)($_POST['roster'] ?? '')), 0, 500);
    foreach ($lines as $l) {
        if (trim($l) === '') continue; $parts = array_map('trim', explode(',', $l));
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '' || str_contains($l, '@') || preg_match('/\d/', $parts[1]) || mb_strlen($parts[0]) > 40 || mb_strlen($parts[1]) > 40 || preg_match('/\s/', $parts[1])) { $bad++; continue; }
        q('insert or ignore into gm_section(name) values(?)', [$parts[0]]); $sid = (int)one('select id from gm_section where name=?', [$parts[0]])['id'];
        $n += q('insert or ignore into gm_person(section_id,first_name) values(?,?)', [$sid, $parts[1]])->rowCount();
    }
    audit((int)$u['id'], 'sl_roster', "$n added, $bad lines refused"); flash("$n added." . ($bad ? " $bad lines were refused: each needs a section and one first name, with no @ and no numbers in the name." : ''), $bad ? 'warn' : 'ok'); redirect('/private/trustee-greetings/suggestions');
}

function r_sl_assign(): void {
    $u = sl_trustee_gate('tgeditor', 'tgapprover'); if (!post()) redirect('/private/trustee-greetings/suggestions'); $back = '/private/trustee-greetings/suggestions';
    $l = one('select id, roles, is_admin from users where email=?', [strtolower(field('email', 200))]);
    if (!$l || !sl_can($l)) { flash('That person does not hold the Section leader role. A restricted administrator can invite them with it.', 'err'); redirect($back); }
    if (!empty($_POST['remove'])) { q('delete from gm_assign where user_id=?', [$l['id']]); audit((int)$u['id'], 'sl_unassign', "leader {$l['id']}"); flash('Assignment removed. Access ended immediately.'); redirect($back); }
    $sec = one('select id from gm_section where id=?', [(int)($_POST['section_id'] ?? 0)]); $until = ($_POST['until'] ?? '') !== '' ? strtotime((string)$_POST['until'] . ' 23:59:59') : null;
    if (!$sec || (($_POST['until'] ?? '') !== '' && !$until)) { flash('Choose a section and a valid date.', 'err'); redirect($back); }
    q('insert or replace into gm_assign(user_id,section_id,until,created) values(?,?,?,?)', [$l['id'], $sec['id'], $until, time()]); // one current assignment per leader: replacing it revokes the old one
    audit((int)$u['id'], 'sl_assign', "leader {$l['id']} to section {$sec['id']}"); flash('Assigned.'); redirect($back);
}

function r_sl_deadline(): void {
    $u = sl_trustee_gate('tgeditor', 'tgapprover'); if (!post()) redirect('/private/trustee-greetings/suggestions'); $id = (int)($_POST['section_id'] ?? 0); $do = (string)($_POST['do'] ?? '');
    if (!one('select 1 from gm_section where id=?', [$id])) fail(404, 'Page not found.');
    if ($do === 'close') q('update gm_section set closed=1 where id=?', [$id]); elseif ($do === 'reopen') q('update gm_section set closed=0 where id=?', [$id]);
    else { $d = trim((string)($_POST['deadline'] ?? '')); $t = $d === '' ? null : strtotime($d); if ($d !== '' && !$t) { flash('That date is not valid.', 'err'); redirect('/private/trustee-greetings/suggestions'); } q('update gm_section set deadline=? where id=?', [$t, $id]); }
    audit((int)$u['id'], 'sl_deadline', "section $id: $do"); flash('Saved.'); redirect('/private/trustee-greetings/suggestions');
}

function r_sl_erase(): void {
    $u = sl_trustee_gate('tgapprover'); if (!post() || ($_POST['confirm'] ?? '') !== 'ERASE') { flash('Type ERASE to confirm.', 'err'); redirect('/private/trustee-greetings/suggestions'); }
    foreach (['gm_draft', 'gm_decision', 'gm_rev', 'gm_sugg', 'gm_assign', 'gm_person', 'gm_section'] as $t) db()->exec("delete from $t");
    audit((int)$u['id'], 'sl_erase', 'roster, suggestions, decisions and drafts erased'); flash('Everything was erased.'); redirect('/private/trustee-greetings/suggestions');
}
