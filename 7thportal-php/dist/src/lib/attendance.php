<?php
// Section attendance registers (FRD FR-SEC-ATT / FR-SEC-REG). Optional module, off
// by default. A register is pre-populated from the live OSM roster then owned
// locally; member name + grouping are snapshotted per row so a submitted register
// survives later OSM membership changes. Emergency contact drill-down (FR-SEC-EC)
// is deliberately NOT part of this - no contact/medical data is stored here.

const ATTENDANCE_STATUSES = [
    'present' => 'Present',
    'late' => 'Late',
    'left_early' => 'Left early',
    'excused' => 'Excused',
    'absent' => 'Absent',
    'guest' => 'Guest',
    'unknown' => 'Not marked',
];
// Statuses that count as "attended" for the present tally.
const ATTENDANCE_PRESENT_STATUSES = ['present', 'late', 'left_early'];
const ATTENDANCE_SOURCE_TYPES = ['ad_hoc' => 'Ad-hoc session', 'calendar' => 'Calendar entry', 'event' => 'Event / camp'];

function attendanceEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'attendance_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireAttendanceEnabled(): void
{
    if (!attendanceEnabled()) jsonResponse(['error' => 'Section attendance is not enabled.'], 404);
}

// Reuse the section-people access rule (admin / own-section leader; trustee &
// parent blocked) - defined in routes/sections.php, loaded before this runs.
function attendanceCanManage(array $user, string $sectionId): bool
{
    return sectionsCanViewMembers($user, $sectionId);
}

function attendanceRegisterOr404($id): array
{
    $r = dbGet('SELECT * FROM attendance_registers WHERE id = ?', [$id]);
    if (!$r) jsonResponse(['error' => 'Register not found.'], 404);
    return $r;
}

function serializeRegister(array $r, bool $withCounts = false): array
{
    $out = [
        'id' => (int) $r['id'],
        'sectionId' => $r['osm_section_id'],
        'sectionName' => $r['section_name'],
        'title' => $r['title'],
        'sessionDate' => $r['session_date'],
        'sourceType' => $r['source_type'],
        'sourceTypeLabel' => ATTENDANCE_SOURCE_TYPES[$r['source_type']] ?? $r['source_type'],
        'sourceRefId' => $r['source_ref_id'] !== null ? (int) $r['source_ref_id'] : null,
        'sourceLabel' => $r['source_label'],
        'notes' => $r['notes'],
        'status' => $r['status'],
        'submittedAt' => $r['submitted_at'],
        'createdBy' => $r['created_by'] !== null ? (int) $r['created_by'] : null,
        'createdAt' => $r['created_at'],
    ];
    if ($withCounts) {
        $counts = [];
        $total = 0;
        foreach (dbAll('SELECT status, COUNT(*) AS n FROM attendance_marks WHERE register_id = ? GROUP BY status', [$r['id']]) as $x) {
            $counts[$x['status']] = (int) $x['n'];
            $total += (int) $x['n'];
        }
        $present = 0;
        foreach (ATTENDANCE_PRESENT_STATUSES as $s) $present += $counts[$s] ?? 0;
        $out['total'] = $total;
        $out['presentCount'] = $present;
        $out['counts'] = $counts;
    }
    return $out;
}

function serializeMark(array $m): array
{
    return [
        'id' => (int) $m['id'],
        'memberId' => $m['osm_member_id'],
        'name' => $m['member_name'],
        'grouping' => $m['grouping'],
        'status' => $m['status'],
        'note' => $m['note'],
    ];
}

// Marks grouped by Six/Patrol (Unassigned last), sorted alphabetically within each
// group (FR-SEC-ATT-003).
function attendanceGroupedMarks(int $registerId): array
{
    $marks = dbAll('SELECT * FROM attendance_marks WHERE register_id = ? ORDER BY grouping IS NULL, grouping, sort_name, member_name', [$registerId]);
    $groups = [];
    foreach ($marks as $m) {
        $key = $m['grouping'] ?: 'Unassigned';
        $groups[$key][] = serializeMark($m);
    }
    $out = [];
    foreach ($groups as $name => $rows) $out[] = ['grouping' => $name, 'members' => $rows];
    return $out;
}

// Action Centre: open registers for a session that is today or past and still not
// submitted (FR-SEC-ATT "record who captured attendance"). Managers only.
function attendanceActionItems(array $user): array
{
    if (!attendanceEnabled()) return [];
    if (!in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'admin'], true)) return [];
    $today = gmdate('Y-m-d');
    $items = [];
    foreach (dbAll("SELECT id, title, osm_section_id FROM attendance_registers WHERE status = 'open' AND session_date <= ?", [$today]) as $reg) {
        if (!sectionsCanViewMembers($user, (string) $reg['osm_section_id'])) continue;
        $items[] = actionItem('att-open-' . $reg['id'], 'Low', 'Attendance', 'Attendance to complete: ' . $reg['title'], 'Section leader', 'Open', 'attendance.html?id=' . $reg['id']);
    }
    return $items;
}
