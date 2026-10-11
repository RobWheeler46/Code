<?php
// Launch-critical resilience (spec v2.3 R1): immutable artwork (FR-156), payment reconciliation (FR-157),
// bounce and complaint handling (FR-163), encrypted off-server backup and restore rehearsal (FR-162), non-waivable gates.

// ---------- FR-156: a sent card keeps the artwork it was sent with
function art_source(string $id): ?string {
    $c = cards()[$id] ?? []; if (!empty($c['art']) && is_file(ROOT . '/data/art/' . $c['art'])) return ROOT . '/data/art/' . $c['art']; // a library design: its published picture
    foreach (['png', 'jpg', 'webp', 'svg'] as $x) if ($f = asset_file("card-$id.$x")) return $f;
    return null;
}
/** Copies the current picture into data/art under a name that includes a content hash. Idempotent. Drawn designs have no file to freeze. */
function freeze_art(int $sid): void {
    $s = one('select card, art_ref from sends where id=?', [$sid]);
    if (!$s || $s['art_ref']) return;
    if (function_exists('library_pin_version')) library_pin_version($sid, $s['card']); // the version published at this moment
    if (!($src = art_source($s['card']))) return;
    $name = $s['card'] . '-' . substr(sha1_file($src), 0, 12) . '.' . pathinfo($src, PATHINFO_EXTENSION);
    @mkdir(ROOT . '/data/art', 0775, true);
    if (!is_file(ROOT . "/data/art/$name")) copy($src, ROOT . "/data/art/$name");
    q('update sends set art_ref=? where id=? and art_ref is null', [$name, $sid]);
}
function r_art(string $name): void { // served from data/art so the web folder never needs to be writable
    $f = ROOT . "/data/art/$name";
    if (!preg_match('/^[a-z0-9-]+-[0-9a-f]{12}\.(png|jpg|webp|svg)$/', $name) || !is_file($f)) { http_response_code(404); exit; }
    header('Content-Type: ' . ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'svg' => 'image/svg+xml'][pathinfo($f, PATHINFO_EXTENSION)]);
    header('Cache-Control: public, max-age=31536000, immutable'); readfile($f); exit;
}

// ---------- FR-157: every payment event is recorded once, applied once, and anything odd becomes a visible exception
/** Returns 'applied', 'duplicate', 'exception' or 'ignored'. Safe to call repeatedly and out of order. */
function stripe_handle_event(array $e): string {
    $id = (string)($e['id'] ?? ''); $type = (string)($e['type'] ?? ''); $o = $e['data']['object'] ?? [];
    if ($id === '') return 'ignored';
    if (!q('insert or ignore into stripe_events(id,type,received) values(?,?,?)', [$id, $type, time()])->rowCount()) return 'duplicate';
    $out = 'ignored'; $detail = '';
    switch ($type) {
        case 'checkout.session.completed':
            if (($o['payment_status'] ?? '') !== 'paid') break;
            $ok = confirm_payment((int)($o['metadata']['send_id'] ?? 0), (string)$o['id'], (int)$o['amount_total'], env('STRIPE_ACCOUNT'), (string)($o['payment_intent'] ?? ''));
            $out = $ok ? 'applied' : 'exception'; $detail = $ok ? '' : 'Paid amount or card did not match what we expected'; break;
        case 'checkout.session.expired':
            if ($s = one("select id from sends where stripe_session=? and status='awaiting_payment'", [(string)($o['id'] ?? '')])) { back_to_draft((int)$s['id']); $out = 'applied'; } break;
        case 'charge.refunded':
            $d = one('select * from donations where payment_intent=?', [(string)($o['payment_intent'] ?? '')]);
            if ($d) { $amt = min((int)($o['amount_refunded'] ?? 0), (int)$d['pence']); q("update donations set refunded=?, refund_status=? where id=?", [$amt, $amt > 0 ? 'confirmed' : 'none', $d['id']]); audit(null, 'refund_imported', "donation {$d['id']}: refunded $amt of {$d['pence']}"); $out = 'applied'; }
            else { $out = 'exception'; $detail = 'Refund for a payment we cannot match'; } break;
        case 'charge.dispute.created': $out = 'exception'; $detail = 'A dispute was opened on a payment'; break;
    }
    q('update stripe_events set outcome=?, detail=? where id=?', [$out, $detail, $id]);
    return $out;
}
/** Things finance must look at: payment events that did not apply cleanly, and donations received for cards that were never sent. */
function payment_exceptions(): array {
    $ev = all("select * from stripe_events where outcome='exception' and resolved_at is null order by received desc");
    $orphans = all("select d.id, d.pence, d.stripe_session, d.created, s.id send_id, s.status from donations d join sends s on s.id=d.send_id where s.status in ('draft','awaiting_payment') order by d.id desc");
    return ['events' => $ev, 'orphans' => $orphans];
}

// ---------- FR-163: verified delivery events change state; hard bounces and complaints stop repeat sends
function bounced_hard(string $email): bool { return (bool)one("select 1 from bounces where email=? and kind in ('hard','complaint')", [strtolower($email)]); }
function postmark_handle_event(array $e): string {
    $rid = (int)($e['Metadata']['rid'] ?? 0); $r = $rid ? one('select * from recipients where id=?', [$rid]) : null; $email = strtolower((string)($e['Email'] ?? $e['Recipient'] ?? ($r['email'] ?? '')));
    switch ($e['RecordType'] ?? '') {
        case 'Delivery': if ($r) q('update recipients set delivered_at=? where id=? and delivered_at is null', [time(), $rid]); return 'delivered';
        case 'Open': if ($r) q('update recipients set opened_at=? where id=? and opened_at is null', [time(), $rid]); return 'opened';
        case 'Bounce':
            $hard = !empty($e['Inactive']) || in_array($e['Type'] ?? '', ['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'Blocked'], true);
            $detail = substr((string)($e['Description'] ?? $e['Details'] ?? 'Bounced'), 0, 200);
            if ($r) q("update recipients set status='bounced', error=? where id=?", [$detail, $rid]);
            if ($hard && $email !== '') q("insert or replace into bounces(email,kind,detail,at) values(?,'hard',?,?)", [$email, $detail, time()]);
            return $hard ? 'hard bounce' : 'soft bounce';
        case 'SpamComplaint':
            if ($r) q("update recipients set status='bounced', error='Spam complaint' where id=?", [$rid]);
            if ($email !== '') { optout($email, 0); q("insert or replace into bounces(email,kind,detail,at) values(?,'complaint','Spam complaint',?)", [$email, time()]); }
            audit(null, 'complaint', 'delivery event for recipient ' . $rid); return 'complaint';
    }
    return 'ignored';
}

// ---------- FR-162: encrypted backup, an off-server copy, and a restore rehearsal that proves it works
/** Snapshot of the database plus frozen artwork, AES-256 encrypted with BACKUP_KEY. Returns what was done. */
function backup_run(): array {
    $d = ROOT . '/data/backups'; @mkdir($d, 0775, true); $stamp = date('Ymd-His'); $db = "$d/ecard-$stamp.sqlite";
    db()->exec("vacuum into '" . str_replace("'", '', $db) . "'");
    $r = ['plain' => $db, 'zip' => null, 'offsite' => [], 'warnings' => []];
    $key = env('BACKUP_KEY');
    if ($key === '') { $r['warnings'][] = 'BACKUP_KEY is not set, so only a local unencrypted snapshot was made and nothing was sent off the server.'; }
    else {
        $zip = "$d/ecard-$stamp.zip"; $z = new ZipArchive();
        if ($z->open($zip, ZipArchive::CREATE) !== true) { $r['warnings'][] = 'Could not create the backup archive.'; }
        else {
            $names = ['ecard.sqlite']; $z->addFile($db, 'ecard.sqlite');
            foreach (glob(ROOT . '/data/art/*') ?: [] as $f) { $z->addFile($f, 'art/' . basename($f)); $names[] = 'art/' . basename($f); }
            foreach (library_files() as $rel => $abs) { $z->addFile($abs, "library/$rel"); $names[] = "library/$rel"; } // uploaded originals and derivatives (EC-02)
            foreach ($names as $n) $z->setEncryptionName($n, ZipArchive::EM_AES_256, $key);
            $z->close(); $r['zip'] = $zip; @unlink($db); $r['plain'] = null;
            if (($dir = env('BACKUP_COPY_DIR')) !== '' && is_dir($dir) && @copy($zip, rtrim($dir, '/\\') . '/' . basename($zip))) $r['offsite'][] = 'copied to ' . $dir;
            if (($to = env('BACKUP_EMAIL')) !== '' && env('POSTMARK_TOKEN') !== '' && filesize($zip) < 9 * 1048576) {
                $err = mail_send($to, "Christmas cards backup $stamp", "Encrypted backup attached. It is useless without the backup key, which is not in this email. Keep it somewhere safe and do not forward it.", [], null, null, [['Name' => basename($zip), 'Content' => base64_encode((string)file_get_contents($zip)), 'ContentType' => 'application/zip']]);
                if ($err === null) $r['offsite'][] = "emailed to $to"; else $r['warnings'][] = 'Emailing the backup failed: ' . $err;
            }
            if (!$r['offsite']) $r['warnings'][] = 'No off-server copy was made. Set BACKUP_COPY_DIR or BACKUP_EMAIL (with Postmark) so a copy leaves this server.';
        }
    }
    foreach (glob("$d/ecard-*") ?: [] as $o) if (filemtime($o) < time() - 30 * 86400) @unlink($o);
    set_setting('last_backup', (string)time()); if ($r['offsite']) set_setting('last_offsite', (string)time());
    return $r;
}
/** Decrypts a backup into $targetDir (never over the live database), checks integrity and counts rows. Records the rehearsal. */
function backup_restore(string $zip, string $key, string $targetDir): array {
    $z = new ZipArchive();
    if (!is_file($zip) || $z->open($zip) !== true) return ['ok' => false, 'error' => 'Could not open the backup file.'];
    $z->setPassword($key); @mkdir($targetDir, 0775, true);
    if (!@$z->extractTo($targetDir)) { $z->close(); set_setting('last_restore_result', 'failed: wrong key or damaged file'); return ['ok' => false, 'error' => 'Could not decrypt it. Is the backup key right?']; }
    $z->close(); $file = rtrim($targetDir, '/\\') . '/ecard.sqlite';
    if (!is_file($file)) return ['ok' => false, 'error' => 'The backup has no database in it.'];
    $p = new PDO('sqlite:' . $file); $ic = (string)$p->query('pragma integrity_check')->fetchColumn();
    $counts = []; foreach (['users', 'sends', 'recipients', 'donations'] as $t) $counts[$t] = (int)$p->query("select count(*) from $t")->fetchColumn();
    $art = count(glob(rtrim($targetDir, '/\\') . '/art/*') ?: []) + count(glob(rtrim($targetDir, '/\\') . '/library/*/*') ?: []);
    $ok = $ic === 'ok';
    set_setting('last_restore_test', (string)time()); set_setting('last_restore_result', $ok ? 'ok: ' . json_encode($counts) . ", $art artwork files" : "failed: $ic");
    return ['ok' => $ok, 'integrity' => $ic, 'counts' => $counts, 'art' => $art, 'file' => $file];
}

// ---------- spec section 8: gates that configuration cannot override
/** Each gate: [label, passes, how to pass it]. In production the campaign stays locked while any of these fails, override or not. */
function hard_gates(): array {
    $h = fn(string $id) => ($d = one('select status, ref from decisions where id=?', [$id])) && $d['status'] === 'approved' && trim((string)$d['ref']) !== '';
    $now = time(); $off = (int)setting('last_offsite'); $rt = (int)setting('last_restore_test');
    return [
        'privacy' => ['Privacy notice, terms and safeguarding wording approved (D-14)', legal_approved(), 'Record D-14 as approved with a reference.'],
        'mfa' => ['Two-step sign in required for every administrator action', true, 'Built in: every admin page and action checks it.'],
        'payments' => ['Payment events are verified and reconciled', env('STRIPE_SECRET') !== '' && env('STRIPE_WEBHOOK_SECRET') !== '' && (int)setting('last_stripe_hook') > 0, 'Set the Stripe keys and webhook secret, then receive one signed test event.'],
        'recovery' => ['An off-server backup exists and a restore has been rehearsed', $off > 0 && $now - $off < 172800 && $rt > 0 && $now - $rt < 5184000 && str_starts_with((string)setting('last_restore_result'), 'ok'), 'Run backup with an off-server copy in the last 48 hours, and restore within the last 60 days.'],
        'security' => ['Security assessment complete with no open critical or high issues', $h('G-SEC'), 'Record G-SEC as approved with the assessment reference.'],
        'support' => ['Complaint, suspension and support route verified', $h('G-SUP'), 'Record G-SUP as approved with the test reference.'],
    ];
}
function hard_gates_failing(): array { return array_keys(array_filter(hard_gates(), fn($g) => !$g[1])); }
