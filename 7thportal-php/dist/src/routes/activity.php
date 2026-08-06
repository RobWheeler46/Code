<?php
// Activity Approval forms API (Activity Approval Testing Pack). Leader-only; a
// two-stage sequential approval (Section Lead -> GLV) with reject / request-more-
// info / resubmit, private evidence uploads, calendar-entry-on-final-approval, and
// a full audit trail. Optional module, off by default.

function activityFormOr404($id): array
{
    $f = dbGet('SELECT * FROM activity_forms WHERE id = ?', [$id]);
    if (!$f) jsonResponse(['error' => 'Form not found.'], 404);
    return $f;
}
function activityLogEvent(int $formId, ?int $actor, string $action, ?string $stage, ?string $comment): void
{
    dbRun('INSERT INTO activity_form_events (form_id, actor_user_id, action, stage, comment) VALUES (?, ?, ?, ?, ?)', [$formId, $actor, $action, $stage, $comment]);
}
function activityMyActions(array $user, array $f): array
{
    $isCreator = (int) $f['created_by'] === (int) $user['id'];
    $editable = $isCreator && in_array($f['status'], ['draft', 'more_info'], true);
    return [
        'canEdit' => $editable,
        'canSubmit' => $editable,
        'canApproveSection' => $f['status'] === 'awaiting_section' && activityCanApproveSection($user, $f),
        'canApproveGlv' => $f['status'] === 'awaiting_glv' && activityCanApproveGlv($user, $f),
        'canDelete' => $isCreator && $f['status'] === 'draft',
        'isCreator' => $isCreator,
    ];
}

// Writable form fields from the request body.
function activityFieldsFromBody(array $b, array $existing): array
{
    $val = fn($k, $col) => array_key_exists($k, $b) ? (trim((string) $b[$k]) ?: null) : ($existing[$col] ?? null);
    $bool = fn($k, $col) => array_key_exists($k, $b) ? ((int) (bool) $b[$k]) : (int) ($existing[$col] ?? 0);
    return [
        'leader_name' => $val('leaderName', 'leader_name'),
        'leader_phone' => $val('leaderPhone', 'leader_phone'),
        'leader_email' => $val('leaderEmail', 'leader_email'),
        'activity_description' => $val('activityDescription', 'activity_description'),
        'activity_location' => $val('location', 'activity_location'),
        'activity_date' => $val('activityDate', 'activity_date'),
        'activity_end_date' => $val('activityEndDate', 'activity_end_date'),
        'section_names' => $val('sectionNames', 'section_names'),
        'osm_section_id' => $val('sectionId', 'osm_section_id'),
        'yp_count' => array_key_exists('ypCount', $b) ? (int) $b['ypCount'] : ($existing['yp_count'] ?? null),
        'adult_count' => array_key_exists('adultCount', $b) ? (int) $b['adultCount'] : ($existing['adult_count'] ?? null),
        'qualifications' => $val('qualifications', 'qualifications'),
        'in_touch' => $val('inTouch', 'in_touch'),
        'risk_assessment_confirmed' => $bool('riskAssessmentConfirmed', 'risk_assessment_confirmed'),
        'public_liability_confirmed' => $bool('publicLiabilityConfirmed', 'public_liability_confirmed'),
        'activity_rules_confirmed' => $bool('activityRulesConfirmed', 'activity_rules_confirmed'),
        'add_to_calendar' => $bool('addToCalendar', 'add_to_calendar'),
        'notes' => $val('notes', 'notes'),
    ];
}

// ── List ────────────────────────────────────────────────────────────────────────
$router->get('/api/activity/forms', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $mine = array_map(fn($f) => serializeActivityForm($f), dbAll('SELECT * FROM activity_forms WHERE created_by = ? ORDER BY updated_at DESC', [$user['id']]));
    // Forms awaiting a decision this user can make.
    $inbox = [];
    if (in_array($user['portal_role'], ['section_leader', 'group_leadership', 'admin'], true)) {
        $rows = dbAll("SELECT * FROM activity_forms WHERE created_by != ? AND status IN ('awaiting_section','awaiting_glv') ORDER BY submitted_at", [$user['id']]);
        foreach ($rows as $f) { if (activityCanActNow($user, $f)) $inbox[] = serializeActivityForm($f); }
    }
    jsonResponse(['mine' => $mine, 'inbox' => $inbox, 'canComplete' => activityCanComplete($user), 'meta' => ['statuses' => ACTIVITY_STATUSES, 'docTypes' => ACTIVITY_DOC_TYPES]]);
});

// ── Create draft ────────────────────────────────────────────────────────────────
$router->post('/api/activity/forms', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    if (!activityCanComplete($user)) jsonResponse(['error' => 'Your role cannot raise activity forms.'], 403);
    $result = dbRun(
        "INSERT INTO activity_forms (created_by, leader_name, leader_email, status) VALUES (?, ?, ?, 'draft')",
        [$user['id'], trim(($user['first_name'] ?? '') . ' ' . ($user['last_name'] ?? '')), $user['email'] ?? null]
    );
    $id = (int) $result['lastInsertId'];
    dbRun('UPDATE activity_forms SET reference = ? WHERE id = ?', ['AAF-' . str_pad((string) $id, 4, '0', STR_PAD_LEFT), $id]);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_create', 'entityType' => 'activity_form', 'entityId' => (string) $id, 'ipAddress' => clientIp()]);
    jsonResponse(serializeActivityForm(activityFormOr404($id), true), 201);
});

// ── Detail ──────────────────────────────────────────────────────────────────────
$router->get('/api/activity/forms/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if (!activityCanView($user, $f)) jsonResponse(['error' => 'You cannot view this form.'], 403);
    jsonResponse([
        'form' => serializeActivityForm($f, true),
        'files' => array_map('serializeActivityFile', dbAll('SELECT * FROM activity_form_files WHERE form_id = ? ORDER BY id', [$f['id']])),
        'events' => array_map('serializeActivityEvent', dbAll('SELECT * FROM activity_form_events WHERE form_id = ? ORDER BY id', [$f['id']])),
        'myActions' => activityMyActions($user, $f),
        'missing' => activityValidate($f),
        'meta' => ['statuses' => ACTIVITY_STATUSES, 'docTypes' => ACTIVITY_DOC_TYPES, 'sections' => ACTIVITY_SECTIONS],
    ]);
});

// ── Save draft ──────────────────────────────────────────────────────────────────
$router->patch('/api/activity/forms/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if ((int) $f['created_by'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot edit this form.'], 403);
    if (!in_array($f['status'], ['draft', 'more_info'], true)) jsonResponse(['error' => 'This form can no longer be edited.'], 409);
    $fields = activityFieldsFromBody(requestBody(), $f);
    $set = implode(', ', array_map(fn($c) => "$c = ?", array_keys($fields)));
    dbRun("UPDATE activity_forms SET $set, updated_at = datetime('now') WHERE id = ?", [...array_values($fields), $f['id']]);
    jsonResponse(serializeActivityForm(activityFormOr404($f['id']), true));
});

// ── Submit / resubmit ───────────────────────────────────────────────────────────
$router->post('/api/activity/forms/:id/submit', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if ((int) $f['created_by'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot submit this form.'], 403);
    if (!in_array($f['status'], ['draft', 'more_info'], true)) jsonResponse(['error' => 'This form is not open for submission.'], 409);
    $missing = activityValidate($f);
    if ($missing) jsonResponse(['error' => 'Some required items are missing.', 'missing' => $missing], 400);

    // A returned form resumes at the stage that asked for more info; a fresh draft
    // starts at the Section Lead stage.
    $resume = $f['status'] === 'more_info' && $f['more_info_stage'] === 'glv';
    $newStatus = $resume ? 'awaiting_glv' : 'awaiting_section';
    dbRun("UPDATE activity_forms SET status = ?, more_info_stage = NULL, submitted_at = COALESCE(submitted_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", [$newStatus, $f['id']]);
    activityLogEvent((int) $f['id'], $user['id'], $f['status'] === 'more_info' ? 'resubmit' : 'submit', null, null);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_submit', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    $ref = $f['reference'] ?: ('AAF-' . $f['id']);
    if ($newStatus === 'awaiting_section') notifyRoles(['section_leader', 'group_leadership', 'admin'], 'activity_form', 'Activity form to approve', $ref . ' has been submitted for Section Lead approval.', 'activity-form.html?id=' . $f['id']);
    else notifyRoles(['group_leadership', 'admin'], 'activity_form', 'Activity form to approve', $ref . ' has been resubmitted for GLV approval.', 'activity-form.html?id=' . $f['id']);
    jsonResponse(serializeActivityForm(activityFormOr404($f['id']), true));
});

// ── Approver decisions ──────────────────────────────────────────────────────────
function activityCreateCalendarEntry(array $f, int $actorId): ?int
{
    if (!(function_exists('calendarEnabled') && calendarEnabled())) return null;
    if (!$f['add_to_calendar'] || $f['calendar_entry_id'] || !$f['activity_date']) return null;
    $start = substr((string) $f['activity_date'], 0, 10) . ' 00:00:00';
    $end = $f['activity_end_date'] ? substr((string) $f['activity_end_date'], 0, 10) . ' 23:59:59' : null;
    $res = dbRun(
        "INSERT INTO calendar_entries (title, entry_type, scope, osm_section_id, section_name, start_at, end_at, all_day, location, notes, visibility, status, created_by)
         VALUES (?, 'activity', ?, ?, ?, ?, ?, 1, ?, ?, 'leaders', 'draft', ?)",
        [
            'Activity: ' . mb_substr((string) ($f['activity_description'] ?: 'Approved activity'), 0, 80),
            $f['osm_section_id'] ? 'section' : 'group', $f['osm_section_id'], $f['section_names'],
            $start, $end, $f['activity_location'], 'From approved activity form ' . ($f['reference'] ?: ('AAF-' . $f['id'])), $actorId,
        ]
    );
    return (int) $res['lastInsertId'];
}

$router->post('/api/activity/forms/:id/approve', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if (!activityCanActNow($user, $f)) jsonResponse(['error' => 'You cannot approve this form at its current stage.'], 403);
    $comment = trim((string) (requestBody()['comment'] ?? '')) ?: null;
    $ref = $f['reference'] ?: ('AAF-' . $f['id']);

    if ($f['status'] === 'awaiting_section') {
        dbRun("UPDATE activity_forms SET status = 'awaiting_glv', section_decided_by = ?, section_decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", [$user['id'], $f['id']]);
        activityLogEvent((int) $f['id'], $user['id'], 'section_approve', 'section', $comment);
        notifyRoles(['group_leadership', 'admin'], 'activity_form', 'Activity form to approve (GLV)', $ref . ' passed Section Lead approval and needs GLV sign-off.', 'activity-form.html?id=' . $f['id']);
        notify((int) $f['created_by'], 'activity_form', 'Activity form progressed', $ref . ' was approved by the Section Lead and is now with GLV.', 'activity-form.html?id=' . $f['id']);
    } else { // awaiting_glv -> final approval
        $calId = activityCreateCalendarEntry($f, (int) $user['id']);
        dbRun("UPDATE activity_forms SET status = 'approved', glv_decided_by = ?, glv_decided_at = datetime('now'), calendar_entry_id = ?, updated_at = datetime('now') WHERE id = ?", [$user['id'], $calId, $f['id']]);
        activityLogEvent((int) $f['id'], $user['id'], 'glv_approve', 'glv', $comment);
        if ($calId) activityLogEvent((int) $f['id'], $user['id'], 'calendar_created', 'glv', null);
        notify((int) $f['created_by'], 'activity_form', 'Activity form approved', $ref . ' has been fully approved.' . ($calId ? ' A draft calendar entry was created.' : ''), 'activity-form.html?id=' . $f['id']);
    }
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_approve', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp(), 'details' => ['stage' => $f['status']]]);
    jsonResponse(serializeActivityForm(activityFormOr404($f['id']), true));
});

$router->post('/api/activity/forms/:id/reject', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if (!activityCanActNow($user, $f)) jsonResponse(['error' => 'You cannot reject this form at its current stage.'], 403);
    $comment = trim((string) (requestBody()['comment'] ?? '')) ?: null;
    $stage = $f['status'] === 'awaiting_section' ? 'section' : 'glv';
    dbRun("UPDATE activity_forms SET status = 'rejected', updated_at = datetime('now') WHERE id = ?", [$f['id']]);
    activityLogEvent((int) $f['id'], $user['id'], 'reject', $stage, $comment);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_reject', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    $ref = $f['reference'] ?: ('AAF-' . $f['id']);
    notify((int) $f['created_by'], 'activity_form', 'Activity form rejected', $ref . ' was rejected.' . ($comment ? ' Reason: ' . $comment : ''), 'activity-form.html?id=' . $f['id']);
    jsonResponse(serializeActivityForm(activityFormOr404($f['id']), true));
});

$router->post('/api/activity/forms/:id/request-info', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if (!activityCanActNow($user, $f)) jsonResponse(['error' => 'You cannot act on this form at its current stage.'], 403);
    $comment = trim((string) (requestBody()['comment'] ?? ''));
    if ($comment === '') jsonResponse(['error' => 'Please say what more information is needed.'], 400);
    $stage = $f['status'] === 'awaiting_section' ? 'section' : 'glv';
    dbRun("UPDATE activity_forms SET status = 'more_info', more_info_stage = ?, updated_at = datetime('now') WHERE id = ?", [$stage, $f['id']]);
    activityLogEvent((int) $f['id'], $user['id'], 'request_info', $stage, $comment);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_request_info', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    $ref = $f['reference'] ?: ('AAF-' . $f['id']);
    notify((int) $f['created_by'], 'activity_form', 'More information needed', $ref . ' was returned for more information: ' . $comment, 'activity-form.html?id=' . $f['id']);
    jsonResponse(serializeActivityForm(activityFormOr404($f['id']), true));
});

$router->delete('/api/activity/forms/:id', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if ((int) $f['created_by'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot delete this form.'], 403);
    if ($f['status'] !== 'draft') jsonResponse(['error' => 'Only a draft can be deleted.'], 409);
    foreach (dbAll('SELECT storage_key, ext FROM activity_form_files WHERE form_id = ?', [$f['id']]) as $x) activityDeleteFileOnDisk($x['storage_key'], $x['ext']);
    dbRun('DELETE FROM activity_forms WHERE id = ?', [$f['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_delete', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true]);
});

// ── Files ───────────────────────────────────────────────────────────────────────
$router->post('/api/activity/forms/:id/files', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if ((int) $f['created_by'] !== (int) $user['id']) jsonResponse(['error' => 'You cannot add files to this form.'], 403);
    if (!in_array($f['status'], ['draft', 'more_info'], true)) jsonResponse(['error' => 'Files can only be changed while the form is open for editing.'], 409);
    $docType = array_key_exists(queryParam('type'), ACTIVITY_DOC_TYPES) ? queryParam('type') : 'supporting';
    if (empty($_FILES['file'])) jsonResponse(['error' => 'No file received.'], 400);
    $file = $_FILES['file'];
    if ($file['error'] !== UPLOAD_ERR_OK || $file['size'] > ACTIVITY_MAX_UPLOAD_BYTES || !is_uploaded_file($file['tmp_name'])) {
        jsonResponse(['error' => 'Upload failed - check the file is under 10MB.'], 400);
    }
    $ext = activityDetectExtension($file['tmp_name'], $file['name']);
    if (!$ext) jsonResponse(['error' => 'Accepted files: PDF, DOCX, XLSX, PNG, JPG.'], 400);
    if (!is_dir(ACTIVITY_UPLOAD_DIR)) @mkdir(ACTIVITY_UPLOAD_DIR, 0775, true);
    $key = activityStorageKey();
    file_put_contents(activityFilePathFor($key, $ext), file_get_contents($file['tmp_name']));
    dbRun('INSERT INTO activity_form_files (form_id, doc_type, storage_key, ext, original_filename, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)', [$f['id'], $docType, $key, $ext, $file['name'], $user['id']]);
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_upload', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp(), 'details' => ['docType' => $docType]]);
    jsonResponse(['ok' => true, 'files' => array_map('serializeActivityFile', dbAll('SELECT * FROM activity_form_files WHERE form_id = ? ORDER BY id', [$f['id']]))]);
});

$router->delete('/api/activity/forms/:id/files/:fileId', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if ((int) $f['created_by'] !== (int) $user['id']) jsonResponse(['error' => 'Not permitted.'], 403);
    if (!in_array($f['status'], ['draft', 'more_info'], true)) jsonResponse(['error' => 'Files can only be changed while the form is open for editing.'], 409);
    $x = dbGet('SELECT * FROM activity_form_files WHERE id = ? AND form_id = ?', [$params['fileId'], $f['id']]);
    if (!$x) jsonResponse(['error' => 'File not found.'], 404);
    activityDeleteFileOnDisk($x['storage_key'], $x['ext']);
    dbRun('DELETE FROM activity_form_files WHERE id = ?', [$x['id']]);
    jsonResponse(['ok' => true]);
});

$router->get('/api/activity/forms/:id/files/:fileId/download', function ($params) {
    $user = requireAuth();
    requireLeader($user);
    requireActivityFormsEnabled();
    $f = activityFormOr404($params['id']);
    if (!activityCanView($user, $f)) { http_response_code(404); exit; }
    $x = dbGet('SELECT * FROM activity_form_files WHERE id = ? AND form_id = ?', [$params['fileId'], $f['id']]);
    if (!$x) { http_response_code(404); exit; }
    $path = activityFilePathFor($x['storage_key'], $x['ext']);
    if (!is_file($path)) { http_response_code(404); exit; }
    logAudit(['userId' => $user['id'], 'action' => 'activity_form_file_view', 'entityType' => 'activity_form', 'entityId' => (string) $f['id'], 'ipAddress' => clientIp()]);
    $mimes = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'png' => 'image/png', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'doc' => 'application/msword', 'xls' => 'application/vnd.ms-excel'];
    header('Content-Type: ' . ($mimes[$x['ext']] ?? 'application/octet-stream'));
    header('Content-Disposition: inline; filename="' . preg_replace('/[^\w.\- ]/', '_', (string) ($x['original_filename'] ?: ('file.' . $x['ext']))) . '"');
    header('Content-Length: ' . filesize($path));
    readfile($path);
    exit;
});
