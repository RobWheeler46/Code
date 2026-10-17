<?php
putenv('APP_ENV=development');
// php tests/recipients_paste_test.php : adding many people to a card at once
$work = sys_get_temp_dir() . '/ecard-paste-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function names(string $t): array { return array_map(fn($r) => $r[0] . '=' . $r[1], parse_recipients($t)[0]); }

// the reading rules
ok(names("Gran, gran@example.com\nUncle Bob <bob@example.com>") === ['Gran=gran@example.com', 'Uncle Bob=bob@example.com'], 'Name, email and Name <email> lines are read');
ok(names("Cy\tcy@example.com") === ['Cy=cy@example.com'], 'a tab between name and email, as copied from a spreadsheet, is read');
ok(names("aunt.sue@example.com\ncousin_dan42@example.com") === ['Aunt Sue=aunt.sue@example.com', 'Cousin Dan=cousin_dan42@example.com'], 'a line with only an address gets a name made from it');
ok(names("a@x.com, b@y.org; c@z.net") === ['A=a@x.com', 'B=b@y.org', 'C=c@z.net'], 'addresses on one line, split by commas, semicolons or spaces, become one person each');
ok(names("Ann <ann@x.com>, \"Bo, Jr\" <bo@x.com>") === ['Ann=ann@x.com', 'Bo, Jr=bo@x.com'], 'a list copied from an email To box is read, including a quoted name with a comma');
ok(parse_recipients("gran@example.com | Love; you")[0][0][2] === 'Love; you', 'a personal message after a bar is kept whole, even with a semicolon');
[$r, $e, $unread] = parse_recipients("Gran, gran@example.com\nbad line\nX, nope\nGRAN@example.com");
ok(count($r) === 1 && count($e) === 3 && $unread === ['bad line', 'X, nope', 'GRAN@example.com'], 'lines that cannot be read, bad addresses and repeats are reported and handed back');
ok(name_from_email('1234@x.com') === 'Friend' && name_from_email('mary+cards@x.com') === 'Mary', 'a name that cannot be made falls back to Friend, and plus tags are dropped');

// over HTTP: the Add these people button
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => true]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
$card = array_key_first(gallery_cards()); $jar = tempnam(sys_get_temp_dir(), 'jar');
[, $pg] = http('/compose?card=' . $card, $jar);
ok(str_contains($pg, 'Add these people to the list') && str_contains($pg, '<details><summary>Add many people at once'), 'the paste box is closed until needed, has a clear name and an Add button');
function add(string $paste, array $names = [''], array $emails = [''], array $msgs = ['']): string { global $jar, $card; [, $p] = http('/compose?card=' . $card, $jar); return http('/compose', $jar, ['_c' => tok($p), 'card' => $card, 'act' => 'addpaste', 'sender_name' => '', 'message' => '', 'r_name' => $names, 'r_email' => $emails, 'r_msg' => $msgs, 'paste' => $paste])[1]; }
$h = add("Gran, gran@example.com\nuncle.bob@example.com\nbad line\nSam, sam@example.com", ['Sam'], ['sam@example.com'], ['']);
preg_match_all('/name="r_email\[\]" value="([^"]*)"/', $h, $m);
ok($m[1] === ['sam@example.com', 'gran@example.com', 'uncle.bob@example.com'], 'pasted people become visible rows after the ones already there, and an address already on the card is skipped');
ok(str_contains($h, 'value="Uncle Bob"') && str_contains($h, 'Added 2 people') && str_contains($h, '1 already on the card was skipped'), 'the names are shown to check, and a message says what happened');
ok(preg_match('#<textarea name="paste"[^>]*>bad line</textarea>#', $h) && str_contains($h, 'Could not read: bad line'), 'a line that could not be read stays in the box with a reason');
$h = add("a1@x.com\na2@x.com"); preg_match_all('/name="r_email\[\]" value="([^"]*)"/', $h, $m); ok($m[1] === ['a1@x.com', 'a2@x.com'], 'an untouched empty first row is replaced, not left blank above the new people');
$big = implode("\n", array_map(fn($i) => "p$i@x.com", range(1, max_recipients() + 5))); $h = add($big); preg_match_all('/name="r_email\[\]" value="([^"]*)"/', $h, $m);
ok(count($m[1]) === max_recipients() && str_contains($h, 'would go over the limit of ' . max_recipients()), 'the limit is kept, and the people left out are mentioned');
[, $pg] = http('/compose?card=' . $card, tempnam(sys_get_temp_dir(), 'jar')); ok(!str_contains($pg, 'Could not read'), 'a new visitor sees none of that');
ok(preg_match('/addrow/', file_get_contents(__DIR__ . '/../src/send.php')) === 1 && str_contains(file_get_contents(__DIR__ . '/../public/assets/app.js'), "b.value === 'addrow'"), 'the Add another recipient button still works without scripts, and with scripts adds a row without reloading');
// without scripts, Add another recipient comes back to the new row, not the top of the list
[, $p] = http('/compose?card=' . $card, $jar); $h = http('/compose', $jar, ['_c' => tok($p), 'card' => $card, 'act' => 'addrow', 'r_name' => ['Gran'], 'r_email' => ['gran@example.com'], 'r_msg' => ['']])[1];
ok(substr_count($h, 'class="rrow"') === 2 && preg_match('/class="rrow" id="newrow"/', $h) && strpos($h, 'id="newrow"') > strpos($h, 'gran@example.com'), 'the page reached after Add another recipient marks the new row so the browser scrolls to it');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
