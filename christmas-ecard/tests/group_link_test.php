<?php
putenv('APP_ENV=development');
// php tests/group_link_test.php : every card email mentions the 7th Swindon Scouts website
$work = sys_get_temp_dir() . '/ecard-glink-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$card = array_key_first(gallery_cards());

// the setting and its rules
ok(group_link_url() === 'https://www.7thswindon.org.uk/', 'the address starts as the Group website');
$v = fn($x) => cfg_validate(['', 'url', 'max' => 200], $x)[1];
ok($v('https://www.7thswindon.org.uk/') === null && $v('') === null, 'an https address, or a blank one that leaves the link out, is accepted');
ok($v('http://example.com') !== null && $v('javascript:alert(1)') !== null && $v('https://exa mple.com') !== null && $v('https://x.com/"onmouseover="x') !== null && $v('//evil.example') !== null, 'http, script, spaced, quoted and scheme-less addresses are refused');
ok(str_contains(cfg_validate(['', 'url', 'max' => 20], 'https://www.example.com/a/very/long/address')[1] ?? '', 'https://'), 'an address over the length limit is refused');

// the email, in both its forms, always mentions it
$rr = ['name' => 'Gran', 'token' => str_repeat('a', 48), 'id' => 1]; $s = ['card' => $card, 'sender_name' => 'Sam', 'id' => 1];
$html = email_html($rr, $s); $text = email_body($rr, $s);
ok(str_contains($html, 'Find out more about 7th Swindon Scouts: <a href="https://www.7thswindon.org.uk/">https://www.7thswindon.org.uk/</a>'), 'the styled email has the link, with the address visible');
ok(str_contains($text, 'Find out more about 7th Swindon Scouts: https://www.7thswindon.org.uk/'), 'the plain text email has it too');
ok(strpos($text, 'Find out more') > strpos($text, 'This private link works') && strpos($text, 'Find out more') < strpos($text, 'Do not want these?'), 'it sits after the private link note and before the stop cards line');
set_setting('group_url', ''); ok(!str_contains(email_html($rr, $s), 'Find out more') && !str_contains(email_body($rr, $s), 'Find out more'), 'with the address blank it is left out');
set_setting('group_url', 'javascript:alert(1)'); ok(group_link_url() === '' && !str_contains(email_html($rr, $s), 'javascript'), 'a bad stored address is never used');
set_setting('group_url', 'https://www.7thswindon.org.uk/');

// there is no tick box any more, and the card page is as the sender wrote it
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path): string { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true]); $b = (string)curl_exec($ch); curl_close($ch); return $b; }
$pg = http('/compose?card=' . $card); ok(!str_contains($pg, 'group_link') && str_contains($pg, 'Write something wonderful'), 'the write screen has no tick box for it');
ok(!str_contains(card_view($card, 'Gran', 'Hi', 'Sam'), 'grouplink') && !str_contains(file_get_contents(__DIR__ . '/../src/recipient.php'), 'group_link'), 'the card page carries no extra link');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
