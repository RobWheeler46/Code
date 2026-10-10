<?php
// Domain logic: recipients, queue, payments, opt-outs, status. No HTML here.
/** Recipient ceiling is configurable but never above the launch maximum of twenty. */
function max_recipients(): int { return max(1, min(20, (int)setting('max_recipients', '20'))); }

function msg_max(): int { return (int)setting('msg_max', '500'); }   // launch configuration: agree with Trustees
function name_max(): int { return (int)setting('name_max', '60'); }
function expiry_days(): int { return (int)setting('expiry_days', '60'); }

/** "Name, email" or "Name <email>" per line, optionally followed by " | personal message". Returns [rows of [name, email, override], error strings]. */
function parse_recipients(string $text): array {
    $rows = []; $errs = []; $seen = [];
    foreach (preg_split('/\R/', $text) as $line) {
        [$line, $own] = array_map('trim', explode('|', $line, 2) + [1 => '']);
        if ($line === '') continue;
        if (!preg_match('/^(.+?)\s*(?:,|<)\s*([^\s<>,]+)\s*>?$/u', $line, $m)) { $errs[] = "Could not read: $line"; continue; }
        $name = trim($m[1]); $email = norm_email($m[2]); $key = strtolower($email);
        if (mb_strlen($name) > 60 || !filter_var($email, FILTER_VALIDATE_EMAIL)) { $errs[] = "Invalid name or email: $line"; continue; }
        if (isset($seen[$key])) { $errs[] = "$email appears more than once in this card"; continue; }
        $seen[$key] = 1;
        if (mb_strlen($own) > msg_max()) { $errs[] = "Personal message for $name is over " . msg_max() . ' characters'; continue; }
        if ($own !== '' && ($bad = abuse_check($own))) { $errs[] = "Personal message for $name: $bad"; continue; }
        $rows[] = [$name, $email, $own];
    }
    return [$rows, $errs];
}

/** Per-recipient override wins; a shared edit never touches overrides. */
function resolved_msg(array $r, array $s): string { return trim((string)($r['own_msg'] ?? '')) !== '' ? $r['own_msg'] : $s['message']; }

/** Configurable abuse rules. Text is always rendered as escaped plain text; links are never made clickable. */
function abuse_check(string $text): ?string {
    if (setting('allow_urls') !== '1' && preg_match('~(https?:|www\.|[a-z0-9-]+\.(com|net|org|info|xyz|ru|top)\b)~i', $text)) return 'web addresses cannot be included in a card message.';
    foreach (array_filter(array_map('trim', explode(',', strtolower(setting('abuse_terms'))))) as $t)
        if (str_contains(strtolower($text), $t)) return 'that wording is not allowed in a card message. Please change it and try again.';
    return null;
}

const STARTERS = [
    'Wishing you a very merry Christmas and a happy, healthy New Year.',
    'Merry Christmas! Thinking of you and sending lots of love this festive season.',
    'Have an in-tents Christmas! Hope it is full of warmth, fun and good company.',
    'Be prepared for lots of mince pies. Merry Christmas from our family to yours!',
    'Thank you for a wonderful year. Wishing you peace and joy at Christmas.',
    'Even Santa needs a Scout! Hope your Christmas is full of adventure.',
];

/** Optional line on the card, only when the sender chose it and a verified payment exists. Never an amount. */
function card_note(array $s): string {
    return ($s['donation_note'] && one('select 1 from donations where send_id=?', [$s['id']])) ? 'This card came with a donation to 7th Swindon Scouts.' : '';
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
    // production stays locked while a launch Must decision is Open, unless a restricted administrator recorded an override
    if (env('APP_ENV', 'development') === 'production' && setting('launch_override') === '' && launch_blockers()) return 'locked';
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
    return array_column(all("select distinct r.email from recipients r join recipients o on lower(o.email)=lower(r.email) join sends so on so.id=o.send_id
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

function email_html(array $r, array $s): string {
    $e = fn($x) => htmlspecialchars((string)$x, ENT_QUOTES);
    $btn = 'display:inline-block;background:#f5b800;color:#041f3d;font-weight:bold;text-decoration:none;padding:12px 24px;border-radius:24px';
    return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c1230"><div style="background:#014493;color:#fff;padding:16px 20px;border-bottom:4px solid #f5b800;font-size:18px;font-weight:bold">7th Swindon Scouts Christmas Cards</div><div style="padding:20px">'
        . '<p>Dear ' . $e($r['name']) . ',</p><p><strong>' . $e($s['sender_name']) . '</strong> has sent you a Christmas card.</p>'
        . '<p><a href="' . $e(card_link($r)) . '" style="' . $btn . '">Open your card</a></p><p style="font-size:13px;color:#5c6470">Button not working? Copy this link: ' . $e(card_link($r)) . '<br>This private link works for ' . expiry_days() . ' days.</p>'
        . '<p style="font-size:13px;color:#5c6470"><a href="' . $e(base_url() . '/optout/' . $r['token']) . '">Stop cards from this sender or from the service</a> &middot; <a href="' . $e(base_url() . '/privacy') . '">Why did I get this? Privacy notice</a></p></div></div>';
}

function email_body(array $r, array $s): string {
    return "Dear {$r['name']},\n\n{$s['sender_name']} has sent you a Christmas card from 7th Swindon Scouts.\n\nOpen your card here:\n" . card_link($r)
        . "\n\nThis private link works for " . expiry_days() . " days.\n\nDo not want these? Stop cards from this sender or from the service:\n" . base_url() . '/optout/' . $r['token']
        . "\n\nWhy did I get this? A person you know asked us to send it. Privacy notice: " . base_url() . "/privacy"
        . "\n\n7th Swindon Scouts";
}

/** Sends queued recipients. The 'sending' claim stops two workers sending the same card and loses races with cancellation. */
function process_queue(int $limit = 50): int {
    if (setting('paused') === '1') return 0;
    if (campaign_state() === 'closed' && setting('closure_queue') === 'hold') return 0;
    $n = 0;
    foreach (all("select r.id from recipients r where r.status='queued' and r.next_at<=? order by r.id limit $limit", [time()]) as $row) {
        if (!q("update recipients set status='sending', tries=tries+1 where id=? and status='queued'", [$row['id']])->rowCount()) continue;
        $r = one('select * from recipients where id=?', [$row['id']]);
        $s = one('select * from sends where id=?', [$r['send_id']]);
        if (one('select 1 from users where id=? and suspended=1', [$s['user_id']])) { q("update recipients set status='cancelled', error='Account suspended' where id=?", [$r['id']]); continue; }
        if (opted_out($r['email'], (int)$s['user_id'])) { q("update recipients set status='cancelled', error='Recipient opted out' where id=?", [$r['id']]); continue; }
        $err = mail_send($r['email'], "{$s['sender_name']} sent you a Christmas card", email_body($r, $s), ['rid' => (string)$r['id']], email_html($r, $s), $s['sender_name']);
        if ($err === null) { q("update recipients set status='sent', sent_at=?, error=null where id=?", [time(), $r['id']]); $n++; }
        elseif (str_starts_with($err, 'UNKNOWN:')) q("update recipients set error=? where id=?", [substr($err, 8), $r['id']]);  // stays 'sending': provider may have accepted it, so never auto-repeat
        elseif (str_starts_with($err, 'PERM:')) q("update recipients set status='failed', error=? where id=?", [substr($err, 5), $r['id']]); // permanent: no automatic retry
        elseif ($r['tries'] >= 4) q("update recipients set status='failed', error=? where id=?", [$err . ' (retries used up; needs support review)', $r['id']]); // original attempt + 3 retries
        else q("update recipients set status='queued', error=?, next_at=? where id=?", [$err, time() + [60, 300, 1800][$r['tries'] - 1], $r['id']]);
    }
    return $n;
}

/** FR-124: the only way to retry a delivery after failure or uncertainty. Fresh private token (the old link stops working), audited, race-safe. */
function requeue_recipient(int $rid, ?string $newEmail, int $actor, string $via): bool {
    $r = one('select * from recipients where id=?', [$rid]);
    if (!$r || !(in_array($r['status'], ['failed', 'bounced']) || rstatus($r) === 'Delivery unconfirmed')) return false;
    $email = $newEmail === null ? $r['email'] : norm_email($newEmail);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) return false;
    $ok = q("update recipients set email=?, token=?, status='queued', tries=0, next_at=0, error=null, delivered_at=null, sent_at=null where id=? and status=? and token=?", [$email, token(), $rid, $r['status'], $r['token']])->rowCount();
    if ($ok) audit($actor, 'address_correction', "recipient $rid via $via: {$r['email']} -> $email; previous link revoked");
    return (bool)$ok;
}

/** Link scanners and previewers must not count as a human view. */
function is_scanner(): bool { return (bool)preg_match('/bot|crawl|spider|preview|scan|safelinks|proofpoint|barracuda|mimecast|office|headless|curl|python|go-http/i', $_SERVER['HTTP_USER_AGENT'] ?? ''); }

/** FR-059: copy design, greeting and From name into a new unsent draft. Only explicitly chosen recipients come along (fresh tokens, no status). */
function copy_send(int $fromId, int $uid, array $recipientIds): int {
    $s = one('select * from sends where id=? and user_id=?', [$fromId, $uid]);
    if (!$s) return 0;
    q('insert into sends(user_id,card,sender_name,message,created,updated) values(?,?,?,?,?,?)', [$uid, $s['card'], $s['sender_name'], $s['message'], time(), time()]);
    $new = (int)db()->lastInsertId();
    foreach ($recipientIds as $rid) if ($r = one('select * from recipients where id=? and send_id=?', [(int)$rid, $fromId]))
        q('insert into recipients(send_id,name,email,own_msg,token) values(?,?,?,?,?)', [$new, $r['name'], $r['email'], $r['own_msg'], token()]);
    return $new;
}

/** FR-065: optional, off by default. Only the first qualifying view of each card notifies, and the wording does not overclaim. */
function notify_view(array $r, array $s): void {
    $u = one('select * from users where id=?', [$s['user_id']]);
    if ($u && $u['notify'] === 'viewed') mail_send($u['email'], 'A card you sent was opened', "{$r['name']} opened the card from you ({$s['sender_name']}). That is a good sign it was seen, but we cannot be certain who opened it.\n\nSee all your cards, or change these emails: " . base_url() . "/dashboard\n");
}
/** Daily summary for users who chose it; sends nothing if nothing changed. Run from cron. */
function send_digests(): int {
    $n = 0;
    foreach (all("select * from users where notify='summary'") as $u) {
        $lines = [];
        foreach (all('select r.* from recipients r join sends s on s.id=r.send_id where s.user_id=? and (r.sent_at>? or r.viewed_at>?)', [$u['id'], time() - 86400, time() - 86400]) as $r) $lines[] = "{$r['name']}: " . rstatus($r);
        if ($lines) { mail_send($u['email'], 'Your Christmas card summary', "In the last day:\n" . implode("\n", $lines) . "\n\nSee details or change these emails: " . base_url() . "/dashboard\n"); $n++; }
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
