<?php
// Ported from the Node version's src/routes/auth.js. OAuth CSRF state is
// kept in $_SESSION rather than an in-memory Map - PHP has no persistent
// process memory between requests, but a session is already exactly
// per-browser, which is what that Map was standing in for anyway.

$router->get('/api/config', function ($params) {
    jsonResponse(['osmConfigured' => osmIsConfigured(), 'demoModeAllowed' => osmDemoModeAllowed(), 'galleryEnabled' => galleryEnabled()]);
});

$router->get('/auth/osm/login', function ($params) {
    loginLog('OSM login initiated', ['intent' => queryParam('intent'), 'ip' => clientIp(), 'configured' => osmIsConfigured()]);
    if (!osmIsConfigured()) {
        loginLog('BLOCKED: OSM not configured (missing OSM_CLIENT_ID/SECRET/REDIRECT_URI in .env)');
        header('Location: /login.html?error=' . rawurlencode('OSM is not configured yet on this server. Ask a Portal Administrator to add OSM app credentials, or try Demo Mode below.'));
        exit;
    }
    $intent = queryParam('intent') === 'service' ? 'service' : 'login';
    if ($intent === 'service') {
        $current = !empty($_SESSION['userId']) ? dbGet('SELECT portal_role FROM users WHERE id = ?', [$_SESSION['userId']]) : null;
        if (!$current || $current['portal_role'] !== 'admin') {
            loginLog('BLOCKED: service-connect attempted without an admin session', ['sessionUserId' => $_SESSION['userId'] ?? null]);
            http_response_code(403);
            echo 'Only a Portal Administrator can connect the OSM service account.';
            exit;
        }
    }
    $state = osmRandomState();
    $_SESSION['oauth_state'] = $state;
    $_SESSION['oauth_intent'] = $intent;
    $_SESSION['oauth_state_created'] = time();
    $authorizeUrl = osmBuildAuthorizeUrl($state);
    loginLog('Redirecting to OSM authorize URL', ['authorizeUrl' => $authorizeUrl, 'redirectUri' => env('OSM_REDIRECT_URI'), 'sessionId' => session_id()]);
    header('Location: ' . $authorizeUrl);
    exit;
});

$router->get('/auth/osm/callback', function ($params) {
    $code = queryParam('code');
    $state = queryParam('state');
    $osmError = queryParam('error');
    $osmErrorDescription = queryParam('error_description');
    $validState = !empty($_SESSION['oauth_state']) && $state === $_SESSION['oauth_state']
        && (time() - ($_SESSION['oauth_state_created'] ?? 0)) < 600;

    loginLog('OSM callback received', [
        'hasCode' => !empty($code), 'hasState' => !empty($state), 'validState' => $validState,
        'sessionId' => session_id(), 'sessionHasOauthState' => !empty($_SESSION['oauth_state']),
        'osmError' => $osmError, 'osmErrorDescription' => $osmErrorDescription, 'fullQuery' => $_GET,
    ]);

    if ($osmError) {
        // OSM itself redirected back with an error (e.g. user declined, redirect_uri
        // mismatch, invalid_client) rather than a code - the single most common
        // real-world failure mode during setup, worth surfacing clearly.
        loginLog('OSM returned an OAuth error directly', ['error' => $osmError, 'description' => $osmErrorDescription]);
    }

    if (!$code || !$state || !$validState) {
        loginLog('BLOCKED: missing/unknown code or state - link expired, was reused, or the PHP session was lost between /auth/osm/login and this callback (check session cookie settings / session save path is writable)');
        header('Location: /login.html?error=' . rawurlencode('The OSM sign-in link expired or was invalid. Please try again.'));
        exit;
    }
    $intent = $_SESSION['oauth_intent'] ?? 'login';
    unset($_SESSION['oauth_state'], $_SESSION['oauth_intent'], $_SESSION['oauth_state_created']);
    loginLog('State validated, proceeding', ['intent' => $intent]);

    $step = 'exchange_code';
    try {
        $token = osmExchangeCodeForToken($code);
        loginLog('Step 1/4 OK: exchanged code for token', ['expiresAt' => date('c', (int) ($token['expiresAt'] / 1000)), 'hasRefreshToken' => !empty($token['refreshToken'])]);

        $step = 'fetch_startup_data';
        $startup = osmGetStartupData($token['accessToken']);
        loginLog('Step 2/4 OK: fetched OSM startup data', ['hasGlobals' => isset($startup['data']['globals']), 'roleCount' => count($startup['data']['globals']['roles'] ?? [])]);

        $step = 'extract_identity';
        $identity = osmExtractIdentity($startup);
        loginLog('Step 3/4 OK: extracted identity', ['osmUserId' => $identity['osmUserId'], 'firstName' => $identity['firstName'], 'lastName' => $identity['lastName'], 'email' => $identity['email'], 'roleCount' => count($identity['roles'])]);

        $step = 'upsert_user';
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
            loginLog('Step 4/4 OK: updated existing user', ['userId' => $user['id'], 'role' => $user['portal_role']]);
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
            loginLog('Step 4/4 OK: created new user', ['userId' => $user['id'], 'role' => $user['portal_role'], 'isFirstOsmUser' => $isFirstOsmUser]);
        }

        if ($user['account_status'] !== 'active') {
            loginLog('BLOCKED: account_status is not active', ['userId' => $user['id'], 'status' => $user['account_status']]);
            logAudit(['userId' => $user['id'], 'action' => 'login_denied_inactive', 'ipAddress' => clientIp()]);
            header('Location: /login.html?error=' . rawurlencode('Your 7thPortal account has been disabled. Contact a Portal Administrator.'));
            exit;
        }

        if ($intent === 'service') {
            dbRun('UPDATE users SET is_osm_service_account = 0 WHERE is_osm_service_account = 1');
            dbRun('UPDATE users SET is_osm_service_account = 1 WHERE id = ?', [$user['id']]);
            logAudit(['userId' => $_SESSION['userId'] ?? $user['id'], 'action' => 'admin_connect_service_account', 'entityType' => 'user', 'entityId' => (string) $user['id'], 'ipAddress' => clientIp()]);
            loginLog('Service account connected, redirecting to admin settings', ['userId' => $user['id']]);
            header('Location: /admin.html?tab=settings&connected=1');
            exit;
        }

        $_SESSION['userId'] = $user['id'];
        logAudit(['userId' => $user['id'], 'action' => 'login', 'ipAddress' => clientIp(), 'details' => ['method' => 'osm']]);
        $redirectTo = isLeaderRole($user['portal_role']) ? '/leader-dashboard.html' : '/parent-dashboard.html';
        loginLog('SUCCESS: session set, redirecting', ['userId' => $user['id'], 'role' => $user['portal_role'], 'redirectTo' => $redirectTo, 'sessionId' => session_id()]);
        header('Location: ' . $redirectTo);
        exit;
    } catch (Throwable $e) {
        loginLog("OSM callback FAILED at step \"$step\"", ['error' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
        error_log('[login] OSM callback FAILED at step "' . $step . '": ' . $e->getMessage() . "\n" . $e->getTraceAsString());
        logAudit(['action' => 'login_failed', 'ipAddress' => clientIp(), 'details' => ['method' => 'osm', 'step' => $step, 'error' => $e->getMessage()]]);
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
    loginLog('Local login attempt', ['emailProvided' => !empty($email), 'passwordProvided' => !empty($password), 'ip' => clientIp()]);
    if (!$email || !$password) {
        loginLog('BLOCKED: missing email or password in request body');
        jsonResponse(['error' => 'Email and password are required.'], 400);
    }
    $normalizedEmail = strtolower(trim($email));
    $user = dbGet("SELECT * FROM users WHERE email = ? AND auth_type = 'local'", [$normalizedEmail]);
    loginLog('User lookup', ['email' => $normalizedEmail, 'found' => !empty($user)]);
    if (!$user) {
        loginLog('BLOCKED: no local-auth user with this email (check it wasn\'t created via OSM, or wasn\'t created at all)');
        logAudit(['action' => 'login_failed', 'ipAddress' => clientIp(), 'details' => ['method' => 'local', 'email' => $normalizedEmail]]);
        jsonResponse(['error' => 'Invalid email or password.'], 401);
    }
    $passwordOk = verifyPassword($password, $user['password_hash']);
    loginLog('Password check', ['userId' => $user['id'], 'passwordOk' => $passwordOk, 'hasPasswordHash' => !empty($user['password_hash'])]);
    if (!$passwordOk) {
        loginLog('BLOCKED: password did not verify - if hasPasswordHash was false above, this account never had set-password completed (still on an invite link)');
        logAudit(['action' => 'login_failed', 'ipAddress' => clientIp(), 'details' => ['method' => 'local', 'email' => $normalizedEmail]]);
        jsonResponse(['error' => 'Invalid email or password.'], 401);
    }
    if ($user['account_status'] !== 'active') {
        loginLog('BLOCKED: account_status is not active', ['userId' => $user['id'], 'status' => $user['account_status']]);
        logAudit(['userId' => $user['id'], 'action' => 'login_denied_inactive', 'ipAddress' => clientIp()]);
        jsonResponse(['error' => 'Your account is not active. Contact a Portal Administrator.'], 403);
    }
    dbRun("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [$user['id']]);
    $_SESSION['userId'] = $user['id'];
    logAudit(['userId' => $user['id'], 'action' => 'login', 'ipAddress' => clientIp(), 'details' => ['method' => 'local']]);
    $redirectTo = isLeaderRole($user['portal_role']) ? '/leader-dashboard.html' : '/parent-dashboard.html';
    loginLog('SUCCESS: local login', ['userId' => $user['id'], 'role' => $user['portal_role'], 'redirectTo' => $redirectTo, 'sessionId' => session_id()]);
    jsonResponse(['ok' => true, 'redirect' => $redirectTo]);
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
