<?php
putenv('APP_ENV=development');
// php tests/group_link_test.php : the option to add a link to the 7th Swindon Scouts website on a card
$work = sys_get_temp_dir() . '/ecard-glink-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$t = time(); q("insert into users(id,name,email,pass,verified,created,terms_version) values(1,'Sam','sam@x.example',?,1,?,?)", [password_hash('Test-pass-123', PASSWORD_DEFAULT), $t, TERMS_VERSION]);
$card = array_key_first(gallery_cards());

// the setting and its rules
ok(group_link_url() === 'https://www.7thswindon.org.uk/', 'the address starts as the Group website');
$v = fn($x) => cfg_validate(['', 'url', 'max' => 200], $x)[1];
ok($v('https://www.7thswindon.org.uk/') === null && $v('') === null, 'an https address, or a blank one that switches the option off, is accepted');
ok($v('http://example.com') !== null && $v('javascript:alert(1)') !== null && $v('https://exa mple.com') !== null && $v('https://x.com/"onmouseover="x') !== null && $v('//evil.example') !== null, 'http, script, spaced, quoted and scheme-less addresses are refused');
ok(str_contains(cfg_validate(['', 'url', 'max' => 20], 'https://www.example.com/a/very/long/address')[1] ?? '', 'https://'), 'an address over the length limit is refused');

// the card shows the link only when asked for
$h = card_view($card, 'Gran', 'Hi', 'Sam', '', null, null, 'https://www.7thswindon.org.uk/');
ok(str_contains($h, '<p class="grouplink"><a href="https://www.7thswindon.org.uk/"') && str_contains($h, 'rel="noopener noreferrer nofollow"') && str_contains($h, '(opens in a new tab)'), 'a card with the option on has a link that opens in a new tab and names it for screen readers');
ok(!str_contains(card_view($card, 'Gran', 'Hi', 'Sam'), 'grouplink'), 'a card without it has none');
ok(card_link_url(['group_link' => 1]) === 'https://www.7thswindon.org.uk/' && card_link_url(['group_link' => 0]) === '' && card_link_url([]) === '', 'only a card whose sender ticked the box carries the link');
set_setting('group_url', ''); ok(group_link_url() === '' && card_link_url(['group_link' => 1]) === '', 'blanking the setting switches the option off, even for a card already ticked');
set_setting('group_url', 'javascript:alert(1)'); ok(group_link_url() === '', 'a bad stored address is never used');
set_setting('group_url', 'https://www.7thswindon.org.uk/');

// over HTTP: tick it in the write screen, see it in the preview and on the recipient's card
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => true]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
$jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $jar); http('/login', $jar, ['_c' => tok($b), 'email' => 'sam@x.example', 'password' => 'Test-pass-123']);
[, $pg] = http('/compose?card=' . $card, $jar); ok(str_contains($pg, 'name="group_link"') && str_contains($pg, 'Add a link to the 7th Swindon Scouts website'), 'the write screen offers the tick box');
function save(array $extra): int { global $jar, $card; [, $p] = http('/compose?card=' . $card, $jar); http('/compose', $jar, array_merge(['_c' => tok($p), 'card' => $card, 'act' => 'save', 'sender_name' => 'Sam', 'message' => 'Happy Christmas', 'r_name' => ['Gran'], 'r_email' => ['gran@example.com'], 'r_msg' => [''], 'paste' => ''], $extra)); return (int)dbq('select max(id) from sends')->fetchColumn(); }
$s1 = save(['group_link' => '1']); ok(dbq("select group_link from sends where id=$s1")->fetchColumn() == 1, 'ticking it is saved with the draft');
[, $pv] = http("/preview?id=$s1", $jar); ok(str_contains($pv, 'class="grouplink"'), 'the preview shows the link');
[, $cm] = http("/compose?id=$s1", $jar); ok(preg_match('/name="group_link" value="1" checked/', $cm), 'coming back to the draft, the box is still ticked');
$s2 = save([]); ok(dbq("select group_link from sends where id=$s2")->fetchColumn() == 0 && !str_contains(http("/preview?id=$s2", $jar)[1], 'class="grouplink"'), 'left unticked, no link is saved or shown');
$new = copy_send($s1, 1, [dbq("select id from recipients where send_id=$s1")->fetchColumn()]); ok(dbq("select group_link from sends where id=$new")->fetchColumn() == 1, 'copying a card keeps the choice');
// the recipient's own page
q("update sends set status='sent' where id=$s1"); q("update recipients set status='sent', sent_at=? where send_id=$s1", [time()]); $tk = (string)dbq("select token from recipients where send_id=$s1")->fetchColumn();
$rj = tempnam(sys_get_temp_dir(), 'jar'); [, $env] = http("/c/$tk", $rj); http("/c/$tk/open", $rj, ['_c' => tok($env)]); [, $card_page] = http("/c/$tk?o=1", $rj);
ok(str_contains($card_page, 'class="grouplink"') && str_contains($card_page, 'https://www.7thswindon.org.uk/') && str_contains($card_page, 'Find out more about 7th Swindon Scouts'), 'the recipient sees the link at the bottom of the card');
set_setting('group_url', ''); [, $cm] = http('/compose?card=' . $card, $jar); ok(!str_contains($cm, 'name="group_link"'), 'with the address blank, the write screen no longer offers it');
[, $card_page] = http("/c/$tk?o=1", $rj); ok(!str_contains($card_page, 'class="grouplink"'), 'and a card already sent stops showing it');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
