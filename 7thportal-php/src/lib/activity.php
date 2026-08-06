<?php
// Activity Approval forms + workflow (Activity Approval Testing Pack). Optional
// module, off by default. One fixed form template (the 7th Swindon Activity
// Approval form) with a two-stage sequential approval route: Section Lead -> GLV.
// Uploaded evidence is private (authenticated-proxy only). Emergency contact /
// child data is not involved here.

const ACTIVITY_UPLOAD_DIR = __DIR__ . '/../../data/activity-uploads';
const ACTIVITY_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ACTIVITY_STATUSES = [
    'draft' => 'Draft',
    'awaiting_section' => 'Awaiting Section Lead',
    'awaiting_glv' => 'Awaiting GLV',
    'approved' => 'Approved',
    'rejected' => 'Rejected',
    'more_info' => 'More information needed',
];
const ACTIVITY_DOC_TYPES = [
    'risk_assessment' => 'Risk assessment',
    'public_liability' => 'Public liability',
    'unity_insurance' => 'Unity Insurance approval',
    'supporting' => 'Other supporting document',
];
// The group's sections, offered as a multi-select on the form (improved-flow spec).
const ACTIVITY_SECTIONS = [
    'Sparrowhawks Beavers', 'Falcon Beavers', 'Kingfisher Beavers',
    'Isambard Cubs', 'Kingdom Cubs', 'Brunel Cubs',
    'Discovery Scouts', 'Endeavour Scouts',
];
// Activity types. Adventurous activities (requiresQualification) make the
// "Relevant qualifications" field required (improved-flow spec: qualifications
// requiredWhen activityType.requiresQualification).
const ACTIVITY_TYPES = [
    'indoor' => ['label' => 'Indoor / meeting-night activity', 'requiresQualification' => false],
    'day_trip' => ['label' => 'Day trip / outing', 'requiresQualification' => false],
    'hike' => ['label' => 'Hike / walk (non-technical)', 'requiresQualification' => false],
    'camp' => ['label' => 'Camp / nights away', 'requiresQualification' => false],
    'water' => ['label' => 'Water activity (kayak, canoe, sail, paddleboard, etc.)', 'requiresQualification' => true],
    'climbing' => ['label' => 'Climbing / abseiling', 'requiresQualification' => true],
    'caving' => ['label' => 'Caving / potholing', 'requiresQualification' => true],
    'archery_shooting' => ['label' => 'Archery / shooting', 'requiresQualification' => true],
    'other_adventurous' => ['label' => 'Other adventurous activity (permit required)', 'requiresQualification' => true],
    'other' => ['label' => 'Other', 'requiresQualification' => false],
];
// Activity types as an ordered list for the client (value + label + flag).
function activityTypeOptions(): array
{
    $out = [];
    foreach (ACTIVITY_TYPES as $k => $t) $out[] = ['value' => $k, 'label' => $t['label'], 'requiresQualification' => $t['requiresQualification']];
    return $out;
}
function activityTypeRequiresQualification(?string $type): bool
{
    return !empty(ACTIVITY_TYPES[$type ?? '']['requiresQualification']);
}

function activityFormsEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'activity_forms_enabled'");
    return ($row['value'] ?? null) === 'true';
}
function requireActivityFormsEnabled(): void
{
    if (!activityFormsEnabled()) jsonResponse(['error' => 'Activity Approval forms are not enabled.'], 404);
}

// Completion group: operational leaders + admins may raise/complete forms.
function activityCanComplete(array $user): bool
{
    return in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'admin'], true);
}
// GLV approver - the single approval stage (glv-only-1.0 workflow). Never the
// submitter (no self-approval). Group Leadership are the GLV approvers; admins
// and the chair act as the fallback / senior-leadership approver group.
function activityCanApproveGlv(array $user, array $form): bool
{
    if ((int) $form['created_by'] === (int) $user['id']) return false;
    return in_array($user['portal_role'], ['group_leadership', 'admin', 'chair'], true);
}
// Who may view a form: its creator, an approver for its current/any stage, or admin.
function activityCanView(array $user, array $form): bool
{
    if ((int) $form['created_by'] === (int) $user['id']) return true;
    if ($user['portal_role'] === 'admin' || $user['portal_role'] === 'group_leadership') return true;
    return in_array($user['portal_role'], ['section_leader'], true); // section leads can see section forms
}

// The approver who can act right now. GLV-only workflow: any pending form needs
// GLV approval (awaiting_section is legacy - kept so any in-flight form migrated
// from the old two-stage route can still be actioned).
function activityCanActNow(array $user, array $form): bool
{
    if (in_array($form['status'], ['awaiting_glv', 'awaiting_section'], true)) return activityCanApproveGlv($user, $form);
    return false;
}

// Required items missing before a form can be submitted. Empty = ready.
function activityValidate(array $f): array
{
    $missing = [];
    $req = [
        'leader_name' => 'Leader name', 'leader_phone' => 'Leader phone', 'leader_email' => 'Leader email',
        'activity_description' => 'Activity description', 'activity_location' => 'Location', 'activity_date' => 'Activity date',
        'section_names' => 'Participating section(s)', 'in_touch' => 'In Touch process',
    ];
    foreach ($req as $k => $label) { if (trim((string) ($f[$k] ?? '')) === '') $missing[] = $label; }
    if ((int) ($f['yp_count'] ?? 0) <= 0) $missing[] = 'Estimated number of young people';
    if ((int) ($f['adult_count'] ?? 0) <= 0) $missing[] = 'Estimated number of adults';
    if (!$f['risk_assessment_confirmed']) $missing[] = 'Risk assessment confirmation';
    if (!$f['activity_rules_confirmed']) $missing[] = 'Activity rules confirmation';
    // Public liability only applies when an external activity provider is used
    // (improved-flow spec): then both the confirmation and a PL document are required.
    if (!empty($f['external_provider_used'])) {
        if (!$f['public_liability_confirmed']) $missing[] = 'Public liability confirmation';
        if (!activityHasDoc($f, 'public_liability')) $missing[] = 'Public liability document';
    }
    // Unity Insurance approval document required only when the activity needs it.
    if (!empty($f['unity_approval_required']) && !activityHasDoc($f, 'unity_insurance')) {
        $missing[] = 'Unity Insurance approval document';
    }
    // Qualifications required for adventurous activity types (permit-requiring).
    if (activityTypeRequiresQualification($f['activity_type'] ?? null) && trim((string) ($f['qualifications'] ?? '')) === '') {
        $missing[] = 'Relevant qualifications';
    }
    // A risk assessment document is recommended, not required (improved-flow spec):
    // the risk-assessment confirmation checkbox above is the required gate.
    return $missing;
}

// Whether a form has at least one uploaded document of the given type.
function activityHasDoc(array $f, string $docType): bool
{
    return (bool) dbGet('SELECT 1 FROM activity_form_files WHERE form_id = ? AND doc_type = ? LIMIT 1', [$f['id'] ?? 0, $docType]);
}

function serializeActivityForm(array $f, bool $full = false): array
{
    $base = [
        'id' => (int) $f['id'],
        'reference' => $f['reference'] ?: ('AAF-' . str_pad((string) $f['id'], 4, '0', STR_PAD_LEFT)),
        'createdBy' => (int) $f['created_by'],
        'activityDescription' => $f['activity_description'],
        'activityDate' => $f['activity_date'],
        'location' => $f['activity_location'],
        'sectionNames' => $f['section_names'],
        'status' => $f['status'],
        'statusLabel' => ACTIVITY_STATUSES[$f['status']] ?? $f['status'],
        'submittedAt' => $f['submitted_at'],
        'updatedAt' => $f['updated_at'],
    ];
    if (!$full) return $base;
    return array_merge($base, [
        'leaderName' => $f['leader_name'], 'leaderPhone' => $f['leader_phone'], 'leaderEmail' => $f['leader_email'],
        'activityEndDate' => $f['activity_end_date'], 'sectionId' => $f['osm_section_id'],
        'ypCount' => $f['yp_count'] !== null ? (int) $f['yp_count'] : null, 'adultCount' => $f['adult_count'] !== null ? (int) $f['adult_count'] : null,
        'activityType' => $f['activity_type'],
        'activityTypeLabel' => ACTIVITY_TYPES[$f['activity_type'] ?? '']['label'] ?? null,
        'qualifications' => $f['qualifications'], 'inTouch' => $f['in_touch'],
        'externalProviderUsed' => (bool) $f['external_provider_used'],
        'unityApprovalRequired' => (bool) $f['unity_approval_required'],
        'riskAssessmentConfirmed' => (bool) $f['risk_assessment_confirmed'],
        'publicLiabilityConfirmed' => (bool) $f['public_liability_confirmed'],
        'activityRulesConfirmed' => (bool) $f['activity_rules_confirmed'],
        'addToCalendar' => (bool) $f['add_to_calendar'], 'notes' => $f['notes'],
        'moreInfoStage' => $f['more_info_stage'], 'calendarEntryId' => $f['calendar_entry_id'] !== null ? (int) $f['calendar_entry_id'] : null,
    ]);
}
function serializeActivityFile(array $x): array
{
    return ['id' => (int) $x['id'], 'docType' => $x['doc_type'], 'docTypeLabel' => ACTIVITY_DOC_TYPES[$x['doc_type']] ?? $x['doc_type'], 'filename' => $x['original_filename'], 'ext' => $x['ext']];
}
function serializeActivityEvent(array $e): array
{
    $u = $e['actor_user_id'] ? dbGet('SELECT first_name, last_name FROM users WHERE id = ?', [$e['actor_user_id']]) : null;
    return ['action' => $e['action'], 'stage' => $e['stage'], 'comment' => $e['comment'], 'at' => $e['created_at'], 'by' => $u ? trim($u['first_name'] . ' ' . $u['last_name']) : 'System'];
}

// ── Private file storage (mirrors receipts) ─────────────────────────────────────
function activityStorageKey(): string { return bin2hex(random_bytes(20)); }
function activityFilePathFor(string $key, string $ext): string { return ACTIVITY_UPLOAD_DIR . "/$key.$ext"; }
// PDF/JPG/PNG sniffed from bytes; office docs (zip-based) trusted by extension -
// consistent with the document library's accepted gap (no fileinfo dependency).
function activityDetectExtension(string $tmpPath, string $originalName): ?string
{
    $info = @getimagesize($tmpPath);
    if ($info && ($info['mime'] ?? null) === 'image/jpeg') return 'jpg';
    if ($info && ($info['mime'] ?? null) === 'image/png') return 'png';
    $head = @file_get_contents($tmpPath, false, null, 0, 5);
    if ($head !== false && str_starts_with($head, '%PDF-')) return 'pdf';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    if (in_array($ext, ['doc', 'docx', 'xls', 'xlsx'], true)) return $ext;
    return null;
}
function activityDeleteFileOnDisk(string $key, string $ext): void
{
    $p = activityFilePathFor($key, $ext);
    if (is_file($p)) unlink($p);
}

// Action Centre (FR-ACT): forms to finish/resubmit for the submitter, and forms
// awaiting a decision for approvers.
function activityActionItems(array $user): array
{
    if (!activityFormsEnabled() || !activityCanComplete($user)) return [];
    $items = [];
    foreach (dbAll("SELECT id, reference, activity_description FROM activity_forms WHERE created_by = ? AND status IN ('draft','more_info')", [$user['id']]) as $f) {
        $ref = $f['reference'] ?: ('AAF-' . str_pad((string) $f['id'], 4, '0', STR_PAD_LEFT));
        $items[] = actionItem('act-form-' . $f['id'], 'Medium', 'Activity form', 'Activity form to complete: ' . $ref, 'You', 'Open', 'activity-form.html?id=' . $f['id']);
    }
    // GLV-only workflow: only GLV approvers get approval tasks. Section Leaders no
    // longer receive them just because it's their section's activity.
    if (in_array($user['portal_role'], ['group_leadership', 'admin', 'chair'], true)) {
        foreach (dbAll("SELECT id, reference FROM activity_forms WHERE status IN ('awaiting_glv','awaiting_section') AND created_by != ?", [$user['id']]) as $f) {
            $ref = $f['reference'] ?: ('AAF-' . str_pad((string) $f['id'], 4, '0', STR_PAD_LEFT));
            $items[] = actionItem('act-glv-' . $f['id'], 'High', 'Activity form', 'Activity form to approve (GLV): ' . $ref, 'GLV', 'Open', 'activity-form.html?id=' . $f['id']);
        }
    }
    return $items;
}
