<?php
// php tests/section_leaders_test.php : SL-01 to SL-09, section leader suggestions and the Trustee decision, over real HTTP. Made up members only.
$work = sys_get_temp_dir() . '/ecard-sl-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$roles = ['tged' => 'tgeditor', 'trev' => 'tgreviewer', 'tapp' => 'tgapprover', 'tdis' => 'tgdispatch', 'leadA' => 'slleader', 'leadB' => 'slleader', 'camp' => 'campaign']; $U = [];
foreach ($roles as $n => $r) { $sec = b32e(random_bytes(10)); q("insert into users(name,email,pass,verified,created,terms_version,is_admin,roles,totp_secret) values(?,?,?,1,?,?,1,?,?)", [$n, strtolower("$n@x.example"), password_hash('Test-pass-123', PASSWORD_DEFAULT), time(), TERMS_VERSION, $r, $sec]); $U[$n] = [strtolower("$n@x.example"), $sec]; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function http(string $path, string $jar, ?array $post = null): array { global $port; $ch = curl_init("http://127.0.0.1:$port$path"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_FOLLOWLOCATION => false]); if ($post !== null) { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($post)); } $b = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch); return [$c, $b]; }
function tok(string $h): string { preg_match('/name="_c" value="([^"]+)"/', $h, $m); return $m[1] ?? ''; }
function login(array $u): string { $j = tempnam(sys_get_temp_dir(), 'jar'); [, $b] = http('/login', $j); http('/login', $j, ['_c' => tok($b), 'email' => $u[0], 'password' => 'Test-pass-123']); [, $m] = http('/mfa', $j); http('/mfa', $j, ['_c' => tok($m), 'code' => totp($u[1], time())]); return $j; }
function hp(string $path, string $jar, array $f, string $from = '/admin'): array { return http($path, $jar, ['_c' => tok(http($from, $jar)[1])] + $f); }
function menu(string $html): array { if (!preg_match('#<nav aria-label="Workspace">(.*?)</nav>#s', $html, $m)) return []; preg_match_all('#<a href="([^"]+)"#', $m[1], $a); return $a[1]; }
function pdo(): PDO { global $dbf; return new PDO('sqlite:' . $dbf); }
$J = []; foreach ($U as $n => $u) $J[$n] = login($u);
$all = ['/private/section-suggestions', '/private/section-suggestions/edit?p=1', '/private/trustee-greetings/suggestions'];

// off by default: nothing answers and no member data tables exist
$e = []; foreach ($J as $n => $j) foreach ($all as $p) if (http($p, $j)[0] !== 404) $e[] = "$n $p"; ok(!$e, 'with the switches off every screen answers Page not found for everyone');
ok(!array_filter(pdo()->query("select name from sqlite_master where type='table'")->fetchAll(PDO::FETCH_COLUMN), fn($n) => str_starts_with($n, 'gm_')), 'no roster tables exist until the feature is used');
set_setting('private_section_greetings', '1'); ok(http($all[0], $J['leadA'])[0] === 404, 'the leader switch alone is not enough: Trustee greetings must be on too');
set_setting('private_trustee_greetings', '1');

// who can open what
$want = ['/private/section-suggestions' => ['leadA', 'leadB'], '/private/trustee-greetings/suggestions' => ['tged', 'trev', 'tapp']]; $e = [];
foreach ($want as $p => $who) foreach ($J as $n => $j) if ((http($p, $j)[0] === 200) !== in_array($n, $who, true)) $e[] = "$n $p";
ok(!$e, 'leaders open only their screen, Trustee roles only the queue; dispatch operator and campaign manager are refused' . ($e ? ': ' . implode(', ', $e) : ''));
ok(http('/private/trustee-greetings', $J['leadA'])[0] === 404 && http('/admin/health', $J['leadA'])[0] === 403 && http('/admin/library', $J['leadA'])[0] === 403, 'a leader cannot reach the Trustee console or any admin tool');
ok(menu(http('/admin', $J['leadA'])[1]) === ['/admin', '/private/section-suggestions'], 'a leader sees only Overview and Suggest messages');
ok(str_contains(http('/private/section-suggestions', $J['leadA'])[1], 'not assigned'), 'an unassigned leader is told so and sees no members');

// roster: first names only, nothing that looks like contact data
[$c] = hp('/private/trustee-greetings/suggestions/roster', $J['trev'], ['roster' => 'Cubs, Alex'], '/private/trustee-greetings/suggestions'); ok($c === 404 && (int)pdo()->query("select count(*) from gm_person")->fetchColumn() === 0, 'a reviewer cannot change the roster');
hp('/private/trustee-greetings/suggestions/roster', $J['tged'], ['roster' => "Cubs, Alex\nCubs, Sam\nScouts, Robin\nCubs, Sam Smith\nCubs, Kim2\nCubs, kim@home.example\njunk"], '/private/trustee-greetings/suggestions');
$names = pdo()->query("select first_name from gm_person order by first_name")->fetchAll(PDO::FETCH_COLUMN); ok($names === ['Alex', 'Robin', 'Sam'], 'only clean "section, first name" lines are added; surnames, digits, emails and junk are refused');
$pid = fn($n) => (int)pdo()->query("select id from gm_person where first_name='$n'")->fetchColumn(); $sec = fn($n) => (int)pdo()->query("select id from gm_section where name='$n'")->fetchColumn();

// assignments
hp('/private/trustee-greetings/suggestions/assign', $J['tged'], ['email' => 'camp@x.example', 'section_id' => $sec('Cubs')], '/private/trustee-greetings/suggestions'); ok((int)pdo()->query("select count(*) from gm_assign")->fetchColumn() === 0, 'someone without the Section leader role cannot be assigned');
hp('/private/trustee-greetings/suggestions/assign', $J['tged'], ['email' => 'leada@x.example', 'section_id' => $sec('Cubs')], '/private/trustee-greetings/suggestions');
hp('/private/trustee-greetings/suggestions/assign', $J['tged'], ['email' => 'leadb@x.example', 'section_id' => $sec('Scouts')], '/private/trustee-greetings/suggestions');
[, $l] = http('/private/section-suggestions', $J['leadA']); ok(str_contains($l, 'Alex') && str_contains($l, 'Sam') && !str_contains($l, 'Robin') && !str_contains($l, '@x.example'), 'a leader sees the members of their own section only, with no email or contact detail');
ok(http('/private/section-suggestions/edit?p=' . $pid('Robin'), $J['leadA'])[0] === 404, 'another section\'s member looks like a missing page');
[$c] = hp('/private/section-suggestions/save', $J['leadA'], ['p' => $pid('Robin'), 'rev' => 0, 'body' => 'Hi', 'do' => 'submit'], '/private/section-suggestions'); ok($c === 404 && (int)pdo()->query("select count(*) from gm_sugg")->fetchColumn() === 0, 'a leader cannot save for another section even by posting directly');

// drafting
$A = $pid('Alex'); $ed = '/private/section-suggestions/edit?p=' . $A; $save = fn($f, $j = null) => hp('/private/section-suggestions/save', $j ?? $J['leadA'], $f + ['p' => $A], $ed);
$save(['rev' => 0, 'body' => str_repeat('word ', 90), 'do' => 'save']); ok((int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 0, 'a message over the word limit is refused');
$save(['rev' => 0, 'body' => 'See www.example.org', 'do' => 'save']); ok((int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 0, 'links and email addresses are refused');
$save(['rev' => 0, 'body' => 'Well done Alex, <b>great</b> year.', 'do' => 'save']); ok(pdo()->query("select status from gm_sugg")->fetchColumn() === 'draft' && str_contains(http($ed, $J['leadA'])[1], '&lt;b&gt;great&lt;/b&gt;'), 'a draft is saved and shown safely as plain text');
$save(['rev' => 0, 'body' => 'Stale write', 'do' => 'save']); ok((int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 1, 'saving from an out of date copy is refused');
$save(['rev' => 1, 'body' => 'Well done Alex, great year.', 'do' => 'submit']); ok(pdo()->query("select status from gm_sugg")->fetchColumn() === 'submitted' && (int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 2 && sl_pending_count() === 1, 'submitting adds a new revision and counts as pending, which blocks approval');
$save(['rev' => 2, 'body' => 'Sneaky edit', 'do' => 'save']); ok((int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 2, 'a submitted suggestion cannot be edited');
ok(pdo()->query("select body from gm_rev where rev=1")->fetchColumn() === 'Well done Alex, <b>great</b> year.', 'earlier revisions are kept unchanged');

// the Trustee decision
$G = '/private/trustee-greetings/suggestions'; $sid = (int)pdo()->query("select id from gm_sugg")->fetchColumn(); $dec = fn($f, $j) => hp('/private/trustee-greetings/suggestions/decide', $j, $f + ['id' => $sid], $G);
ok(str_contains(http($G, $J['trev'])[1], 'Well done Alex, great year.') && !str_contains(http($G, $J['trev'])[1], 'Sneaky'), 'the queue shows the submitted revision');
[$c] = $dec(['rev' => 2, 'outcome' => 'accept'], $J['tged']); ok($c === 404 && sl_pending_count() === 1, 'an editor cannot decide');
$dec(['rev' => 1, 'outcome' => 'accept'], $J['trev']); ok(sl_pending_count() === 1, 'a decision on an old revision is refused');
$dec(['rev' => 2, 'outcome' => 'changes', 'feedback' => ''], $J['trev']); ok(sl_pending_count() === 1, 'asking for changes without feedback is refused');
$dec(['rev' => 2, 'outcome' => 'changes', 'feedback' => 'Please mention the camp.'], $J['trev']); ok(pdo()->query("select status from gm_sugg")->fetchColumn() === 'changes' && sl_pending_count() === 0, 'changes requested: the leader is unblocked and nothing is pending');
ok(str_contains(http($ed, $J['leadA'])[1], 'Please mention the camp.'), 'the leader sees the feedback');
$save(['rev' => 2, 'body' => 'Well done Alex, loved the camp.', 'do' => 'submit']); $dec(['rev' => 3, 'outcome' => 'accept'], $J['tapp']);
ok(pdo()->query("select status from gm_sugg")->fetchColumn() === 'accepted' && pdo()->query("select body from gm_draft where person_id=$A")->fetchColumn() === 'Well done Alex, loved the camp.', 'accepting copies that exact revision into a Trustee draft');
ok((int)pdo()->query("select count(*) from recipients")->fetchColumn() + (int)pdo()->query("select count(*) from sends")->fetchColumn() === 0, 'nothing was queued or sent');
$save(['rev' => 3, 'body' => 'Late edit', 'do' => 'save']); ok((int)pdo()->query("select count(*) from gm_rev")->fetchColumn() === 3, 'an accepted suggestion is locked');
$au = implode(' ', pdo()->query("select detail from audit where action like 'sl_%'")->fetchAll(PDO::FETCH_COLUMN)); ok($au !== '' && !str_contains($au, 'camp') && !str_contains($au, 'great') && !str_contains($au, 'Alex'), 'the audit trail names ids and outcomes, never the message or a name');

// deadline and reassignment
hp('/private/trustee-greetings/suggestions/deadline', $J['tged'], ['section_id' => $sec('Cubs'), 'do' => 'set', 'deadline' => '2020-01-01T10:00'], $G);
$S = $pid('Sam'); hp('/private/section-suggestions/save', $J['leadA'], ['p' => $S, 'rev' => 0, 'body' => 'Late one', 'do' => 'save'], $ed); ok((int)pdo()->query("select count(*) from gm_sugg where person_id=$S")->fetchColumn() === 0, 'after the deadline a leader can no longer write');
hp('/private/trustee-greetings/suggestions/deadline', $J['tged'], ['section_id' => $sec('Cubs'), 'do' => 'set', 'deadline' => ''], $G);
hp('/private/trustee-greetings/suggestions/deadline', $J['tged'], ['section_id' => $sec('Cubs'), 'do' => 'close'], $G); hp('/private/section-suggestions/save', $J['leadA'], ['p' => $S, 'rev' => 0, 'body' => 'Closed one', 'do' => 'save'], $ed); ok((int)pdo()->query("select count(*) from gm_sugg where person_id=$S")->fetchColumn() === 0, 'a closed section refuses writes');
hp('/private/trustee-greetings/suggestions/deadline', $J['tged'], ['section_id' => $sec('Cubs'), 'do' => 'reopen'], $G); hp('/private/section-suggestions/save', $J['leadA'], ['p' => $S, 'rev' => 0, 'body' => 'Open again', 'do' => 'save'], $ed); ok((int)pdo()->query("select count(*) from gm_sugg where person_id=$S")->fetchColumn() === 1, 'reopening lets the leader write again');
hp('/private/trustee-greetings/suggestions/assign', $J['tged'], ['email' => 'leada@x.example', 'section_id' => $sec('Scouts')], $G); ok(http('/private/section-suggestions/edit?p=' . $S, $J['leadA'])[0] === 404 && http($ed, $J['leadA'])[0] === 404, 'reassigning a leader removes access to the old section at once');
hp('/private/trustee-greetings/suggestions/assign', $J['tged'], ['email' => 'leada@x.example', 'remove' => 1, 'section_id' => 0], $G); ok(str_contains(http('/private/section-suggestions', $J['leadA'])[1], 'not assigned'), 'removing an assignment ends access immediately');
q("insert or replace into gm_assign(user_id,section_id,until,created) values((select id from users where name='leadA'),?,?,?)", [$sec('Cubs'), time() - 60, time()]); ok(str_contains(http('/private/section-suggestions', $J['leadA'])[1], 'not assigned'), 'an assignment past its end date gives no access');

// erase
hp('/private/trustee-greetings/suggestions/erase', $J['tged'], ['confirm' => 'ERASE'], $G); ok((int)pdo()->query("select count(*) from gm_person")->fetchColumn() === 3, 'only an approver can erase');
hp('/private/trustee-greetings/suggestions/erase', $J['tapp'], ['confirm' => 'no'], $G); ok((int)pdo()->query("select count(*) from gm_person")->fetchColumn() === 3, 'erasing needs the word ERASE');
hp('/private/trustee-greetings/suggestions/erase', $J['tapp'], ['confirm' => 'ERASE'], $G); ok(array_sum(array_map(fn($t) => (int)pdo()->query("select count(*) from $t")->fetchColumn(), ['gm_person', 'gm_section', 'gm_sugg', 'gm_rev', 'gm_decision', 'gm_draft', 'gm_assign'])) === 0, 'erase removes the roster, suggestions, decisions and drafts');

proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
