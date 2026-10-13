<?php
// Makes public/assets/share.jpg (1200x630), the picture WhatsApp, Facebook and others show when the site link is shared.
// Run once by hand: php scripts/make-share-image.php   Needs GD with WebP and FreeType, and a bold font (set FONT=path to override).
$root = dirname(__DIR__); $W = 1200; $H = 630;
$font = getenv('FONT') ?: (is_file('C:/Windows/Fonts/arialbd.ttf') ? 'C:/Windows/Fonts/arialbd.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf');
$im = imagecreatetruecolor($W, $H); imagesavealpha($im, true);
$navy = imagecolorallocate($im, 4, 31, 61); $yellow = imagecolorallocate($im, 245, 184, 0); $white = imagecolorallocate($im, 255, 255, 255); $pale = imagecolorallocate($im, 190, 205, 225);
imagefilledrectangle($im, 0, 0, $W, $H, $navy); imagefilledrectangle($im, 0, $H - 14, $W, $H, $yellow);

// two cards, slightly overlapping, on the right
$ch = 440; $cw = (int)round($ch * 1060 / 1484); $x = 578; $y = 84;
foreach (['pegs', 'chaos'] as $i => $id) {
    $c = imagecreatefromwebp("$root/public/assets/card-$id.webp"); $s = imagecreatetruecolor($cw, $ch); imagecopyresampled($s, $c, 0, 0, 0, 0, $cw, $ch, imagesx($c), imagesy($c));
    $px = $x + $i * ($cw - 36); $py = $y + ($i === 1 ? 0 : 36);
    imagefilledrectangle($im, $px - 4, $py - 4, $px + $cw + 3, $py + $ch + 3, $white); imagecopy($im, $s, $px, $py, 0, 0, $cw, $ch);
}
// logo and words on the left
$logo = imagecreatefrompng("$root/public/assets/brand/7th-swindon-circle-blue.png"); imagecopyresampled($im, $logo, 48, 48, 0, 0, 96, 96, imagesx($logo), imagesy($logo));
imagettftext($im, 22, 0, 160, 92, $white, $font, '7th Swindon Scouts'); imagettftext($im, 16, 0, 160, 124, $pale, $font, 'eCards');
$lines = ['Send a card,', 'Scout style']; foreach ($lines as $i => $l) imagettftext($im, 44, 0, 48, 300 + $i * 70, $i === 1 ? $yellow : $white, $font, $l);
imagettftext($im, 20, 0, 48, 520, $pale, $font, 'Free to send, private to open.');
imagejpeg($im, "$root/public/assets/share.jpg", 86); echo filesize("$root/public/assets/share.jpg") . " bytes\n";
