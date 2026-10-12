# 7thPortal - Project Context

Spec-driven context for 7thPortal, the parent/leader web portal for 7th Swindon Scout Group. This file is the always-loaded context for spec and change work; capability specs live under `openspec/specs/<capability>/spec.md` and proposed changes under `openspec/changes/`.

## Purpose

A read-mostly portal that lets parents and leaders see the group's information (sections, notices, their children, programme, events) and run operational workflows (activity approval, expenses, photo gallery, documents, patrol points, equipment), with Online Scout Manager (OSM) as the system of record. It links back to OSM for anything the portal does not own.

## Tech stack

- **PHP 8.1+**, no framework, no Composer, no build step. Hard-fails fast below 8.1 (uses `str_starts_with`, `match`, etc.).
- **SQLite** via PDO (`data/7thportal.db`); schema is created and migrated at bootstrap (`src/db.php`: `CREATE TABLE IF NOT EXISTS` + guarded `ALTER`s).
- **GD** for image resize/EXIF-strip; **curl** for OSM's API and SMTP done by hand (`src/lib/mailer.php`).
- Hand-rolled front end: static HTML pages in `webroot/` + vanilla JS (`webroot/js/*.js`), no framework. `Api` helper in `js/api.js`; nav/auth via `js/nav.js` (`requireUserNav`); page headers via `js/pageheader.js`.
- Hand-rolled router (`src/router.php`): `$router->get/post/put/patch/delete('/path', fn)`, `:param` path segments. Front controller `webroot/index.php` requires libs + routes, runs idempotent maintenance each request, then dispatches.

## Architecture

- `webroot/` is the only web-servable folder (document root). `src/` and `data/` must sit outside the web root (`src/.htaccess` / `data/.htaccess` `Require all denied` is a fallback only). No public image/file URLs - uploads are served through authenticated proxy routes.
- `src/lib/*.php` - domain logic (one file per area). `src/routes/*.php` - HTTP endpoints. `src/db.php` - schema + `dbGet/dbAll/dbRun`. `src/http.php` - `requestBody/queryParam/jsonResponse/loginLog`. `src/lib/middleware.php` - `requireAuth/requireLeader/requireAdmin`.
- OSM: `src/lib/osm.php` (OAuth + `/ext` and `/v3` reads/writes), `src/lib/osmData.php` (token resolution + demo fixtures), `src/lib/osmdiscovery.php` (capability probe), `src/lib/osmbadges.php`, `src/lib/osmprobe.php`.

## Roles

`portal_role` in `users`: `parent`, `section_leader`, `assistant_leader`, `group_leadership`, `quartermaster`, `trustee_viewer`, `treasurer`, `chair`, `admin`. Capabilities are derived, not merged: a user who is both a leader and a parent switches between a Leader view and a Parent view (own children only). Parents get locally-issued accounts (admin-created, linked to OSM member ids); leaders authenticate via OSM OAuth.

## OSM integration model

- OSM OAuth for leaders (section-scoped). Parents have no OSM login of their own, so parent-facing reads go through one admin-designated **service connection** (`is_osm_service_account = 1`).
- **Reads must be cached, never live on page load** - OSM rate-limits/throttles server reads, so dashboards read a local mirror (`osm_sections`, etc.) populated by a paced, admin-triggered or scheduled sync.
- **OSM's `/ext` validators want un-underscored integer params** (`sectionid`/`termid`, not `section_id`/`term_id`); `termid=-1` means "no term".
- Confirmed readable server-side: sections, members (contact grid), patrols, terms, programme, events, badge catalogue, waiting list (a section of type `waiting`).
- Confirmed writable: creating a waiting-list member (`POST /ext/members/contact/actions/?action=newMember`) and custom-data fields (`POST /ext/customdata/?action=updateColumn`); requires the `section:member:write` scope and a re-authorised connection.
- Blocked: member **badge award records** (permission wall - a per-account OSM Badges permission, not a scope/code issue). Only the badge catalogue reads.
- Data-sensitivity tiers and governance for using live member data: `DECISIONS-osm-integration.md` (Tier A counts/structure, Tier B member references, Tier C contact/medical behind a hard line). `DECISIONS-finance-module.md` covers the finance module's P0 decisions.

## Conventions

- **Feature modules ship off by default** behind a settings toggle when they touch safeguarding/finance/PII (gallery, finance, document library, forms). Enable in Admin settings.
- **No member PII stored for aggregate features**: counts/structure only (Tier A). Named member data is read through to an authorised viewer and not persisted; where it must be written (waiting-list add) it goes straight to OSM.
- **Demo mode** (`/auth/demo/login?as=<role>`) uses fixtures so the whole app is clickable without OSM credentials; every live OSM call degrades to "data not available" rather than breaking a page.
- **Copy**: no em/en dashes, no abbreviations in user-facing text.
- **No native dialogs** (`prompt`/`confirm`) - inline UI only.
- **Verification**: `php scripts/smoke-test.php` (dependency-free, per-scenario throwaway DBs). Keep it green before deploy. Browser-verify observable changes.
- **Deploy**: manual to cPanel. `php scripts/build-deploy.php` (stamps build id, cache-busts) then `php scripts/zip-dist.php`. Never overwrite the server `.env` or `data/`.
- **Git**: branch off main; commit only when asked; end commit messages with the required Co-Authored-By line.

## Capabilities (specs to maintain)

Specced here: `authentication`, `osm-integration`, `activity-approval`, `finance`, `waiting-list`. Further modules present in the code and awaiting their own specs: parent/leader dashboards, notices, photo gallery, document library, patrol points, events and camps, quartermaster and equipment, attendance, incidents, activity forms, calendar, notifications, search, access groups, governance/trustee dashboard, OSM capability discovery, badges-awarded.
