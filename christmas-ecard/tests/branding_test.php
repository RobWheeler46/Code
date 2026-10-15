<?php
putenv('APP_ENV=development');
// php tests/branding_test.php : the service name and wording work for any occasion
$work = sys_get_temp_dir() . '/ecard-brand-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }

ok(SITE_NAME === '7th Swindon Scouts eCards', 'the service is called 7th Swindon Scouts eCards');
$src = ''; foreach (glob(__DIR__ . '/../src/*.php') as $f) $src .= file_get_contents($f);
ok(!str_contains($src, 'Christmas Cards') && !str_contains($src, 'Christmas cards service') && !str_contains($src, 'Christmas eCards'), 'no old Christmas only service name is left in the code');

// a Christmas send and a birthday send read correctly
$t = time(); $xmas = ['sender_name' => 'The Smiths', 'card' => 'pegs'];
ok(card_word($xmas) === 'Christmas card', 'a Christmas design gives a Christmas card');
q("insert into designs(slug,internal_name,category,created) values('bd-test','Birthday test','birthday',?),('ty-test','Thanks test','thank-you',?)", [$t, $t]);
$b = ['sender_name' => 'The Smiths', 'card' => 'bd-test']; $th = ['sender_name' => 'The Smiths', 'card' => 'ty-test'];
ok(card_word($b) === 'Birthday card' && card_word($th) === 'Thank you card', 'a birthday card is a Birthday card and a thank you card is a Thank you card (the name as typed)');
ok(email_subject($xmas) === 'The Smiths sent you a Christmas card' && email_subject($b) === 'The Smiths sent you a Birthday card', 'the email subject names the occasion');
ok(tpl_text(email_intro(), $th) === 'The Smiths has sent you a Thank you card.', 'the opening line names the occasion');
ok(str_contains(tpl_html('{sender} sent you a {card}', $b), '<strong>The Smiths</strong>') && str_contains(tpl_html('{sender} sent you a {card}', $b), 'Birthday card'), 'the HTML version of the email does too');
set_setting('email_subject', 'A message from {sender}'); ok(email_subject($b) === 'A message from The Smiths', 'a subject edited by an administrator still works');
set_setting('email_subject', '');

// greeting examples follow the occasion, and are not all about Christmas
ok(starters($xmas) === STARTERS, 'Christmas greeting examples are kept for Christmas');
ok(!preg_grep('/christmas|santa|mince/i', starters($b)) && !preg_grep('/christmas|santa|mince/i', starters($th)) && count(starters($b)) >= 3, 'other occasions get their own examples with no Christmas wording');

// Christmas times are only offered for Christmas cards
ok(!str_contains(schedule_picker($b), 'Christmas') && !str_contains(schedule_picker($th), 'Christmas'), 'the delivery choices for other occasions do not mention Christmas');

// the public pages carry the new name
foreach (['r_home', 'r_help', 'r_privacy', 'r_terms'] as $fn) {
    file_put_contents($work . '/p.php', '<?php require ' . var_export(realpath(__DIR__ . '/../src/app.php'), true) . "; $fn();");
    $h = (string)shell_exec('php ' . escapeshellarg($work . '/p.php'));
    ok(str_contains($h, '| 7th Swindon Scouts eCards</title>') && !str_contains($h, 'Christmas Cards'), "$fn is titled with the new name and has no old name");
}
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
