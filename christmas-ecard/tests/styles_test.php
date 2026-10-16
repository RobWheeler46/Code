<?php
putenv('APP_ENV=development');
// php tests/styles_test.php : style tags, the style filter, favourites and greeting tones
$work = sys_get_temp_dir() . '/ecard-sty-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$S = []; foreach (['admin' => [1, 'admin'], 'plain' => [0, ''], 'other' => [0, '']] as $n => [$adm, $roles]) { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,?,?,?)", [$n, "$n@x.example", password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $adm, $roles, $sec]); $S[$n] = ["$n@x.example", $sec]; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u, bool $mfa): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); if ($mfa) { [, $m] = http('/mfa', $j); http('/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); } return $j; }
function act(string $jar, string $page, array $f): array { [, $p] = http($page, $jar); return http($f['_to'] ?? $page, $jar, ['_c' => tok($p)] + array_diff_key($f, ['_to' => 1])); }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
function guest_home(string $qs = ''): string { return http('/' . $qs, tempnam(sys_get_temp_dir(), 'jar'))[1]; }
$a = login($S['admin'], true); $p = login($S['plain'], false); $o = login($S['other'], false);

// the vocabulary
ok(dbq('select count(*) from style_tags')->fetchColumn() == 4 && dbq("select count(*) from style_tags where slug='funny'")->fetchColumn() == 1, 'four starting styles are set up');
[$c, $pg] = http('/admin/occasions', $a); ok($c === 200 && str_contains($pg, 'Add a style') && str_contains($pg, 'aria-label="Name of style Funny"'), 'the Occasions screen lists the styles, each field labelled');
act($p, '/admin/occasions', ['do' => 'style_add', 'label' => 'Hacked']); ok(dbq("select count(*) from style_tags where label='Hacked'")->fetchColumn() == 0, 'someone who is not an administrator cannot add a style');
act($a, '/admin/occasions', ['do' => 'style_add', 'label' => 'Cheeky']); ok(dbq("select count(*) from style_tags where slug='cheeky'")->fetchColumn() == 1, 'an administrator can add a style');
act($a, '/admin/occasions', ['do' => 'style_add', 'label' => 'cheeky']); act($a, '/admin/occasions', ['do' => 'style_add', 'label' => 'Bad <b>']); act($a, '/admin/occasions', ['do' => 'style_add', 'label' => str_repeat('x', 21)]); ok(dbq('select count(*) from style_tags')->fetchColumn() == 5, 'a repeat, markup or a long name is refused');
$cid = (int)dbq("select id from style_tags where slug='cheeky'")->fetchColumn(); act($a, '/admin/occasions', ['do' => 'style_save', 'id' => $cid, 'label' => 'Cheeky chaps']); ok(dbq("select label from style_tags where id=$cid")->fetchColumn() === 'Cheeky chaps', 'a style can be renamed');

// tagging a published card from Order and visibility
$cards = array_keys(gallery_cards()); $c1 = $cards[0]; $c2 = $cards[1]; $fun = (int)dbq("select id from style_tags where slug='funny'")->fetchColumn(); $hrt = (int)dbq("select id from style_tags where slug='heartfelt'")->fetchColumn();
ok(!str_contains(guest_home(), 'id="gsty"'), 'with no card tagged, visitors are not offered a style filter');
[, $pg] = http('/admin/designs', $a); ok(str_contains($pg, 'name="styles[]"') && str_contains($pg, 'Save styles'), 'each card on Order and visibility has style tick boxes');
act($p, '/admin/designs', ['_to' => '/admin/design-styles', 'card' => $c1, 'styles' => [$fun]]); ok(dbq('select count(*) from design_style_tags')->fetchColumn() == 0, 'only administrators can tag a card');
act($a, '/admin/designs', ['_to' => '/admin/design-styles', 'card' => $c1, 'styles' => [$fun, $hrt, 9999]]); ok(dbq('select count(*) from design_style_tags')->fetchColumn() == 2, 'ticked styles are saved, and a made up style is ignored');
act($a, '/admin/designs', ['_to' => '/admin/design-styles', 'card' => $c2, 'styles' => [$hrt]]);

// the filter on the home page
$h = guest_home(); ok(str_contains($h, 'id="gsty"') && str_contains($h, 'value="funny"') && str_contains($h, 'value="heartfelt"') && !str_contains($h, 'value="adventure"'), 'the style drop down lists only styles that cards carry');
$h = guest_home('?style=funny'); ok(substr_count($h, 'class="tile"') === 1 && str_contains($h, 'compose?card=' . $c1) && str_contains($h, '1 card shown') && str_contains($h, 'Show all cards'), 'choosing a style shows only matching cards, with a count and a way back');
$h = guest_home('?style=heartfelt'); ok(substr_count($h, 'class="tile"') === 2, 'a style carried by two cards shows both');
ok(substr_count(guest_home('?style=nonsense'), 'class="tile"') === count($cards), 'a style that does not exist is ignored');
$ho0 = http('/?style=funny&fav=1', $o)[1]; ok(substr_count($ho0, 'class="tile"') === 0 && str_contains($ho0, 'No cards match'), 'style and favourites combine, and an empty result says so');
act($a, '/admin/occasions', ['do' => 'style_save', 'id' => $fun, 'label' => 'Funny', 'hide' => '1']); ok(substr_count(guest_home('?style=funny'), 'class="tile"') === count($cards), 'a hidden style cannot be used in an address');
act($a, '/admin/occasions', ['do' => 'style_save', 'id' => $fun, 'label' => 'Funny']);
dbq("insert into settings(k,v) values('off_$c2','1') on conflict(k) do update set v='1'");
ok(!str_contains(guest_home('?style=heartfelt'), 'compose?card=' . $c2), 'a card that is turned off never appears through a style address');
dbq("delete from settings where k='off_$c2'");

// favourites
ok(!str_contains(guest_home(), 'class="fav"') && !str_contains(guest_home(), 'Only my favourites'), 'visitors who are not signed in see no favourite controls');
$hp = http('/', $p)[1]; ok(str_contains($hp, 'class="fav"') && str_contains($hp, 'aria-pressed="false"') && str_contains($hp, 'to your favourites'), 'a signed in sender sees a labelled favourite button on every card');
[, $pg] = http('/', $p); http('/favourite', $p, ['_c' => tok($pg), 'card' => $c1, 'on' => '1', 'back' => '']); http('/favourite', $p, ['_c' => tok($pg), 'card' => $c1, 'on' => '1', 'back' => '']);
ok(dbq('select count(*) from user_favourite_designs')->fetchColumn() == 1, 'saving a favourite twice keeps one');
[, $hp] = http('/', $p); ok(str_contains($hp, 'aria-pressed="true"') && str_contains($hp, 'Remove'), 'it then shows as saved');
[, $ho] = http('/', $o); ok(str_contains($ho, 'aria-pressed="false"') && !str_contains($ho, 'aria-pressed="true"'), 'favourites are private to each sender');
$hp = http('/?fav=1', $p)[1]; ok(substr_count($hp, 'class="tile"') === 1 && str_contains($hp, 'compose?card=' . $c1), 'the favourites filter shows only the saved card');
http('/favourite', $p, ['_c' => tok($pg), 'card' => 'no-such-card', 'on' => '1', 'back' => '']); ok(dbq('select count(*) from user_favourite_designs')->fetchColumn() == 1, 'a card that does not exist cannot be saved');
dbq("insert into settings(k,v) values('off_$c1','1') on conflict(k) do update set v='1'"); ok(!str_contains(http('/?fav=1', $p)[1], 'compose?card=' . $c1), 'a saved card that is turned off is not offered');
dbq("delete from settings where k='off_$c1'");
[$c] = http('/favourite', tempnam(sys_get_temp_dir(), 'jar'), ['card' => $c1, 'on' => '1']); ok($c !== 200, 'saving needs a signed in account');
http('/favourite', $p, ['_c' => tok($pg), 'card' => $c1, 'on' => '', 'back' => 'style=funny']); ok(dbq('select count(*) from user_favourite_designs')->fetchColumn() == 0, 'it can be removed');
ok(preg_match('/user_favourite_designs/', file_get_contents(__DIR__ . '/../src/auth.php')) === 1, 'deleting an account removes its favourites');

// favourites on My cards
[, $dp] = http('/dashboard', $p); ok(str_contains($dp, 'My favourite cards') && str_contains($dp, 'Press the heart'), 'My cards has a favourites section, with a hint when it is empty');
[, $pg] = http('/', $p); http('/favourite', $p, ['_c' => tok($pg), 'card' => $c1, 'on' => '1', 'back' => '']);
[, $dp] = http('/dashboard', $p); ok(str_contains($dp, 'compose?card=' . $c1) && !str_contains($dp, 'Press the heart') && str_contains($dp, 'name="to" value="dashboard"'), 'a saved card appears there as a link to start a card');
[, $do2] = http('/dashboard', $o); ok(str_contains($do2, 'Press the heart'), 'another sender does not see it');
[, $pg2] = http('/dashboard', $p); [$c, ] = http('/favourite', $p, ['_c' => tok($pg2), 'card' => $c1, 'on' => '', 'to' => 'dashboard']);
ok(dbq('select count(*) from user_favourite_designs')->fetchColumn() == 0, 'removing it there removes the favourite');
dbq("insert into user_favourite_designs values((select id from users where email='plain@x.example'),'$c1',1)"); dbq("insert into settings(k,v) values('off_$c1','1') on conflict(k) do update set v='1'");
ok(!str_contains(http('/dashboard', $p)[1], 'compose?card=' . $c1), 'a saved card that is turned off is not shown');
dbq("delete from settings where k='off_$c1'"); dbq('delete from user_favourite_designs');
// a closer look at a card before choosing it
$gj = tempnam(sys_get_temp_dir(), 'jar'); [$c, $pv] = http('/card-preview?card=' . $c1, $gj);
ok($c === 200 && str_contains($pv, 'compose?card=' . $c1) && str_contains($pv, 'Personalise this card') && str_contains($pv, 'Back to the cards'), 'anyone can preview a card in full and go on to personalise it');
ok(str_contains(guest_home(), 'href="/card-preview?card=' . $c1 . '"') && str_contains(guest_home(), 'Preview<span class="sr">'), 'each card in the gallery has a Preview link that names the card');
[$c, ] = http('/card-preview?card=nonsense', $gj); ok($c === 302, 'a card that does not exist goes back to the gallery');
dbq("insert into settings(k,v) values('off_$c1','1') on conflict(k) do update set v='1'"); [$c, ] = http('/card-preview?card=' . $c1, $gj); ok($c === 302, 'a card that is turned off cannot be previewed');
dbq("delete from settings where k='off_$c1'");
[, $pv] = http('/card-preview?card=' . urlencode('"><script>'), $gj); ok(!str_contains($pv, '<script>'), 'odd input is never printed');
// hidden text for screen readers must be clipped, not moved off to the left (inside a positioned link that put it on screen in the right hand columns)
ok(preg_match('/^\.sr\{[^}]*clip:rect/m', file_get_contents(__DIR__ . '/../public/assets/style.css')) && !preg_match('/\.sr\{[^}]*left:-999px/', file_get_contents(__DIR__ . '/../public/assets/style.css')), 'text meant only for screen readers is clipped away and cannot appear on screen');

// greeting ideas and the card sent back
[, $cm] = http('/compose?card=' . $c1, $p); ok(str_contains($cm, 'data-tone="Short and sweet"') && str_contains($cm, 'data-tone="A bit cheeky"') && str_contains($cm, 'data-tone="Warm and thoughtful"'), 'greeting examples carry a tone');
ok(starter_tone('Sending you warm wishes.') === 'Short and sweet' && starter_tone('something else') === 'Warm and thoughtful', 'an example without a tone is warm');
ok(str_contains(file_get_contents(__DIR__ . '/../src/recipient.php'), '/?ref=recipient-card'), 'the card page link to the gallery carries a promotion label and no private link');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
