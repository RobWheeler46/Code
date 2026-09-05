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
    $id = formStartSubmission($user, $templateId);
    if (!$id) jsonResponse(['error' => 'That form is not available.'], 404);
    logAudit(['userId' => $user['id'], 'action' => 'form_submission_start', 'entityType' => 'form_submission', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
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
