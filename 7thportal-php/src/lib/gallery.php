<?php
// Ported from the Node version's src/lib/gallery.js. Node used Jimp (pure
// JS) for image processing; PHP's GD extension is the equivalent here -
// bundled with virtually every PHP install, no Composer dependency needed.
// Same approach: decode whatever format was uploaded, resize if needed,
// optionally stamp a watermark, then re-encode as JPEG. Re-encoding through
// GD naturally drops EXIF/GPS metadata the same way Jimp's re-encode does,
// because the output is freshly built pixel data with no source metadata
// carried over - the original upload buffer is never persisted, only this
// processed copy is (FR-070, NFR-028, NFR-030).
//
// One visual difference from the Node version: watermark text uses GD's
// built-in bitmap font (imagestring, font 5) rather than Jimp's 16px sans
// font - smaller and plainer, but the same "don't share this" message in
// the same corner. Not worth bundling a TTF file just to match the look
// exactly.

define('GALLERY_UPLOAD_DIR', __DIR__ . '/../../data/gallery-uploads');
if (!is_dir(GALLERY_UPLOAD_DIR)) mkdir(GALLERY_UPLOAD_DIR, 0775, true);
define('GALLERY_MAX_DIMENSION', 1600); // web-optimised copy, not the original (FR-070, NFR-028)

function galleryProcessUpload(string $data, bool $watermark = false): array
{
    $img = @imagecreatefromstring($data);
    if (!$img) throw new Exception('Could not read this image file.');

    $width = imagesx($img);
    $height = imagesy($img);
    if ($width > GALLERY_MAX_DIMENSION || $height > GALLERY_MAX_DIMENSION) {
        if ($width >= $height) {
            $newWidth = GALLERY_MAX_DIMENSION;
            $newHeight = (int) round($height * (GALLERY_MAX_DIMENSION / $width));
        } else {
            $newHeight = GALLERY_MAX_DIMENSION;
            $newWidth = (int) round($width * (GALLERY_MAX_DIMENSION / $height));
        }
        $resized = imagecreatetruecolor($newWidth, $newHeight);
        imagecopyresampled($resized, $img, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);
        imagedestroy($img);
        $img = $resized;
        $width = $newWidth;
        $height = $newHeight;
    }

    if ($watermark) {
        $white = imagecolorallocate($img, 255, 255, 255);
        imagestring($img, 5, 10, $height - 20, '7th Swindon Scouts - private, do not share', $white);
    }

    ob_start();
    imagejpeg($img, null, 85);
    $buffer = ob_get_clean();
    imagedestroy($img);

    return ['buffer' => $buffer, 'width' => $width, 'height' => $height];
}

function galleryStorageKey(): string { return bin2hex(random_bytes(20)); }
function galleryFilePathFor(string $key): string { return GALLERY_UPLOAD_DIR . "/$key.jpg"; }
function gallerySaveFile(string $key, string $buffer): void { file_put_contents(galleryFilePathFor($key), $buffer); }
function galleryDeleteFile(string $key): void { $p = galleryFilePathFor($key); if (is_file($p)) unlink($p); }

// ── Permissions ────────────────────────────────────────────────────────────

function galleryUserOwnSectionIds(array $user): array
{
    return array_values(array_filter(array_column(json_decode($user['osm_roles_json'] ?? '[]', true) ?: [], 'sectionid')));
}

// Leaders/admins who may create photos, edit metadata, upload, and manage a
// draft/pending album. Once published, only the creator or an admin may
// unpublish/delete (FR-073 - published content take-down is admin-gated).
function galleryCanManageAlbum(array $user, array $album): bool
{
    if (isAdminRole($user['portal_role'])) return true;
    if (!isLeaderRole($user['portal_role'])) return false;
    if ((int) $album['created_by'] === (int) $user['id']) return true;
    if (in_array($album['status'], ['published', 'archived'], true)) return false;
    return $album['osm_section_id'] && in_array($album['osm_section_id'], galleryUserOwnSectionIds($user), true);
}

function galleryCanTakeDownAlbum(array $user, array $album): bool
{
    if (isAdminRole($user['portal_role'])) return true;
    return (int) $album['created_by'] === (int) $user['id'];
}

// Parents can only ever see published albums they're eligible for (FR-068).
function galleryParentEligibleForAlbum(array $user, array $album): bool
{
    if ($album['status'] !== 'published') return false;
    if ($album['visibility_scope'] === 'all_parents') return true;
    if ($album['visibility_scope'] === 'section') {
        $sectionIds = array_column(dbAll('SELECT DISTINCT osm_section_id FROM parent_child_links WHERE parent_user_id = ?', [$user['id']]), 'osm_section_id');
        return in_array($album['osm_section_id'], $sectionIds, true);
    }
    if ($album['visibility_scope'] === 'selected_parents') {
        return (bool) dbGet('SELECT 1 AS x FROM gallery_album_parents WHERE album_id = ? AND parent_user_id = ?', [$album['id'], $user['id']]);
    }
    return false;
}

function galleryCanViewAlbum(array $user, array $album): bool
{
    if ($user['portal_role'] === 'parent') return galleryParentEligibleForAlbum($user, $album);
    return galleryCanManageAlbum($user, $album);
}

function galleryEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'gallery_enabled'");
    return ($row['value'] ?? null) === 'true';
}

// Delete archived albums past the configured retention period (FRD 13.1
// mitigation "define automatic archive and deletion rules" - Phase 3 in the
// FRD's own roadmap; this covers the archived-cleanup slice of that only).
function pruneArchivedAlbums(): void
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'gallery_retention_days'");
    $days = (int) ($row['value'] ?? 365);
    $stale = dbAll("SELECT id FROM gallery_albums WHERE status = 'archived' AND updated_at < datetime('now', ?)", ["-$days days"]);
    foreach ($stale as $album) {
        $photos = dbAll('SELECT storage_key FROM gallery_photos WHERE album_id = ?', [$album['id']]);
        foreach ($photos as $p) { galleryDeleteFile($p['storage_key']); }
        dbRun('DELETE FROM gallery_photos WHERE album_id = ?', [$album['id']]);
        dbRun('DELETE FROM gallery_album_parents WHERE album_id = ?', [$album['id']]);
        dbRun('DELETE FROM gallery_albums WHERE id = ?', [$album['id']]);
    }
}

// One-time demo fixture so "Demo: Parent view" has something to show once an
// admin flips gallery_enabled on - solid-colour placeholders, not real photos.
function gallerySeedDemoAlbumIfMissing(int $createdByUserId): void
{
    if (dbGet("SELECT id FROM gallery_albums WHERE title = 'Cubs Summer Camp 2026'")) return;

    $result = dbRun(
        "INSERT INTO gallery_albums (title, grouping_type, grouping_label, osm_section_id, osm_section_name,
         visibility_scope, status, watermark_enabled, consent_confirmed, consent_confirmed_by, created_by, approved_by, approved_at)
         VALUES ('Cubs Summer Camp 2026', 'camp', 'Youlbury Scout Camp', 's101', 'Cubs', 'section', 'published', 1, 1, ?, ?, ?, datetime('now'))",
        [$createdByUserId, $createdByUserId, $createdByUserId]
    );
    $albumId = $result['lastInsertId'];

    $colours = [[92, 45, 145], [31, 122, 61]];
    foreach ($colours as $i => [$r, $g, $b]) {
        $img = imagecreatetruecolor(1200, 800);
        imagefill($img, 0, 0, imagecolorallocate($img, $r, $g, $b));
        $white = imagecolorallocate($img, 255, 255, 255);
        imagestring($img, 5, 20, 20, 'Demo photo ' . ($i + 1) . ' - Youlbury Scout Camp', $white);
        imagestring($img, 5, 20, 770, '7th Swindon Scouts - private, do not share', $white);
        ob_start();
        imagejpeg($img, null, 85);
        $buffer = ob_get_clean();
        imagedestroy($img);

        $key = galleryStorageKey();
        gallerySaveFile($key, $buffer);
        dbRun('INSERT INTO gallery_photos (album_id, storage_key, width, height, uploaded_by) VALUES (?, ?, 1200, 800, ?)', [$albumId, $key, $createdByUserId]);
    }
}
