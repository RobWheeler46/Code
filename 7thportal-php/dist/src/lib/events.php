<?php
// Event and Camp Hub (FRD FR-EVT-HUB). Optional module, off by default.

const EVENT_TYPES = ['event' => 'Event', 'camp' => 'Camp', 'sleepover' => 'Sleepover', 'trip' => 'Trip', 'activity' => 'Activity'];
const EVENT_HUB_STATUSES = ['draft' => 'Draft', 'published' => 'Published', 'archived' => 'Archived'];
const EVENT_ITEM_STATUSES = ['draft' => 'Draft', 'published' => 'Published', 'linked' => 'Linked', 'awaiting' => 'Awaiting'];
const EVENT_ITEM_VISIBILITIES = ['parents' => 'Parents', 'leaders' => 'Leaders only'];

// Camp Planning Toolkit - location & emergency directory (FR-CAMP-OP-004..008).
const EVENT_LOCATION_TYPES = [
    'campsite' => 'Campsite', 'hospital' => 'Hospital (A&E)', 'minor_injuries' => 'Minor injuries unit',
    'dentist' => 'Dentist', 'optician' => 'Optician', 'vet' => 'Vet', 'fuel' => 'Fuel', 'gas' => 'Gas',
    'supermarket' => 'Supermarket', 'supplier' => 'Supplier', 'activity_venue' => 'Activity venue',
    'drop_off' => 'Drop-off point', 'collection' => 'Collection point', 'other' => 'Other',
];
const EVENT_LOCATION_VISIBILITIES = ['parents' => 'Parent-visible', 'leaders' => 'Leader-only', 'emergency' => 'Emergency'];
// Types that count as emergency locations for the prominent directory / offline pack.
const EVENT_EMERGENCY_TYPES = ['hospital', 'minor_injuries', 'dentist', 'vet'];

// Camp Planning Toolkit - adult rota (FR-CAMP-OP-018..021).
const CAMP_ROTA_ROLES = [
    'duty_scouter' => 'Duty scouter', 'asst_duty_scouter' => 'Assistant duty scouter',
    'driver' => 'Driver', 'instructor' => 'Instructor', 'activity_supervisor' => 'Activity supervisor',
    'qm_food' => 'QM food', 'qm_stores' => 'QM stores', 'shopping' => 'Shopping', 'campfire' => 'Campfire',
    'wide_game' => 'Wide game coordinator', 'first_aid' => 'First aid', 'free_period' => 'Free period', 'other' => 'Other',
];
const CAMP_ROTA_SESSIONS = ['am' => 'Morning', 'pm' => 'Afternoon', 'evening' => 'Evening', 'night' => 'Overnight', 'all_day' => 'All day'];
// Roles that require a specifically-qualified adult, for gap detection.
const CAMP_ROTA_ROLES_NEED_DRIVER = ['driver'];
const CAMP_ROTA_ROLES_NEED_FIRST_AID = ['first_aid'];

function eventHubEnabled(): bool
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'event_hub_enabled'");
    return ($row['value'] ?? null) === 'true';
}

function requireEventHubEnabled(): void
{
    if (!eventHubEnabled()) jsonResponse(['error' => 'The event and camp hub is not enabled.'], 404);
}

// Operational leaders may create and manage hubs (FR-EVT-HUB-001).
function eventHubCanManage(array $user): bool
{
    return in_array($user['portal_role'], ['section_leader', 'assistant_leader', 'group_leadership', 'admin'], true);
}

// A parent may see a published hub only where it is group-wide or their child is
// in the hub's section (FR-EVT-HUB-002 / FR-EVT-HUB-008).
function eventHubVisibleToParent(array $user, array $hub): bool
{
    if ($hub['status'] !== 'published') return false;
    if (empty($hub['osm_section_id'])) return true;
    return (bool) dbGet('SELECT 1 FROM parent_child_links WHERE parent_user_id = ? AND osm_section_id = ? LIMIT 1', [$user['id'], $hub['osm_section_id']]);
}

// Setup readiness (FR-EVT-HUB-007): six tasks, returned as complete/total + RAG.
function eventHubReadiness(array $hub): array
{
    $items = dbAll('SELECT * FROM event_hub_items WHERE hub_id = ?', [$hub['id']]);
    $tasks = [
        'Dates set' => !empty($hub['start_date']),
        'Location set' => !empty($hub['location']),
        'Key information' => !empty($hub['key_information']),
        'Kit list / what to bring' => !empty($hub['what_to_bring']),
        'Published parent content' => (bool) array_filter($items, fn($i) => $i['visibility'] === 'parents' && $i['item_status'] === 'published'),
        'OSM event linked' => !empty($hub['osm_event_url']),
    ];
    $complete = count(array_filter($tasks));
    $total = count($tasks);
    $rag = $complete >= $total ? 'green' : ($complete >= 3 ? 'amber' : 'red');
    return ['complete' => $complete, 'total' => $total, 'rag' => $rag, 'tasks' => $tasks];
}

function serializeHub(array $h, bool $full = false): array
{
    $base = [
        'id' => (int) $h['id'], 'title' => $h['title'], 'eventType' => $h['event_type'], 'eventTypeLabel' => EVENT_TYPES[$h['event_type']] ?? $h['event_type'],
        'sectionName' => $h['section_name'], 'startDate' => $h['start_date'], 'endDate' => $h['end_date'], 'location' => $h['location'],
        'status' => $h['status'], 'statusLabel' => EVENT_HUB_STATUSES[$h['status']] ?? $h['status'],
    ];
    if (!$full) return $base;
    return array_merge($base, [
        'osmSectionId' => $h['osm_section_id'], 'keyInformation' => $h['key_information'], 'whatToBring' => $h['what_to_bring'],
        'programmeHighlights' => $h['programme_highlights'], 'osmEventUrl' => $h['osm_event_url'],
        'createdAt' => $h['created_at'], 'updatedAt' => $h['updated_at'],
    ]);
}

function serializeHubItem(array $i): array
{
    return [
        'id' => (int) $i['id'], 'label' => $i['label'], 'itemStatus' => $i['item_status'], 'itemStatusLabel' => EVENT_ITEM_STATUSES[$i['item_status']] ?? $i['item_status'],
        'visibility' => $i['visibility'], 'visibilityLabel' => EVENT_ITEM_VISIBILITIES[$i['visibility']] ?? $i['visibility'],
        'owner' => $i['owner_name'], 'linkUrl' => $i['link_url'], 'notes' => $i['notes'],
    ];
}

function serializeLocation(array $l): array
{
    return [
        'id' => (int) $l['id'], 'type' => $l['location_type'], 'typeLabel' => EVENT_LOCATION_TYPES[$l['location_type']] ?? $l['location_type'],
        'name' => $l['name'], 'address' => $l['address'], 'phone' => $l['phone'], 'openingTimes' => $l['opening_times'],
        'notes' => $l['notes'], 'mapUrl' => $l['map_url'],
        'visibility' => $l['visibility'], 'visibilityLabel' => EVENT_LOCATION_VISIBILITIES[$l['visibility']] ?? $l['visibility'],
        'isEmergency' => $l['visibility'] === 'emergency' || in_array($l['location_type'], EVENT_EMERGENCY_TYPES, true),
    ];
}

function serializeRotaAdult(array $a): array
{
    return ['id' => (int) $a['id'], 'name' => $a['name'], 'isDriver' => (bool) $a['is_driver'], 'isFirstAider' => (bool) $a['is_first_aider'], 'skills' => $a['skills']];
}
function serializeRotaEntry(array $e, array $adultsById): array
{
    $adult = $e['adult_id'] !== null ? ($adultsById[(int) $e['adult_id']] ?? null) : null;
    // A gap: no adult, or the assigned adult isn't qualified for a role that needs it.
    $gap = null;
    if (!$adult) $gap = 'No adult assigned';
    elseif (in_array($e['role'], CAMP_ROTA_ROLES_NEED_DRIVER, true) && !$adult['is_driver']) $gap = 'Assigned adult is not a driver';
    elseif (in_array($e['role'], CAMP_ROTA_ROLES_NEED_FIRST_AID, true) && !$adult['is_first_aider']) $gap = 'Assigned adult is not a first aider';
    return [
        'id' => (int) $e['id'], 'dayLabel' => $e['day_label'], 'session' => $e['session'],
        'sessionLabel' => CAMP_ROTA_SESSIONS[$e['session']] ?? $e['session'],
        'role' => $e['role'], 'roleLabel' => CAMP_ROTA_ROLES[$e['role']] ?? $e['role'],
        'adultId' => $e['adult_id'] !== null ? (int) $e['adult_id'] : null,
        'adultName' => $adult['name'] ?? null, 'activity' => $e['activity'], 'notes' => $e['notes'],
        'gap' => $gap,
    ];
}

// The camp's rota: adult team + entries (grouped-ready) + a gap count for the overview.
function eventCampRota(int $hubId): array
{
    $adults = dbAll('SELECT * FROM camp_rota_adults WHERE hub_id = ? ORDER BY sort_order, name', [$hubId]);
    $byId = [];
    foreach ($adults as $a) $byId[(int) $a['id']] = $a;
    $entries = array_map(fn($e) => serializeRotaEntry($e, $byId), dbAll('SELECT * FROM camp_rota_entries WHERE hub_id = ? ORDER BY sort_order, id', [$hubId]));
    $gaps = count(array_filter($entries, fn($e) => $e['gap'] !== null));
    return [
        'adults' => array_map('serializeRotaAdult', $adults),
        'entries' => $entries,
        'gaps' => $gaps,
        'meta' => ['roles' => CAMP_ROTA_ROLES, 'sessions' => CAMP_ROTA_SESSIONS],
    ];
}

// Camp overview summary for the leader dashboard (FR-CAMP-OP-003). Honest about the
// data we hold in this slice - no attendee/leader counts (that's the deferred
// programme/allocation module); dates, status, readiness, item + location tallies.
function eventCampOverview(array $hub): array
{
    $items = dbAll('SELECT visibility, item_status FROM event_hub_items WHERE hub_id = ?', [$hub['id']]);
    $locs = dbAll('SELECT location_type, visibility FROM event_locations WHERE hub_id = ?', [$hub['id']]);
    $days = null;
    if (!empty($hub['start_date'])) {
        $end = $hub['end_date'] ?: $hub['start_date'];
        $days = (int) floor((strtotime($end) - strtotime($hub['start_date'])) / 86400) + 1;
    }
    $emergency = count(array_filter($locs, fn($l) => $l['visibility'] === 'emergency' || in_array($l['location_type'], EVENT_EMERGENCY_TYPES, true)));
    $readiness = eventHubReadiness($hub);
    $rota = eventCampRota((int) $hub['id']);
    return [
        'days' => $days,
        'parentItems' => count(array_filter($items, fn($i) => $i['visibility'] === 'parents')),
        'leaderItems' => count(array_filter($items, fn($i) => $i['visibility'] === 'leaders')),
        'locations' => count($locs),
        'emergencyLocations' => $emergency,
        'rotaAdults' => count($rota['adults']),
        'rotaEntries' => count($rota['entries']),
        'rotaGaps' => $rota['gaps'],
        'openActions' => $readiness['total'] - $readiness['complete'],
        'readiness' => $readiness,
    ];
}

// Draft hubs a leader should finish setting up surface in the Action Centre
// (FR-EVT-HUB-007 / journey "Action Centre shows a new camp hub").
function eventHubActionItems(array $user): array
{
    if (!eventHubEnabled() || !eventHubCanManage($user)) return [];
    $items = [];
    foreach (dbAll("SELECT id, title FROM event_hubs WHERE status = 'draft' ORDER BY start_date") as $h) {
        $items[] = actionItem('evt-' . $h['id'], 'Medium', 'Event', 'Finish setting up: ' . $h['title'], 'Event lead', 'Open', 'events.html');
    }
    return $items;
}
