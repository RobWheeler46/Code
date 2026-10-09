<?php
// Domain logic: recipients, queue, payments, opt-outs, status. No HTML here.
const MAX_RECIPIENTS = 20;

function msg_max(): int { return (int)setting('msg_max', '500'); }   // launch configuration: agree with Trustees
function name_max(): int { return (int)setting('name_max', '60'); }
function expiry_days(): int { return (int)setting('expiry_days', '60'); }

/** "Name, email" or "Name <email>" per line. Returns [valid rows, error strings]. */
function parse_recipients(string $text): array {
    $rows = []; $errs = []; $seen = [];
    foreach (preg_split('/\R/', $text) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        if (!preg_match('/^(.+?)\s*(?:,|<)\s*([^\s<>,]+)\s*>?$/u', $line, $m)) { $errs[] = "Could not read: $line"; continue; }
        $name = trim($m[1]); $email = strtolower($m[2]);
        if (mb_strlen($name) > 60 || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $errs[] = "Invalid name or email: $line"; continue; }
        if (isset($seen[$email])) { $errs[] = "$email appears more than once in this card"; continue; }
        $seen[$email] = 1;
        $rows[] = [$name, $email];
    }
    return [$rows, $errs];
}

function rstatus(array $r): string {
    if ($r['viewed_at']) return 'Viewed';
    if ($r['delivered_at']) return 'Delivered';
    if ($r['status'] === 'cancelled') return 'Cancelled';
    if (in_array($r['status'], ['failed', 'bounced'])) return 'Failed';
    if ($r['status'] === 'sent') return time() - (int)$r['sent_at'] > 172800 ? 'Delivery unconfirmed' : 'Sent'; // 48h without a provider delivery event
    if ($r['status'] === 'sending') return 'Delivery unconfirmed';
    return $r['status'] === 'draft' ? 'Draft' : 'Queued';
}
const STATUS_HELP = [
    'Queued' => 'Accepted and waiting to be sent.', 'Sent' => 'Accepted by the email service; inbox delivery is not confirmed.',
    'Delivered' => 'The email service confirmed delivery. This does not prove the card was read.', 'Viewed' => 'The recipient opened the card themselves.',
    'Failed' => 'The email could not be delivered. Correct the address to try again.', 'Delivery unconfirmed' => 'We have no delivery confirmation yet.',
    'Cancelled' => 'Cancelled before it was sent.'];

function card_link(array $r): string { return base_url() . '/c/' . $r['token']; }
function expiry_ts(array $r): int { return (int)$r['sent_at'] + 86400 * expiry_days(); }
function support_ref(array $r): string { return 'R-' . $r['id']; } // exposes no viewing token

// ---- campaign window (Europe/London); blank = unrestricted
function campaign_state(): string {
    $o = setting('opens'); $c = setting('closes');
    if ($o && time() < strtotime($o)) return 'before';
    if ($c && time() >= strtotime($c)) return 'closed';
    return 'open';
}

// ---- opt-outs (user_id 0 = every sender). Checked at dispatch, retry and resend.
function optout(string $email, int $userId): void { q('insert or ignore into optouts(email,user_id,created) values(?,?,?)', [strtolower($email), $userId, time()]); }
function opted_out(string $email, int $userId): bool { return (bool)one('select 1 from optouts where email=? and user_id in (0,?)', [strtolower($email), $userId]); }

/** Same recipient address already sent a card by this sender in another submission. */
function repeats_for(array $s): array {
    return array_column(all("select distinct r.email from recipients r join recipients o on o.email=r.email join sends so on so.id=o.send_id
        where r.send_id=? and so.user_id=? and so.id<>r.send_id and o.status not in ('draft','cancelled')", [$s['id'], $s['user_id']]), 'email');
}

/** Atomic: only wins if the delivery has not been claimed for dispatch. */
function cancel_recipient(int $rid): bool { return (bool)q("update recipients set status='cancelled' where id=? and status='queued'", [$rid])->rowCount(); }

/** Moves a draft (or abandoned payment attempt) to queued as a free send in one guarded step. */
function queue_send(int $sid): bool {
    db()->beginTransaction();
    $go = q("update sends set status='queued', queued_at=? where id=? and status in ('draft','awaiting_payment')", [time(), $sid])->rowCount();
    if ($go) q("update recipients set status='queued' where send_id=? and status='draft'", [$sid]);
    db()->commit();
    if ($go) process_queue();
    return (bool)$go;
}

/** Idempotent. A confirmation arriving after the parent chose free sending only records the donation; it never queues again. */
function confirm_payment(int $sid, string $cs, int $amt, string $acct = ''): bool {
    $s = one('select * from sends where id=?', [$sid]);
    if (!$s) return false;
    if ($amt !== (int)$s['donation']) { audit(null, 'payment_mismatch', "send $sid session $cs paid $amt expected {$s['donation']}"); return false; }
    db()->beginTransaction();
    $new = q('insert or ignore into donations(send_id,user_id,pence,stripe_session,account,created) values(?,?,?,?,?,?)', [$sid, $s['user_id'], $amt, $cs, $acct, time()])->rowCount();
    $go = q("update sends set status='queued', queued_at=? where id=? and status='awaiting_payment'", [time(), $sid])->rowCount();
    if ($go) q("update recipients set status='queued' where send_id=? and status='draft'", [$sid]);
    db()->commit();
    if ($new) {
        $u = one('select * from users where id=?', [$s['user_id']]);
        mail_send($u['email'], 'Your donation receipt: 7th Swindon Scouts',
            "Hello {$u['name']},\n\nThank you. We have received your donation of " . gbp($amt) . " to 7th Swindon Scouts.\nReference: $cs\n\n" . ($go ? 'Your Christmas cards are being sent.' : 'Your cards had already been queued; this donation did not trigger a second send.') . "\n\n7th Swindon Scouts");
    }
    if ($go) process_queue();
    return true;
}

function email_body(array $r, array $s): string {
    return "Dear {$r['name']},\n\n{$s['sender_name']} has sent you a Christmas card from 7th Swindon Scouts.\n\nOpen your card here:\n" . card_link($r)
        . "\n\nThis private link works for " . expiry_days() . " days.\n\nDo not want these? Stop cards from this sender or from the service:\n" . base_url() . '/optout/' . $r['token']
        . "\n\n7th Swindon Scouts";
}

/** Sends queued recipients. The 'sending' claim stops two workers sending the same card and loses races with cancellation. */
function process_queue(int $limit = 50): int {
    if (setting('paused') === '1') return 0;
    if (campaign_state() === 'closed' && setting('closure_queue') === 'hold') return 0;
    $n = 0;
    foreach (all("select r.id from recipients r where r.status='queued' order by r.id limit $limit") as $row) {
        if (!q("update recipients set status='sending', tries=tries+1 where id=? and status='queued'", [$row['id']])->rowCount()) continue;
        $r = one('select * from recipients where id=?', [$row['id']]);
        $s = one('select * from sends where id=?', [$r['send_id']]);
        if (opted_out($r['email'], (int)$s['user_id'])) { q("update recipients set status='cancelled', error='Recipient opted out' where id=?", [$r['id']]); continue; }
        $err = mail_send($r['email'], "{$s['sender_name']} sent you a Christmas card", email_body($r, $s), ['rid' => (string)$r['id']]);
        if ($err === null) { q("update recipients set status='sent', sent_at=?, error=null where id=?", [time(), $r['id']]); $n++; }
        else q('update recipients set status=?, error=? where id=?', [$r['tries'] >= 3 ? 'failed' : 'queued', $err, $r['id']]);
    }
    return $n;
}

/** Retention: blank card content and recipient details once the retention period has passed; drop stale anonymous drafts. */
function purge_old(): int {
    $cut = time() - 86400 * (int)setting('retention_days', '90');
    $ids = array_column(all("select id from sends where queued_at is not null and queued_at<? and message<>''", [$cut]), 'id');
    foreach ($ids as $id) {
        q("update sends set message='' where id=?", [$id]);
        q("update recipients set name='', email='deleted-'||id, token='gone-'||id where send_id=?", [$id]);
    }
    foreach (array_column(all('select id from sends where user_id=0 and updated<?', [time() - 7 * 86400]), 'id') as $id) {
        q('delete from recipients where send_id=?', [$id]); q('delete from sends where id=?', [$id]);
    }
    return count($ids);
}

/** A send belongs to its signed-in owner, or (anonymous draft) to the session that created it. */
function own_send(int $id): array {
    $u = user(); $s = one('select * from sends where id=?', [$id]);
    if ($s && (($u && (int)$s['user_id'] === (int)$u['id']) || ((int)$s['user_id'] === 0 && in_array($id, $_SESSION['drafts'] ?? [], true)))) return $s;
    fail(404, 'Card not found.');
}
function claim_drafts(int $uid): void {
    foreach ($_SESSION['drafts'] ?? [] as $id) q('update sends set user_id=? where id=? and user_id=0', [$uid, $id]);
    unset($_SESSION['drafts']);
}

/** Spreadsheet formula injection guard for free-text cells. */
function csv_text(string $s): string { return preg_match('/^[=+\-@\t\r]/', $s) ? "'" . $s : $s; }

function donation_state(array $s): string {
    if (one('select 1 from donations where send_id=?', [$s['id']])) return 'Donation confirmed: ' . gbp((int)$s['donation']);
    if ($s['status'] === 'awaiting_payment') return 'Donation payment pending: ' . gbp((int)$s['donation']);
    return 'No donation';
}
