<?php
// Internal calendar (FRD FR-CAL / backlog LATER-007). Optional module, off by
// default. A local planning layer: the calendar view aggregates local calendar
// entries with Event & Camp Hub records and QM booking resource blocks, read live
// from those modules. OSM stays the source of truth for OSM programme/event data.

const CALENDAR_ENTRY_TYPES = [
    'placeholder' => 'Planning placeholder',
    'activity' => 'Activity',
    'deadline' => 'Deadline',
    'note' => 'Note',
];
const CALENDAR_SCOPES = ['group' => 'Group', 'section' => 'Section'];
// Templates offered when converting a placeholder into an Event & Camp Hub record;
// values must be valid event_hubs.event_type values.
const CALENDAR_CONVERT_TEMPLATES = ['event' => 'Event', 'camp' => 'Camp', 'sleepover' => 'Sleepover', 'trip' => 'Day trip', 'activity' => 'Activity day'];

function calendarEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'calendar_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireCalendarEnabled(): void
{
    if (!calendarEnabled()) jsonResponse(['error' => 'The internal calendar is not enabled.'], 404);
}

// Who can create/edit/publish calendar entries. Operational leaders + admins;
// trustee/chair/treasurer roles get read-only visibility.
function calendarCanManage(array $user): bool
{
    return in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'admin'], true);
}

// Normalise a date or datetime to 'YYYY-MM-DD HH:MM:SS'. All-day entries anchor to
// 00:00:00 (start) / 23:59:59 (end) so a range query still spans the whole day.
function calendarNormalizeDateTime($raw, bool $isEnd, bool $allDay): ?string
{
    if ($raw === null || trim((string) $raw) === '') return null;
    $s = str_replace('T', ' ', trim((string) $raw));
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s . ($isEnd ? ' 23:59:59' : ' 00:00:00');
    if ($allDay && preg_match('/^(\d{4}-\d{2}-\d{2})/', $s, $m)) return $m[1] . ($isEnd ? ' 23:59:59' : ' 00:00:00');
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $s)) return $s . ':00';
    if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $s)) return $s;
    return null;
}

function serializeCalendarEntry(array $e): array
{
    return [
        'id' => (int) $e['id'],
        'title' => $e['title'],
        'entryType' => $e['entry_type'],
        'entryTypeLabel' => CALENDAR_ENTRY_TYPES[$e['entry_type']] ?? $e['entry_type'],
        'scope' => $e['scope'],
        'sectionId' => $e['osm_section_id'],
        'sectionName' => $e['section_name'],
        'startAt' => $e['start_at'],
        'endAt' => $e['end_at'],
        'allDay' => (bool) $e['all_day'],
        'location' => $e['location'],
        'ownerName' => $e['owner_name'],
        'notes' => $e['notes'],
        'parentSafeTitle' => $e['parent_safe_title'],
        'parentSafeDescription' => $e['parent_safe_description'],
        'visibility' => $e['visibility'],
        'status' => $e['status'],
        'convertedEventHubId' => $e['converted_event_hub_id'] !== null ? (int) $e['converted_event_hub_id'] : null,
        'createdBy' => $e['created_by'] !== null ? (int) $e['created_by'] : null,
    ];
}

// Merge local entries + Event Hub records + QM booking resource blocks over a window.
// Role-filtered: parents see only parent-safe published items and never QM blocks or
// leader-only notes (FR-CAL-011).
function calendarCollect(array $user, string $from, string $to): array
{
    $isParent = $user['portal_role'] === 'parent';
    $canManage = calendarCanManage($user);
    $items = [];

    // 1. Local calendar entries overlapping [from, to].
    $rows = dbAll(
        "SELECT * FROM calendar_entries WHERE status != 'cancelled' AND start_at <= ? AND COALESCE(end_at, start_at) >= ?",
        [$to, $from]
    );
    foreach ($rows as $e) {
        $parentSafe = $e['status'] === 'published' && $e['visibility'] === 'parents';
        if ($isParent && !$parentSafe) continue;
        $title = ($isParent && $e['parent_safe_title']) ? $e['parent_safe_title'] : $e['title'];
        $items[] = [
            'source' => 'entry',
            'id' => (int) $e['id'],
            'title' => $title,
            'type' => $e['entry_type'],
            'typeLabel' => CALENDAR_ENTRY_TYPES[$e['entry_type']] ?? $e['entry_type'],
            'start' => $e['start_at'],
            'end' => $e['end_at'],
            'allDay' => (bool) $e['all_day'],
            'scope' => $e['scope'],
            'sectionName' => $e['section_name'],
            'location' => $isParent ? null : $e['location'],
            'description' => $isParent ? ($e['parent_safe_description'] ?? '') : ($e['notes'] ?? ''),
            'status' => $e['status'],
            'parentSafe' => $parentSafe,
            'convertedEventHubId' => $e['converted_event_hub_id'] !== null ? (int) $e['converted_event_hub_id'] : null,
            'link' => $isParent ? null : 'calendar.html?entry=' . $e['id'],
            'canManage' => !$isParent && $canManage,
        ];
    }

    // 2. Event & Camp Hub records (if that module is on).
    if (function_exists('eventHubEnabled') && eventHubEnabled()) {
        $hubs = dbAll(
            "SELECT * FROM event_hubs WHERE status != 'archived' AND start_date IS NOT NULL AND start_date <= ? AND COALESCE(end_date, start_date) >= ?",
            [substr($to, 0, 10), substr($from, 0, 10)]
        );
        foreach ($hubs as $h) {
            if ($isParent && !eventHubVisibleToParent($user, $h)) continue;
            $items[] = [
                'source' => 'event',
                'id' => (int) $h['id'],
                'title' => $h['title'],
                'type' => $h['event_type'],
                'typeLabel' => ucfirst($h['event_type']),
                'start' => $h['start_date'],
                'end' => $h['end_date'],
                'allDay' => true,
                'scope' => $h['osm_section_id'] ? 'section' : 'group',
                'sectionName' => $h['section_name'],
                'location' => $isParent ? null : $h['location'],
                'description' => '',
                'status' => $h['status'],
                'parentSafe' => $h['status'] === 'published',
                'link' => 'event-hub.html?id=' . $h['id'],
                'canManage' => false,
            ];
        }
    }

    // 3. QM booking resource blocks - leaders/QMs only, never parents (FR-CAL-003/011).
    if (!$isParent && function_exists('qmBookingEnabled') && qmBookingEnabled()) {
        // Only bookings still holding kit appear as resource blocks; returned/closed/
        // cancelled/draft bookings no longer block availability.
        $bk = dbAll(
            "SELECT * FROM qm_bookings WHERE status IN ('submitted','approved','partially_approved','ready_for_collection','collected') AND collect_at IS NOT NULL AND collect_at <= ? AND COALESCE(return_at, collect_at) >= ?",
            [$to, $from]
        );
        foreach ($bk as $b) {
            $ref = $b['reference'] ?: ('QM-' . str_pad((string) $b['id'], 4, '0', STR_PAD_LEFT));
            $overdue = $b['status'] === 'collected' && !empty($b['return_at']) && $b['return_at'] < gmdate('Y-m-d H:i:s');
            $provisional = $b['status'] === 'submitted';
            $items[] = [
                'source' => 'qm',
                'id' => (int) $b['id'],
                'title' => $ref . ' · ' . ($b['purpose'] ?: 'Equipment'),
                'type' => 'qm_booking',
                'typeLabel' => 'QM booking',
                'start' => $b['collect_at'],
                'end' => $b['return_at'],
                'allDay' => false,
                'scope' => $b['osm_section_id'] ? 'section' : 'group',
                'sectionName' => $b['section_name'] ?: $b['event_name'],
                'location' => null,
                'description' => '',
                'status' => $b['status'],
                'overdue' => $overdue,
                'provisional' => $provisional,
                'parentSafe' => false,
                'link' => 'quartermaster.html?id=' . $b['id'],
                'canManage' => false,
            ];
        }
    }

    usort($items, fn($a, $b) => strcmp((string) $a['start'], (string) $b['start']));
    return $items;
}

// ── iCal feed (FR-CAL "iCal export") ────────────────────────────────────────────
// A personal, read-only calendar subscription. The feed URL carries a per-user secret
// token (calendar apps can't send a session cookie), and the feed is scoped to exactly
// what that user is allowed to see - so a parent's feed is parent-safe, a leader's
// carries operational detail. Rotating the token kills the old link.

function calendarFeedToken(int $userId, bool $regenerate = false): string
{
    $row = dbGet('SELECT ical_token FROM users WHERE id = ?', [$userId]);
    if (!$regenerate && $row && !empty($row['ical_token'])) return $row['ical_token'];
    $token = bin2hex(random_bytes(24));
    dbRun('UPDATE users SET ical_token = ? WHERE id = ?', [$token, $userId]);
    return $token;
}

// RFC 5545 text escaping for a property value.
function icalEscape(string $s): string
{
    return str_replace(['\\', "\r\n", "\n", "\r", ',', ';'], ['\\\\', '\\n', '\\n', '\\n', '\\,', '\\;'], $s);
}

// Fold a content line at 75 octets with CRLF + space, per RFC 5545.
function icalFold(string $line): string
{
    if (strlen($line) <= 75) return $line;
    $out = '';
    while (strlen($line) > 75) { $out .= substr($line, 0, 75) . "\r\n "; $line = substr($line, 75); }
    return $out . $line;
}

// Format a stored 'YYYY-MM-DD HH:MM:SS' (or date-only) value as an iCal DTSTART/DTEND
// suffix. All-day values become DATE (with an exclusive, +1-day end); timed values
// become a floating local date-time (no timezone), which is robust for a subscription.
function icalDate(string $dt, bool $allDay, bool $isEnd): string
{
    $day = substr($dt, 0, 10);
    if ($allDay) {
        $date = $isEnd ? gmdate('Ymd', strtotime($day . ' +1 day')) : str_replace('-', '', $day);
        return ';VALUE=DATE:' . $date;
    }
    $time = strlen($dt) >= 19 ? substr($dt, 11, 8) : '00:00:00';
    return ':' . str_replace('-', '', $day) . 'T' . str_replace(':', '', $time);
}

// Build the VCALENDAR feed for a user from the shared calendar aggregator, over a
// rolling window (recent past through the next year).
function buildICalFeed(array $user): string
{
    $from = gmdate('Y-m-d', strtotime('-30 days')) . ' 00:00:00';
    $to = gmdate('Y-m-d', strtotime('+365 days')) . ' 23:59:59';
    $items = function_exists('calendarCollect') ? calendarCollect($user, $from, $to) : [];
    $stamp = gmdate('Ymd\THis\Z');
    $lines = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//7thPortal//Calendar//EN',
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:7thPortal', 'X-WR-TIMEZONE:Europe/London',
    ];
    foreach ($items as $it) {
        if (empty($it['start'])) continue;
        $allDay = !empty($it['allDay']);
        $summary = $it['title'] . (!empty($it['typeLabel']) ? ' [' . $it['typeLabel'] . ']' : '');
        $descBits = array_filter([(string) ($it['description'] ?? ''), !empty($it['sectionName']) ? 'Section: ' . $it['sectionName'] : '']);
        $lines[] = 'BEGIN:VEVENT';
        $lines[] = 'UID:' . ($it['source'] ?? 'x') . '-' . ($it['id'] ?? '0') . '@7thportal';
        $lines[] = 'DTSTAMP:' . $stamp;
        $lines[] = 'DTSTART' . icalDate((string) $it['start'], $allDay, false);
        $lines[] = 'DTEND' . icalDate((string) ($it['end'] ?: $it['start']), $allDay, true);
        $lines[] = icalFold('SUMMARY:' . icalEscape($summary));
        if (!empty($it['location'])) $lines[] = icalFold('LOCATION:' . icalEscape($it['location']));
        if ($descBits) $lines[] = icalFold('DESCRIPTION:' . icalEscape(implode("\n", $descBits)));
        $lines[] = 'END:VEVENT';
    }
    $lines[] = 'END:VCALENDAR';
    return implode("\r\n", $lines) . "\r\n";
}

// Action Centre: upcoming leader-only placeholders that still need firming up or
// publishing (FR-CAL-013). Managers only; keeps the parent view clean.
function calendarActionItems(array $user): array
{
    if (!calendarEnabled() || !calendarCanManage($user)) return [];
    $today = gmdate('Y-m-d H:i:s');
    $soon = gmdate('Y-m-d H:i:s', strtotime('+14 days'));
    $items = [];
    $rows = dbAll(
        "SELECT id, title FROM calendar_entries WHERE status = 'draft' AND converted_event_hub_id IS NULL AND start_at >= ? AND start_at <= ?",
        [$today, $soon]
    );
    foreach ($rows as $e) {
        $items[] = actionItem('cal-draft-' . $e['id'], 'Low', 'Calendar', 'Upcoming plan to firm up: ' . $e['title'], 'Leader', 'Open', 'calendar.html?entry=' . $e['id']);
    }
    return $items;
}
