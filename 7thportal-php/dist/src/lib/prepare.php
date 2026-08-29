<?php
// Prepare Tonight (FRD-IA "Leader Prepare Tonight view"). A focused, time-based view
// for the leader's next section night: which section meets tonight (from the OSM
// meeting day cached at login - NO live OSM call), what's on the calendar today, the
// forms and equipment to sort, and the top actions. Live attendance rosters remain
// OSM's system of record (link-out), so this is honest about that gap rather than
// faking a register.

const PREPARE_WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Normalise an OSM meeting-day string ("Monday", "Mon", "Mondays", "mon") to a
// weekday index 0=Sun..6=Sat, or null if unrecognised / not set.
function prepareWeekdayIndex(?string $day): ?int
{
    if ($day === null) return null;
    $d = strtolower(trim($day));
    if ($d === '') return null;
    foreach (PREPARE_WEEKDAYS as $i => $name) {
        if ($d === $name || str_starts_with($d, substr($name, 0, 3))) return $i;
    }
    return null;
}

// Classify each leader section by when it next meets relative to $todayIdx (0=Sun).
// Pure - no DB / OSM - so "which section is on tonight" is directly testable. Sections
// whose meeting day OSM didn't give us sort last with a null distance (honest unknown).
function prepareTonightSections(array $sections, ?int $todayIdx = null): array
{
    if ($todayIdx === null) $todayIdx = (int) gmdate('w');
    $out = [];
    foreach ($sections as $s) {
        $idx = prepareWeekdayIndex($s['meetingDay'] ?? null);
        $daysUntil = $idx === null ? null : (($idx - $todayIdx + 7) % 7);
        if ($daysUntil === null) $label = null;
        elseif ($daysUntil === 0) $label = 'Tonight';
        elseif ($daysUntil === 1) $label = 'Tomorrow';
        else $label = ucfirst(PREPARE_WEEKDAYS[$idx]);
        $out[] = array_merge($s, [
            'meetsToday' => $daysUntil === 0,
            'daysUntil' => $daysUntil,
            'nextMeetingLabel' => $label,
        ]);
    }
    usort($out, function ($a, $b) {
        $an = $a['daysUntil']; $bn = $b['daysUntil'];
        if ($an === null && $bn === null) return 0;
        if ($an === null) return 1;
        if ($bn === null) return -1;
        return $an <=> $bn;
    });
    return $out;
}

// The leader's youth sections, derived from OSM roles + meeting metadata captured at
// login. Reads only cached data - never calls OSM (which rate-limits server reads).
function leaderYouthSections(array $user): array
{
    $roles = array_values(array_filter(
        json_decode($user['osm_roles_json'] ?? '[]', true) ?: [],
        fn($r) => in_array($r['section'] ?? null, OSM_YOUTH_SECTION_TYPES, true)
    ));
    $visible = getVisibleSectionIds();
    if ($visible !== null) {
        $roles = array_values(array_filter($roles, fn($r) => in_array($r['sectionid'], $visible, true)));
    }
    $termsData = json_decode($user['osm_terms_json'] ?? '[]', true) ?: [];
    return array_map(function ($role) use ($termsData) {
        $sectionId = (string) $role['sectionid'];
        $meta = osmDataSectionMeta($sectionId);
        $term = osmCurrentTermFromData($termsData, $sectionId);
        return [
            'sectionId' => $sectionId,
            'sectionName' => $role['sectionname'],
            'sectionType' => $role['section'],
            'meetingDay' => $meta['meetingDay'] ?? null,
            'meetingTime' => $meta['meetingTime'] ?? null,
            'location' => $meta['location'] ?? null,
            'currentTerm' => $term ? ['name' => $term['name'], 'startDate' => $term['startDate'], 'endDate' => $term['endDate']] : null,
        ];
    }, $roles);
}

// Assemble the full Prepare Tonight payload from the leader's sections plus whatever
// modules are on. Every module read is guarded so a disabled module simply drops out.
function buildPrepareTonight(array $user, array $sections): array
{
    $classified = prepareTonightSections($sections);
    $tonight = array_values(array_filter($classified, fn($s) => $s['meetsToday']));

    // What's on today: local calendar entries + event/camp hubs, via the shared
    // calendar aggregator (leader view, so leader-only detail is included).
    $whatsOn = [];
    if (function_exists('calendarEnabled') && calendarEnabled() && function_exists('calendarCollect')) {
        $today = gmdate('Y-m-d');
        foreach (calendarCollect($user, $today . ' 00:00', $today . ' 23:59') as $e) {
            $whatsOn[] = [
                'title' => $e['title'],
                'typeLabel' => $e['typeLabel'] ?? '',
                'start' => $e['start'] ?? null,
                'end' => $e['end'] ?? null,
                'allDay' => (bool) ($e['allDay'] ?? false),
                'location' => $e['location'] ?? null,
                'sectionName' => $e['sectionName'] ?? null,
                'link' => $e['link'] ?? null,
            ];
        }
    }

    // Forms to complete/approve before an activity (risk-assessment reminders live in
    // the activity-form workflow), and equipment to collect / return around now.
    $forms = function_exists('activityActionItems') ? activityActionItems($user) : [];
    $equipment = function_exists('qmActionItems') ? qmActionItems($user) : [];
    // The leader's top few actions overall (highest priority first).
    $actions = function_exists('buildActionCentre') ? array_slice(buildActionCentre($user), 0, 6) : [];

    return [
        'sections' => $classified,
        'tonightCount' => count($tonight),
        'whatsOn' => $whatsOn,
        'forms' => $forms,
        'equipment' => $equipment,
        'actions' => $actions,
        // Live attendance is OSM's system of record; we link out rather than fake a
        // roster from data we don't hold.
        'attendance' => [
            'osmOnly' => true,
            'note' => 'Take the register in Online Scout Manager - section rosters and attendance are not synced into the portal.',
            'link' => (function_exists('attendanceEnabled') && attendanceEnabled()) ? 'attendance.html' : null,
        ],
    ];
}
