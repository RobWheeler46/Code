<?php
// Hard requirement: PHP 8.1+. The app uses 8.0/8.1 features (str_starts_with,
// str_contains, match) that are undefined on older PHP, so on a mis-set host -
// e.g. a cPanel subdomain left on PHP 7.x while the live site runs 8.1+ - every
// request otherwise dies with a cryptic "Call to undefined function" fatal deep
// in a required file, taking the whole site down. Fail early with an actionable
// message instead. This check uses only ancient built-ins so it runs anywhere.
if (PHP_VERSION_ID < 80100) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "7thPortal requires PHP 8.1 or newer. This server is running PHP " . PHP_VERSION . ".\n";
    echo "Fix: in cPanel > MultiPHP Manager, set this domain to PHP 8.1+ (match the live site), then reload.\n";
    exit;
}

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

// Bootstrap (schema migrations in db.php, plus loading http.php and the lib
// files below) runs before any route logic. A failure in any of it - a migration
// tripping on unexpected DB state, or even a PARSE ERROR in one uploaded file -
// would otherwise be an uncaught fatal that the host replaces with its own blank
// 500 page, hiding the cause and taking down every dynamic route at once. Two
// nets catch it:
//   1. A shutdown handler records ANY fatal (including parse/compile errors that
//      try/catch cannot catch) to data/bootstrap-error.log - a plain file OUTSIDE
//      the web root, readable via cPanel File Manager. This is what makes the
//      recurring "every page 500s after a deploy" diagnosable without shell access.
//   2. The try/catch below turns a catchable bootstrap Throwable into a graceful
//      response: in development the real message with a 200 status (readable even
//      when the host swallows 500 bodies); in production a generic 500.
$bootErrorLog = __DIR__ . '/../data/bootstrap-error.log';
register_shutdown_function(function () use ($bootErrorLog, $isProd) {
    $e = error_get_last();
    if (!$e || !in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_RECOVERABLE_ERROR], true)) return;
    $line = date('c') . '  FATAL: ' . $e['message'] . ' in ' . $e['file'] . ':' . $e['line'] . "\n";
    @file_put_contents($bootErrorLog, $line, FILE_APPEND);
    error_log('[bootstrap] fatal: ' . $e['message'] . ' in ' . $e['file'] . ':' . $e['line']);
    if (!$isProd && !headers_sent()) {
        http_response_code(200);
        header('Content-Type: text/plain; charset=utf-8');
        echo "BOOTSTRAP FATAL (shown because APP_ENV is not production)\n\n" . $line;
    }
});

try {
    require_once __DIR__ . '/../src/db.php';
    require_once __DIR__ . '/../src/http.php';
    require_once __DIR__ . '/../src/router.php';
    require_once __DIR__ . '/../src/lib/helpers.php';
    require_once __DIR__ . '/../src/lib/middleware.php';
    require_once __DIR__ . '/../src/lib/osm.php';
    require_once __DIR__ . '/../src/lib/osmData.php';
    require_once __DIR__ . '/../src/lib/mailer.php';
    require_once __DIR__ . '/../src/lib/gallery.php';
    require_once __DIR__ . '/../src/lib/finance.php';
    require_once __DIR__ . '/../src/lib/documents.php';
    require_once __DIR__ . '/../src/lib/notifications.php';
    require_once __DIR__ . '/../src/lib/equipment.php';
    require_once __DIR__ . '/../src/lib/quartermaster.php';
    require_once __DIR__ . '/../src/lib/incidents.php';
    require_once __DIR__ . '/../src/lib/events.php';
    require_once __DIR__ . '/../src/lib/calendar.php';
    require_once __DIR__ . '/../src/lib/attendance.php';
    require_once __DIR__ . '/../src/lib/activity.php';
    require_once __DIR__ . '/../src/lib/patrolpoints.php';
    require_once __DIR__ . '/../src/lib/demoseed.php';
    require_once __DIR__ . '/../src/lib/actions.php';
} catch (Throwable $e) {
    @file_put_contents($bootErrorLog, date('c') . '  THROW: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine() . "\n" . $e->getTraceAsString() . "\n", FILE_APPEND);
    error_log('[bootstrap] init failed: ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
    if (!$isProd) {
        http_response_code(200);
        header('Content-Type: text/plain; charset=utf-8');
        echo "BOOTSTRAP / MIGRATION ERROR (shown because APP_ENV is not production)\n\n";
        echo $e->getMessage() . "\n\nin " . $e->getFile() . ':' . $e->getLine() . "\n\n" . $e->getTraceAsString() . "\n";
        exit;
    }
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'The site is temporarily unavailable. Please try again shortly.']);
    exit;
}

if (loginDebugEnabled() && preg_match('#^/(auth|api/auth|api/me|login\.html)#', $uri)) {
    loginLog('--- New request ---', [
        'method' => $method, 'uri' => $uri,
        'APP_ENV' => env('APP_ENV', '(unset)'),
        'osmConfigured' => !empty(env('OSM_CLIENT_ID')) && !empty(env('OSM_CLIENT_SECRET')) && !empty(env('OSM_REDIRECT_URI')),
        'curlAvailable' => function_exists('curl_init'),
        'phpVersion' => PHP_VERSION,
    ]);
}

// Idempotent maintenance, mirrors the one-off boot tasks in the Node
// version's server.js. Cheap enough to run every request at this app's scale.
pruneAuditLog();
pruneArchivedAlbums();
pruneOldClaims();
pruneRejectedActivityForms();
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
require_once __DIR__ . '/../src/routes/finance.php';
require_once __DIR__ . '/../src/routes/governance.php';
require_once __DIR__ . '/../src/routes/documents.php';
require_once __DIR__ . '/../src/routes/actions.php';
require_once __DIR__ . '/../src/routes/notifications.php';
require_once __DIR__ . '/../src/routes/equipment.php';
require_once __DIR__ . '/../src/routes/quartermaster.php';
require_once __DIR__ . '/../src/routes/incidents.php';
require_once __DIR__ . '/../src/routes/events.php';
require_once __DIR__ . '/../src/routes/calendar.php';
require_once __DIR__ . '/../src/routes/attendance.php';
require_once __DIR__ . '/../src/routes/activity.php';
require_once __DIR__ . '/../src/routes/patrolpoints.php';
require_once __DIR__ . '/../src/routes/feedback.php';

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
