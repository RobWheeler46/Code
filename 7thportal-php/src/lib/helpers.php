<?php

const ROLE_LABELS = [
    'parent' => 'Parent/Carer',
    'section_leader' => 'Section Leader',
    'assistant_leader' => 'Assistant Leader or Section Volunteer',
    'group_leadership' => 'Group Leadership Team',
    'trustee_viewer' => 'Trustee Viewer',
    'treasurer' => 'Treasurer',
    'chair' => 'Chair',
    'admin' => 'Portal Administrator',
];
const LEADER_ROLES = ['section_leader', 'assistant_leader', 'group_leadership', 'trustee_viewer', 'treasurer', 'chair', 'admin'];

function roleLabel(string $role): string { return ROLE_LABELS[$role] ?? $role; }
function isLeaderRole(string $role): bool { return in_array($role, LEADER_ROLES, true); }
function isAdminRole(string $role): bool { return $role === 'admin'; }
function canSeeSensitiveChildData(string $role): bool { return in_array($role, ['section_leader', 'admin'], true); }

// Finance-module roles (FRD Final Pack section 5/26) layered onto the
// existing role model rather than replacing it - "approver" is per-account
// (see expense_accounts.approver_user_id), not a portal_role of its own.
function isTreasurerRole(string $role): bool { return in_array($role, ['treasurer', 'admin'], true); }
function isChairRole(string $role): bool { return in_array($role, ['chair', 'admin'], true); }
// Who may view the read-only Trustee Board finance dashboard.
function isTrusteeDashboardRole(string $role): bool { return in_array($role, ['trustee_viewer', 'chair', 'treasurer', 'admin'], true); }

// "Now" in milliseconds, matching the millisecond-epoch strings stored in
// osm_token_expires_at (kept the same unit as the Node version for parity).
function nowMs(): int { return (int) round(microtime(true) * 1000); }

// PHP's native password_hash()/password_verify() (bcrypt by default) stands
// in for the Node version's hand-rolled scrypt - same security property
// (salted, slow, one-way, safe comparison), no extension dependency, and the
// salt/algorithm are self-contained in the stored hash string.
function hashPassword(string $password): string
{
    return password_hash($password, PASSWORD_DEFAULT);
}

function verifyPassword(string $password, ?string $stored): bool
{
    if (!$stored) return false;
    return password_verify($password, $stored);
}

function logAudit(array $args): void
{
    dbRun(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address, details) VALUES (?, ?, ?, ?, ?, ?)',
        [
            $args['userId'] ?? null,
            $args['action'],
            $args['entityType'] ?? null,
            $args['entityId'] ?? null,
            $args['ipAddress'] ?? null,
            isset($args['details']) ? json_encode($args['details']) : null,
        ]
    );
}

function publicUser(?array $user): ?array
{
    if (!$user) return null;
    return [
        'id' => (int) $user['id'],
        'firstName' => $user['first_name'],
        'lastName' => $user['last_name'],
        'email' => $user['email'],
        'role' => $user['portal_role'],
        'roleLabel' => roleLabel($user['portal_role']),
        'authType' => $user['auth_type'],
    ];
}

// Returns a live OSM access token for this user, refreshing if needed. Demo
// users get back the literal 'demo' sentinel that every osmData.php data
// function treats as "serve mock data".
function ensureFreshToken(array $user): string
{
    if ($user['osm_access_token'] === 'demo') return 'demo';
    if (!$user['osm_access_token']) throw new Exception('No OSM connection for this account.');
    if ($user['osm_token_expires_at'] && (int) $user['osm_token_expires_at'] > nowMs() + 5000) {
        return $user['osm_access_token'];
    }
    $refreshed = osmRefreshAccessToken($user['osm_refresh_token']);
    dbRun(
        "UPDATE users SET osm_access_token = ?, osm_refresh_token = ?, osm_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?",
        [$refreshed['accessToken'], $refreshed['refreshToken'], (string) $refreshed['expiresAt'], $user['id']]
    );
    return $refreshed['accessToken'];
}

// The single account (real or demo) whose OSM token serves reads for parent
// dashboards, since parents have no OSM token of their own. See README
// "Integration model" for why this shared service-account design was chosen.
function getServiceAccount(): ?array
{
    return dbGet("SELECT * FROM users WHERE is_osm_service_account = 1 AND account_status = 'active' LIMIT 1");
}

// null = no restriction configured (all sections visible) - see admin FR-057.
function getVisibleSectionIds(): ?array
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'visible_sections'");
    if (!$row || !$row['value']) return null;
    $decoded = json_decode($row['value'], true);
    return is_array($decoded) ? $decoded : null;
}

// Prune audit log entries past the configured retention window (NFR-011, FR-068).
function pruneAuditLog(): void
{
    $row = dbGet("SELECT value FROM settings WHERE key = 'audit_retention_days'");
    $days = (int) ($row['value'] ?? 365);
    dbRun("DELETE FROM audit_log WHERE created_at < datetime('now', ?)", ["-$days days"]);
}
