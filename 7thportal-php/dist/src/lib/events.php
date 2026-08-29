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
const CAMP_TRANSPORT_TYPES = ['minibus' => 'Minibus', 'car' => 'Car', 'coach' => 'Coach', 'other' => 'Other'];

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

// Tell the parents who can see a hub that it has just been published, so they
// aren't relying on stumbling across it. Section-scoped hubs notify parents with a
// child in that section; a group-wide hub notifies all linked parents. Best-effort
// (deduped by parent); also feeds the weekly digest.
function eventHubNotifyPublished(array $hub): void
{
    $rows = !empty($hub['osm_section_id'])
        ? dbAll('SELECT DISTINCT parent_user_id AS uid FROM parent_child_links WHERE osm_section_id = ?', [$hub['osm_section_id']])
        : dbAll('SELECT DISTINCT parent_user_id AS uid FROM parent_child_links');
    $title = $hub['title'] ?: 'An event';
    $when = !empty($hub['start_date']) ? ' (' . $hub['start_date'] . ')' : '';
    foreach ($rows as $r) {
        notify((int) $r['uid'], 'event_hub', 'New event published', $title . $when . ' has been published.', 'event-hub.html?id=' . $hub['id']);
    }
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

// Transport & manifests (FR-CAMP-OP-023..028). Vehicles with a driver + seat
// capacity, each carrying a passenger manifest; flags over-capacity and no-driver.
function serializeTransportVehicle(array $v, array $passengers): array
{
    $cap = $v['capacity'] !== null && $v['capacity'] !== '' ? (int) $v['capacity'] : null;
    $assigned = count($passengers);
    return [
        'id' => (int) $v['id'], 'name' => $v['name'],
        'vehicleType' => $v['vehicle_type'], 'vehicleTypeLabel' => CAMP_TRANSPORT_TYPES[$v['vehicle_type']] ?? $v['vehicle_type'],
        'driverName' => $v['driver_name'], 'capacity' => $cap, 'departAt' => $v['depart_at'], 'notes' => $v['notes'],
        'passengers' => array_map(fn($p) => ['id' => (int) $p['id'], 'name' => $p['passenger_name'], 'notes' => $p['notes']], $passengers),
        'assigned' => $assigned,
        'seatsLeft' => $cap !== null ? $cap - $assigned : null,
        'overCapacity' => $cap !== null && $assigned > $cap,
        'noDriver' => trim((string) $v['driver_name']) === '',
    ];
}
function eventCampTransport(int $hubId): array
{
    $vehicles = dbAll('SELECT * FROM camp_transport_vehicles WHERE hub_id = ? ORDER BY sort_order, id', [$hubId]);
    $pax = dbAll('SELECT * FROM camp_transport_passengers WHERE hub_id = ? ORDER BY sort_order, id', [$hubId]);
    $byVeh = [];
    foreach ($pax as $p) $byVeh[(int) $p['vehicle_id']][] = $p;
    $out = array_map(fn($v) => serializeTransportVehicle($v, $byVeh[(int) $v['id']] ?? []), $vehicles);
    return [
        'vehicles' => $out,
        'totalSeats' => array_sum(array_map(fn($v) => $v['capacity'] ?? 0, $out)),
        'totalPassengers' => count($pax),
        'issues' => count(array_filter($out, fn($v) => $v['overCapacity'] || $v['noDriver'])),
        'meta' => ['types' => CAMP_TRANSPORT_TYPES],
    ];
}

// Programme matrix & activity allocation (FR-CAMP-OP-009..017). A day/session
// schedule of activities allocated to groups; a group in two activities in the same
// day+session is a clash.
function serializeProgrammeSlot(array $s): array
{
    return [
        'id' => (int) $s['id'], 'dayLabel' => $s['day_label'],
        'session' => $s['session'], 'sessionLabel' => CAMP_ROTA_SESSIONS[$s['session']] ?? $s['session'],
        'activity' => $s['activity'], 'group' => $s['group_label'], 'location' => $s['location'],
        'lead' => $s['lead_name'], 'notes' => $s['notes'],
    ];
}
function eventCampProgramme(int $hubId): array
{
    $slots = array_map('serializeProgrammeSlot', dbAll('SELECT * FROM camp_programme_slots WHERE hub_id = ? ORDER BY sort_order, id', [$hubId]));
    // Clash = the same named group in two slots in one day+session. Blank / "All"
    // groups run in parallel legitimately and are never clashed.
    $seen = [];
    foreach ($slots as $i => $sl) {
        $slots[$i]['clash'] = false;
        $g = strtolower(trim((string) $sl['group']));
        if ($g === '' || $g === 'all') continue;
        $seen[strtolower(trim($sl['dayLabel'])) . '|' . $sl['session'] . '|' . $g][] = $i;
    }
    foreach ($seen as $idxs) {
        if (count($idxs) > 1) foreach ($idxs as $i) $slots[$i]['clash'] = true;
    }
    return [
        'slots' => $slots,
        'total' => count($slots),
        'clashes' => count(array_filter($slots, fn($s) => $s['clash'])),
        'meta' => ['sessions' => CAMP_ROTA_SESSIONS],
    ];
}

// Camp plan version history & acknowledgements (FRD-CAMP-010). Capturing a version
// freezes a snapshot of the plan's current shape - the counts that matter plus the
// readiness verdict - so each numbered version is an honest record of what the plan
// looked like when it was shared, and leaders can acknowledge they've read it.

// Build the frozen snapshot stored against a version. Deliberately a summary of the
// operational content (not a full data dump): enough to see at a glance what changed
// between versions without re-reading every table.
function campPlanSnapshot(array $hub): array
{
    $id = (int) $hub['id'];
    $prog = eventCampProgramme($id);
    $trans = eventCampTransport($id);
    $rota = eventCampRota($id);
    $roll = eventReadinessRollup($hub);
    return [
        'capturedFor' => $hub['title'] ?? '',
        'dates' => trim(($hub['start_date'] ?? '') . (!empty($hub['end_date']) && $hub['end_date'] !== ($hub['start_date'] ?? '') ? ' – ' . $hub['end_date'] : '')),
        'status' => $hub['status'] ?? null,
        'readiness' => $roll['overall'],
        'programme' => ['activities' => $prog['total'], 'clashes' => $prog['clashes']],
        'transport' => ['vehicles' => count($trans['vehicles']), 'seats' => $trans['totalSeats'], 'passengers' => $trans['totalPassengers']],
        'rota' => ['adults' => count($rota['adults']), 'entries' => count($rota['entries']), 'gaps' => $rota['gaps']],
    ];
}

function serializeCampVersion(array $row, array $acks, ?int $forUserId = null): array
{
    $mine = null;
    $list = [];
    foreach ($acks as $a) {
        $list[] = ['userName' => $a['user_name'] ?: 'A leader', 'at' => $a['acknowledged_at']];
        if ($forUserId !== null && (int) $a['user_id'] === $forUserId) $mine = $a['acknowledged_at'];
    }
    return [
        'id' => (int) $row['id'],
        'versionNo' => (int) $row['version_no'],
        'label' => $row['label'],
        'summary' => $row['summary'],
        'snapshot' => json_decode($row['snapshot_json'] ?: '{}', true) ?: [],
        'createdByName' => $row['created_by_name'] ?: 'A leader',
        'createdAt' => $row['created_at'],
        'ackCount' => count($acks),
        'acks' => $list,
        'acknowledgedByMe' => $mine,
    ];
}

// Version list, newest first, each carrying its acknowledgements. $forUserId flags the
// current leader's own acknowledgement so the UI can show a tick or an ask.
function eventCampVersions(int $hubId, ?int $forUserId = null): array
{
    $rows = dbAll('SELECT * FROM camp_plan_versions WHERE hub_id = ? ORDER BY version_no DESC', [$hubId]);
    $acks = dbAll('SELECT * FROM camp_plan_acks WHERE hub_id = ? ORDER BY acknowledged_at', [$hubId]);
    $byVer = [];
    foreach ($acks as $a) $byVer[(int) $a['version_id']][] = $a;
    $out = array_map(fn($r) => serializeCampVersion($r, $byVer[(int) $r['id']] ?? [], $forUserId), $rows);
    $latest = $out[0] ?? null;
    return [
        'versions' => $out,
        'total' => count($out),
        // How many still owe an acknowledgement is a per-person question we can't answer
        // without a defined leader roster; instead we surface the latest version and
        // whether the current leader has acknowledged it, which drives the call-to-action.
        'latestNeedsMyAck' => $latest ? ($latest['acknowledgedByMe'] === null) : false,
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

// Camp Readiness checker: reduce the per-area Command Centre to one overall status
// plus the actionable gaps (blocked/attention areas), for the events-list overview.
// Rule-based, evidence-carrying, suggestions-only - no LLM, no approvals.
function eventReadinessRollup(array $hub): array
{
    $areas = eventCommandCentre($hub);
    $statuses = array_column($areas, 'status');
    $overall = in_array('blocked', $statuses, true) ? 'blocked'
        : (in_array('attention', $statuses, true) ? 'attention'
        : (in_array('ready', $statuses, true) ? 'ready' : 'none'));
    $gaps = [];
    foreach ($areas as $a) {
        if ($a['status'] === 'blocked' || $a['status'] === 'attention') {
            $gaps[] = ['label' => $a['label'], 'status' => $a['status'], 'summary' => $a['summary']];
        }
    }
    return ['overall' => $overall, 'gaps' => $gaps];
}

// Command Centre readiness rollup: the event as the operational spine. Each area is
// computed from real data linked to this event (no placeholders) and reports one of
// ready / attention / blocked / none, with a plain summary and a deep link. Areas
// whose modules don't yet link to an event (finance, transport, catering) are
// deliberately omitted rather than shown as dead cards.
function eventCommandCentre(array $hub): array
{
    $id = (int) $hub['id'];
    $areas = [];

    // Setup — the hub content-readiness tasks.
    $r = eventHubReadiness($hub);
    $areas[] = [
        'key' => 'setup', 'label' => 'Event setup',
        'status' => $r['rag'] === 'green' ? 'ready' : ($r['complete'] === 0 ? 'none' : 'attention'),
        'summary' => $r['complete'] . ' of ' . $r['total'] . ' setup tasks done',
        'link' => null,
    ];

    // Adults & ratios — from the rota (gap detection already flags unqualified/empty).
    $rota = eventCampRota($id);
    $adults = count($rota['adults']);
    $areas[] = [
        'key' => 'adults', 'label' => 'Adults & ratios',
        'status' => $adults === 0 ? 'none' : ($rota['gaps'] > 0 ? 'attention' : 'ready'),
        'summary' => $adults === 0 ? 'No adults on the rota yet' : ($rota['gaps'] > 0 ? $rota['gaps'] . ' gap' . ($rota['gaps'] === 1 ? '' : 's') . ' to fill' : $adults . ' adults, no gaps'),
        'link' => null,
    ];

    // Equipment — QM bookings linked to this event (event_hub_id).
    // A return that's past due is a real blocker; 'overdue' is derived from
    // return_at (not a stored status), so compute it here.
    $bk = dbAll("SELECT status, return_at FROM qm_bookings WHERE event_hub_id = ? AND status != 'cancelled'", [$id]);
    $today = gmdate('Y-m-d');
    $pending = count(array_filter($bk, fn($b) => in_array($b['status'], ['draft', 'submitted', 'partially_approved'], true)));
    $overdue = count(array_filter($bk, fn($b) => $b['status'] === 'collected' && !empty($b['return_at']) && substr($b['return_at'], 0, 10) < $today));
    $areas[] = [
        'key' => 'equipment', 'label' => 'Equipment',
        'status' => count($bk) === 0 ? 'none' : ($overdue > 0 ? 'blocked' : ($pending > 0 ? 'attention' : 'ready')),
        'summary' => count($bk) === 0 ? 'No kit booked yet' : ($overdue > 0 ? $overdue . ' overdue to return' : ($pending > 0 ? $pending . ' awaiting the QM' : count($bk) . ' booking' . (count($bk) === 1 ? '' : 's') . ' approved')),
        'link' => 'quartermaster.html',
    ];

    // Parent pack — published parent-visible content.
    $items = dbAll('SELECT visibility, item_status FROM event_hub_items WHERE hub_id = ?', [$id]);
    $parentItems = array_filter($items, fn($i) => $i['visibility'] === 'parents');
    $published = count(array_filter($parentItems, fn($i) => $i['item_status'] === 'published'));
    $areas[] = [
        'key' => 'parentpack', 'label' => 'Parent pack',
        'status' => $published > 0 ? 'ready' : (count($parentItems) > 0 ? 'attention' : 'none'),
        'summary' => $published > 0 ? $published . ' shared with parents' : (count($parentItems) > 0 ? 'Drafted, not shared yet' : 'Nothing for parents yet'),
        'link' => null,
    ];

    // Locations & emergency directory.
    $locs = dbAll('SELECT location_type, visibility FROM event_locations WHERE hub_id = ?', [$id]);
    $emergency = count(array_filter($locs, fn($l) => $l['visibility'] === 'emergency' || in_array($l['location_type'], EVENT_EMERGENCY_TYPES, true)));
    $areas[] = [
        'key' => 'locations', 'label' => 'Locations & emergency',
        'status' => $emergency > 0 ? 'ready' : (count($locs) > 0 ? 'attention' : 'none'),
        'summary' => $emergency > 0 ? $emergency . ' emergency contact' . ($emergency === 1 ? '' : 's') : (count($locs) > 0 ? 'No emergency contacts set' : 'No locations added yet'),
        'link' => null,
    ];

    // Transport & manifests.
    $t = eventCampTransport($id);
    $vc = count($t['vehicles']);
    $areas[] = [
        'key' => 'transport', 'label' => 'Transport',
        'status' => $vc === 0 ? 'none' : ($t['issues'] > 0 ? 'attention' : 'ready'),
        'summary' => $vc === 0 ? 'No transport planned yet' : ($t['issues'] > 0 ? plural($t['issues'], 'vehicle') . ($t['issues'] === 1 ? ' needs' : ' need') . ' a driver or seat' : plural($vc, 'vehicle') . ', ' . plural($t['totalPassengers'], 'passenger') . ' seated'),
        'link' => null,
    ];

    // Programme.
    $prog = eventCampProgramme($id);
    $areas[] = [
        'key' => 'programme', 'label' => 'Programme',
        'status' => $prog['total'] === 0 ? 'none' : ($prog['clashes'] > 0 ? 'attention' : 'ready'),
        'summary' => $prog['total'] === 0 ? 'No activities planned yet' : ($prog['clashes'] > 0 ? $prog['clashes'] . ' clash' . ($prog['clashes'] === 1 ? '' : 'es') . ' to resolve' : $prog['total'] . ' activit' . ($prog['total'] === 1 ? 'y' : 'ies') . ' scheduled'),
        'link' => null,
    ];

    return $areas;
}

// tiny pluraliser for readiness summaries.
function plural(int $n, string $s): string { return $n . ' ' . $s . ($n === 1 ? '' : ($s[-1] === 's' ? 'es' : 's')); }

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
