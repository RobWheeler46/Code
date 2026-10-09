<?php
// Domain logic: recipients, queue, payments, status. No HTML here.
const MAX_RECIPIENTS = 20;

/** "Name, email" or "Name <email>" per line. Returns [valid rows, error strings]. */
function parse_recipients(string $text): array {
    $rows = []; $errs = []; $seen = [];
    foreach (preg_split('/\R/', $text) as $line) {
        $line = trim($line);
        if ($line === '') continue;
        if (!preg_match('/^(.+?)\s*(?:,|<)\s*([^\s<>,]+)\s*>?$/u', $line, $m)) { $errs[] = "Could not read: $line"; continue; }
        $name = trim($m[1]); $email = strtolower($m[2]);
        if (mb_strlen($name) > 60 || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $errs[] = "Invalid name or email: $line"; continue; }
        if (isset($seen[$email])) { $errs[] = "Duplicate email: $email"; continue; }
        $seen[$email] = 1;
        $rows[] = [$name, $email];
    }
    return [$rows, $errs];
}

function rstatus(array $r): string {
    if ($r['viewed_at']) return 'Viewed';
    if ($r['delivered_at']) return 'Delivered';
    if (in_array($r['status'], ['failed', 'bounced'])) return 'Failed';
    if ($r['status'] === 'sent') return 'Sent';
    if ($r['status'] === 'sending') return 'Uncertain';
    return $r['status'] === 'draft' ? 'Draft' : 'Queued';
}

function card_link(array $r): string { return base_url() . '/c/' . $r['token']; }
function expiry_ts(array $r): int { return (int)$r['sent_at'] + 86400 * (int)setting('expiry_days', '60'); }

/** Moves a draft to queued (free send) in one guarded step. Returns false if already queued. */
function queue_send(int $sid): bool {
    db()->beginTransaction();
    $go = q("update sends set status='queued', queued_at=? where id=? and status='draft'", [time(), $sid])->rowCount();
    if ($go) q("update recipients set status='queued' where send_id=? and status='draft'", [$sid]);
    db()->commit();
    if ($go) process_queue();
    return (bool)$go;
}

/** Idempotent: repeated webhooks / return-page hits create one donation and one dispatch. */
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
            "Hello {$u['name']},\n\nThank you. We have received your donation of " . gbp($amt) . " to 7th Swindon Scouts.\nReference: $cs\n\nYour Christmas cards are on their way.\n\n7th Swindon Scouts");
    }
    if ($go) process_queue();
    return true;
}

function email_body(array $r, array $s): string {
    return "Dear {$r['name']},\n\n{$s['sender_name']} has sent you a Christmas card from 7th Swindon Scouts.\n\nOpen your card here:\n" . card_link($r)
        . "\n\nThis private link works for " . (int)setting('expiry_days', '60') . " days. If you do not want cards like this, open the card and use the report link.\n\n7th Swindon Scouts";
}

/** Sends queued recipients. The 'sending' claim stops two workers sending the same card. */
function process_queue(int $limit = 50): int {
    if (setting('paused') === '1') return 0;
    $n = 0;
    foreach (all("select r.id from recipients r where r.status='queued' order by r.id limit $limit") as $row) {
        if (!q("update recipients set status='sending', tries=tries+1 where id=? and status='queued'", [$row['id']])->rowCount()) continue;
        $r = one('select * from recipients where id=?', [$row['id']]);
        $s = one('select * from sends where id=?', [$r['send_id']]);
        if (one('select 1 from suppressed where email=?', [$r['email']])) { q("update recipients set status='failed', error='Recipient has opted out' where id=?", [$r['id']]); continue; }
        $err = mail_send($r['email'], "{$s['sender_name']} sent you a Christmas card", email_body($r, $s), ['rid' => (string)$r['id']]);
        if ($err === null) { q("update recipients set status='sent', sent_at=?, error=null where id=?", [time(), $r['id']]); $n++; }
        else q('update recipients set status=?, error=? where id=?', [$r['tries'] >= 3 ? 'failed' : 'queued', $err, $r['id']]);
    }
    return $n;
}

/** Retention: blank card content and recipient details once the retention period has passed. */
function purge_old(): int {
    $cut = time() - 86400 * (int)setting('retention_days', '90');
    $ids = array_column(all("select id from sends where queued_at is not null and queued_at<? and message<>''", [$cut]), 'id');
    foreach ($ids as $id) {
        q("update sends set message='' where id=?", [$id]);
        q("update recipients set name='', email='deleted-'||id, token='gone-'||id where send_id=?", [$id]);
    }
    return count($ids);
}

function own_send(int $id): array {
    $s = one('select * from sends where id=? and user_id=?', [$id, user()['id']]);
    return $s ?: fail(404, 'Card not found.');
}
