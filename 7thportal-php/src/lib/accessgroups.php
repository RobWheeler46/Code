<?php
// Shared admin-defined access groups (FRD PP2.5 s17.3 / FR-PP-018/022). A reusable
// 7thPortal access primitive: a named, identity-based collection of authenticated users
// maintained by administrators. Membership is independent of the members' portal roles
// and grants no permission by itself - a module (Patrol Points is the first consumer)
// must explicitly assign a capability to the group. Retired groups are preserved so
// historical assignments/audit references survive.

// Normalise an optional expiry input to 'YYYY-MM-DD HH:MM:SS' (UTC), or null. A bare date
// is treated as end-of-day so the group stays active through that day.
function ppNormExpiry($v): ?string
{
    $s = trim((string) ($v ?? ''));
    if ($s === '') return null;
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) return $s . ' 23:59:59';
    $t = strtotime($s);
    return $t ? gmdate('Y-m-d H:i:s', $t) : null;
}

// A group is usable (its membership counts toward access) only when not retired and not
// past its optional expiry.
function accessGroupActive(array $g): bool
{
    if (!empty($g['retired'])) return false;
    if (!empty($g['expires_at']) && $g['expires_at'] < gmdate('Y-m-d H:i:s')) return false;
    return true;
}

// Member user ids of a group. Empty when the group is not currently active (expired or
// retired), so an expiry immediately removes access on the next evaluation (AC-326).
function accessGroupMemberIds(int $groupId): array
{
    $g = dbGet('SELECT * FROM access_groups WHERE id = ?', [$groupId]);
    if (!$g || !accessGroupActive($g)) return [];
    return array_map(fn($r) => (int) $r['user_id'], dbAll('SELECT user_id FROM access_group_members WHERE group_id = ?', [$groupId]));
}

function accessGroupIsMember(int $groupId, int $userId): bool
{
    return in_array($userId, accessGroupMemberIds($groupId), true);
}

// How many Patrol Points access assignments reference this group (usage, for the
// retirement guard and admin visibility - FRD s17.3 "usage references").
function accessGroupUsageCount(int $groupId): int
{
    return (int) (dbGet("SELECT COUNT(*) c FROM pp_access_assignments WHERE subject_kind = 'group' AND subject_value = ?", [(string) $groupId])['c'] ?? 0);
}

function serializeAccessGroup(array $g, bool $full = false): array
{
    $base = [
        'id' => (int) $g['id'], 'name' => $g['name'], 'description' => $g['description'],
        'expiresAt' => $g['expires_at'], 'retired' => (bool) $g['retired'],
        'active' => accessGroupActive($g),
        'memberCount' => (int) (dbGet('SELECT COUNT(*) c FROM access_group_members WHERE group_id = ?', [$g['id']])['c'] ?? 0),
        'usageCount' => accessGroupUsageCount((int) $g['id']),
    ];
    if (!$full) return $base;
    $base['members'] = array_map(fn($m) => [
        'userId' => (int) $m['user_id'],
        'name' => trim(($m['first_name'] ?? '') . ' ' . ($m['last_name'] ?? '')) ?: ('User ' . $m['user_id']),
        'role' => $m['portal_role'] ?? null,
    ], dbAll('SELECT gm.user_id, u.first_name, u.last_name, u.portal_role FROM access_group_members gm LEFT JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY u.first_name, u.last_name', [$g['id']]));
    return $base;
}
