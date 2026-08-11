<?php
// Incident and near-miss logging (FRD FR-INC). Optional, off by default, and
// safeguarding-sensitive - see access rules below.

const INCIDENT_TYPES = [
    'near_miss' => 'Near miss',
    'accident_followup' => 'Accident / injury follow-up',
    'behaviour_concern' => 'Behaviour concern',
    'building_issue' => 'Building / facilities issue',
    'safeguarding_signpost' => 'Safeguarding signpost',
];
const INCIDENT_STATUSES = ['open' => 'Open', 'in_progress' => 'In progress', 'closed' => 'Closed'];
// Types whose records are restricted to admins/GLV/reporter/assignee.
const INCIDENT_RESTRICTED_TYPES = ['accident_followup', 'behaviour_concern', 'safeguarding_signpost'];

// The formal escalation route - always shown, never replaced by this module.
const INCIDENT_SAFEGUARDING = [
    'notice' => 'This does not replace formal reporting. If a child may be at risk of harm, follow the Scouts safeguarding process immediately - do not wait.',
    'phone' => '020 8433 7222',
    'email' => 'safeguarding@scouts.org.uk',
];

function incidentLoggingEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'incident_logging_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireIncidentLoggingEnabled(): void
{
    if (!incidentLoggingEnabled()) jsonResponse(['error' => 'Incident logging is not enabled.'], 404);
}

function incidentSensitivityForType(string $type): string
{
    return in_array($type, INCIDENT_RESTRICTED_TYPES, true) ? 'restricted' : 'standard';
}

// Operational leaders may create and see standard records. Governance roles
// (trustee/chair/treasurer) get summary counts only (FR-INC-009).
function incidentCanCreate(array $user): bool
{
    return in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'admin'], true);
}

// Row-level visibility (FR-INC-005). Restricted records: admin, GLV, reporter or
// the assigned owner only. Standard records: operational leaders too.
function incidentCanViewDetail(array $user, array $inc): bool
{
    $role = $user['portal_role'];
    if ($role === 'admin' || $role === 'group_leadership') return true;
    if ((int) ($inc['reported_by'] ?? 0) === (int) $user['id']) return true;
    if (!empty($inc['assigned_to']) && (int) $inc['assigned_to'] === (int) $user['id']) return true;
    if (($inc['sensitivity'] ?? 'standard') === 'standard' && in_array($role, ['section_leader', 'assistant_leader'], true)) return true;
    return false;
}

function serializeIncident(array $i, bool $full = true): array
{
    $base = [
        'id' => (int) $i['id'], 'recordType' => $i['record_type'], 'recordTypeLabel' => INCIDENT_TYPES[$i['record_type']] ?? $i['record_type'],
        'sensitivity' => $i['sensitivity'], 'summary' => $i['summary'], 'sectionName' => $i['section_name'],
        'status' => $i['status'], 'statusLabel' => INCIDENT_STATUSES[$i['status']] ?? $i['status'],
        'dueDate' => $i['due_date'], 'assignedTo' => $i['assigned_to'] !== null ? (int) $i['assigned_to'] : null,
    ];
    if (!$full) return $base;
    return array_merge($base, [
        'eventName' => $i['event_name'], 'occurredAt' => $i['occurred_at'], 'location' => $i['location'],
        'whatHappened' => $i['what_happened'], 'immediateAction' => $i['immediate_action'], 'followUpActions' => $i['follow_up_actions'],
        'closedNote' => $i['closed_note'], 'reportedBy' => $i['reported_by'] !== null ? (int) $i['reported_by'] : null,
        'osmSectionId' => $i['osm_section_id'], 'createdAt' => $i['created_at'], 'updatedAt' => $i['updated_at'],
    ]);
}

// A notification body for an incident that never leaks restricted free-text
// (FR-INC-008): the type label is always safe, but the free-text summary is only
// included for standard records. $lead is the human sentence, e.g. "You have been
// assigned an incident follow-up".
function incidentNotifyBody(array $inc, string $lead): string
{
    $type = INCIDENT_TYPES[$inc['record_type']] ?? 'incident';
    if (($inc['sensitivity'] ?? 'standard') === 'restricted') {
        return $lead . ' (' . $type . ', restricted record). Open the incident log for details.';
    }
    return $lead . ' (' . $type . '): ' . $inc['summary'];
}

// Alert those who oversee restricted records (GLV + admins) that one was logged,
// excluding the people already notified directly (reporter, assignee). Body stays
// neutral - no summary - since some recipients see these only as counts elsewhere.
function notifyRestrictedIncidentOversight(array $inc, array $excludeUserIds): void
{
    $type = INCIDENT_TYPES[$inc['record_type']] ?? 'incident';
    foreach (dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role IN ('group_leadership','admin')") as $u) {
        if (in_array((int) $u['id'], $excludeUserIds, true)) continue;
        notify((int) $u['id'], 'incident', 'Restricted incident logged',
            'A restricted incident record (' . $type . ') has been logged and needs oversight. Open the incident log for details.', 'incidents.html');
    }
}

// Overdue assigned incident actions for the Action Centre (FR-INC "Incident action
// due"). Admin/GLV see all overdue; others see only the ones assigned to them.
function incidentActionItems(array $user): array
{
    if (!incidentLoggingEnabled()) return [];
    $today = gmdate('Y-m-d');
    $seesAll = in_array($user['portal_role'], ['admin', 'group_leadership'], true);
    $sql = "SELECT id, summary, sensitivity FROM incidents WHERE status != 'closed' AND due_date IS NOT NULL AND due_date < ?";
    $args = [$today];
    if (!$seesAll) { $sql .= ' AND assigned_to = ?'; $args[] = $user['id']; }
    $items = [];
    foreach (dbAll($sql, $args) as $inc) {
        // Restricted records surface as a neutral label so the Action Centre never
        // leaks sensitive detail to a summary role.
        $label = $inc['sensitivity'] === 'restricted' ? 'Restricted incident action overdue' : ('Incident action overdue: ' . $inc['summary']);
        $items[] = actionItem('inc-' . $inc['id'], 'High', 'Incident', $label, 'Assigned leader', 'Open', 'incidents.html');
    }
    return $items;
}
