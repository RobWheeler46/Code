<?php
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];

// Under PHP's built-in dev server every request hits this script as the
// router. `return false` only makes the server auto-serve a static file when
// the requested URI *literally* matches that file's path (e.g. /css/style.css
// really is at that path) - it does NOT resolve "/" to "index.html", so for
// the root path we have to output the file ourselves. Getting this wrong
// causes the server to fall through and invoke this whole script a second
// time for the same request (duplicate session_start()/db work) - this check
// runs first, before any of that, to keep static requests cheap and single-pass.
if (php_sapi_name() === 'cli-server') {
    if ($uri === '/') {
        readfile(__DIR__ . '/index.html');
        exit;
    }
    $filePath = __DIR__ . $uri;
    if (is_file($filePath)) return false;
}

require_once __DIR__ . '/../src/env.php';
loadEnv(__DIR__ . '/../.env');

$isProd = env('APP_ENV') === 'production';
error_reporting(E_ALL);
ini_set('display_errors', $isProd ? '0' : '1');

require_once __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/http.php';

if (loginDebugEnabled() && preg_match('#^/(auth|api/auth|api/me|login\.html)#', $uri)) {
    loginLog('--- New request ---', [
        'method' => $method, 'uri' => $uri,
        'APP_ENV' => env('APP_ENV', '(unset)'),
        'osmConfigured' => !empty(env('OSM_CLIENT_ID')) && !empty(env('OSM_CLIENT_SECRET')) && !empty(env('OSM_REDIRECT_URI')),
        'curlAvailable' => function_exists('curl_init'),
        'phpVersion' => PHP_VERSION,
    ]);
}
require_once __DIR__ . '/../src/router.php';
require_once __DIR__ . '/../src/lib/helpers.php';
require_once __DIR__ . '/../src/lib/middleware.php';
require_once __DIR__ . '/../src/lib/osm.php';
require_once __DIR__ . '/../src/lib/osmData.php';
require_once __DIR__ . '/../src/lib/mailer.php';
require_once __DIR__ . '/../src/lib/gallery.php';

// Idempotent maintenance, mirrors the one-off boot tasks in the Node
// version's server.js. Cheap enough to run every request at this app's scale.
pruneAuditLog();
pruneArchivedAlbums();
if ((dbGet('SELECT COUNT(*) AS n FROM notices')['n'] ?? 0) === 0) {
    dbRun("INSERT INTO notices (title, body, audience, start_date, status)
           VALUES ('Welcome to 7thPortal', 'This is your new 7th Swindon Scout Group portal. Head to OSM for anything this site cannot show yet.', 'all', date('now'), 'published')");
}

// Session cookie config mirrors the Node version's express-session setup
// (FR-005 idle timeout via a sliding/rolling expiry).
if (session_status() !== PHP_SESSION_ACTIVE) {
    $timeoutRow = dbGet("SELECT value FROM settings WHERE key = 'session_timeout_minutes'");
    $maxAge = (int) ($timeoutRow['value'] ?? 720) * 60;
    session_set_cookie_params([
        'lifetime' => $maxAge,
        'path' => '/',
        'secure' => $isProd,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    setcookie(session_name(), session_id(), time() + $maxAge, '/', '', $isProd, true);

    if (loginDebugEnabled() && preg_match('#^/(auth|api/auth|api/me|login\.html)#', $uri)) {
        loginLog('Request ' . $method . ' ' . $uri, [
            'APP_ENV' => env('APP_ENV', '(unset)'),
            'cookieSecure' => $isProd,
            'protocol' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http',
            'xForwardedProto' => $_SERVER['HTTP_X_FORWARDED_PROTO'] ?? null,
            'hasCookieHeader' => isset($_SERVER['HTTP_COOKIE']),
            'sessionId' => session_id(),
            'sessionUserId' => $_SESSION['userId'] ?? null,
            'sessionSavePath' => session_save_path() ?: ini_get('session.save_path') ?: '(default)',
        ]);
        if ($isProd && empty($_SERVER['HTTP_X_FORWARDED_PROTO']) && (empty($_SERVER['HTTPS']) || $_SERVER['HTTPS'] === 'off')) {
            loginLog('WARNING: APP_ENV=production (cookie.secure=true) but this request looks like plain HTTP and carries no X-Forwarded-Proto header. If the site is actually reached over HTTPS through a proxy that does not forward that header, the session cookie will be marked Secure but PHP cannot tell the original request was HTTPS - this can cause "login redirects then bounces back" symptoms. Check your host\'s reverse proxy config forwards X-Forwarded-Proto, or check $_SERVER[\'HTTPS\'] is actually being set for HTTPS requests on this host.');
        }
    }
}

$router = new Router();
require_once __DIR__ . '/../src/routes/auth.php';
require_once __DIR__ . '/../src/routes/dashboard.php';
require_once __DIR__ . '/../src/routes/children.php';
require_once __DIR__ . '/../src/routes/sections.php';
require_once __DIR__ . '/../src/routes/notices.php';
require_once __DIR__ . '/../src/routes/admin.php';
require_once __DIR__ . '/../src/routes/gallery.php';

// NFR-007: never expose technical error details to end users - the response
// body stays generic, but the server-side log (error_log + data/login-debug.log
// for auth-path requests) gets full detail for debugging.
try {
    if (!$router->dispatch($method, $uri)) {
        jsonResponse(['error' => 'Not found.'], 404);
    }
} catch (Throwable $e) {
    error_log("[error] Unhandled error on $method $uri: " . $e->getMessage() . "\n" . $e->getTraceAsString());
    if (loginDebugEnabled() && preg_match('#^/(auth|api/auth|api/me)#', $uri)) {
        loginLog("Unhandled error on $method $uri", ['error' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()]);
    }
    jsonResponse(['error' => 'Something went wrong. Please try again.'], 500);
}
