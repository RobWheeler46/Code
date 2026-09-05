<?php
// Generic reusable Forms (FR-FORM-003..009). Optional module, off by default. A logical
// form (form_templates) carries versioned schemas (form_template_versions); a completed
// record (form_submissions) freezes the exact version schema it was filled against so it
// always renders as it was, whatever later template edits happen. Distinct from the fixed
// Activity Approval form, which keeps its own workflow. This file owns the model, the
// permission rules and completion; template administration lives in routes/forms.php.

const FORM_SUB_STATUSES = [
    'draft' => 'Draft',
    'submitted' => 'Submitted',
    'approved' => 'Approved',
    'returned' => 'Returned for changes',
    'withdrawn' => 'Withdrawn',
];
// The field types the builder/renderer understand. Kept deliberately small and shared
// with the design-system field components. 'file' collects private evidence.
const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'number', 'date', 'select', 'radio', 'checkbox', 'file'];
const FORM_UPLOAD_DIR = __DIR__ . '/../../data/form-uploads';
const FORM_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
function formStorageKey(): string { return bin2hex(random_bytes(20)); }
function formFilePathFor(string $key, string $ext): string { return FORM_UPLOAD_DIR . "/$key.$ext"; }
function formDeleteFileOnDisk(string $key, string $ext): void { $p = formFilePathFor($key, $ext); if (is_file($p)) @unlink($p); }
// Files attached to a submission, grouped by field id, for the completion renderer.
function formSubmissionFilesByField(int $submissionId): array
{
    $out = [];
    foreach (dbAll('SELECT * FROM form_submission_files WHERE submission_id = ? ORDER BY id', [$submissionId]) as $x) {
        $out[$x['field_id']][] = ['id' => (int) $x['id'], 'filename' => $x['original_filename'], 'ext' => $x['ext']];
    }
    return $out;
}
// Whether the given user may complete a form on behalf of someone else (FR-FORM-008):
// only when the template allows it and the actor is an administrator.
function formCanCompleteOnBehalf(array $user, array $tpl): bool
{
    return !empty($tpl['allow_on_behalf']) && formsCanAdmin($user);
}

function formsEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'forms_enabled'");
    return ($row['value'] ?? null) === 'true';
}
function requireFormsEnabled(): void
{
    if (!formsEnabled()) jsonResponse(['error' => 'Forms are not enabled.'], 404);
}

// Completion group: operational leaders + admins may start/complete forms. (Parents are
// out of scope for the generic forms module in this release.)
function formsCanComplete(array $user): bool
{
    return in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'treasurer', 'chair', 'admin'], true);
}
// Template + submissions administration is permission-separated from completion
// (FR-FORM-004): only admins manage templates and see all submissions.
function formsCanAdmin(array $user): bool
{
    return $user['portal_role'] === 'admin';
}

// Is this published template offered to this user? audience_roles is a JSON array of
// portal_roles; empty/absent means "any completer". Restricted templates never surface
// to a user outside their audience (FR-FORM-007 no-leak also applies to the landing).
function formTemplateInAudience(array $tpl, array $user): bool
{
    if (formsCanAdmin($user)) return true;
    $roles = json_decode($tpl['audience_roles'] ?? '[]', true);
    if (!is_array($roles) || !$roles) return formsCanComplete($user);
    return in_array($user['portal_role'], $roles, true);
}

// Published templates this user may start, each with its current published-version id.
function formPublishedTemplatesFor(array $user): array
{
    $out = [];
    foreach (dbAll("SELECT * FROM form_templates WHERE status = 'published' ORDER BY title") as $t) {
        if (!formTemplateInAudience($t, $user)) continue;
        if (!$t['current_version_id']) continue;
        $out[] = [
            'id' => (int) $t['id'],
            'slug' => $t['slug'],
            'title' => $t['title'],
            'description' => $t['description'],
            'category' => $t['category'],
            'workflow' => $t['workflow'],
            'allowOnBehalf' => (bool) $t['allow_on_behalf'],
        ];
    }
    return $out;
}

// The parsed section/field schema for a template version.
function formSchemaFields(array $schema): array
{
    $fields = [];
    foreach (($schema['sections'] ?? []) as $sec) {
        foreach (($sec['fields'] ?? []) as $f) $fields[] = $f;
    }
    return $fields;
}

// Start a new draft submission of a published template for this user. Freezes the
// current published version's schema onto the submission (snapshot). Returns the id.
function formStartSubmission(array $user, int $templateId, ?array $onBehalf = null): int
{
    $tpl = dbGet("SELECT * FROM form_templates WHERE id = ? AND status = 'published'", [$templateId]);
    if (!$tpl || !$tpl['current_version_id']) return 0;
    $ver = dbGet('SELECT * FROM form_template_versions WHERE id = ?', [$tpl['current_version_id']]);
    if (!$ver) return 0;
    dbRun(
        "INSERT INTO form_submissions (template_id, template_version_id, schema_snapshot_json, submitter_user_id, on_behalf_of_user_id, on_behalf_reason, status)
         VALUES (?, ?, ?, ?, ?, ?, 'draft')",
        [$templateId, $ver['id'], $ver['schema_json'], $user['id'], $onBehalf['userId'] ?? null, $onBehalf['reason'] ?? null]
    );
    return (int) db()->lastInsertId();
}

// Human reference, assigned on first submit (FRM-YYYY-000001).
function formSubmissionReference(): string
{
    $n = (int) (dbGet("SELECT COUNT(*) c FROM form_submissions WHERE reference IS NOT NULL")['c'] ?? 0) + 1;
    return 'FRM-' . date('Y') . '-' . str_pad((string) $n, 6, '0', STR_PAD_LEFT);
}

// Required-field validation against a submission's frozen schema. Returns the list of
// missing field labels (empty = ready to submit).
function formValidateSubmission(array $sub): array
{
    $schema = json_decode($sub['schema_snapshot_json'] ?: '{}', true) ?: [];
    $data = json_decode($sub['data_json'] ?: '{}', true) ?: [];
    $files = formSubmissionFilesByField((int) $sub['id']);
    $missing = [];
    foreach (formSchemaFields($schema) as $f) {
        if (empty($f['required'])) continue;
        if (($f['type'] ?? '') === 'file') {
            if (empty($files[$f['id']])) $missing[] = $f['label'] ?? $f['id'];
            continue;
        }
        $v = $data[$f['id']] ?? null;
        $empty = $v === null || $v === '' || (is_array($v) && !$v) || ($f['type'] === 'checkbox' && !$v);
        if ($empty) $missing[] = $f['label'] ?? $f['id'];
    }
    return $missing;
}

// Who may view a submission: its submitter, the person it was filed on behalf of, an
// admin, or (approval workflow) an approver. No leakage to anyone else (FR-FORM-007).
function formCanViewSubmission(array $user, array $sub): bool
{
    if ((int) $sub['submitter_user_id'] === (int) $user['id']) return true;
    if ((int) ($sub['on_behalf_of_user_id'] ?? 0) === (int) $user['id']) return true;
    if (formsCanAdmin($user)) return true;
    if ((int) ($sub['decided_by'] ?? 0) === (int) $user['id']) return true;
    // Approval workflow: group leadership / chair may review any post-draft record they
    // govern (submitted, and the decided/withdrawn history), not a draft in progress.
    if (in_array($sub['status'], ['submitted', 'approved', 'returned', 'withdrawn'], true)) {
        $tpl = dbGet('SELECT workflow FROM form_templates WHERE id = ?', [$sub['template_id']]);
        if (($tpl['workflow'] ?? 'record') === 'approval' && in_array($user['portal_role'], ['group_leadership', 'chair'], true)) return true;
    }
    return false;
}
function formCanEditSubmission(array $user, array $sub): bool
{
    if (!in_array($sub['status'], ['draft', 'returned'], true)) return false;
    return (int) $sub['submitter_user_id'] === (int) $user['id'] || formsCanAdmin($user);
}
// An approver who can act on a submitted record right now (approval workflow only).
function formCanApprove(array $user, array $sub): bool
{
    if ($sub['status'] !== 'submitted') return false;
    if ((int) $sub['submitter_user_id'] === (int) $user['id']) return false; // no self-approval
    $tpl = dbGet('SELECT workflow FROM form_templates WHERE id = ?', [$sub['template_id']]);
    if (($tpl['workflow'] ?? 'record') !== 'approval') return false;
    return in_array($user['portal_role'], ['group_leadership', 'chair', 'admin'], true);
}

function formSubmissionRef(array $sub): string
{
    return $sub['reference'] ?: ('FRM-' . str_pad((string) $sub['id'], 4, '0', STR_PAD_LEFT));
}

// Serialise a submission for the API, including the frozen schema and the viewer's
// permitted actions computed server-side (the client never re-derives permissions).
function serializeFormSubmission(array $sub, array $user): array
{
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$sub['template_id']]);
    $submitter = dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$sub['submitter_user_id']]);
    $onBehalf = $sub['on_behalf_of_user_id'] ? dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$sub['on_behalf_of_user_id']]) : null;
    return [
        'id' => (int) $sub['id'],
        'reference' => formSubmissionRef($sub),
        'templateId' => (int) $sub['template_id'],
        'templateTitle' => $tpl['title'] ?? 'Form',
        'templateDescription' => $tpl['description'] ?? '',
        'workflow' => $tpl['workflow'] ?? 'record',
        'status' => $sub['status'],
        'statusLabel' => FORM_SUB_STATUSES[$sub['status']] ?? $sub['status'],
        'schema' => json_decode($sub['schema_snapshot_json'] ?: '{}', true) ?: [],
        'data' => json_decode($sub['data_json'] ?: '{}', true) ?: [],
        'files' => formSubmissionFilesByField((int) $sub['id']),
        'submittedAt' => $sub['submitted_at'],
        'submitterName' => $submitter ? trim($submitter['first_name'] . ' ' . $submitter['last_name']) : '',
        'onBehalfOf' => $onBehalf ? trim($onBehalf['first_name'] . ' ' . $onBehalf['last_name']) : null,
        'onBehalfReason' => $sub['on_behalf_reason'],
        'decisionComment' => $sub['decision_comment'],
        'missing' => formValidateSubmission($sub),
        'myActions' => [
            'canEdit' => formCanEditSubmission($user, $sub),
            'canSubmit' => formCanEditSubmission($user, $sub),
            'canApprove' => formCanApprove($user, $sub),
            'canWithdraw' => (int) $sub['submitter_user_id'] === (int) $user['id'] && in_array($sub['status'], ['draft', 'submitted', 'returned'], true),
        ],
    ];
}

// A user's own submissions for the Forms landing (FR-FORM-003: own/recent, not a task inbox).
function formMySubmissions(array $user, int $limit = 25): array
{
    $out = [];
    foreach (dbAll('SELECT * FROM form_submissions WHERE submitter_user_id = ? ORDER BY updated_at DESC LIMIT ?', [$user['id'], $limit]) as $s) {
        $tpl = dbGet('SELECT title FROM form_templates WHERE id = ?', [$s['template_id']]);
        $out[] = [
            'id' => (int) $s['id'],
            'reference' => formSubmissionRef($s),
            'templateTitle' => $tpl['title'] ?? 'Form',
            'status' => $s['status'],
            'statusLabel' => FORM_SUB_STATUSES[$s['status']] ?? $s['status'],
            'updatedAt' => $s['updated_at'],
        ];
    }
    return $out;
}

// ── Template administration (FR-FORM-004/005/006) ───────────────────────────────
// Admin-only. Editing always happens on a single working DRAFT version; a published
// version with submissions is never edited in place — publishing supersedes it and the
// old version stays immutable so historical submissions keep their snapshot.

// The working draft version for a template, or 0. A template has at most one draft.
function formDraftVersion(int $templateId): ?array
{
    return dbGet("SELECT * FROM form_template_versions WHERE template_id = ? AND status = 'draft' ORDER BY version_no DESC LIMIT 1", [$templateId]);
}
// Return an editable draft version id, creating one (seeded from the current published
// schema) if the template has none — so editing a published form starts a new version.
function formEnsureDraft(int $templateId, int $userId): int
{
    $d = formDraftVersion($templateId);
    if ($d) return (int) $d['id'];
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$templateId]);
    $seed = '{"sections":[]}';
    if ($tpl && $tpl['current_version_id']) {
        $pv = dbGet('SELECT schema_json FROM form_template_versions WHERE id = ?', [$tpl['current_version_id']]);
        if ($pv) $seed = $pv['schema_json'];
    }
    $maxNo = (int) (dbGet('SELECT MAX(version_no) m FROM form_template_versions WHERE template_id = ?', [$templateId])['m'] ?? 0);
    return (int) dbRun("INSERT INTO form_template_versions (template_id, version_no, schema_json, status, created_by) VALUES (?, ?, ?, 'draft', ?)", [$templateId, $maxNo + 1, $seed, $userId])['lastInsertId'];
}

// Pre-publish validation of a schema (FR-FORM-006). Returns a list of problems.
function formValidateSchema(array $schema): array
{
    $errors = [];
    $sections = $schema['sections'] ?? [];
    if (!$sections) $errors[] = 'Add at least one section.';
    $ids = [];
    $fieldCount = 0;
    foreach ($sections as $sec) {
        foreach (($sec['fields'] ?? []) as $f) {
            $fieldCount++;
            $label = $f['label'] ?? ($f['id'] ?? '?');
            if (empty($f['id'])) $errors[] = 'A field is missing its identifier.';
            elseif (in_array($f['id'], $ids, true)) $errors[] = 'Two fields share the id "' . $f['id'] . '".';
            else $ids[] = $f['id'];
            if (empty($f['label'])) $errors[] = 'A field is missing a label.';
            if (!in_array($f['type'] ?? '', FORM_FIELD_TYPES, true)) $errors[] = 'Unknown field type for "' . $label . '".';
            if (in_array($f['type'] ?? '', ['select', 'radio'], true) && empty($f['options'])) $errors[] = 'Add options for "' . $label . '".';
        }
    }
    if (!$fieldCount) $errors[] = 'Add at least one field.';
    return $errors;
}

// Create a new template (draft) with an empty first version. Returns the template id.
function formCreateTemplate(array $user, array $d): int
{
    $workflow = ($d['workflow'] ?? 'record') === 'approval' ? 'approval' : 'record';
    $roles = is_array($d['audienceRoles'] ?? null) ? array_values(array_intersect($d['audienceRoles'], ['section_leader', 'assistant_leader', 'group_leadership', 'treasurer', 'chair', 'admin'])) : [];
    $tid = (int) dbRun(
        "INSERT INTO form_templates (title, description, category, status, workflow, allow_on_behalf, audience_roles, created_by) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)",
        [trim((string) ($d['title'] ?? 'Untitled form')) ?: 'Untitled form', $d['description'] ?? null, $d['category'] ?? null, $workflow, !empty($d['allowOnBehalf']) ? 1 : 0, $roles ? json_encode($roles) : null, $user['id']]
    )['lastInsertId'];
    dbRun("INSERT INTO form_template_versions (template_id, version_no, schema_json, status, created_by) VALUES (?, 1, '{\"sections\":[]}', 'draft', ?)", [$tid, $user['id']]);
    return $tid;
}

// Update template metadata and (if a schema is supplied) the working draft version.
function formUpdateTemplate(int $templateId, array $user, array $d): void
{
    $sets = [];
    $args = [];
    foreach (['title' => 'title', 'description' => 'description', 'category' => 'category'] as $key => $col) {
        if (array_key_exists($key, $d)) { $sets[] = "$col = ?"; $args[] = $d[$key]; }
    }
    if (array_key_exists('workflow', $d)) { $sets[] = 'workflow = ?'; $args[] = $d['workflow'] === 'approval' ? 'approval' : 'record'; }
    if (array_key_exists('allowOnBehalf', $d)) { $sets[] = 'allow_on_behalf = ?'; $args[] = !empty($d['allowOnBehalf']) ? 1 : 0; }
    if (array_key_exists('audienceRoles', $d)) {
        $roles = is_array($d['audienceRoles']) ? array_values(array_intersect($d['audienceRoles'], ['section_leader', 'assistant_leader', 'group_leadership', 'treasurer', 'chair', 'admin'])) : [];
        $sets[] = 'audience_roles = ?'; $args[] = $roles ? json_encode($roles) : null;
    }
    if ($sets) {
        $sets[] = "updated_at = datetime('now')";
        $args[] = $templateId;
        dbRun('UPDATE form_templates SET ' . implode(', ', $sets) . ' WHERE id = ?', $args);
    }
    if (array_key_exists('schema', $d) && is_array($d['schema'])) {
        $vid = formEnsureDraft($templateId, (int) $user['id']);
        dbRun('UPDATE form_template_versions SET schema_json = ? WHERE id = ?', [json_encode($d['schema']), $vid]);
    }
}

// Validate + publish the working draft. Supersedes the previously-live version (which
// stays immutable). Returns ['ok'=>true] or ['errors'=>[...]] / ['error'=>...].
function formPublishTemplate(int $templateId): array
{
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$templateId]);
    if (!$tpl) return ['error' => 'Form not found.'];
    $draft = formDraftVersion($templateId);
    if (!$draft) return ['error' => 'There are no draft changes to publish.'];
    $errs = formValidateSchema(json_decode($draft['schema_json'] ?: '{}', true) ?: []);
    if ($errs) return ['errors' => $errs];
    if ($tpl['current_version_id']) dbRun("UPDATE form_template_versions SET status = 'retired' WHERE id = ?", [$tpl['current_version_id']]);
    dbRun("UPDATE form_template_versions SET status = 'published', published_at = datetime('now') WHERE id = ?", [$draft['id']]);
    dbRun("UPDATE form_templates SET status = 'published', current_version_id = ?, updated_at = datetime('now') WHERE id = ?", [$draft['id'], $templateId]);
    return ['ok' => true];
}

// Retire a template: no longer startable; existing submissions keep working.
function formRetireTemplate(int $templateId): void
{
    dbRun("UPDATE form_templates SET status = 'retired', updated_at = datetime('now') WHERE id = ?", [$templateId]);
}

function formTemplateSubmissionCount(int $templateId): int
{
    return (int) (dbGet('SELECT COUNT(*) c FROM form_submissions WHERE template_id = ?', [$templateId])['c'] ?? 0);
}

// Admin serialise: template metadata + the editable draft schema (or the current
// published schema if there is no draft) + version history + submission count.
function serializeFormTemplateAdmin(array $tpl): array
{
    $draft = formDraftVersion((int) $tpl['id']);
    $editVer = $draft ?: ($tpl['current_version_id'] ? dbGet('SELECT * FROM form_template_versions WHERE id = ?', [$tpl['current_version_id']]) : null);
    $versions = dbAll('SELECT id, version_no, status, published_at, created_at FROM form_template_versions WHERE template_id = ? ORDER BY version_no DESC', [$tpl['id']]);
    return [
        'id' => (int) $tpl['id'],
        'title' => $tpl['title'],
        'description' => $tpl['description'],
        'category' => $tpl['category'],
        'status' => $tpl['status'],
        'workflow' => $tpl['workflow'],
        'allowOnBehalf' => (bool) $tpl['allow_on_behalf'],
        'audienceRoles' => json_decode($tpl['audience_roles'] ?? '[]', true) ?: [],
        'schema' => $editVer ? (json_decode($editVer['schema_json'] ?: '{}', true) ?: ['sections' => []]) : ['sections' => []],
        'hasDraft' => (bool) $draft,
        'currentVersionId' => $tpl['current_version_id'] ? (int) $tpl['current_version_id'] : null,
        'versions' => array_map(fn($v) => ['id' => (int) $v['id'], 'versionNo' => (int) $v['version_no'], 'status' => $v['status'], 'publishedAt' => $v['published_at']], $versions),
        'submissionCount' => formTemplateSubmissionCount((int) $tpl['id']),
    ];
}

// Admin templates list (all statuses) with light summary.
function formAdminTemplates(): array
{
    $out = [];
    foreach (dbAll('SELECT * FROM form_templates ORDER BY status, title') as $t) {
        $out[] = [
            'id' => (int) $t['id'],
            'title' => $t['title'],
            'category' => $t['category'],
            'status' => $t['status'],
            'workflow' => $t['workflow'],
            'hasDraft' => (bool) formDraftVersion((int) $t['id']),
            'submissionCount' => formTemplateSubmissionCount((int) $t['id']),
        ];
    }
    return $out;
}

// Permission-filtered submissions administration (FR-FORM-007). Admin-scoped list with
// optional filters; joins template + submitter for display. No restricted leakage since
// only admins reach this.
function formAdminSubmissions(array $filters): array
{
    $where = [];
    $args = [];
    if (!empty($filters['templateId'])) { $where[] = 's.template_id = ?'; $args[] = (int) $filters['templateId']; }
    if (!empty($filters['status']) && isset(FORM_SUB_STATUSES[$filters['status']])) { $where[] = 's.status = ?'; $args[] = $filters['status']; }
    $sql = 'SELECT s.*, t.title AS tpl_title, u.first_name, u.last_name FROM form_submissions s
            JOIN form_templates t ON t.id = s.template_id
            LEFT JOIN users u ON u.id = s.submitter_user_id';
    if ($where) $sql .= ' WHERE ' . implode(' AND ', $where);
    $sql .= ' ORDER BY s.updated_at DESC LIMIT 200';
    $q = strtolower(trim((string) ($filters['q'] ?? '')));
    $out = [];
    foreach (dbAll($sql, $args) as $s) {
        $name = trim(($s['first_name'] ?? '') . ' ' . ($s['last_name'] ?? ''));
        if ($q !== '' && !str_contains(strtolower($s['tpl_title'] . ' ' . $name . ' ' . formSubmissionRef($s)), $q)) continue;
        $out[] = [
            'id' => (int) $s['id'],
            'reference' => formSubmissionRef($s),
            'templateTitle' => $s['tpl_title'],
            'submitterName' => $name,
            'status' => $s['status'],
            'statusLabel' => FORM_SUB_STATUSES[$s['status']] ?? $s['status'],
            'updatedAt' => $s['updated_at'],
        ];
    }
    return $out;
}

// Action-Centre items: a returned submission is the submitter's to fix; a submitted
// record awaiting approval is the approver's. Mirrors the shared Action model (projection,
// not a parallel store).
function formActionItems(array $user): array
{
    if (!formsEnabled()) return [];
    $items = [];
    foreach (dbAll("SELECT * FROM form_submissions WHERE submitter_user_id = ? AND status = 'returned'", [$user['id']]) as $s) {
        $tpl = dbGet('SELECT title FROM form_templates WHERE id = ?', [$s['template_id']]);
        $items[] = ['type' => 'Form', 'action' => 'Update returned form: ' . ($tpl['title'] ?? 'Form'), 'priority' => 'Medium', 'status' => 'Open', 'link' => 'form-fill.html?id=' . $s['id'], 'owner' => 'You'];
    }
    foreach (dbAll("SELECT s.* FROM form_submissions s JOIN form_templates t ON t.id = s.template_id WHERE s.status = 'submitted' AND t.workflow = 'approval' AND s.submitter_user_id != ?", [$user['id']]) as $s) {
        if (!formCanApprove($user, $s)) continue;
        $tpl = dbGet('SELECT title FROM form_templates WHERE id = ?', [$s['template_id']]);
        $items[] = ['type' => 'Form', 'action' => 'Review form: ' . ($tpl['title'] ?? 'Form'), 'priority' => 'Medium', 'status' => 'Review', 'link' => 'form-fill.html?id=' . $s['id'], 'owner' => 'You'];
    }
    return $items;
}
