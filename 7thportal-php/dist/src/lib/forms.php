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
// with the design-system field components.
const FORM_FIELD_TYPES = ['text', 'textarea', 'email', 'number', 'date', 'select', 'radio', 'checkbox'];

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
    $missing = [];
    foreach (formSchemaFields($schema) as $f) {
        if (empty($f['required'])) continue;
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
