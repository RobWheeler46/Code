<?php
// php tests/qr_test.php : the QR code is made here. Scanning was checked once with an independent reader (jsQR) for five strings across versions 1 to 6;
// the pinned fingerprint below makes any later change to the output show up.
require __DIR__ . '/../src/qr.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
$fp = fn(array $m) => sha1(implode('|', array_map(fn($r) => implode('', array_map(fn($v) => $v ? '1' : '0', $r)), $m)));
$url = 'https://card.7thswindon.org.uk/'; $m = qr_matrix($url); $n = count($m);
ok($n === 29 && $fp($m) === 'c3d0e91c06a967d4dad8b2c44ff87ed558e864af', 'the campaign address always gives the same, scan-checked code');
foreach ([1 => 'A', 2 => str_repeat('a', 20), 3 => str_repeat('a', 40), 4 => str_repeat('a', 60), 5 => str_repeat('a', 80), 6 => str_repeat('a', 106)] as $v => $t) ok(count(qr_matrix($t)) === 17 + 4 * $v, "version $v is chosen for " . strlen($t) . ' characters');
$threw = false; try { qr_matrix(str_repeat('a', 107)); } catch (InvalidArgumentException $e) { $threw = true; } ok($threw, 'text that is too long is refused rather than made wrongly');
$finder = function (int $x, int $y) use ($m) { for ($dy = 0; $dy < 7; $dy++) for ($dx = 0; $dx < 7; $dx++) { $edge = $dx === 0 || $dx === 6 || $dy === 0 || $dy === 6; $core = $dx >= 2 && $dx <= 4 && $dy >= 2 && $dy <= 4; if ($m[$y + $dy][$x + $dx] !== ($edge || $core)) return false; } return true; };
ok($finder(0, 0) && $finder($n - 7, 0) && $finder(0, $n - 7), 'the three corner squares are in place');
$timing = true; for ($i = 8; $i < $n - 8; $i++) if ($m[6][$i] !== ($i % 2 === 0) || $m[$i][6] !== ($i % 2 === 0)) $timing = false; ok($timing && $m[$n - 8][8], 'the timing lines and the fixed dark square are in place');
// the two copies of the format information agree and form a valid code word
$bits1 = 0; $pos1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]; foreach ($pos1 as $i => [$x, $y]) $bits1 |= ($m[$y][$x] ? 1 : 0) << $i;
$bits2 = 0; for ($i = 0; $i < 8; $i++) $bits2 |= ($m[8][$n - 1 - $i] ? 1 : 0) << $i; for ($i = 8; $i < 15; $i++) $bits2 |= ($m[$n - 15 + $i][8] ? 1 : 0) << $i;
$chk = $bits1 ^ 0x5412; $r = $chk; for ($i = 14; $i >= 10; $i--) if (($r >> $i) & 1) $r ^= 0x537 << ($i - 10);
ok($bits1 === $bits2 && $r === 0 && ($chk >> 13) === 0 && (($chk >> 10) & 7) < 8, 'both copies of the format information match and pass their error check');
$svg = qr_svg('https://x.example/?a="b"&c=<d>');
ok(str_starts_with($svg, '<svg') && !str_contains($svg, '<script') && !str_contains($svg, '"b"') && str_contains($svg, 'viewBox="0 0 ' . (count(qr_matrix('https://x.example/?a="b"&c=<d>')) + 8)), 'the SVG escapes the text and keeps a four square quiet zone');
ok(!preg_match('/qrserver|http[s]?:\/\/(?!card|x\.example)[^"]*\.(png|svg)/', file_get_contents(__DIR__ . '/../src/qr.php')) && !str_contains(file_get_contents(__DIR__ . '/../src/admin.php'), 'qrserver'), 'no other website is used to make the code');
exit($GLOBALS['bad'] ?? 0);
