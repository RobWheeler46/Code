<?php
// Notifications and weekly digest (FRD FR-NOT). In-portal notifications are always
// recorded; a user can mute notification types and opt out of the weekly digest.
// Email content is kept minimal and routes users into the portal (FR-NOT-006).

// Record an in-portal notification for a user, honouring their muted types.
function notify(int $userId, string $type, string $title, ?string $body = null, ?string $link = null): void
{
    $pref = dbGet('SELECT muted_types FROM notification_prefs WHERE user_id = ?', [$userId]);
    if ($pref && $pref['muted_types']) {
        $muted = json_decode($pref['muted_types'], true) ?: [];
        if (in_array($type, $muted, true)) return;
    }
    dbRun('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', [$userId, $type, $title, $body, $link]);
}

// Notify every active user holding one of the given portal roles.
function notifyRoles(array $roles, string $type, string $title, ?string $body = null, ?string $link = null): void
{
    $ph = implode(',', array_fill(0, count($roles), '?'));
    foreach (dbAll("SELECT id FROM users WHERE account_status = 'active' AND portal_role IN ($ph)", $roles) as $u) {
        notify((int) $u['id'], $type, $title, $body, $link);
    }
}

// Notify parents (optionally only those with a child in a given section).
function notifyParents(string $type, string $title, ?string $body = null, ?string $link = null, ?string $sectionId = null): void
{
    $sql = "SELECT id FROM users WHERE account_status = 'active' AND portal_role = 'parent'";
    $args = [];
    if ($sectionId) {
        $sql .= ' AND id IN (SELECT parent_user_id FROM parent_child_links WHERE osm_section_id = ?)';
        $args[] = $sectionId;
    }
    foreach (dbAll($sql, $args) as $u) notify((int) $u['id'], $type, $title, $body, $link);
}

function notificationsForUser(int $userId, int $limit = 50): array
{
    return dbAll('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?', [$userId, $limit]);
}

function unreadNotificationCount(int $userId): int
{
    return (int) dbGet('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [$userId])['n'];
}

// The notification types users can mute, with friendly labels (FR-NOT-004).
const NOTIFICATION_TYPES = [
    'notice' => 'Group and section notices',
    'document' => 'Document acknowledgements',
    'expense' => 'Expense claim updates',
    'gallery' => 'Photo album updates',
    'incident' => 'Incident and near-miss actions',
    'equipment' => 'Equipment checks due',
    'patrol_points' => 'Patrol Points approvals',
    'admin' => 'Admin and sync alerts',
];

function notificationPrefs(int $userId): array
{
    $row = dbGet('SELECT * FROM notification_prefs WHERE user_id = ?', [$userId]);
    return [
        'mutedTypes' => $row && $row['muted_types'] ? (json_decode($row['muted_types'], true) ?: []) : [],
        'weeklyDigest' => $row ? (bool) $row['weekly_digest'] : true,
    ];
}

function saveNotificationPrefs(int $userId, array $mutedTypes, bool $weeklyDigest): void
{
    $muted = array_values(array_intersect($mutedTypes, array_keys(NOTIFICATION_TYPES)));
    dbRun(
        "INSERT INTO notification_prefs (user_id, muted_types, weekly_digest, updated_at) VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET muted_types = excluded.muted_types, weekly_digest = excluded.weekly_digest, updated_at = excluded.updated_at",
        [$userId, json_encode($muted), $weeklyDigest ? 1 : 0]
    );
}

// Build a plain-text weekly digest for a user: their pending actions + unread
// notification count. Deliberately free of sensitive record detail (FR-NOT-006).
function buildWeeklyDigest(array $user): ?string
{
    $actions = function_exists('buildActionCentre') ? buildActionCentre($user) : [];
    $unread = unreadNotificationCount((int) $user['id']);
    if (count($actions) === 0 && $unread === 0) return null;
    $lines = ['Hello ' . $user['first_name'] . ',', '', 'Your 7thPortal weekly summary:', ''];
    $lines[] = $unread . ' unread notification' . ($unread === 1 ? '' : 's') . '.';
    $lines[] = count($actions) . ' action' . (count($actions) === 1 ? '' : 's') . ' needing attention:';
    foreach (array_slice($actions, 0, 10) as $a) $lines[] = '  - [' . $a['priority'] . '] ' . $a['type'] . ': ' . $a['action'];
    $lines[] = '';
    $lines[] = 'Sign in to 7thPortal to review and action these items.';
    return implode("\n", $lines);
}

// Send the weekly digest to every opted-in active user. Returns the count sent.
// Intended to be called from a weekly cron (or the admin "send now" action).
function sendWeeklyDigests(): int
{
    $sent = 0;
    foreach (dbAll("SELECT u.* FROM users u LEFT JOIN notification_prefs p ON p.user_id = u.id WHERE u.account_status = 'active' AND u.email IS NOT NULL AND (p.weekly_digest IS NULL OR p.weekly_digest = 1)") as $u) {
        $body = buildWeeklyDigest($u);
        if ($body === null) continue;
        try {
            if (sendEmail($u['email'], '7thPortal weekly summary', $body)) $sent++;
        } catch (Throwable $e) { /* mailer disabled or failed - skip */ }
    }
    return $sent;
}
