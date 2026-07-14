<?php
// Ported from the Node version's src/routes/auth.js. OAuth CSRF state is
// kept in $_SESSION rather than an in-memory Map - PHP has no persistent
// process memory between requests, but a session is already exactly
// per-browser, which is what that Map was standing in for anyway.

$router->get('/api/config', function ($params) {
    jsonResponse(['osmConfigured' => osmIsConfigured(), 'demoModeAllowed' => osmDemoModeAllowed(), 'galleryEnabled' => galleryEnabled()]);
});

$router->get('/auth/osm/login', function ($params) {
    if (!osmIsConfigured()) {
        header('Location: /login.html?error=' . rawurlencode('OSM is not configured yet on this server. Ask a Portal Administrator to add OSM app credentials, or try Demo Mode below.'));
        exit;
    }
    $intent = queryParam('intent') === 'service' ? 'service' : 'login';
    if ($intent === 'service') {
        $current = !empty($_SESSION['userId']) ? dbGet('SELECT portal_role FROM users WHERE id = ?', [$_SESSION['userId']]) : null;
        if (!$current || $current['portal_role'] !== 'admin') {
            http_response_code(403);
            echo 'Only a Portal Administrator can connect the OSM service account.';
            exit;
        }
    }
    $state = osmRandomState();
    $_SESSION['oauth_state'] = $state;
    $_SESSION['oauth_intent'] = $intent;
    $_SESSION['oauth_state_created'] = time();
    header('Location: ' . osmBuildAuthorizeUrl($state));
    exit;
});

$router->get('/auth/osm/callback', function ($params) {
    $code = queryParam('code');
    $state = queryParam('state');
    $validState = !empty($_SESSION['oauth_state']) && $state === $_SESSION['oauth_state']
        && (time() - ($_SESSION['oauth_state_created'] ?? 0)) < 600;

    if (!$code || !$state || !$validState) {
        header('Location: /login.html?error=' . rawurlencode('The OSM sign-in link expired or was invalid. Please try again.'));
        exit;
    }
    $intent = $_SESSION['oauth_intent'] ?? 'login';
    unset($_SESSION['oauth_state'], $_SESSION['oauth_intent'], $_SESSION['oauth_state_created']);

    try {
        $token = osmExchangeCodeForToken($code);
        $startup = osmGetStartupData($token['accessToken']);
        $identity = osmExtractIdentity($startup);

        $user = dbGet('SELECT * FROM users WHERE osm_user_id = ?', [$identity['osmUserId']]);
        $isFirstOsmUser = (int) dbGet("SELECT COUNT(*) AS n FROM users WHERE auth_type = 'osm'")['n'] === 0;

        if ($user) {
            dbRun(
                "UPDATE users SET first_name = ?, last_name = ?, osm_roles_json = ?, osm_access_token = ?, osm_refresh_token = ?,
                 osm_token_expires_at = ?, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
                [$identity['firstName'], $identity['lastName'], json_encode($identity['roles']), $token['accessToken'],
                 $token['refreshToken'], (string) $token['expiresAt'], $user['id']]
            );
            $user = dbGet('SELECT * FROM users WHERE id = ?', [$user['id']]);
        } else {
            $defaultRole = $isFirstOsmUser ? 'admin' : (count($identity['roles']) > 0 ? 'section_leader' : 'group_leadership');
            $result = dbRun(
                "INSERT INTO users (auth_type, osm_user_id, email, first_name, last_name, portal_role, osm_roles_json,
                 osm_access_token, osm_refresh_token, osm_token_expires_at, is_osm_service_account, last_login_at)
                 VALUES ('osm', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
                [$identity['osmUserId'], $identity['email'], $identity['firstName'], $identity['lastName'], $defaultRole,
                 json_encode($identity['roles']), $token['accessToken'], $token['refreshToken'], (string) $token['expiresAt'], $isFirstOsmUser ? 1 : 0]
            );
            $user = dbGet('SELECT * FROM users WHERE id = ?', [$result['lastInsertId']]);
        }

        if ($user['account_status'] !== 'active') {
            logAudit(['userId' => $user['id'], 'action' => 'login_denied_inactive', 'ipAddress' => clientIp()]);
            header('Location: /login.html?error=' . rawurlencode('Your 7thPortal account has been disabled. Contact a Portal Administrator.'));
            exit;
        }

        if ($intent === 'service') {
            dbRun('UPDATE users SET is_osm_service_account = 0 WHERE is_osm_service_account = 1');
            dbRun('UPDATE users SET is_osm_service_account = 1 WHERE id = ?', [$user['id']]);
            logAudit(['userId' => $_SESSION['userId'] ?? $user['id'], 'action' => 'admin_connect_service_account', 'entityType' => 'user', 'entityId' => (string) $user['id'], 'ipAddress' => clientIp()]);
            header('Location: /admin.html?tab=settings&connected=1');
            exit;
        }

        $_SESSION['userId'] = $user['id'];
        logAudit(['userId' => $user['id'], 'action' => 'login', 'ipAddress' => clientIp(), 'details' => ['method' => 'osm']]);
        header('Location: ' . (isLeaderRole($user['portal_role']) ? '/leader-dashboard.html' : '/parent-dashboard.html'));
        exit;
    } catch (Throwable $e) {
        error_log('OSM callback failed: ' . $e->getMessage());
        logAudit(['action' => 'login_failed', 'ipAddress' => clientIp(), 'details' => ['method' => 'osm', 'error' => $e->getMessage()]]);
        header('Location: /login.html?error=' . rawurlencode('We could not sign you in with OSM. Please try again or contact a Portal Administrator.'));
        exit;
    }
});

// Demo mode - only reachable when explicitly allowed. Lets anyone explore
// the app with fake data before OSM credentials are configured.
$router->get('/auth/demo/login', function ($params) {
    if (!osmDemoModeAllowed()) { http_response_code(403); echo 'Demo mode is disabled on this server.'; exit; }
    $as = in_array(queryParam('as'), ['parent', 'leader', 'admin'], true) ? queryParam('as') : 'parent';

    if ($as === 'parent') {
        $user = dbGet("SELECT * FROM users WHERE email = 'demo.parent@example.com'");
        if (!$user) {
            $result = dbRun("INSERT INTO users (auth_type, email, first_name, last_name, portal_role, last_login_at)
                VALUES ('local', 'demo.parent@example.com', 'Demo', 'Parent', 'parent', datetime('now'))");
            $userId = $result['lastInsertId'];
            dbRun("INSERT OR IGNORE INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?, 'm201', 's101', 'Cubs', 'cubs', 'Amelia Turner')", [$userId]);
            dbRun("INSERT OR IGNORE INTO parent_child_links (parent_user_id, osm_member_id, osm_section_id, osm_section_name, osm_section_type, child_display_name) VALUES (?, 'm203', 's102', 'Scouts', 'scouts', 'Freddie Brown')", [$userId]);
            $user = dbGet('SELECT * FROM users WHERE id = ?', [$userId]);
        }
    } else {
        $osmUserId = "demo-$as";
        $portalRole = $as === 'admin' ? 'admin' : 'section_leader';
        $user = dbGet('SELECT * FROM users WHERE osm_user_id = ?', [$osmUserId]);
        if (!$user) {
            $startup = osmDemoStartupForRole($as);
            $g = $startup['data']['globals'];
            $result = dbRun(
                "INSERT INTO users (auth_type, osm_user_id, first_name, last_name, portal_role, osm_roles_json,
                 osm_access_token, osm_refresh_token, osm_token_expires_at, last_login_at)
                 VALUES ('osm', ?, ?, ?, ?, ?, 'demo', 'demo', ?, datetime('now'))",
                [$osmUserId, $g['firstname'], $g['lastname'], $portalRole, json_encode($g['roles']), (string) (nowMs() + 3600000)]
            );
            $user = dbGet('SELECT * FROM users WHERE id = ?', [$result['lastInsertId']]);
        }
        if ($as === 'leader') {
            try { gallerySeedDemoAlbumIfMissing((int) $user['id']); } catch (Throwable $e) { /* best effort, matches Node's .catch(() => {}) */ }
        }
    }

    dbRun("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [$user['id']]);
    $_SESSION['userId'] = $user['id'];
    logAudit(['userId' => $user['id'], 'action' => 'login', 'ipAddress' => clientIp(), 'details' => ['method' => 'demo', 'as' => $as]]);
    header('Location: ' . (isLeaderRole($user['portal_role']) ? '/leader-dashboard.html' : '/parent-dashboard.html'));
    exit;
});

$router->post('/api/auth/local-login', function ($params) {
    $body = requestBody();
    $email = $body['email'] ?? null;
    $password = $body['password'] ?? null;
    if (!$email || !$password) jsonResponse(['error' => 'Email and password are required.'], 400);
    $normalizedEmail = strtolower(trim($email));
    $user = dbGet("SELECT * FROM users WHERE email = ? AND auth_type = 'local'", [$normalizedEmail]);
    if (!$user || !verifyPassword($password, $user['password_hash'])) {
        logAudit(['action' => 'login_failed', 'ipAddress' => clientIp(), 'details' => ['method' => 'local', 'email' => $normalizedEmail]]);
        jsonResponse(['error' => 'Invalid email or password.'], 401);
    }
    if ($user['account_status'] !== 'active') {
        logAudit(['userId' => $user['id'], 'action' => 'login_denied_inactive', 'ipAddress' => clientIp()]);
        jsonResponse(['error' => 'Your account is not active. Contact a Portal Administrator.'], 403);
    }
    dbRun("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [$user['id']]);
    $_SESSION['userId'] = $user['id'];
    logAudit(['userId' => $user['id'], 'action' => 'login', 'ipAddress' => clientIp(), 'details' => ['method' => 'local']]);
    jsonResponse(['ok' => true, 'redirect' => isLeaderRole($user['portal_role']) ? '/leader-dashboard.html' : '/parent-dashboard.html']);
});

$router->get('/api/auth/invite/:token', function ($params) {
    $user = dbGet('SELECT * FROM users WHERE invite_token = ?', [$params['token']]);
    if (!$user || !$user['invite_expires_at'] || strtotime($user['invite_expires_at']) < time()) {
        jsonResponse(['error' => 'This invite link is invalid or has expired. Ask a Portal Administrator for a new one.'], 404);
    }
    jsonResponse(['firstName' => $user['first_name'], 'email' => $user['email']]);
});

$router->post('/api/auth/set-password', function ($params) {
    $body = requestBody();
    $token = $body['token'] ?? null;
    $password = $body['password'] ?? '';
    if (!$token || !$password || strlen($password) < 8) jsonResponse(['error' => 'A password of at least 8 characters is required.'], 400);
    $user = dbGet('SELECT * FROM users WHERE invite_token = ?', [$token]);
    if (!$user || !$user['invite_expires_at'] || strtotime($user['invite_expires_at']) < time()) {
        jsonResponse(['error' => 'This invite link is invalid or has expired. Ask a Portal Administrator for a new one.'], 404);
    }
    dbRun(
        "UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires_at = NULL, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
        [hashPassword($password), $user['id']]
    );
    $_SESSION['userId'] = $user['id'];
    logAudit(['userId' => $user['id'], 'action' => 'set_password', 'ipAddress' => clientIp()]);
    jsonResponse(['ok' => true, 'redirect' => '/parent-dashboard.html']);
});

$router->post('/api/auth/logout', function ($params) {
    $user = requireAuth();
    $_SESSION = [];
    session_destroy();
    logAudit(['userId' => $user['id'], 'action' => 'logout']);
    jsonResponse(['ok' => true]);
});

$router->get('/api/me', function ($params) {
    $user = requireAuth();
    jsonResponse(array_merge(publicUser($user), [
        'osmConnected' => !empty($user['osm_access_token']),
        'isServiceAccount' => (bool) $user['is_osm_service_account'],
    ]));
});
