<?php
// Feature availability catalogue & matrix (FRD v1.3 Responsive & Feature-Flag pack,
// wireframe s6). A single, admin-facing view of every optional module: its current
// on/off status, who it's visible to, what it depends on, and when it was last
// changed. The status is the same flag the whole app already gates on (settings +
// /api/config); this just consolidates it with metadata so an admin can reason about
// the product at a glance. Toggling still goes through the audited settings PUT.

// Static metadata per module. `flag` is the /api/config + settings-PUT camelCase key;
// `setting` is the settings-table key. `dependsOnSetting` (optional) names a module
// this one needs, so the matrix can warn when it's enabled but its dependency isn't.
const FEATURE_CATALOGUE = [
    ['flag' => 'eventHubEnabled', 'setting' => 'event_hub_enabled', 'label' => 'Event & Camp Hub', 'visibleTo' => 'Leaders; parents see published pages', 'dependsOn' => 'Central Section Directory'],
    ['flag' => 'calendarEnabled', 'setting' => 'calendar_enabled', 'label' => 'Calendar', 'visibleTo' => 'Leaders & QMs; parents see published', 'dependsOn' => '—'],
    ['flag' => 'attendanceEnabled', 'setting' => 'attendance_enabled', 'label' => 'Attendance', 'visibleTo' => 'Leaders', 'dependsOn' => 'Central Section Directory'],
    ['flag' => 'activityFormsEnabled', 'setting' => 'activity_forms_enabled', 'label' => 'Activity forms & approval', 'visibleTo' => 'Leaders; GLV approvers', 'dependsOn' => '—'],
    ['flag' => 'equipmentRegisterEnabled', 'setting' => 'equipment_register_enabled', 'label' => 'Equipment register', 'visibleTo' => 'Leaders, QMs, Admin', 'dependsOn' => '—'],
    ['flag' => 'qmBookingEnabled', 'setting' => 'qm_booking_enabled', 'label' => 'QM bookings', 'visibleTo' => 'Leaders, QMs, Admin', 'dependsOn' => 'Equipment register', 'dependsOnSetting' => 'equipment_register_enabled', 'dependsOnLabel' => 'Equipment register'],
    ['flag' => 'financeEnabled', 'setting' => 'finance_enabled', 'label' => 'Finance & expenses', 'visibleTo' => 'Leaders, approvers, Treasurer', 'dependsOn' => 'Accounts & approver groups'],
    ['flag' => 'galleryEnabled', 'setting' => 'gallery_enabled', 'label' => 'Photo gallery', 'visibleTo' => 'Leaders; consented parents', 'dependsOn' => 'Consent & photo storage'],
    ['flag' => 'documentLibraryEnabled', 'setting' => 'document_library_enabled', 'label' => 'Document library', 'visibleTo' => 'Leaders', 'dependsOn' => '—'],
    ['flag' => 'incidentLoggingEnabled', 'setting' => 'incident_logging_enabled', 'label' => 'Incident & near-miss log', 'visibleTo' => 'Leaders & Admin (restricted records limited)', 'dependsOn' => '—'],
    ['flag' => 'patrolPointsEnabled', 'setting' => 'patrol_points_enabled', 'label' => 'Patrol Points', 'visibleTo' => 'Leaders; parents read-only leaderboard', 'dependsOn' => 'Section teams'],
    ['flag' => 'ppGuestEnabled', 'setting' => 'pp_guest_enabled', 'label' => 'Patrol Points — guest approver entry', 'visibleTo' => 'Invited guest approvers', 'dependsOn' => 'Patrol Points', 'dependsOnSetting' => 'patrol_points_enabled', 'dependsOnLabel' => 'Patrol Points'],
];

// When a flag was last configured, derived from the audit trail the settings PUT
// already writes (it records the whole change body). "Last configured", honestly -
// we report the most recent admin settings change whose payload named this flag.
function featureLastChanged(string $flag): array
{
    $row = dbGet(
        "SELECT a.created_at, u.first_name, u.last_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.action IN ('admin_update_settings', 'admin_toggle_gallery', 'admin_toggle_finance')
           AND a.details LIKE ?
         ORDER BY a.id DESC LIMIT 1",
        ['%"' . $flag . '"%']
    );
    if (!$row) return ['at' => null, 'by' => null];
    return ['at' => $row['created_at'], 'by' => trim(($row['first_name'] ?? '') . ' ' . ($row['last_name'] ?? '')) ?: 'Admin'];
}

// Build the matrix rows: catalogue metadata + live status + a dependency warning when
// a module is on but the module it needs is off + last-changed attribution.
function featureAvailabilityMatrix(): array
{
    $settings = [];
    foreach (dbAll('SELECT key, value FROM settings') as $r) $settings[$r['key']] = $r['value'];
    $isOn = fn($settingKey) => ($settings[$settingKey] ?? null) === 'true';

    $rows = [];
    foreach (FEATURE_CATALOGUE as $f) {
        $enabled = $isOn($f['setting']);
        $depWarning = null;
        if (!empty($f['dependsOnSetting']) && $enabled && !$isOn($f['dependsOnSetting'])) {
            $depWarning = $f['dependsOnLabel'] . ' is switched off, so this feature will not work fully.';
        }
        $last = featureLastChanged($f['flag']);
        $rows[] = [
            'flag' => $f['flag'],
            'label' => $f['label'],
            'enabled' => $enabled,
            'visibleTo' => $f['visibleTo'],
            'dependsOn' => $f['dependsOn'],
            'dependencyWarning' => $depWarning,
            'lastChangedAt' => $last['at'],
            'lastChangedBy' => $last['by'],
        ];
    }
    return [
        'features' => $rows,
        'enabledCount' => count(array_filter($rows, fn($r) => $r['enabled'])),
        'total' => count($rows),
        // Honest note: the portal runs one feature set; the demo/test environment is a
        // login mode over the same flags, not a separate configuration yet.
        'sharedWithDemoNote' => 'Production and the demo/test environment currently share one feature set. Per-environment feature flags are a planned enhancement.',
    ];
}
