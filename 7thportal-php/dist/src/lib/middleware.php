<?php
// PHP has no Express-style next()-chained middleware, so each of these is a
// guard function a route handler calls at the top: it returns the
// authenticated user on success, or halts the request itself (via
// jsonResponse(), which exits) on failure - e.g.:
//
//   $user = requireAuth();
//   requireParent($user);
//   ... rest of the handler ...

function requireAuth(): array
{
    if (empty($_SESSION['userId'])) jsonResponse(['error' => 'Not logged in.'], 401);
    $user = dbGet('SELECT * FROM users WHERE id = ?', [$_SESSION['userId']]);
    if (!$user || $user['account_status'] !== 'active') jsonResponse(['error' => 'Not logged in.'], 401);
    return $user;
}

function requireParent(array $user): void
{
    if ($user['portal_role'] !== 'parent') jsonResponse(['error' => 'Parent/carer access required.'], 403);
}

function requireLeader(array $user): void
{
    if (!isLeaderRole($user['portal_role'])) jsonResponse(['error' => 'Leader access required.'], 403);
}

function requireAdmin(array $user): void
{
    if (!isAdminRole($user['portal_role'])) jsonResponse(['error' => 'Portal administrator access required.'], 403);
}
