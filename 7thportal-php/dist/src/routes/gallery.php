<?php
// Ported from the Node version's src/routes/gallery.js. Node used multer for
// multipart uploads; PHP parses multipart bodies natively into $_FILES, but
// only produces an array of files if the field name ends in "[]" - so the
// webroot copy of js/album-edit.js sends the field as "photos[]" (the only
// deliberate frontend change this whole port needed).

const GALLERY_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const GALLERY_MAX_UPLOAD_FILES = 20;

function requireGalleryEnabled(): void
{
    if (!galleryEnabled()) jsonResponse(['error' => 'The photo gallery is not enabled yet. Ask a Portal Administrator to turn it on in Admin Settings.'], 403);
}

function serializeAlbum(array $album, array $photos = []): array
{
    return [
        'id' => (int) $album['id'], 'title' => $album['title'], 'groupingType' => $album['grouping_type'], 'groupingLabel' => $album['grouping_label'],
        'sectionId' => $album['osm_section_id'], 'sectionName' => $album['osm_section_name'], 'visibilityScope' => $album['visibility_scope'],
        'status' => $album['status'], 'watermarkEnabled' => (bool) $album['watermark_enabled'], 'consentConfirmed' => (bool) $album['consent_confirmed'],
        'createdAt' => $album['created_at'], 'approvedAt' => $album['approved_at'],
        'photos' => array_map(fn($p) => ['id' => (int) $p['id'], 'width' => $p['width'], 'height' => $p['height']], $photos),
    ];
}

function galleryPhotoCount(int $albumId): int
{
    return (int) dbGet('SELECT COUNT(*) AS n FROM gallery_photos WHERE album_id = ?', [$albumId])['n'];
}

// Normalises PHP's $_FILES["field[]"] shape into a flat list of
// ['name'=>, 'type'=>, 'tmp_name'=>, 'error'=>, 'size'=>] entries.
function normalizedUploadedFiles(string $field): array
{
    if (empty($_FILES[$field])) return [];
    $f = $_FILES[$field];
    if (!is_array($f['name'])) return [$f];
    $files = [];
    foreach ($f['name'] as $i => $name) {
        $files[] = ['name' => $name, 'type' => $f['type'][$i], 'tmp_name' => $f['tmp_name'][$i], 'error' => $f['error'][$i], 'size' => $f['size'][$i]];
    }
    return $files;
}

// ── Parent-facing: view published albums only ─────────────────────────────

$router->get('/api/gallery/albums', function ($params) {
    $user = requireAuth();
    requireParent($user);
    requireGalleryEnabled();
    $albums = dbAll("SELECT * FROM gallery_albums WHERE status = 'published' ORDER BY created_at DESC");
    $eligible = array_values(array_filter($albums, fn($a) => galleryParentEligibleForAlbum($user, $a)));
    jsonResponse(array_map(fn($a) => serializeAlbum($a, dbAll('SELECT * FROM gallery_photos WHERE album_id = ?', [$a['id']])), $eligible));
});

$router->get('/api/gallery/albums/:id', function ($params) {
    $user = requireAuth();
    requireParent($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album || !galleryParentEligibleForAlbum($user, $album)) jsonResponse(['error' => 'Album not found.'], 404);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_view_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeAlbum($album, dbAll('SELECT * FROM gallery_photos WHERE album_id = ?', [$album['id']])));
});

// Shared authenticated image proxy (NFR-027) - never a public/static URL, and
// checked against the same permission rules as the album itself on every
// request (NFR-025). No download/share affordance is exposed - see FR-069.
$router->get('/api/gallery/photos/:photoId/image', function ($params) {
    $user = requireAuth();
    requireGalleryEnabled();
    $photo = dbGet('SELECT * FROM gallery_photos WHERE id = ?', [$params['photoId']]);
    if (!$photo) { http_response_code(404); exit; }
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$photo['album_id']]);
    if (!$album || !galleryCanViewAlbum($user, $album)) { http_response_code(403); exit; }
    $filePath = galleryFilePathFor($photo['storage_key']);
    if (!is_file($filePath)) { http_response_code(404); exit; }
    header('Cache-Control: private, no-store'); // NFR-029
    header('Content-Disposition: inline'); // never offered as a download
    header('Content-Type: image/jpeg');
    readfile($filePath);
    exit;
});

// ── Leader/admin: manage albums ────────────────────────────────────────────

$router->get('/api/leader/gallery/sections', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $roles = array_values(array_filter(json_decode($user['osm_roles_json'] ?? '[]', true) ?: [], fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)));
    jsonResponse(array_map(fn($r) => ['sectionId' => $r['sectionid'], 'sectionName' => $r['sectionname']], $roles));
});

$router->get('/api/leader/gallery/albums', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $albums = dbAll('SELECT * FROM gallery_albums ORDER BY created_at DESC');
    $visible = array_values(array_filter($albums, fn($a) => galleryCanManageAlbum($user, $a) || $user['portal_role'] === 'admin'));
    jsonResponse(array_map(fn($a) => array_merge(serializeAlbum($a), ['photoCount' => galleryPhotoCount((int) $a['id'])]), $visible));
});

$router->post('/api/leader/gallery/albums', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $body = requestBody();
    if (empty($body['title'])) jsonResponse(['error' => 'A title is required.'], 400);
    $validGrouping = ['section', 'event', 'camp', 'activity', 'term'];
    $validScope = ['section', 'all_parents', 'selected_parents'];
    $result = dbRun(
        'INSERT INTO gallery_albums (title, grouping_type, grouping_label, osm_section_id, osm_section_name, visibility_scope, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
            $body['title'], in_array($body['groupingType'] ?? null, $validGrouping, true) ? $body['groupingType'] : 'activity',
            $body['groupingLabel'] ?? null, $body['sectionId'] ?? null, $body['sectionName'] ?? null,
            in_array($body['visibilityScope'] ?? null, $validScope, true) ? $body['visibilityScope'] : 'section', $user['id'],
        ]
    );
    logAudit(['userId' => $user['id'], 'action' => 'gallery_create_album', 'entityType' => 'gallery_album', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeAlbum(dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$result['lastInsertId']])));
});

function loadManagedAlbum(array $user, string $id): array
{
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$id]);
    if (!$album || !galleryCanManageAlbum($user, $album)) jsonResponse(['error' => 'Album not found.'], 404);
    return $album;
}

$router->get('/api/leader/gallery/albums/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = loadManagedAlbum($user, $params['id']);
    jsonResponse(serializeAlbum($album, dbAll('SELECT * FROM gallery_photos WHERE album_id = ?', [$album['id']])));
});

$router->patch('/api/leader/gallery/albums/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = loadManagedAlbum($user, $params['id']);
    if ($album['status'] !== 'draft') jsonResponse(['error' => 'Only draft albums can be edited. Ask an administrator to unpublish it first.'], 400);
    $body = requestBody();
    $validGrouping = ['section', 'event', 'camp', 'activity', 'term'];
    $validScope = ['section', 'all_parents', 'selected_parents'];
    $consentConfirmed = array_key_exists('consentConfirmed', $body) ? (bool) $body['consentConfirmed'] : null;
    dbRun(
        "UPDATE gallery_albums SET title = ?, grouping_type = ?, grouping_label = ?, osm_section_id = ?, osm_section_name = ?,
         visibility_scope = ?, watermark_enabled = ?, consent_confirmed = ?, consent_confirmed_by = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['title'] ?? $album['title'],
            in_array($body['groupingType'] ?? null, $validGrouping, true) ? $body['groupingType'] : $album['grouping_type'],
            array_key_exists('groupingLabel', $body) ? $body['groupingLabel'] : $album['grouping_label'],
            array_key_exists('sectionId', $body) ? $body['sectionId'] : $album['osm_section_id'],
            array_key_exists('sectionName', $body) ? $body['sectionName'] : $album['osm_section_name'],
            in_array($body['visibilityScope'] ?? null, $validScope, true) ? $body['visibilityScope'] : $album['visibility_scope'],
            array_key_exists('watermarkEnabled', $body) ? ($body['watermarkEnabled'] ? 1 : 0) : $album['watermark_enabled'],
            $consentConfirmed !== null ? ($consentConfirmed ? 1 : 0) : $album['consent_confirmed'],
            $consentConfirmed ? $user['id'] : $album['consent_confirmed_by'],
            $album['id'],
        ]
    );
    logAudit(['userId' => $user['id'], 'action' => 'gallery_update_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeAlbum(dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$album['id']])));
});

$router->post('/api/leader/gallery/albums/:id/photos', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = loadManagedAlbum($user, $params['id']);
    if ($album['status'] !== 'draft') jsonResponse(['error' => 'Photos can only be added while an album is in draft.'], 400);
    $files = normalizedUploadedFiles('photos');
    if (count($files) === 0) jsonResponse(['error' => 'No image files were received.'], 400);

    $saved = [];
    $failed = [];
    foreach (array_slice($files, 0, GALLERY_MAX_UPLOAD_FILES) as $file) {
        if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > GALLERY_MAX_UPLOAD_BYTES || !is_uploaded_file($file['tmp_name'])) {
            $failed[] = $file['name'] ?: 'file';
            continue;
        }
        try {
            $data = file_get_contents($file['tmp_name']);
            $result = galleryProcessUpload($data, (bool) $album['watermark_enabled']);
            $key = galleryStorageKey();
            gallerySaveFile($key, $result['buffer']);
            $inserted = dbRun('INSERT INTO gallery_photos (album_id, storage_key, width, height, uploaded_by) VALUES (?, ?, ?, ?, ?)', [$album['id'], $key, $result['width'], $result['height'], $user['id']]);
            $saved[] = $inserted['lastInsertId'];
        } catch (Throwable $e) {
            $failed[] = $file['name'] ?: 'file';
        }
    }
    if (count($saved)) logAudit(['userId' => $user['id'], 'action' => 'gallery_upload_photo', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp(), 'details' => ['count' => count($saved)]]);
    jsonResponse(['saved' => count($saved), 'failed' => $failed]);
});

$router->delete('/api/leader/gallery/albums/:id/photos/:photoId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = loadManagedAlbum($user, $params['id']);
    $photo = dbGet('SELECT * FROM gallery_photos WHERE id = ? AND album_id = ?', [$params['photoId'], $album['id']]);
    if (!$photo) jsonResponse(['error' => 'Photo not found.'], 404);
    galleryDeleteFile($photo['storage_key']);
    dbRun('DELETE FROM gallery_photos WHERE id = ?', [$photo['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_delete_photo', 'entityType' => 'gallery_photo', 'entityId' => (string) $photo['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/leader/gallery/albums/:id/submit', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = loadManagedAlbum($user, $params['id']);
    if ($album['status'] !== 'draft') jsonResponse(['error' => 'Only draft albums can be submitted.'], 400);
    if (!$album['consent_confirmed']) jsonResponse(['error' => 'Confirm photo consent for everyone in this album before submitting it (FRD FR-076).'], 400);
    if (galleryPhotoCount((int) $album['id']) === 0) jsonResponse(['error' => 'Add at least one photo before submitting.'], 400);
    dbRun("UPDATE gallery_albums SET status = 'pending_approval', updated_at = datetime('now') WHERE id = ?", [$album['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_submit_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->delete('/api/leader/gallery/albums/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album || !galleryCanTakeDownAlbum($user, $album)) jsonResponse(['error' => 'Album not found.'], 404);
    foreach (dbAll('SELECT storage_key FROM gallery_photos WHERE album_id = ?', [$album['id']]) as $p) { galleryDeleteFile($p['storage_key']); }
    dbRun('DELETE FROM gallery_photos WHERE album_id = ?', [$album['id']]);
    dbRun('DELETE FROM gallery_album_parents WHERE album_id = ?', [$album['id']]);
    dbRun('DELETE FROM gallery_albums WHERE id = ?', [$album['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_delete_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Admin: approval workflow ─────────────────────────────────────────────

$router->get('/api/admin/gallery/albums', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    requireGalleryEnabled();
    $albums = dbAll('SELECT * FROM gallery_albums ORDER BY created_at DESC');
    jsonResponse(array_map(fn($a) => array_merge(serializeAlbum($a), ['photoCount' => galleryPhotoCount((int) $a['id'])]), $albums));
});

$router->post('/api/admin/gallery/albums/:id/approve', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album || $album['status'] !== 'pending_approval') jsonResponse(['error' => 'Only albums pending approval can be published.'], 400);
    dbRun("UPDATE gallery_albums SET status = 'published', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $album['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_approve_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/admin/gallery/albums/:id/reject', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album || $album['status'] !== 'pending_approval') jsonResponse(['error' => 'Only albums pending approval can be rejected back to draft.'], 400);
    dbRun("UPDATE gallery_albums SET status = 'draft', updated_at = datetime('now') WHERE id = ?", [$album['id']]);
    $body = requestBody();
    logAudit(['userId' => $user['id'], 'action' => 'gallery_reject_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp(), 'details' => ['reason' => $body['reason'] ?? null]]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/admin/gallery/albums/:id/unpublish', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album || $album['status'] !== 'published') jsonResponse(['error' => 'Only published albums can be unpublished.'], 400);
    dbRun("UPDATE gallery_albums SET status = 'archived', updated_at = datetime('now') WHERE id = ?", [$album['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_unpublish_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->delete('/api/admin/gallery/albums/:id', function ($params) {
    $user = requireAuth();
    requireAdmin($user);
    requireGalleryEnabled();
    $album = dbGet('SELECT * FROM gallery_albums WHERE id = ?', [$params['id']]);
    if (!$album) jsonResponse(['error' => 'Album not found.'], 404);
    foreach (dbAll('SELECT storage_key FROM gallery_photos WHERE album_id = ?', [$album['id']]) as $p) { galleryDeleteFile($p['storage_key']); }
    dbRun('DELETE FROM gallery_photos WHERE album_id = ?', [$album['id']]);
    dbRun('DELETE FROM gallery_album_parents WHERE album_id = ?', [$album['id']]);
    dbRun('DELETE FROM gallery_albums WHERE id = ?', [$album['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'gallery_delete_album', 'entityType' => 'gallery_album', 'entityId' => (string) $album['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});
