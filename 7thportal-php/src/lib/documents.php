<?php
// Leader-only document library (7thPortal wireframe screens 48-51): store,
// find, version, acknowledge and audit leader-only policies, process
// documents, templates and guidance. Not safeguarding/finance-sensitive like
// the gallery or expenses modules, but ships off by default anyway via
// 'document_library_enabled', for consistency with every other optional
// module in this app - an admin opts in once real content is ready to load.

define('DOCUMENT_UPLOAD_DIR', __DIR__ . '/../../data/document-uploads');
if (!is_dir(DOCUMENT_UPLOAD_DIR)) mkdir(DOCUMENT_UPLOAD_DIR, 0775, true);
const DOCUMENT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const DOCUMENT_ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'png', 'jpg', 'jpeg'];

function documentLibraryEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'document_library_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireDocumentLibraryEnabled(): void
{
    if (!documentLibraryEnabled()) jsonResponse(['error' => 'The document library is not enabled yet. Ask a Portal Administrator to turn it on in Admin Settings.'], 403);
}

// ── Storage - private, authenticated-proxy-only, same principle as the
// gallery/receipts modules ("no public URL"). Trusts the extension from the
// uploaded filename rather than magic-byte sniffing - office document
// formats (docx/xlsx/pptx are themselves zip files) aren't reliably
// distinguishable that way, and this project already accepts "no malware
// scanning on uploads" as a deliberate, documented gap (see lib/finance.php),
// so an allowlist-by-extension check is consistent with that existing
// posture rather than a new one. ──

function documentStorageKey(): string { return bin2hex(random_bytes(20)); }
function documentFilePathFor(string $key, string $ext): string { return DOCUMENT_UPLOAD_DIR . "/$key.$ext"; }

function detectDocumentExtension(string $originalFilename): ?string
{
    $ext = strtolower(pathinfo($originalFilename, PATHINFO_EXTENSION));
    return in_array($ext, DOCUMENT_ALLOWED_EXTENSIONS, true) ? $ext : null;
}

function saveDocumentFile(string $key, string $ext, string $data): void
{
    file_put_contents(documentFilePathFor($key, $ext), $data);
}

function deleteDocumentFileOnDisk(string $storageKey, string $ext): void
{
    $p = documentFilePathFor($storageKey, $ext);
    if (is_file($p)) unlink($p);
}

// ── Serialization ────────────────────────────────────────────────────────────

function serializeVersion(array $version): array
{
    $uploader = dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$version['uploaded_by_user_id']]);
    return [
        'id' => (int) $version['id'],
        'versionNumber' => (int) $version['version_number'],
        'originalFilename' => $version['original_filename'],
        'notes' => $version['notes'],
        'uploadedBy' => $uploader ? $uploader['first_name'] . ' ' . $uploader['last_name'] : null,
        'createdAt' => $version['created_at'],
    ];
}

// $forUserId, if given, adds 'myAcknowledged' for the current version.
function serializeDocument(array $document, ?int $forUserId = null): array
{
    $owner = $document['owner_user_id'] ? dbGet('SELECT id, first_name, last_name FROM users WHERE id = ?', [$document['owner_user_id']]) : null;
    $currentVersion = $document['current_version_id'] ? dbGet('SELECT * FROM document_versions WHERE id = ?', [$document['current_version_id']]) : null;
    $versionCount = (int) dbGet('SELECT COUNT(*) AS n FROM document_versions WHERE document_id = ?', [$document['id']])['n'];
    $result = [
        'id' => (int) $document['id'],
        'title' => $document['title'],
        'category' => $document['category'],
        'owner' => $owner ? ['id' => (int) $owner['id'], 'name' => $owner['first_name'] . ' ' . $owner['last_name']] : null,
        'reviewDate' => $document['review_date'],
        'status' => $document['status'],
        'currentVersion' => $currentVersion ? serializeVersion($currentVersion) : null,
        'versionCount' => $versionCount,
        'createdAt' => $document['created_at'],
        'updatedAt' => $document['updated_at'],
    ];
    if ($forUserId && $currentVersion) {
        $result['myAcknowledged'] = (bool) dbGet(
            'SELECT 1 AS x FROM document_acknowledgements WHERE version_id = ? AND user_id = ?',
            [$currentVersion['id'], $forUserId]
        );
    }
    return $result;
}

// ── Permissions ──────────────────────────────────────────────────────────────

function isDocumentManager(array $user, array $document): bool
{
    return isAdminRole($user['portal_role']) || (int) $user['id'] === (int) ($document['owner_user_id'] ?? 0);
}

// ── Acknowledgement status (screen 51: "tracking outstanding
// acknowledgements") - every non-parent user against whether they've
// acknowledged the document's *current* published version. ─────────────────

function acknowledgementStatusForDocument(array $document): array
{
    if (!$document['current_version_id']) return [];
    $users = dbAll("SELECT id, first_name, last_name FROM users WHERE portal_role != 'parent' AND account_status = 'active' ORDER BY first_name");
    $acked = array_column(dbAll('SELECT user_id, acknowledged_at FROM document_acknowledgements WHERE version_id = ?', [$document['current_version_id']]), 'acknowledged_at', 'user_id');
    return array_map(fn($u) => [
        'userId' => (int) $u['id'],
        'name' => $u['first_name'] . ' ' . $u['last_name'],
        'acknowledged' => isset($acked[$u['id']]),
        'acknowledgedAt' => $acked[$u['id']] ?? null,
    ], $users);
}
