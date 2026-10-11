<?php
// EC-02 (build pack v2.7): safe artwork intake. No route calls this yet (EC-03 adds the admin screen), and it never touches the
// database, so nothing it stores can become public by itself. Files go under data/library, which is outside the web root.
// Limits below are PROPOSALS for decision ED-02, sized from the twelve real designs (all 1060 x 1484, 340 to 490 KB, 1.6 megapixels).

function art_limits(): array {
    $n = fn(string $k, int $d): int => max(0, (int)setting($k, '')) ?: $d; // an unset or blank setting means the default
    return [
        'max_bytes' => $n('art_max_bytes', 8 * 1024 * 1024),
        'max_pixels' => $n('art_max_pixels', 12000000), // decoded size is about 5 bytes a pixel, so 12 MP needs about 60 MB
        'max_side' => $n('art_max_side', 6000),
        'min_width' => $n('art_min_width', 800),
        'full_width' => $n('art_full_width', 1600),
        'thumb_width' => $n('art_thumb_width', 480),
    ];
}
function art_dir(): string { return rtrim((string)env('LIBRARY_DIR', ROOT . '/data/library'), '/\\'); }

/** The real format from the first bytes, never from the file name or the browser's claimed type. */
function art_sniff(string $path): ?string {
    $h = (string)@file_get_contents($path, false, null, 0, 16);
    if (str_starts_with($h, "\x89PNG\r\n\x1a\n")) return 'png';
    if (str_starts_with($h, "\xff\xd8\xff")) return 'jpg';
    if (strlen($h) >= 12 && str_starts_with($h, 'RIFF') && substr($h, 8, 4) === 'WEBP') return 'webp';
    return null;
}

/** JPEG orientation from the EXIF block (the exif extension is not always installed). 1 when absent or unreadable. */
function art_jpeg_orientation(string $path): int {
    $d = (string)@file_get_contents($path, false, null, 0, 65536); $n = strlen($d);
    for ($i = 2; $i + 4 < $n && $d[$i] === "\xff"; ) {
        $m = ord($d[$i + 1]); $len = unpack('n', substr($d, $i + 2, 2))[1];
        if ($m === 0xE1 && substr($d, $i + 4, 6) === "Exif\0\0") {
            $t = $i + 10; $le = substr($d, $t, 2) === 'II'; $u16 = fn($o) => unpack($le ? 'v' : 'n', substr($d, $t + $o, 2))[1]; $u32 = fn($o) => unpack($le ? 'V' : 'N', substr($d, $t + $o, 4))[1];
            $ifd = $u32(4); $cnt = $u16($ifd);
            for ($k = 0; $k < $cnt && $k < 64; $k++) { $e = $ifd + 2 + $k * 12; if ($u16($e) === 0x0112) { $v = $u16($e + 8); return $v >= 1 && $v <= 8 ? $v : 1; } }
            return 1;
        }
        if ($m === 0xDA) return 1;
        $i += 2 + $len;
    }
    return 1;
}

/** Checks one file. Returns ['ok'=>bool, 'errors'=>[plain sentences], 'format'=>, 'width'=>, 'height'=>]. Decodes nothing until the cheap checks pass. */
function art_validate(string $path): array {
    $L = art_limits(); $err = []; $r = ['ok' => false, 'errors' => &$err, 'format' => null, 'width' => 0, 'height' => 0];
    if (!is_file($path)) { $err[] = 'No file was received. Please choose the picture again.'; return $r; }
    $size = (int)filesize($path);
    if ($size < 100) $err[] = 'That file is empty or too small to be a picture.';
    if ($size > $L['max_bytes']) $err[] = 'That file is too large. The most we accept is ' . round($L['max_bytes'] / 1048576, 1) . ' MB.';
    $fmt = art_sniff($path); $r['format'] = $fmt;
    if (!$fmt) { $err[] = 'We can only accept PNG, JPEG or WebP pictures. SVG, GIF and other file types are not accepted.'; return $r; }
    $dim = @getimagesize($path); // reads the header only
    if (!$dim || $dim[0] < 1 || $dim[1] < 1) { $err[] = 'That picture could not be read. It may be damaged.'; return $r; }
    [$w, $h] = $dim; $r['width'] = $w; $r['height'] = $h;
    if ($w > $L['max_side'] || $h > $L['max_side']) $err[] = "That picture is too big ($w by $h). The longest side can be at most {$L['max_side']} pixels.";
    if ($w * $h > $L['max_pixels']) $err[] = 'That picture has too many pixels to process safely.';
    elseif ($w * $h * 5 > (art_memory_bytes() * 0.5)) $err[] = 'That picture is too big for this server to process safely.';
    if ($w < $L['min_width']) $err[] = "That picture is too small ($w pixels wide). Please use one at least {$L['min_width']} pixels wide so it stays sharp.";
    if ($err) return $r;
    $img = @imagecreatefromstring((string)file_get_contents($path)); // proves it really decodes
    if (!$img) { $err[] = 'That picture could not be read. It may be damaged. Please export it again.'; return $r; }
    imagedestroy($img);
    $r['ok'] = true; return $r;
}
function art_memory_bytes(): int {
    $m = trim((string)ini_get('memory_limit')); if ($m === '-1' || $m === '') return 512 * 1048576;
    $n = (int)$m; return match (strtolower(substr($m, -1))) { 'g' => $n * 1073741824, 'm' => $n * 1048576, 'k' => $n * 1024, default => $n };
}

/** Re-encodes to WebP at a width, upright, with all metadata dropped (GD writes only pixels). Returns the written path or null. */
function art_derivative(string $src, string $dest, int $width, int $orientation): ?string {
    $im = @imagecreatefromstring((string)file_get_contents($src)); if (!$im) return null;
    $rot = [3 => 180, 6 => -90, 8 => 90][$orientation] ?? 0;
    if ($rot) { $n = imagerotate($im, $rot, 0); imagedestroy($im); if (!$n) return null; $im = $n; }
    $w = imagesx($im); $h = imagesy($im);
    if ($w > $width) { $n = imagescale($im, $width, (int)round($h * $width / $w), IMG_BICUBIC); imagedestroy($im); if (!$n) return null; $im = $n; }
    imagepalettetotruecolor($im); imagesavealpha($im, true);
    $ok = @imagewebp($im, $dest, 85); imagedestroy($im);
    return $ok && is_file($dest) && filesize($dest) > 0 ? $dest : null;
}

/**
 * Validates, processes and stores one upload. All work happens in a quarantine folder and the files move to their final names
 * only when every step has worked, so a failure leaves nothing behind. Returns ['ok'=>true,'asset'=>[...]] or ['ok'=>false,'errors'=>[...]].
 * The caller (the admin screen, later) must already have checked the user, the CSRF token and is_uploaded_file().
 */
function art_store(string $path): array {
    $v = art_validate($path);
    if (!$v['ok']) return ['ok' => false, 'errors' => $v['errors']];
    $L = art_limits(); $id = bin2hex(random_bytes(16)); $tmp = art_dir() . '/tmp/' . $id;
    $final = art_dir() . '/' . substr($id, 0, 2); $made = [];
    try {
        if (!@mkdir($tmp, 0775, true) && !is_dir($tmp)) throw new RuntimeException('workspace');
        $orient = $v['format'] === 'jpg' ? art_jpeg_orientation($path) : 1;
        $orig = "$tmp/o-$id." . $v['format']; if (!copy($path, $orig)) throw new RuntimeException('copy');
        $full = art_derivative($path, "$tmp/f-$id.webp", $L['full_width'], $orient); $thumb = art_derivative($path, "$tmp/t-$id.webp", $L['thumb_width'], $orient);
        if (!$full || !$thumb) throw new RuntimeException('process');
        [$fw, $fh] = getimagesize($full);
        if (!is_dir($final) && !@mkdir($final, 0775, true) && !is_dir($final)) throw new RuntimeException('store');
        foreach (glob("$tmp/*") as $f) { $to = "$final/" . basename($f); if (!rename($f, $to)) throw new RuntimeException('commit'); $made[] = $to; }
        @rmdir($tmp);
        return ['ok' => true, 'errors' => [], 'asset' => ['id' => $id, 'format' => $v['format'], 'sha256' => hash_file('sha256', "$final/o-$id." . $v['format']),
            'width' => $v['width'], 'height' => $v['height'], 'full_key' => substr($id, 0, 2) . "/f-$id.webp", 'thumb_key' => substr($id, 0, 2) . "/t-$id.webp",
            'original_key' => substr($id, 0, 2) . "/o-$id." . $v['format'], 'full_width' => $fw, 'full_height' => $fh]];
    } catch (Throwable $e) {
        foreach ($made as $f) @unlink($f);
        foreach (glob("$tmp/*") ?: [] as $f) @unlink($f);
        @rmdir($tmp); @rmdir($final);
        return ['ok' => false, 'errors' => ['We could not process that picture. Nothing was saved. Please try again, or export it again from your design tool.']];
    }
}

/** Removes quarantine folders left by an interrupted upload. Safe to run from cron. Returns how many were removed. */
function art_cleanup_tmp(int $olderThan = 3600): int {
    $n = 0;
    foreach (glob(art_dir() . '/tmp/*', GLOB_ONLYDIR) ?: [] as $d) {
        if (filemtime($d) > time() - $olderThan) continue;
        foreach (glob("$d/*") ?: [] as $f) @unlink($f);
        if (@rmdir($d)) $n++;
    }
    return $n;
}

/** Every stored library file as relative name => absolute path (the quarantine folder is skipped). Used by the backup. */
function library_files(): array {
    $d = art_dir(); $o = []; if (!is_dir($d)) return $o;
    foreach (glob("$d/*/*") ?: [] as $f) if (is_file($f) && basename(dirname($f)) !== 'tmp') $o[basename(dirname($f)) . '/' . basename($f)] = $f;
    return $o;
}
