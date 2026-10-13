<?php
putenv('APP_ENV=development');
// php tests/uploads_test.php : EC-02 safe artwork intake (CAT-01, CAT-02, CAT-10 sizes, CAT-12 failure leaves nothing)
$work = sys_get_temp_dir() . '/ecard-up-' . getmypid(); mkdir($work, 0775, true);
putenv('DB_PATH=' . $work . '/t.sqlite'); putenv('LIBRARY_DIR=' . $work . '/library'); putenv('POSTMARK_TOKEN=');
require __DIR__ . '/../src/app.php';
function ok($c, string $m): void { echo ($c ? 'PASS ' : 'FAIL ') . $m . "\n"; if (!$c) $GLOBALS['bad'] = 1; }
function files(string $d): array { $o = []; if (!is_dir($d)) return $o; foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($d, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::SELF_FIRST) as $f) if ($f->isFile()) $o[] = $f->getPathname(); return $o; }
function canvas(int $w, int $h) { $im = imagecreatetruecolor($w, $h); imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 10, 60, 140)); imagestring($im, 5, 20, 20, 'Merry Christmas', imagecolorallocate($im, 255, 255, 255)); return $im; }
function save(string $kind, int $w, int $h, string $to): string { $im = canvas($w, $h); match ($kind) { 'png' => imagepng($im, $to), 'jpg' => imagejpeg($im, $to, 90), 'webp' => imagewebp($im, $to, 85), 'gif' => imagegif($im, $to) }; imagedestroy($im); return $to; }
$lib = $work . '/library';

// valid files
foreach (['png' => 'a-santa-card.png', 'jpg' => 'b.jpg', 'webp' => 'c.webp'] as $k => $name) {
    $src = save($k, 1060, 1484, "$work/$name"); $r = art_store($src);
    ok($r['ok'] && $r['asset']['format'] === $k, "CAT-01: a valid $k is accepted");
    if ($k === 'png') $png = $r['asset'];
}
ok(count(files($lib)) === 9, 'each upload stores exactly an original and two derivatives');
$all = implode("\n", files($lib));
ok(!str_contains($all, 'santa') && !str_contains($all, '/public/') && preg_match('#/library/[0-9a-f]{2}/[of]-[0-9a-f]{32}\.#', str_replace('\\', '/', $all)), 'stored names are opaque (no file name kept) and live outside the web root');
ok($png['sha256'] === hash_file('sha256', "$work/a-santa-card.png") && hash_file('sha256', "$lib/" . $png['original_key']) === $png['sha256'], 'the original is kept byte for byte');
[$fw, $fh] = getimagesize("$lib/" . $png['full_key']); [$tw] = getimagesize("$lib/" . $png['thumb_key']);
ok($fw === 1060 && $fh === 1484 && $tw === 480, 'the full picture is not cropped or upscaled; the thumbnail is 480 wide');

// metadata stripped, orientation fixed
$j = "$work/exif.jpg"; $im = canvas(1200, 900); ob_start(); imagejpeg($im, null, 90); $jpg = ob_get_clean();
$tiff = "MM\0*\0\0\0\x08" . "\0\x01" . "\x01\x12\0\x03\0\0\0\x01\0\x06\0\0" . "\0\0\0\0";
$app1 = "\xff\xe1" . pack('n', 2 + 6 + strlen($tiff)) . "Exif\0\0" . $tiff; $com = "\xff\xfe" . pack('n', 2 + 9) . 'SECRETGPS';
file_put_contents($j, substr($jpg, 0, 2) . $app1 . $com . substr($jpg, 2));
ok(art_jpeg_orientation($j) === 6, 'the EXIF orientation is read from the file');
$r = art_store($j); [$ow, $oh] = getimagesize("$lib/" . $r['asset']['full_key']);
ok($r['ok'] && $oh > $ow, 'a sideways phone photo is stored upright');
ok(str_contains(file_get_contents("$lib/" . $r['asset']['original_key']), 'SECRETGPS') && !str_contains(file_get_contents("$lib/" . $r['asset']['full_key']), 'SECRETGPS') && !str_contains(file_get_contents("$lib/" . $r['asset']['thumb_key']), 'SECRETGPS'), 'the private original keeps its metadata but the public derivatives carry none');

// rejects: each must leave the library unchanged
$before = files($lib);
$samples = [];
file_put_contents($samples['php'] = "$work/evil.png", "<?php system(\$_GET['c']); ?>" . str_repeat(' ', 300));
file_put_contents($samples['svg'] = "$work/a.png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' . str_repeat(' ', 300) . '</svg>');
$samples['gif'] = save('gif', 1000, 900, "$work/a.gif");
file_put_contents($samples['corrupt'] = "$work/c.jpg", "\xff\xd8\xff\xe0" . random_bytes(4000));
$samples['small'] = save('png', 400, 500, "$work/small.png");
$bomb = file_get_contents(save('png', 1000, 900, "$work/b.png")); file_put_contents($samples['bomb'] = "$work/bomb.png", substr($bomb, 0, 16) . pack('N', 20000) . pack('N', 20000) . substr($bomb, 24));
$mp = file_get_contents(save('png', 1000, 900, "$work/m.png")); file_put_contents($samples['pixels'] = "$work/mp.png", substr($mp, 0, 16) . pack('N', 5000) . pack('N', 5000) . substr($mp, 24));
$full = file_get_contents(save('png', 1060, 1484, "$work/t.png")); file_put_contents($samples['truncated'] = "$work/trunc.png", substr($full, 0, 120));
file_put_contents($samples['empty'] = "$work/empty.png", '');
foreach ($samples as $k => $p) { $r = art_store($p); ok(!$r['ok'] && $r['errors'] && !isset($r['asset']), "CAT-02: $k is rejected with a plain explanation"); }
ok(art_store("$work/missing.png")['ok'] === false, 'a missing file is rejected');
ok(files($lib) === $before && !glob("$lib/tmp/*"), 'CAT-12: rejected files leave nothing stored and no quarantine folder');
set_setting('art_max_bytes', '1000'); $r = art_store("$work/a-santa-card.png"); set_setting('art_max_bytes', '');
ok(!$r['ok'] && str_contains(implode(' ', $r['errors']), 'too large'), 'the size limit comes from a setting and is enforced');

// storage failure
@rmdir("$lib/tmp"); file_put_contents("$lib/tmp", 'x'); // a file where the quarantine folder should be
$r = art_store("$work/b.jpg"); unlink("$lib/tmp");
ok(!$r['ok'] && str_contains(implode(' ', $r['errors']), 'Nothing was saved'), 'CAT-12: if the store cannot be written the user is told nothing was saved');

// backup and restore carry the stored artwork (CAT-13)
$copy = $work . '/offsite'; @mkdir($copy); putenv('BACKUP_KEY=upload test key 123'); putenv('BACKUP_COPY_DIR=' . $copy);
$bk = backup_run(); $rs = backup_restore($bk['zip'], 'upload test key 123', $work . '/restored'); putenv('BACKUP_KEY='); putenv('BACKUP_COPY_DIR=');
$norm = fn($p) => str_replace(chr(92), '/', $p); $root = $norm($work . '/restored/library/');
$stored = array_keys(library_files()); $back = array_map(fn($f) => substr($norm($f), strlen($root)), files($work . '/restored/library'));
sort($stored); sort($back);
ok($rs['ok'] && $stored && $stored === $back, 'CAT-13: a restored backup contains every stored original and derivative');
@unlink($bk['zip']);

// quarantine cleanup
mkdir("$lib/tmp/old", 0775, true); touch("$lib/tmp/old/x", time() - 7200); touch("$lib/tmp/old", time() - 7200); mkdir("$lib/tmp/fresh", 0775, true);
ok(art_cleanup_tmp(3600) === 1 && !is_dir("$lib/tmp/old") && is_dir("$lib/tmp/fresh"), 'stale quarantine folders are removed, fresh ones kept');

exec('rmdir /s /q ' . escapeshellarg($work) . ' 2>nul'); if (is_dir($work)) exec('rm -rf ' . escapeshellarg($work));
exit($GLOBALS['bad'] ?? 0);
