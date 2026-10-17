<?php
// Bulk card send (administrators only): one card, a different message for each person, from a CSV file (Name, Email, Message).
// It uses the ordinary send queue, so opt outs, retries, the scheduler and the status page all behave as they do for any card.

const BULK_MAX = 200;

/** Read the uploaded file: [valid rows of [name, email, message], problems as text, how many data rows were seen]. A heading line is optional. */
function bulk_parse(string $path, string $default): array {
    $h = fopen($path, 'r'); $first = (string)fgets($h); rewind($h);
    $d = (str_contains($first, ';') && !str_contains($first, ',')) ? ';' : ',';
    $rows = []; $bad = []; $seen = []; $n = 0; $line = 0;
    while (($r = fgetcsv($h, 5000, $d, '"', '')) !== false) {
        $line++; if ($r === [null]) continue;
        $name = trim(preg_replace('/\s+/', ' ', ltrim((string)($r[0] ?? ''), "\xEF\xBB\xBF"))); $email = norm_email((string)($r[1] ?? '')); $msg = trim((string)($r[2] ?? ''));
        if ($line === 1 && strtolower($name) === 'name' && strtolower($email) === 'email') continue;
        $n++;
        if ($n > BULK_MAX) { $bad[] = 'Only the first ' . BULK_MAX . ' people are used; the rest of the file was left out.'; break; }
        $e = contact_errors($name, $email);
        if (!$e && isset($seen[email_key($email)])) $e['email'] = 'This address is already earlier in the file.';
        if (!$e && $msg === '' && $default === '') $e['message'] = 'No message on this line and no message to use instead.';
        if (!$e && mb_strlen($msg) > msg_max()) $e['message'] = 'The message is over ' . msg_max() . ' characters.';
        if (!$e && $msg !== '' && ($why = abuse_check($msg))) $e['message'] = ucfirst($why);
        if ($e) { $bad[] = "Line $line: " . implode(' ', $e); continue; }
        $seen[email_key($email)] = 1; $rows[] = [$name, $email, $msg];
    }
    fclose($h);
    return [$rows, $bad, $n];
}

function r_admin_bulk(): void {
    $u = need_admin(); if (!ops_admin()) fail(403, 'You do not have permission for that.'); $uid = (int)$u['id'];
    $sid = (int)($_GET['id'] ?? $_POST['id'] ?? 0); $s = null;
    if ($sid) { $s = own_send($sid); if (empty($s['bulk']) || $s['status'] !== 'draft') redirect($s['status'] === 'draft' ? '/compose?id=' . $sid : '/send?id=' . $sid); }
    if (post()) {
        $do = (string)($_POST['do'] ?? '');
        if ($do === 'upload' && !$s) {
            $card = field('card', 40); $from = field('sender_name', 120) ?: $u['name']; $default = trim((string)($_POST['message'] ?? '')); $f = $_FILES['csv'] ?? null; $e = [];
            if (!(cards()[$card]['on'] ?? false)) $e[] = 'Choose an available card.';
            if (mb_strlen($from) > name_max()) $e[] = 'Use ' . name_max() . ' characters or fewer for the From name.'; elseif ($why = abuse_check($from)) $e[] = ucfirst($why);
            if (mb_strlen($default) > msg_max()) $e[] = 'The message to use instead is over ' . msg_max() . ' characters.'; elseif ($default !== '' && ($why = abuse_check($default))) $e[] = ucfirst($why);
            if (!$f || $f['error'] !== UPLOAD_ERR_OK || $f['size'] > 300000 || !is_uploaded_file($f['tmp_name'])) $e[] = 'Choose a CSV file smaller than 300 KB.';
            if (!$e) {
                [$rows, $bad] = bulk_parse($f['tmp_name'], $default);
                if (!$rows) { $e[] = 'No one in the file could be used.'; foreach (array_slice($bad, 0, 10) as $b) $e[] = $b; }
                else {
                    q('insert into sends(user_id,card,sender_name,message,status,created,updated,bulk) values(?,?,?,?,?,?,?,1)', [$uid, $card, $from, $default !== '' ? $default : $rows[0][2], 'draft', time(), time()]); $sid = (int)db()->lastInsertId();
                    foreach ($rows as [$n, $em, $m]) q('insert into recipients(send_id,name,email,own_msg,token) values(?,?,?,?,?)', [$sid, $n, $em, $m, token()]);
                    audit($uid, 'bulk_draft', "send $sid: " . count($rows) . ' people, ' . count($bad) . ' lines not used'); $_SESSION['bulk_bad'][$sid] = array_slice($bad, 0, 30);
                    redirect('/admin/bulk?id=' . $sid);
                }
            }
            flash(implode(' ', array_slice($e, 0, 4)), 'err'); redirect('/admin/bulk');
        }
        if ($s && $do === 'discard') { q('delete from recipients where send_id=?', [$sid]); q('delete from sends where id=?', [$sid]); audit($uid, 'bulk_discard', "send $sid"); flash('Draft discarded. Nothing was sent.'); redirect('/admin/bulk'); }
        if ($s && $do === 'send') {
            if (!$u['verified']) { flash('Please verify your email before sending.', 'warn'); redirect("/admin/bulk?id=$sid"); }
            sender_gate($u, "/admin/bulk?id=$sid");
            if (sending_state() !== 'open') { flash('Card sending is not open right now. Your draft is saved.', 'warn'); redirect("/admin/bulk?id=$sid"); }
            if (!(cards()[$s['card']]['on'] ?? false)) { flash('That card is no longer available. Discard this draft and start again with another card.', 'err'); redirect("/admin/bulk?id=$sid"); }
            limit_for("submit:$uid", 5, 3600);
            $at = schedule_parse($_POST); if ($at === false) { flash('Choose a delivery time that is at least an hour from now and within 90 days, or send straight away.', 'err'); redirect("/admin/bulk?id=$sid"); }
            $cnt = (int)one('select count(*) n from recipients where send_id=?', [$sid])['n'];
            q('update sends set send_at=? where id=?', [$at, $sid]); queue_send($sid); audit($uid, 'bulk_send', "send $sid: $cnt people" . ($at ? ', scheduled' : ''));
            flash($at ? "$cnt cards are scheduled for " . date('j F \a\t H:i', $at) . '.' : "$cnt cards are queued for sending."); redirect("/send?id=$sid&done=1");
        }
        redirect('/admin/bulk' . ($s ? "?id=$sid" : ''));
    }
    if (!$s) { // step 1: the card, the wording and the file
        $opts = ''; foreach (gallery_cards() as $id => $c) $opts .= '<option value="' . h($id) . '">' . h($c['title']) . '</option>';
        admin_page('Bulk card send', '<h1>Bulk card send</h1><p class="lead">Send one card to everyone in a spreadsheet, each with their own message. You check the list before anything is sent.</p>'
            . '<form method="post" enctype="multipart/form-data" class="stack">' . csrf() . '<input type="hidden" name="do" value="upload">'
            . '<label>Card<select name="card">' . $opts . '</select></label>'
            . '<label>From<input name="sender_name" maxlength="' . (name_max() + 20) . '" value="' . h($u['name']) . '"></label>'
            . '<label>CSV file<input type="file" name="csv" accept=".csv,text/csv" required></label>'
            . '<label>Message for anyone with no message of their own (optional)<textarea name="message" rows="3" maxlength="' . msg_max() . '"></textarea></label>'
            . '<button class="btn">Check the file</button></form>'
            . '<h2>The file</h2><p>Save your spreadsheet as a CSV file with three columns: <strong>Name</strong>, <strong>Email</strong> and <strong>Message</strong>, one person on each line. A heading line saying Name, Email and Message is fine. Up to ' . BULK_MAX . ' people at a time, and up to ' . msg_max() . ' characters in each message. Anyone who has asked not to receive cards is skipped automatically. Sending is free, uses your own account, and goes through the normal queue.</p>'
            . '<pre>Name,Email,Message' . "\n" . 'Gran,gran@example.com,"Thank you for the wonderful scarf."' . "\n" . 'Sam,sam@example.com,"Good luck with the exams!"</pre>');
    }
    // step 2: check and send
    $rs = all('select * from recipients where send_id=? order by id', [$sid]); $own = count(array_filter($rs, fn($r) => trim((string)$r['own_msg']) !== '')); $stop = count(array_filter($rs, fn($r) => opted_out($r['email'], $uid)));
    $bad = $_SESSION['bulk_bad'][$sid] ?? []; $rows = '';
    foreach (array_slice($rs, 0, 10) as $r) $rows .= '<tr><td>' . h($r['name']) . '</td><td>' . h($r['email']) . '</td><td>' . h(mb_strimwidth(resolved_msg($r, $s), 0, 90, '...')) . '</td></tr>';
    admin_page('Check bulk send', '<h1>Check before sending</h1><div class="admincard row">' . card_art($s['card'], true) . '<p><strong>' . h(cards()[$s['card']]['title'] ?? '') . '</strong><br>From ' . h($s['sender_name']) . '<br>' . count($rs) . ' people, ' . $own . ' with their own message' . ($own < count($rs) ? ', ' . (count($rs) - $own) . ' with the shared message' : '') . '.</p></div>'
        . ($bad ? '<section class="flash warn" role="status"><h2>Lines not used</h2><ul>' . implode('', array_map(fn($b) => '<li>' . h($b) . '</li>', $bad)) . '</ul></section>' : '')
        . ($stop ? '<p class="note">' . $stop . ($stop === 1 ? ' person has' : ' people have') . ' asked not to receive cards and will be skipped automatically.</p>' : '')
        . '<h2>The first ' . min(10, count($rs)) . '</h2><table class="stacked"><tr><th>Name</th><th>Email</th><th>Message</th></tr>' . $rows . '</table>'
        . '<form method="post" class="stack">' . csrf() . '<input type="hidden" name="id" value="' . $sid . '">' . schedule_picker($s)
        . '<div class="row"><button class="btn big" name="do" value="send">Send ' . count($rs) . ' cards</button><button class="btn alt" name="do" value="discard">Discard this draft</button></div></form>'
        . '<p class="note">Each person gets their own private link. Large lists go out in batches, so the last cards can take a while. You can follow them, and cancel any that have not gone yet, on the card status page afterwards.</p>');
}
