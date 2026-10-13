<?php
putenv('APP_ENV=development');
// php tests/smtp_test.php : sending through the Group's own mail account, against a pretend SMTP server. TLS needs the openssl extension and is not tested here.
$work = sys_get_temp_dir() . '/ecard-smtp-' . getmypid(); mkdir($work); $log = $work . '/mail.log'; $port = random_int(20100, 20900);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=127.0.0.1'); putenv("SMTP_PORT=$port"); putenv('SMTP_SECURE=none'); putenv('SMTP_USER=cards@7thswindon.org.uk'); putenv('SMTP_PASS=secret-pass'); putenv('MAIL_FROM=cards@7thswindon.org.uk'); putenv('APP_URL=https://card.7thswindon.org.uk');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$proc = proc_open([PHP_BINARY, __DIR__ . '/fake_smtp.php', (string)$port, $log], [1 => ['file', $work . '/s.out', 'w'], 2 => ['file', $work . '/s.out', 'a']], $pipes);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function last(): array { $l = file($GLOBALS['log']); return json_decode(end($l), true); }
$body = "Hello Gran,\n.a line that starts with a dot\nWith a £ sign and an é.\n";
$r = mail_send('gran@example.org', 'Smith family sent you a Christmas card ☃', $body, [], '<p>Hi <b>Gran</b></p>', 'The Smiths');
$m = last(); ok($r === null, 'an accepted email returns no error');
ok($m['user'] === 'cards@7thswindon.org.uk' && $m['pass'] === 'secret-pass' && str_contains($m['from'], '<cards@7thswindon.org.uk>') && str_contains($m['rcpt'], '<gran@example.org>'), 'it signs in and uses the Group address as sender, never the card sender');
ok(str_contains($m['data'], "From: \"The Smiths via 7th Swindon Scouts\" <cards@7thswindon.org.uk>\n") && str_contains($m['data'], "To: gran@example.org\n") && str_contains($m['data'], 'MIME-Version: 1.0'), 'the headers are right');
preg_match('/^Subject: (.*(?:\n .*)*)/m', $m['data'], $s); $dec = ''; foreach (preg_split('/\s+/', trim($s[1])) as $w) if (preg_match('/=\?UTF-8\?B\?(.*)\?=/', $w, $x)) $dec .= base64_decode($x[1]);
ok($dec === 'Smith family sent you a Christmas card ☃', 'a subject with a symbol is encoded and reads back exactly');
ok(str_contains($m['data'], 'multipart/alternative') && str_contains($m['data'], 'text/plain') && str_contains($m['data'], 'text/html') && str_contains($m['data'], '<p>Hi <b>Gran</b></p>'), 'plain text and HTML versions are both sent');
ok(str_contains(quoted_printable_decode($m['data']), '.a line that starts with a dot') && str_contains(quoted_printable_decode($m['data']), '£ sign and an é'), 'a line that begins with a dot and accented letters arrive intact');
$e = mail_send('perm@example.org', 'x', 'y'); ok(is_string($e) && str_starts_with($e, 'PERM:') && str_contains($e, 'no such user'), 'a refused address is a permanent failure, so it is not retried');
$e = mail_send('temp@example.org', 'x', 'y'); ok(is_string($e) && !str_starts_with($e, 'PERM:') && !str_starts_with($e, 'UNKNOWN:') && str_contains($e, 'try later'), 'a "try later" answer is retried later');
$e = mail_send('afterdata@example.org', 'x', 'y'); ok(is_string($e) && str_starts_with($e, 'PERM:'), 'a refusal after the message was sent is permanent');
$e = mail_send('silent@example.org', 'x', 'y'); ok(is_string($e) && str_starts_with($e, 'UNKNOWN:'), 'no answer after the message was sent is "unknown", so it is not blindly resent');
putenv('SMTP_PASS=bad'); $e = mail_send('ok@example.org', 'x', 'y'); ok(is_string($e) && !str_starts_with($e, 'PERM:') && str_contains($e, 'Email delivery settings'), 'a wrong mail login gives a plain, fixable message and is not a permanent failure for the card'); putenv('SMTP_PASS=secret-pass');
putenv('SMTP_PORT=1'); $e = mail_send('ok@example.org', 'x', 'y'); ok(is_string($e) && str_contains($e, 'could not be reached'), 'a mail server that is not there is reported, to be retried'); putenv("SMTP_PORT=$port");
mail_send('victim@example.org', "Hi\r\nBcc: spy@example.org", 'body'); $m = last(); ok(!preg_match('/^Bcc:/mi', $m['data']), 'a line break in a subject cannot add a header');
mail_send('zip@example.org', 'backup', 'attached', [], null, null, [['Name' => 'bk up.zip', 'Content' => base64_encode(random_bytes(200)), 'ContentType' => 'application/zip']]); $m = last();
ok(str_contains($m['data'], 'multipart/mixed') && str_contains($m['data'], 'filename="bk_up.zip"') && str_contains($m['data'], 'Content-Transfer-Encoding: base64'), 'an attachment is sent as a safe base64 part');
putenv('SMTP_PER_RUN=2'); q("insert into users(name,email,pass,verified,created) values('S','s@x.com','x',1,?)", [time()]); q("insert into sends(user_id,card,sender_name,message,status,queued_at,created,updated) values(1,'pegs','S','Hi','queued',?,?,?)", [time(), time(), time()]);
for ($i = 0; $i < 5; $i++) q("insert into recipients(send_id,name,email,token,status) values(1,'G','g$i@example.org','t$i','queued')");
ok(process_queue() === 2, 'the queue sends only SMTP_PER_RUN emails at a time, to stay under hourly limits');
ok((int)one("select count(*) n from recipients where status='sent'")['n'] === 2 && str_contains(file_get_contents(__DIR__ . '/../src/admin.php'), 'No bounce or delivery feedback'), 'the sent cards are marked sent and the health page says there is no bounce feedback');
proc_terminate($proc); proc_close($proc); exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
