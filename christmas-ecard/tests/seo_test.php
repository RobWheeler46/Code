<?php
putenv('APP_ENV=development');
// php tests/seo_test.php : search engine and AI tool signals on the public pages
$work = sys_get_temp_dir() . '/ecard-seo-' . getmypid(); mkdir($work, 0775, true); $dbf = $work . '/t.sqlite';
putenv('DB_PATH=' . $dbf); putenv('POSTMARK_TOKEN='); putenv('SMTP_HOST='); putenv('SCHEDULER=off'); putenv('APP_URL=https://cards.example.org');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$port = random_int(19100, 19900); $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', __DIR__ . '/../public', __DIR__ . '/../public/index.php'], [1 => ['file', $work . '/srv.log', 'w'], 2 => ['file', $work . '/srv.log', 'a']], $pipes, null, array_merge(getenv(), ['DB_PATH' => $dbf, 'POSTMARK_TOKEN' => '', 'SMTP_HOST' => '', 'SCHEDULER' => 'off', 'APP_URL' => 'https://cards.example.org']));
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);
function get(string $p): array { global $port; $ch = curl_init("http://127.0.0.1:$port$p"); curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true]); $r = (string)curl_exec($ch); $c = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $hs = (int)curl_getinfo($ch, CURLINFO_HEADER_SIZE); curl_close($ch); return [$c, substr($r, $hs), substr($r, 0, $hs)]; }
function ld(string $html): array { preg_match_all('#<script type="application/ld\+json">(.*?)</script>#s', $html, $m); return array_map(fn($j) => json_decode($j, true), $m[1]); }

// robots.txt and sitemap.xml
[$c, $b, $h] = get('/robots.txt'); ok($c === 200 && stripos($h, 'content-type: text/plain') !== false && stripos($h, 'x-robots-tag') === false && str_contains($b, 'Sitemap: https://cards.example.org/sitemap.xml'), 'robots.txt is served as plain text, is itself not hidden, and names the sitemap');
ok(str_contains($b, "Disallow: /\n") && str_contains($b, 'Allow: /$') && str_contains($b, 'Allow: /help') && str_contains($b, 'Allow: /art/') && !str_contains($b, 'Allow: /admin') && !str_contains($b, 'Allow: /c/'), 'it closes everything and opens only the public pages and pictures');
[$c, $b, $h] = get('/sitemap.xml'); $x = @simplexml_load_string($b);
ok($c === 200 && $x && stripos($h, 'xml') !== false && stripos($h, 'x-robots-tag') === false, 'the sitemap is valid XML and is not hidden');
$locs = $x ? array_map(fn($u) => (string)$u->loc, iterator_to_array($x->url, false)) : [];
ok($locs === ['https://cards.example.org/', 'https://cards.example.org/help', 'https://cards.example.org/privacy', 'https://cards.example.org/terms'], 'it lists the four public pages and nothing else');
ok(!preg_match('#/c/|\?ref=|/admin|/compose#', $b), 'never a card link, a promotion label or a private screen');

// canonical, descriptions and share titles
$pages = ['/' => 'https://cards.example.org/', '/help' => 'https://cards.example.org/help', '/privacy' => 'https://cards.example.org/privacy', '/terms' => 'https://cards.example.org/terms'];
$desc = [];
foreach ($pages as $p => $canon) { [, $b] = get($p); preg_match('#<link rel="canonical" href="([^"]*)"#', $b, $m); ok(($m[1] ?? '') === $canon, "$p has its own canonical address"); preg_match('#name="description" content="([^"]*)"#', $b, $d); $desc[$p] = $d[1] ?? ''; }
ok(count(array_unique($desc)) === 4 && !in_array('', $desc, true), 'each public page has its own description');
[, $b] = get('/?occasion=christmas&ref=newsletter'); ok(str_contains($b, '<link rel="canonical" href="https://cards.example.org/">'), 'the home page with a filter or a promotion label points to the plain home page');
[, $b] = get('/help'); ok(str_contains($b, 'property="og:title" content="Help and FAQ"') && str_contains($b, '<title>Help | '), 'a page shares under its own name, not the home page name');
[, $b] = get('/'); ok(str_contains($b, '<title>Free Scout eCards to send by email | '), 'the home page title says what the service is');
foreach (['/login', '/register', '/card-preview?card=' . array_key_first(gallery_cards()), '/c/nonsense'] as $p) { [, $b] = get($p); ok(!str_contains($b, 'rel="canonical"') && !str_contains($b, 'ld+json'), "$p, which is private, has no canonical address or structured data"); }

// structured data
[, $b] = get('/'); $l = ld($b); $types = array_column($l, '@type');
ok(in_array('Organization', $types, true) && in_array('WebSite', $types, true), 'the home page names the organisation and the website');
$org = $l[array_search('Organization', $types, true)] ?? [];
ok(($org['name'] ?? '') === '7th Swindon Scouts' && ($org['address']['addressLocality'] ?? '') === 'Swindon' && !isset($org['address']['streetAddress']) && ($org['url'] ?? '') === 'https://www.7thswindon.org.uk/', 'it gives the town and the Group website, never a street address');
[, $b] = get('/help'); $l = ld($b); $faq = $l[0] ?? [];
ok(($faq['@type'] ?? '') === 'FAQPage' && count($faq['mainEntity'] ?? []) >= 8 && ($faq['mainEntity'][0]['name'] ?? '') === 'Is it really free?' && str_contains($faq['mainEntity'][0]['acceptedAnswer']['text'] ?? '', 'Sending is always free'), 'Help is marked up as questions and answers, with the same words as the page');
set_setting('help_extra', "Is it </script><b>safe?\nYes & always \"checked\".");
[, $b] = get('/help'); ok(substr_count($b, '</script>') === 2 && str_contains($b, '</script>') && ld($b)[0]['mainEntity'] !== null, 'a question an administrator adds cannot break out of the structured data');
set_setting('help_extra', '');

// the footer link to the Group's site
[, $b] = get('/'); ok(str_contains($b, 'A service of <a href="https://www.7thswindon.org.uk/">7th Swindon Scouts</a>'), 'the footer says the service belongs to the Group and links to its website');
set_setting('group_url', ''); [, $b] = get('/'); ok(!str_contains($b, 'A service of') && !str_contains($b, '"url":"https://www.7thswindon'), 'with the address blank, the link and the website address are left out');
set_setting('group_url', 'https://www.7thswindon.org.uk/');
// llms.txt: a short plain summary for AI tools
[$c, $b, $h] = get('/llms.txt');
ok($c === 200 && stripos($h, 'content-type: text/plain') !== false && stripos($h, 'x-robots-tag') === false && str_starts_with($b, '# 7th Swindon Scouts eCards') && str_contains($b, "\n> Free Scout themed eCards from 7th Swindon Scouts"), 'llms.txt is plain text, not hidden, and opens with the name and a one line summary');
ok(str_contains($b, '[Help and FAQ](https://cards.example.org/help)') && str_contains($b, '[Privacy and cookies](https://cards.example.org/privacy)') && str_contains($b, 'website: https://www.7thswindon.org.uk/'), 'it points to the public pages and the Group website');
ok(str_contains($b, 'Each card goes to up to ' . max_recipients() . ' people') && str_contains($b, 'works for ' . expiry_days() . ' days') && str_contains($b, 'a card link is never public'), 'its facts come from the live settings and say cards are private');
ok(!str_contains($b, 'optional') && !str_contains($b, 'donation'), 'it says nothing about donations while they are switched off');
set_setting('donations_enabled', '1'); [, $b2] = get('/llms.txt'); ok(str_contains($b2, 'a donation to the Group is optional'), 'and mentions the optional donation once they are on'); set_setting('donations_enabled', '0');
set_setting('group_url', ''); [, $b3] = get('/llms.txt'); ok(!str_contains($b3, 'website:'), 'with the Group address blank, no website is named'); set_setting('group_url', 'https://www.7thswindon.org.uk/');
[, $r] = get('/robots.txt'); ok(str_contains($r, 'Allow: /llms.txt'), 'robots.txt lets crawlers read it');
[, $m] = get('/sitemap.xml'); ok(!str_contains($m, 'llms'), 'it is not a page, so it is not in the sitemap');
proc_terminate($proc); proc_close($proc);
exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
