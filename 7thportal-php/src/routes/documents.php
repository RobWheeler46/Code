<?php
// Leader-only document library. See lib/documents.php for storage,
// serialization and permission helpers this file's handlers lean on.

function loadDocumentOr404(int $id): array
{
    $document = dbGet('SELECT * FROM documents WHERE id = ?', [$id]);
    if (!$document) jsonResponse(['error' => 'Document not found.'], 404);
    return $document;
}

// ── Leader-facing: browse, view, download, acknowledge ──────────────────────

$router->get('/api/documents', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $category = queryParam('category');
    $sql = "SELECT * FROM documents WHERE status = 'published'" . ($category ? ' AND category = ?' : '') . ' ORDER BY title';
    $documents = dbAll($sql, $category ? [$category] : []);
    jsonResponse(array_map(fn($d) => serializeDocument($d, (int) $user['id']), $documents));
});

$router->get('/api/documents/manage', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $documents = isAdminRole($user['portal_role'])
        ? dbAll('SELECT * FROM documents ORDER BY updated_at DESC')
        : dbAll('SELECT * FROM documents WHERE owner_user_id = ? ORDER BY updated_at DESC', [$user['id']]);
    jsonResponse(array_map(fn($d) => serializeDocument($d, (int) $user['id']), $documents));
});

$router->get('/api/documents/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if ($document['status'] !== 'published' && !isDocumentManager($user, $document)) jsonResponse(['error' => 'Document not found.'], 404);
    $serialized = serializeDocument($document, (int) $user['id']);
    $serialized['isManager'] = isDocumentManager($user, $document);
    if ($serialized['isManager']) {
        $serialized['versions'] = array_map('serializeVersion', dbAll('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC', [$document['id']]));
        $serialized['acknowledgementStatus'] = acknowledgementStatusForDocument($document);
    }
    jsonResponse($serialized);
});

$router->get('/api/documents/:id/file', function ($params) {
    $user = requireAuth();
    requireDocumentLibraryEnabled();
    $document = dbGet('SELECT * FROM documents WHERE id = ?', [$params['id']]);
    if (!$document || (!isLeaderRole($user['portal_role'])) || ($document['status'] !== 'published' && !isDocumentManager($user, $document))) { http_response_code(404); exit; }
    if (!$document['current_version_id']) { http_response_code(404); exit; }
    $version = dbGet('SELECT * FROM document_versions WHERE id = ?', [$document['current_version_id']]);
    serveDocumentFile($version);
});

$router->get('/api/documents/:id/versions/:versionId/file', function ($params) {
    $user = requireAuth();
    requireDocumentLibraryEnabled();
    $document = dbGet('SELECT * FROM documents WHERE id = ?', [$params['id']]);
    if (!$document || !isDocumentManager($user, $document)) { http_response_code(404); exit; }
    $version = dbGet('SELECT * FROM document_versions WHERE id = ? AND document_id = ?', [$params['versionId'], $document['id']]);
    serveDocumentFile($version);
});

function serveDocumentFile(?array $version): void
{
    if (!$version) { http_response_code(404); exit; }
    $path = documentFilePathFor($version['storage_key'], $version['ext']);
    if (!is_file($path)) { http_response_code(404); exit; }
    $mime = [
        'pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'doc' => 'application/msword', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt' => 'application/vnd.ms-powerpoint', 'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ][$version['ext']] ?? 'application/octet-stream';
    header('Cache-Control: private, no-store');
    header('Content-Disposition: inline; filename="' . basename($version['original_filename'] ?: 'document') . '"');
    header("Content-Type: $mime");
    readfile($path);
    exit;
}

$router->post('/api/documents/:id/acknowledge', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if ($document['status'] !== 'published' || !$document['current_version_id']) jsonResponse(['error' => 'This document has no published version to acknowledge.'], 400);
    dbRun('INSERT OR IGNORE INTO document_acknowledgements (document_id, version_id, user_id) VALUES (?, ?, ?)', [$document['id'], $document['current_version_id'], $user['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'document_acknowledge', 'entityType' => 'document', 'entityId' => (string) $document['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeDocument(dbGet('SELECT * FROM documents WHERE id = ?', [$document['id']]), (int) $user['id']));
});

// ── Owner/admin: create, version, publish, edit ─────────────────────────────

$router->post('/api/documents', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $body = requestBody();
    if (empty($body['title'])) jsonResponse(['error' => 'A document title is required.'], 400);
    $validCategories = ['policy', 'process', 'template', 'guidance', 'other'];
    $category = in_array($body['category'] ?? null, $validCategories, true) ? $body['category'] : 'guidance';
    $ownerUserId = (isAdminRole($user['portal_role']) && !empty($body['ownerUserId'])) ? $body['ownerUserId'] : $user['id'];
    $result = dbRun(
        'INSERT INTO documents (title, category, owner_user_id, review_date) VALUES (?, ?, ?, ?)',
        [$body['title'], $category, $ownerUserId, $body['reviewDate'] ?? null]
    );
    logAudit(['userId' => $user['id'], 'action' => 'document_create', 'entityType' => 'document', 'entityId' => (string) $result['lastInsertId'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeDocument(dbGet('SELECT * FROM documents WHERE id = ?', [$result['lastInsertId']]), (int) $user['id']));
});

$router->patch('/api/documents/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if (!isDocumentManager($user, $document)) jsonResponse(['error' => 'Document not found.'], 404);
    $body = requestBody();
    $validCategories = ['policy', 'process', 'template', 'guidance', 'other'];
    dbRun(
        "UPDATE documents SET title = ?, category = ?, owner_user_id = ?, review_date = ?, updated_at = datetime('now') WHERE id = ?",
        [
            $body['title'] ?? $document['title'],
            in_array($body['category'] ?? null, $validCategories, true) ? $body['category'] : $document['category'],
            (isAdminRole($user['portal_role']) && array_key_exists('ownerUserId', $body)) ? $body['ownerUserId'] : $document['owner_user_id'],
            array_key_exists('reviewDate', $body) ? $body['reviewDate'] : $document['review_date'],
            $document['id'],
        ]
    );
    jsonResponse(serializeDocument(dbGet('SELECT * FROM documents WHERE id = ?', [$document['id']]), (int) $user['id']));
});

$router->delete('/api/documents/:id', function ($params) {
    $admin = requireAuth();
    requireAdmin($admin);
    $document = loadDocumentOr404((int) $params['id']);
    foreach (dbAll('SELECT * FROM document_versions WHERE document_id = ?', [$document['id']]) as $v) {
        deleteDocumentFileOnDisk($v['storage_key'], $v['ext']);
    }
    dbRun('DELETE FROM document_acknowledgements WHERE document_id = ?', [$document['id']]);
    dbRun('DELETE FROM document_versions WHERE document_id = ?', [$document['id']]);
    dbRun('DELETE FROM documents WHERE id = ?', [$document['id']]);
    logAudit(['userId' => $admin['id'], 'action' => 'document_delete', 'entityType' => 'document', 'entityId' => (string) $document['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

$router->post('/api/documents/:id/versions', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if (!isDocumentManager($user, $document)) jsonResponse(['error' => 'Document not found.'], 404);
    if (empty($_FILES['file'])) jsonResponse(['error' => 'No file received.'], 400);
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > DOCUMENT_MAX_UPLOAD_BYTES || !is_uploaded_file($file['tmp_name'])) {
        jsonResponse(['error' => 'Upload failed - check the file is under 20MB.'], 400);
    }
    $ext = detectDocumentExtension($file['name']);
    if (!$ext) jsonResponse(['error' => 'File type not accepted. Allowed: ' . implode(', ', DOCUMENT_ALLOWED_EXTENSIONS)], 400);

    $key = documentStorageKey();
    saveDocumentFile($key, $ext, file_get_contents($file['tmp_name']));
    $nextVersion = (int) (dbGet('SELECT COALESCE(MAX(version_number), 0) AS n FROM document_versions WHERE document_id = ?', [$document['id']])['n']) + 1;
    $result = dbRun(
        'INSERT INTO document_versions (document_id, version_number, storage_key, ext, original_filename, notes, uploaded_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [$document['id'], $nextVersion, $key, $ext, $file['name'], $_POST['notes'] ?? null, $user['id']]
    );
    logAudit(['userId' => $user['id'], 'action' => 'document_upload_version', 'entityType' => 'document', 'entityId' => (string) $document['id'], 'ipAddress' => clientIp(), 'details' => ['versionNumber' => $nextVersion]]);
    jsonResponse(serializeVersion(dbGet('SELECT * FROM document_versions WHERE id = ?', [$result['lastInsertId']])));
});

$router->post('/api/documents/:id/publish', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if (!isDocumentManager($user, $document)) jsonResponse(['error' => 'Document not found.'], 404);
    $body = requestBody();
    $version = dbGet('SELECT * FROM document_versions WHERE id = ? AND document_id = ?', [$body['versionId'] ?? null, $document['id']]);
    if (!$version) jsonResponse(['error' => 'Choose a valid version to publish.'], 400);
    dbRun("UPDATE documents SET status = 'published', current_version_id = ?, updated_at = datetime('now') WHERE id = ?", [$version['id'], $document['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'document_publish', 'entityType' => 'document', 'entityId' => (string) $document['id'], 'ipAddress' => clientIp(), 'details' => ['versionId' => $version['id']]]);
    jsonResponse(serializeDocument(dbGet('SELECT * FROM documents WHERE id = ?', [$document['id']]), (int) $user['id']));
});

$router->delete('/api/documents/:id/versions/:versionId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireDocumentLibraryEnabled();
    $document = loadDocumentOr404((int) $params['id']);
    if (!isDocumentManager($user, $document)) jsonResponse(['error' => 'Document not found.'], 404);
    if ((int) $document['current_version_id'] === (int) $params['versionId']) jsonResponse(['error' => 'Cannot delete the currently published version.'], 400);
    $version = dbGet('SELECT * FROM document_versions WHERE id = ? AND document_id = ?', [$params['versionId'], $document['id']]);
    if (!$version) jsonResponse(['error' => 'Version not found.'], 404);
    deleteDocumentFileOnDisk($version['storage_key'], $version['ext']);
    dbRun('DELETE FROM document_acknowledgements WHERE version_id = ?', [$version['id']]);
    dbRun('DELETE FROM document_versions WHERE id = ?', [$version['id']]);
    jsonResponse(['ok' => true]);
});
