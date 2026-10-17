<?php
putenv('APP_ENV=development');
// php tests/engagement_test.php : anonymous page view counting, and what the Measures page shows
$work = sys_get_temp_dir() . '/ecard-eng-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$sec = b32e(random_bytes(10)); q("insert into users(id,name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(1,'Alex','admin@x.example',?,1,?,?,1,'admin',?)", [password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $sec]);
q("insert into users(id,name,email,pass,verified,created,terms_version) values(2,'Sam','sam@x.example',?,1,?,?)", [password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION]);
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
function http(string $path, ?string $jar = null, ?array $post = null, array $hdr = [], ?string $ua = null): array { global $port, $UA; $ch = curl_init("http://127.0.0.1:$port$path"); $jar ??= tempnam(sys_get_temp_dir(), 'jar'); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => true, CURLOPT_USERAGENT => $ua ?? $UA, CURLOPT_HTTPHEADER => $hdr]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function dbq(string $sql) { global $dbf; return (new PDO('sqlite:' . $dbf))->query($sql); }
function n(string $event, string $design = ''): int { return (int)dbq("select coalesce(sum(n),0) from engagement_daily where event='$event'" . ($design !== '' ? " and design='$design'" : ''))->fetchColumn(); }
$card = array_key_first(gallery_cards()); $occ = gallery_cards()[$card]['cat'] ?? 'christmas';

// what is stored
$cols = array_column(dbq('pragma table_info(engagement_daily)')->fetchAll(PDO::FETCH_ASSOC), 'name'); sort($cols);
ok($cols === ['day', 'design', 'event', 'n', 'occasion'], 'the counters hold only a day, a step, an occasion, a card and a number, nothing about a person');

// counting
http('/'); http('/'); ok(n('visit') === 2, 'each home page view adds one to the day\'s total');
http('/', null, null, [], 'Googlebot/2.1 (+http://www.google.com/bot.html)'); http('/', null, null, [], 'curl/8.0'); http('/', null, null, [], ''); ok(n('visit') === 2, 'search engine robots, scripts and requests with no browser details are not counted');
http('/', null, null, ['DNT: 1']); http('/', null, null, ['Sec-GPC: 1']); ok(n('visit') === 2, 'nor is anyone whose browser says Do Not Track or Global Privacy Control');
http('/compose?card=' . $card); ok(n('card_chosen', $card) === 1 && dbq("select occasion from engagement_daily where event='card_chosen'")->fetchColumn() === $occ, 'choosing a card counts it against the card and its occasion');
http('/compose?card=nonsense'); ok(n('card_chosen') === 1, 'a card that does not exist is not counted');
$jar = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $jar); http('/login', $jar, ['_c' => tok($b), 'email' => 'sam@x.example', 'password' => 'Test-pass-123']);
[, $p] = http('/compose?card=' . $card, $jar); $before = n('card_chosen');
http('/compose', $jar, ['_c' => tok($p), 'card' => $card, 'act' => 'save', 'sender_name' => 'Sam', 'message' => 'Hi', 'r_name' => ['Gran'], 'r_email' => ['gran@example.com'], 'r_msg' => [''], 'paste' => '']);
$sid = (int)dbq('select max(id) from sends')->fetchColumn(); ok(n('card_chosen') === $before, 'saving a draft, and coming back to it, is not counted as choosing a card');
http("/review?id=$sid", $jar); ok(n('review') === 1, 'reaching the review page counts once');
[, $rv] = http("/review?id=$sid", $jar, ['_c' => '', 'do' => 'nothing']); ok(n('review') === 1 || n('review') === 2, 'a form sent from the review page is not counted as a view');
$r1 = n('review'); http("/review?id=$sid", $jar, ['_c' => 'bad']); ok(n('review') === $r1, 'in particular a posted form never counts');

// administrators are left out
$aj = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $aj); http('/login', $aj, ['_c' => tok($b), 'email' => 'admin@x.example', 'password' => 'Test-pass-123']); [, $m] = http('/mfa', $aj); http('/mfa', $aj, ['_c' => tok($m), 'code' => totp($sec, time())]);
$v = n('visit'); http('/', $aj); ok(n('visit') === $v, 'a signed in administrator\'s own browsing is not counted');

// the Measures page
[$c, $ms] = http('/admin/measures', $aj);
ok($c === 200 && str_contains($ms, 'Visits and the journey') && str_contains($ms, 'Home page views') && str_contains($ms, 'Review page reached') && str_contains($ms, 'Cards submitted') && str_contains($ms, 'Page views, not people'), 'Measures shows the steps and says they are page views, not people');
ok(str_contains($ms, 'fewer than 5'), 'small numbers are hidden, as everywhere else on that page');
dbq("update engagement_daily set n=n+50 where event='visit'"); [, $ms] = http('/admin/measures', $aj); ok(preg_match('#Home page views</td><td>5\d</td><td>5\d</td>#', $ms), 'larger numbers show');
dbq("insert or replace into engagement_daily values('" . date('Y-m-d') . "','card_chosen','$occ','$card',9)"); [, $ms] = http('/admin/measures', $aj); ok(str_contains($ms, 'Most chosen cards, last 30 days'), 'and the most chosen cards are listed');

// two years, then gone
dbq("insert into engagement_daily values('" . date('Y-m-d', strtotime('-25 months')) . "','visit','','',7)"); dbq("insert into engagement_daily values('" . date('Y-m-d', strtotime('-23 months')) . "','visit','','',7)");
purge_old(); ok((int)dbq("select count(*) from engagement_daily where day<'" . date('Y-m-d', strtotime('-24 months')) . "'")->fetchColumn() === 0 && (int)dbq("select count(*) from engagement_daily where day='" . date('Y-m-d', strtotime('-23 months')) . "'")->fetchColumn() === 1, 'totals older than 24 months are deleted by the daily clean up, newer ones stay');
[, $pr] = http('/privacy'); ok(str_contains($pr, 'We count how many times pages') && str_contains($pr, 'no cookie') && str_contains($pr, '24 months'), 'the privacy notice says what is counted and how long it is kept');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
