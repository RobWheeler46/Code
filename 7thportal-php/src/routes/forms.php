<?php
// Generic Forms routes (FR-FORM-003..009): the canonical Forms landing, completion of a
// submission against a frozen template-version snapshot, and an optional single-approval
// workflow. Template administration + submissions administration are added separately.

// ── Landing (FR-FORM-003): published forms for this user + their own submissions ──
$router->get('/api/forms', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    if (!formsCanComplete($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    jsonResponse([
        'canComplete' => true,
        'canAdmin' => formsCanAdmin($user),
        'templates' => formPublishedTemplatesFor($user),
        'mySubmissions' => formMySubmissions($user),
    ]);
});

// Start a submission of a published template (creates a draft with a frozen schema).
$router->post('/api/forms/submissions', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    if (!formsCanComplete($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $b = requestBody();
    $templateId = (int) ($b['templateId'] ?? 0);
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$templateId]);

    // On-behalf (FR-FORM-008): only when the template allows it and the actor is an
    // administrator. The acting admin stays the submitter; the subject and reason are
    // recorded, never a silent impersonation.
    $onBehalf = null;
    if (!empty($b['onBehalf']) && is_array($b['onBehalf']) && !empty($b['onBehalf']['userId'])) {
        if (!$tpl || !formCanCompleteOnBehalf($user, $tpl)) jsonResponse(['error' => 'On-behalf completion is not permitted for this form.'], 403);
        $target = dbGet('SELECT id FROM users WHERE id = ?', [(int) $b['onBehalf']['userId']]);
        if (!$target) jsonResponse(['error' => 'Choose a valid person to complete this for.'], 422);
        $reason = trim((string) ($b['onBehalf']['reason'] ?? ''));
        if ($reason === '') jsonResponse(['error' => 'Give a reason for completing on behalf of someone else.'], 422);
        $onBehalf = ['userId' => (int) $target['id'], 'reason' => $reason];
    }

    $id = formStartSubmission($user, $templateId, $onBehalf);
    if (!$id) jsonResponse(['error' => 'That form is not available.'], 404);
    logAudit(['userId' => $user['id'], 'action' => 'form_submission_start', 'entityType' => 'form_submission', 'entityId' => (string) $id, 'ipAddress' => clientIp(), 'details' => $onBehalf ? ['onBehalfOf' => $onBehalf['userId'], 'reason' => $onBehalf['reason']] : null]);
    jsonResponse(['id' => $id], 201);
});

// A submission detail (guarded view).
$router->get('/api/forms/submissions/:id', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanViewSubmission($user, $sub)) jsonResponse(['error' => 'Not permitted.'], 403);
    jsonResponse(serializeFormSubmission($sub, $user));
});

// Save answers (draft/returned, own or admin).
$router->put('/api/forms/submissions/:id', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanEditSubmission($user, $sub)) jsonResponse(['error' => 'This form can no longer be edited.'], 409);
    $b = requestBody();
    $data = is_array($b['data'] ?? null) ? $b['data'] : [];
    dbRun("UPDATE form_submissions SET data_json = ?, updated_at = datetime('now') WHERE id = ?", [json_encode($data), $sub['id']]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

// Submit (validate required fields, assign a reference, route for approval if configured).
$router->post('/api/forms/submissions/:id/submit', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanEditSubmission($user, $sub)) jsonResponse(['error' => 'This form can no longer be submitted.'], 409);
    // Persist any answers sent with the submit, then validate the frozen schema.
    $b = requestBody();
    if (is_array($b['data'] ?? null)) dbRun('UPDATE form_submissions SET data_json = ? WHERE id = ?', [json_encode($b['data']), $sub['id']]);
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]);
    $missing = formValidateSubmission($sub);
    if ($missing) jsonResponse(['error' => 'Please complete: ' . implode(', ', $missing), 'missing' => $missing], 422);

    $ref = $sub['reference'] ?: formSubmissionReference();
    dbRun("UPDATE form_submissions SET status = 'submitted', reference = ?, submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$ref, $sub['id']]);
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$sub['template_id']]);
    if (($tpl['workflow'] ?? 'record') === 'approval') {
        notifyRoles(['group_leadership', 'chair'], 'form_submitted', 'Form to review: ' . $tpl['title'], $ref . ' was submitted by ' . trim($user['first_name'] . ' ' . $user['last_name']), 'form-fill.html?id=' . $sub['id']);
    }
    logAudit(['userId' => $user['id'], 'action' => 'form_submission_submit', 'entityType' => 'form_submission', 'entityId' => (string) $sub['id'], 'ipAddress' => clientIp(), 'details' => ['reference' => $ref]]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

// Withdraw (submitter only).
$router->post('/api/forms/submissions/:id/withdraw', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if ((int) $sub['submitter_user_id'] !== (int) $user['id'] || !in_array($sub['status'], ['draft', 'submitted', 'returned'], true)) jsonResponse(['error' => 'Not permitted.'], 403);
    dbRun("UPDATE form_submissions SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?", [$sub['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'form_submission_withdraw', 'entityType' => 'form_submission', 'entityId' => (string) $sub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

// Approval decision (approval workflow only; never the submitter).
$router->post('/api/forms/submissions/:id/decision', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanApprove($user, $sub)) jsonResponse(['error' => 'Not permitted.'], 403);
    $b = requestBody();
    $decision = ($b['decision'] ?? '') === 'approve' ? 'approved' : (($b['decision'] ?? '') === 'return' ? 'returned' : '');
    if (!$decision) jsonResponse(['error' => 'Choose approve or return.'], 422);
    $comment = trim((string) ($b['comment'] ?? ''));
    if ($decision === 'returned' && $comment === '') jsonResponse(['error' => 'A reason is required when returning a form.'], 422);
    dbRun("UPDATE form_submissions SET status = ?, decided_by = ?, decided_at = datetime('now'), decision_comment = ?, updated_at = datetime('now') WHERE id = ?", [$decision, $user['id'], $comment, $sub['id']]);
    $tpl = dbGet('SELECT title FROM form_templates WHERE id = ?', [$sub['template_id']]);
    notify((int) $sub['submitter_user_id'], 'form_decided', $tpl['title'] . ' ' . ($decision === 'approved' ? 'approved' : 'returned'), $comment ?: null, 'form-fill.html?id=' . $sub['id']);
    logAudit(['userId' => $user['id'], 'action' => 'form_submission_' . $decision, 'entityType' => 'form_submission', 'entityId' => (string) $sub['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

// ── Evidence files on a submission's 'file' fields. Private: stored outside the web
// root, served only via this authenticated proxy. ───────────────────────────────
$router->post('/api/forms/submissions/:id/files', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanEditSubmission($user, $sub)) jsonResponse(['error' => 'This form can no longer be edited.'], 409);
    $fieldId = trim((string) ($_POST['fieldId'] ?? ''));
    $schema = json_decode($sub['schema_snapshot_json'] ?: '{}', true) ?: [];
    $field = null;
    foreach (formSchemaFields($schema) as $f) { if (($f['id'] ?? '') === $fieldId && ($f['type'] ?? '') === 'file') { $field = $f; break; } }
    if (!$field) jsonResponse(['error' => 'Unknown upload field.'], 400);
    if (empty($_FILES['file'])) jsonResponse(['error' => 'No file received.'], 400);
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > FORM_MAX_UPLOAD_BYTES || !is_uploaded_file($file['tmp_name'])) jsonResponse(['error' => 'Upload failed - check the file is under 10MB.'], 400);
    $ext = activityDetectExtension($file['tmp_name'], $file['name']); // shared detector (PDF/JPG/PNG sniffed, office by ext)
    if (!$ext) jsonResponse(['error' => 'Accepted files: PDF, DOCX, XLSX, PNG, JPG.'], 400);
    if (!is_dir(FORM_UPLOAD_DIR)) @mkdir(FORM_UPLOAD_DIR, 0775, true);
    $key = formStorageKey();
    file_put_contents(formFilePathFor($key, $ext), file_get_contents($file['tmp_name']));
    dbRun('INSERT INTO form_submission_files (submission_id, field_id, storage_key, ext, original_filename, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', [$sub['id'], $fieldId, $key, $ext, $file['name'], $user['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'form_file_upload', 'entityType' => 'form_submission', 'entityId' => (string) $sub['id'], 'ipAddress' => clientIp(), 'details' => ['fieldId' => $fieldId]]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

$router->delete('/api/forms/submissions/:id/files/:fileId', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub) jsonResponse(['error' => 'Not found.'], 404);
    if (!formCanEditSubmission($user, $sub)) jsonResponse(['error' => 'This form can no longer be edited.'], 409);
    $x = dbGet('SELECT * FROM form_submission_files WHERE id = ? AND submission_id = ?', [$params['fileId'], $sub['id']]);
    if (!$x) jsonResponse(['error' => 'File not found.'], 404);
    formDeleteFileOnDisk($x['storage_key'], $x['ext']);
    dbRun('DELETE FROM form_submission_files WHERE id = ?', [$x['id']]);
    jsonResponse(serializeFormSubmission(dbGet('SELECT * FROM form_submissions WHERE id = ?', [$sub['id']]), $user));
});

$router->get('/api/forms/submissions/:id/files/:fileId/download', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    $sub = dbGet('SELECT * FROM form_submissions WHERE id = ?', [$params['id']]);
    if (!$sub || !formCanViewSubmission($user, $sub)) { http_response_code(404); exit; }
    $x = dbGet('SELECT * FROM form_submission_files WHERE id = ? AND submission_id = ?', [$params['fileId'], $sub['id']]);
    if (!$x) { http_response_code(404); exit; }
    $path = formFilePathFor($x['storage_key'], $x['ext']);
    if (!is_file($path)) { http_response_code(404); exit; }
    $mimes = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'png' => 'image/png', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    header('Content-Type: ' . ($mimes[$x['ext']] ?? 'application/octet-stream'));
    header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\- ]/', '_', (string) ($x['original_filename'] ?: ('file.' . $x['ext']))) . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
});

// People an admin may complete a form on behalf of (on-behalf picker). Admin-only.
$router->get('/api/forms/people', function ($params) {
    $user = requireAuth();
    requireFormsEnabled();
    if (!formsCanAdmin($user)) jsonResponse(['error' => 'Not permitted.'], 403);
    $people = array_map(fn($u) => ['id' => (int) $u['id'], 'name' => trim($u['first_name'] . ' ' . $u['last_name']), 'role' => $u['portal_role']],
        dbAll("SELECT id, first_name, last_name, portal_role FROM users WHERE account_status = 'active' ORDER BY first_name, last_name"));
    jsonResponse(['people' => $people]);
});

// ── Template administration (FR-FORM-004/005/006). Admin only; permission-separated
// from completion, so an ordinary completer never reaches these. ─────────────────
function requireFormsAdmin(): array
{
    $user = requireAuth();
    requireFormsEnabled();
    if (!formsCanAdmin($user)) jsonResponse(['error' => 'Form administration is restricted to administrators.'], 403);
    return $user;
}

$router->get('/api/admin/forms/templates', function ($params) {
    requireFormsAdmin();
    jsonResponse(['templates' => formAdminTemplates()]);
});

$router->post('/api/admin/forms/templates', function ($params) {
    $user = requireFormsAdmin();
    $id = formCreateTemplate($user, requestBody());
    logAudit(['userId' => $user['id'], 'action' => 'form_template_create', 'entityType' => 'form_template', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
    jsonResponse(['id' => $id], 201);
});

$router->get('/api/admin/forms/templates/:id', function ($params) {
    requireFormsAdmin();
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$params['id']]);
    if (!$tpl) jsonResponse(['error' => 'Not found.'], 404);
    jsonResponse(serializeFormTemplateAdmin($tpl));
});

$router->put('/api/admin/forms/templates/:id', function ($params) {
    $user = requireFormsAdmin();
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$params['id']]);
    if (!$tpl) jsonResponse(['error' => 'Not found.'], 404);
    formUpdateTemplate((int) $tpl['id'], $user, requestBody());
    logAudit(['userId' => $user['id'], 'action' => 'form_template_update', 'entityType' => 'form_template', 'entityId' => (string) $tpl['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeFormTemplateAdmin(dbGet('SELECT * FROM form_templates WHERE id = ?', [$tpl['id']])));
});

$router->post('/api/admin/forms/templates/:id/publish', function ($params) {
    $user = requireFormsAdmin();
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$params['id']]);
    if (!$tpl) jsonResponse(['error' => 'Not found.'], 404);
    $r = formPublishTemplate((int) $tpl['id']);
    if (isset($r['errors'])) jsonResponse(['error' => 'Fix these before publishing.', 'errors' => $r['errors']], 422);
    if (isset($r['error'])) jsonResponse(['error' => $r['error']], 409);
    logAudit(['userId' => $user['id'], 'action' => 'form_template_publish', 'entityType' => 'form_template', 'entityId' => (string) $tpl['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeFormTemplateAdmin(dbGet('SELECT * FROM form_templates WHERE id = ?', [$tpl['id']])));
});

$router->post('/api/admin/forms/templates/:id/retire', function ($params) {
    $user = requireFormsAdmin();
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$params['id']]);
    if (!$tpl) jsonResponse(['error' => 'Not found.'], 404);
    formRetireTemplate((int) $tpl['id']);
    logAudit(['userId' => $user['id'], 'action' => 'form_template_retire', 'entityType' => 'form_template', 'entityId' => (string) $tpl['id'], 'ipAddress' => clientIp()]);
    jsonResponse(serializeFormTemplateAdmin(dbGet('SELECT * FROM form_templates WHERE id = ?', [$tpl['id']])));
});

// Delete only a never-published template with no submissions; otherwise retire.
$router->delete('/api/admin/forms/templates/:id', function ($params) {
    $user = requireFormsAdmin();
    $tpl = dbGet('SELECT * FROM form_templates WHERE id = ?', [$params['id']]);
    if (!$tpl) jsonResponse(['error' => 'Not found.'], 404);
    if ($tpl['status'] !== 'draft' || formTemplateSubmissionCount((int) $tpl['id']) > 0) jsonResponse(['error' => 'This form has been published or has submissions. Retire it instead.'], 409);
    dbRun('DELETE FROM form_templates WHERE id = ?', [$tpl['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'form_template_delete', 'entityType' => 'form_template', 'entityId' => (string) $tpl['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// Submissions administration (FR-FORM-007): permission-filtered list. Admin only.
$router->get('/api/admin/forms/submissions', function ($params) {
    requireFormsAdmin();
    jsonResponse([
        'submissions' => formAdminSubmissions(['templateId' => queryParam('templateId'), 'status' => queryParam('status'), 'q' => queryParam('q')]),
        'templates' => formAdminTemplates(),
        'statuses' => FORM_SUB_STATUSES,
    ]);
});
