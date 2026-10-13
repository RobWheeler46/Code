<?php
// A small QR code generator, so the QR code is made here and the address is never sent to another website.
// Byte mode, error correction level M, versions 1 to 6 (up to 106 characters), the usual eight masks scored for the lowest penalty.

/** [raw codewords, blocks, error correction codewords per block] for versions 1 to 6 at level M. */
const QR_M = [1 => [26, 1, 10], 2 => [44, 1, 16], 3 => [70, 1, 26], 4 => [100, 2, 18], 5 => [134, 2, 24], 6 => [172, 4, 16]];

function qr_gf_mul(int $x, int $y): int { $z = 0; for ($i = 7; $i >= 0; $i--) { $z = ($z << 1) ^ (($z >> 7) * 0x11D); $z ^= (($y >> $i) & 1) * $x; } return $z & 0xFF; }
function qr_rs(array $data, int $degree): array {
    $div = array_fill(0, $degree, 0); $div[$degree - 1] = 1; $root = 1;
    for ($i = 0; $i < $degree; $i++) { for ($j = 0; $j < $degree; $j++) { $div[$j] = qr_gf_mul($div[$j], $root); if ($j + 1 < $degree) $div[$j] ^= $div[$j + 1]; } $root = qr_gf_mul($root, 2); }
    $res = array_fill(0, $degree, 0);
    foreach ($data as $b) { $f = $b ^ array_shift($res); $res[] = 0; foreach ($div as $i => $c) $res[$i] ^= qr_gf_mul($c, $f); }
    return $res;
}

/** Returns the module grid: an array of rows, each an array of booleans (true is dark). */
function qr_matrix(string $text): array {
    $bytes = array_values(unpack('C*', $text) ?: []); $n = count($bytes);
    for ($ver = 1; $ver <= 6; $ver++) if ($n <= QR_M[$ver][0] - QR_M[$ver][1] * QR_M[$ver][2] - 2) break;
    if ($ver > 6) throw new InvalidArgumentException('That text is too long for this QR code (106 characters at most).');
    [$raw, $blocks, $ecc] = QR_M[$ver]; $cap = $raw - $blocks * $ecc;
    $bits = []; $put = function (int $v, int $len) use (&$bits) { for ($i = $len - 1; $i >= 0; $i--) $bits[] = ($v >> $i) & 1; };
    $put(0b0100, 4); $put($n, 8); foreach ($bytes as $b) $put($b, 8);
    for ($i = 0; $i < 4 && count($bits) < $cap * 8; $i++) $bits[] = 0;
    while (count($bits) % 8) $bits[] = 0;
    $data = []; for ($i = 0; $i < count($bits); $i += 8) { $v = 0; for ($j = 0; $j < 8; $j++) $v = ($v << 1) | $bits[$i + $j]; $data[] = $v; }
    for ($pad = 0xEC; count($data) < $cap; $pad ^= 0xEC ^ 0x11) $data[] = $pad;
    // split into blocks, add error correction, interleave
    $short = $blocks - $raw % $blocks; $shortLen = intdiv($raw, $blocks); $bl = []; $k = 0;
    for ($i = 0; $i < $blocks; $i++) { $d = array_slice($data, $k, $shortLen - $ecc + ($i < $short ? 0 : 1)); $k += count($d); $bl[] = ['d' => $d, 'e' => qr_rs($d, $ecc)]; }
    $out = [];
    for ($i = 0; $i <= $shortLen - $ecc; $i++) foreach ($bl as $j => $b) if (isset($b['d'][$i])) $out[] = $b['d'][$i];
    for ($i = 0; $i < $ecc; $i++) foreach ($bl as $b) $out[] = $b['e'][$i];
    $size = 17 + 4 * $ver; $m = array_fill(0, $size, array_fill(0, $size, false)); $fn = $m;
    $set = function (int $x, int $y, bool $dark) use (&$m, &$fn, $size) { if ($x >= 0 && $y >= 0 && $x < $size && $y < $size) { $m[$y][$x] = $dark; $fn[$y][$x] = true; } };
    for ($i = 0; $i < $size; $i++) { $set(6, $i, $i % 2 === 0); $set($i, 6, $i % 2 === 0); }
    foreach ([[3, 3], [$size - 4, 3], [3, $size - 4]] as [$cx, $cy]) for ($dy = -4; $dy <= 4; $dy++) for ($dx = -4; $dx <= 4; $dx++) { $d = max(abs($dx), abs($dy)); $set($cx + $dx, $cy + $dy, $d !== 2 && $d !== 4); }
    $pos = [1 => [], 2 => [6, 18], 3 => [6, 22], 4 => [6, 26], 5 => [6, 30], 6 => [6, 34]][$ver]; $np = count($pos);
    foreach ($pos as $a => $px) foreach ($pos as $b => $py) { if (($a === 0 && $b === 0) || ($a === 0 && $b === $np - 1) || ($a === $np - 1 && $b === 0)) continue; for ($dy = -2; $dy <= 2; $dy++) for ($dx = -2; $dx <= 2; $dx++) $set($px + $dx, $py + $dy, max(abs($dx), abs($dy)) !== 1); }
    $format = function (int $mask) use ($set, $size) { // level M is 00
        $d = $mask; $r = $d; for ($i = 0; $i < 10; $i++) $r = ($r << 1) ^ (($r >> 9) * 0x537); $bits = (($d << 10) | $r) ^ 0x5412; $bit = fn($i) => (($bits >> $i) & 1) === 1;
        for ($i = 0; $i <= 5; $i++) $set(8, $i, $bit($i)); $set(8, 7, $bit(6)); $set(8, 8, $bit(7)); $set(7, 8, $bit(8)); for ($i = 9; $i < 15; $i++) $set(14 - $i, 8, $bit($i));
        for ($i = 0; $i < 8; $i++) $set($size - 1 - $i, 8, $bit($i)); for ($i = 8; $i < 15; $i++) $set(8, $size - 15 + $i, $bit($i)); $set(8, $size - 8, true);
    };
    $format(0); // reserves the format squares so the data skips them
    $i = 0; $total = count($out) * 8;
    for ($right = $size - 1; $right >= 1; $right -= 2) {
        if ($right === 6) $right = 5;
        for ($v = 0; $v < $size; $v++) for ($j = 0; $j < 2; $j++) {
            $x = $right - $j; $y = ((($right + 1) & 2) === 0) ? $size - 1 - $v : $v;
            if (!$fn[$y][$x] && $i < $total) { $m[$y][$x] = (($out[$i >> 3] >> (7 - ($i & 7))) & 1) === 1; $i++; }
        }
    }
    $mask = function (int $k) use (&$m, $fn, $size) { for ($y = 0; $y < $size; $y++) for ($x = 0; $x < $size; $x++) {
        if ($fn[$y][$x]) continue;
        $inv = match ($k) { 0 => ($x + $y) % 2 === 0, 1 => $y % 2 === 0, 2 => $x % 3 === 0, 3 => ($x + $y) % 3 === 0, 4 => (intdiv($x, 3) + intdiv($y, 2)) % 2 === 0, 5 => $x * $y % 2 + $x * $y % 3 === 0, 6 => ($x * $y % 2 + $x * $y % 3) % 2 === 0, 7 => (($x + $y) % 2 + $x * $y % 3) % 2 === 0 };
        if ($inv) $m[$y][$x] = !$m[$y][$x]; } };
    $best = null; $bestScore = PHP_INT_MAX;
    for ($k = 0; $k < 8; $k++) { $mask($k); $format($k); $s = qr_penalty($m, $size); if ($s < $bestScore) { $bestScore = $s; $best = $m; } $mask($k); }
    return $best;
}

function qr_penalty(array $m, int $size): int {
    $p = 0; $dark = 0;
    foreach ([false, true] as $col) for ($a = 0; $a < $size; $a++) { // runs of five or more, and finder like patterns, along rows then columns
        $run = 1; $line = [];
        for ($b = 0; $b < $size; $b++) $line[] = $col ? $m[$b][$a] : $m[$a][$b];
        for ($b = 1; $b < $size; $b++) { if ($line[$b] === $line[$b - 1]) { $run++; if ($run === 5) $p += 3; elseif ($run > 5) $p++; } else $run = 1; }
        $s = implode('', array_map(fn($v) => $v ? '1' : '0', $line)); $p += 40 * (substr_count($s, '000010111010') + substr_count($s, '010111010000'));
    }
    for ($y = 0; $y < $size; $y++) for ($x = 0; $x < $size; $x++) { if ($m[$y][$x]) $dark++; if ($x + 1 < $size && $y + 1 < $size && $m[$y][$x] === $m[$y][$x + 1] && $m[$y][$x] === $m[$y + 1][$x] && $m[$y][$x] === $m[$y + 1][$x + 1]) $p += 3; }
    return $p + 10 * max(0, (int)(abs($dark * 20 - $size * $size * 10) / ($size * $size)) );
}

/** The code as a small SVG with the four square quiet zone readers need. */
function qr_svg(string $text, int $px = 320): string {
    $m = qr_matrix($text); $n = count($m); $d = '';
    for ($y = 0; $y < $n; $y++) for ($x = 0; $x < $n; $x++) if ($m[$y][$x]) $d .= 'M' . ($x + 4) . ',' . ($y + 4) . 'h1v1h-1z';
    $v = $n + 8;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' . $v . ' ' . $v . '" width="' . $px . '" height="' . $px . '" shape-rendering="crispEdges" role="img" aria-label="QR code for ' . htmlspecialchars($text, ENT_QUOTES) . '"><rect width="' . $v . '" height="' . $v . '" fill="#fff"/><path d="' . $d . '" fill="#000"/></svg>';
}
