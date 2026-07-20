# 7thPortal (PHP)

A PHP port of `../7thportal` (the original Node/Express version), built because the target hosting (`digital.7thswindon.org.uk`, cPanel shared hosting) only supports PHP, not a persistent Node.js process. Same functionality, same FRD (`7thPortal_FRD_with_Photo_Gallery.docx`), same design decisions - this is a language port, not a feature redesign. See `../7thportal/README.md` for the full FRD-level rationale (OSM integration model, role model, MVP scope, photo gallery scope decisions); this README only covers what's different because it's PHP.

**Deploying for the first time? Follow `DEPLOY.md` step by step** - it's a plain checklist for uploading to `digital.7thswindon.org.uk` via cPanel. Everything below is background/reference, not a to-do list.

## Stack

Plain PHP 8.1+ (no framework), PDO/SQLite, GD for image processing, curl for OSM's API - no Composer, no build step. Same hand-written `public/`-style frontend as the Node version (copied into `webroot/`, functionally unchanged).

## Deployment layout - read this before uploading anywhere

```
7thportal-php/
  .env                  # real secrets - created on the server, never uploaded
  data/                  # SQLite db + uploaded photos - runtime state
  src/                    # all PHP application code
  webroot/                # <- point your web server's document root HERE, not at the parent folder
    .htaccess
    index.php             # front controller
    index.html, login.html, ... (all the pages, unchanged from the Node version)
    css/, js/
```

`src/` and `data/` must **not** be reachable over HTTP - `data/7thportal.db` is the whole user database, and `data/gallery-uploads/*.jpg` bypassing the authenticated image proxy would defeat the entire point of NFR-025/NFR-026/NFR-027 (no public image URLs). The correct way to guarantee this is to point your hosting's document root at `webroot/` specifically, so `src/` and `data/` simply aren't inside the web-servable tree at all - most cPanel hosts let you set a custom document root when creating/editing a subdomain.

**If your host forces the document root to be a fixed folder** (some very basic shared hosting does), `src/.htaccess` and `data/.htaccess` both carry a `Require all denied` rule as a fallback - but treat that as a safety net, not the primary control. Verify by trying to load `https://your-domain/../data/7thportal.db` (adjust the path for wherever it ended up) after deploying and confirming it 403s/404s.

## Building a deploy package

```
php scripts/build-deploy.php
php scripts/zip-dist.php
```

The first produces `./dist` with `src/`, `webroot/`, `data/.htaccess`, `.env.example` and this README - everything needed, nothing that shouldn't be there (no `.env`, no `data/` contents). The second zips it up with proper forward-slash paths for a one-file cPanel File Manager upload (`Upload` → `Extract`) - don't substitute Windows' built-in "Compress to ZIP" or PowerShell's `Compress-Archive`, both store backslash separators that some server-side unzip tools mishandle. Unlike the Node version there's no dependency-install step; PHP files just run.

## What's different from the Node version (and why)

- **Routing**: Node used Express; this uses a small hand-rolled `Router` class (`src/router.php`) plus an `.htaccess` rewrite-everything-to-`index.php` front controller. URL paths are identical to the Node version - the frontend JS didn't need to change for this.
- **Database**: `node:sqlite` → PDO with the same SQLite file format and near-identical schema (`src/db.php`). `dbGet()/dbAll()/dbRun()` helpers mirror `db.prepare(sql).get/all/run()` so the ported route code reads close to the original.
- **Sessions**: `express-session` → PHP's native `session_start()`/`$_SESSION`, with the same cookie flags (HttpOnly, SameSite=Lax, Secure in production) and a sliding/rolling expiry re-applied on every request (FR-005).
- **Passwords**: the Node version's hand-rolled scrypt is replaced with PHP's native `password_hash()`/`password_verify()` (bcrypt) - same security property (salted, slow, one-way), no extension dependency, nothing to migrate since this is a fresh separate deployment.
- **OSM OAuth CSRF state**: Node kept a short-lived in-memory `Map`; PHP has no persistent process memory between requests, so this lives in `$_SESSION` instead - simpler, and it was only ever standing in for "this browser's in-flight login attempt" anyway.
- **Image processing**: Jimp (pure JS) → PHP's GD extension (`src/lib/gallery.php`) - decode whatever format was uploaded, resize to the same 1600px max dimension, optionally stamp a watermark, re-encode as JPEG (which drops EXIF/GPS the same way Jimp's re-encode did). The watermark itself looks plainer - GD's built-in bitmap font instead of a 16px sans font - to avoid bundling a TTF file just for a "don't share this" caption.
- **File uploads**: `multer` → PHP's native `$_FILES`. One genuine frontend change was needed here: PHP only groups multiple same-named file inputs into an array if the field name ends in `[]`, so `webroot/js/album-edit.js` sends `photos[]` instead of the Node version's `photos` - everything else about that page is unchanged.
- **Concurrency in OSM badge lookups**: Node used bounded-concurrency workers to fetch several badge types/records in parallel; this does the same lookups sequentially in a plain loop. Slower per request, not less correct - not worth `curl_multi_*` complexity at this app's traffic scale.
- **Email**: `nodemailer` → a small hand-rolled SMTP client (`src/lib/mailer.php`, STARTTLS on 587 / implicit TLS on 465, AUTH LOGIN) to avoid a Composer dependency. Same behaviour either way: returns `false` without throwing if `SMTP_HOST`/`SMTP_USER` aren't set, and the admin UI falls back to showing the invite link to copy/send manually.

## Local development

```
php -S localhost:8040 -t webroot webroot/index.php
```

The third argument makes `index.php` act as a router script: it serves real static files directly (mirroring what `.htaccess` does under Apache) and otherwise dispatches through the app. Requires the `pdo_sqlite`, `gd`, `curl` and `mbstring` PHP extensions enabled (all bundled with PHP; if a fresh install shows none loaded, copy `php.ini-development` to `php.ini` next to `php.exe` and add `extension=` lines for each).

Demo Mode, role model, notices, admin backend and the photo gallery all behave identically to the Node version - see its README for the full feature list and FRD traceability. Every workflow was re-verified against this PHP version directly (auth, dashboards, child/section views, notices, admin user/parent management, and the complete photo gallery pipeline including a real image upload, resize, EXIF-strip check, submit/approve/reject/unpublish, and parent viewing).

## Debugging login issues

Both login flows (`/auth/osm/login` → `/auth/osm/callback` and `/api/auth/local-login`) log every step server-side - never to the browser, which still only ever shows the existing safe, generic error messages (NFR-007). Two places to look, both controlled by `LOGIN_DEBUG` in `.env` (on by default, set to `false` once things are working):

- **`data/login-debug.log`** - a plain text file, easiest to check on shared hosting since you don't need to know where the host puts its PHP error log. Open it directly via cPanel File Manager. Not web-accessible (outside `webroot/`, same protection as the database).
- **PHP's normal `error_log()`** - also gets everything, in case you're already tailing that.

What gets logged: for OSM login, every step (redirect URL built including the exact `redirect_uri` sent, callback received, code/state validity, token exchange result including OSM's raw error response on failure, startup payload keys, identity extraction, user upsert, final redirect) with a clear `Step N/4 OK` or `BLOCKED: <reason>` marker so you can see exactly where it stopped. If OSM itself redirects back with `?error=...` (e.g. `invalid_client`, `access_denied`) instead of a code, that's logged explicitly - this is the most common real failure mode when the app's redirect URI doesn't exactly match what's registered on OSM's My Apps page, or the app credentials have been revoked.

For local (parent) login: email/password presence, whether a matching local-auth account was found, whether the password verified, and account status - each with a note on what a `false` there implies (e.g. `hasPasswordHash: false` means the account is still on an unused invite link, not that the password is wrong).

One specific thing the startup log checks for: `APP_ENV=production` sets the session cookie's `Secure` flag, which requires PHP to know the original request was HTTPS. If the app sits behind a reverse proxy that terminates TLS (common on some hosts) and doesn't forward an `X-Forwarded-Proto: https` header, PHP sees the request as plain HTTP, the secure cookie gets set but the browser may not send it back correctly, and login *appears* to succeed (redirect happens, `SUCCESS` shows in the log) but bounces straight back to the login page. The log prints a `WARNING` line when it detects this specific combination.

## Known follow-ups

Same open items as the Node version's README (OSM endpoint field-name confidence beyond the proven OAuth+badges calls, formal GDPR status, photo consent data source, session-timeout-requires-restart, no automated tests) - none of that changed by moving to PHP.
