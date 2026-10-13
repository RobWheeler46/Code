# Code review, 12 October 2026

Scope: all of `src/` (4,000 lines of PHP), `public/assets`, `scripts/`, the 26 test files and the repository. Method: reading the code, searching for risky patterns, timing start up, and running the test suite. Nothing here has been changed. Each finding says how big the fix is.

## Overall

The codebase is in good shape for its size. Every database call I looked at uses bound parameters, every output goes through `h()`, state changes are POST with a CSRF token, admin routes check their role on the server, card links are hashed at rest, uploads are quarantined and re-encoded, and there are security headers and rate limits. The test suite is unusually strong (real HTTP tests with role by route checks). The main problems are not bugs but weight: very long lines, one large `app.php`, two migration systems that run on every request, and a few things left behind by features that were removed.

## Fix soon (security and correctness)

| # | Finding | Why it matters | Effort |
|---|---|---|---|
| 1 | **Password reset and email verification tokens are stored in plain text** (`users.reset_token`, `users.verify_token`; `app.php` 141, 151, 91, 102). Card links and the email change token are already stored as hashes. | A copy of the database (a backup, or a lost laptop) lets someone reset any account that has a live token and take it over. Reset tokens last an hour, verify tokens last until used. | Small. Store `sha256(token)`, compare the hash. Same pattern as `pending_token` in `account.php`. |
| 2 | **The Postmark webhook key travels in the URL** (`?k=...`, `app.php` 417). | URLs are written to web server logs, so the key ends up in log files. | Small. Postmark supports Basic Auth on the webhook URL. Move the key there and keep `hash_equals`. |
| 3 | **Registration says whether an email is already registered** (`app.php` 89). | Lets anyone test which addresses have accounts. Low risk for a Scout card service, and it is friendlier to users. | Decision, not a bug. Leave unless the Trustees care. |
| 4 | **`session.use_strict_mode` and a session lifetime are not set** (`lib.php` 83 to 85). | Defaults depend on the host's php.ini. Strict mode stops a session id that was never issued from being accepted. | One line each. |
| 5 | **A stray `cj2.txt` is committed in the repository root.** It is a curl cookie jar from a local test run. | It holds a (dead) localhost session cookie. Harmless now, but it should not be in git. | Delete and add to `.gitignore`. |
| 6 | **`APP_ENV` defaults to `development`.** In that mode the payment lock never applies and the banner shows. | If `.env` loses the line, a production site quietly runs unlocked with a test banner. Safe for you today, but fail-open. | Small. Make production the default and require `APP_ENV=development` on dev machines (tests already set env). |

## Simplify (biggest wins first)

| # | Finding | Detail | Effort |
|---|---|---|---|
| 7 | **Every request re-runs the migrations.** `db()` executes the whole `SCHEMA`, a `pragma table_info` per added column (about 40), several `update` statements, then `library_migrate()` which does more (`lib.php` 43 to 60, `library.php`). Start up measured 70 to 100 ms before any page work. | Wasted work on a shared host, and a lock contention risk with the queue cron. | Medium. Store a schema version in `settings` (or `pragma user_version`) and skip all of it when current. Run migrations only when the version is behind. |
| 8 | **Two migration systems** (`lib.php` ensure-columns loop and `library.php` `library_migrate`, with its own rollback, `LIBRARY_TABLES` drop list and an env switch). | Two places to look, two styles. The rollback code is destructive and rarely used. | Medium. Fold both into one ordered list of numbered migrations. |
| 9 | **WAL mode is not enabled.** Only `busy_timeout` is set. | The web requests and the 5 minute queue cron write to the same SQLite file. WAL lets readers continue during a write and reduces "database is locked". | One line: `pragma journal_mode=WAL` (check the host allows it; the backup uses `vacuum into`, which is fine). |
| 10 | **79 lines are longer than 400 characters**, and `app.php` (653 lines) mixes routes, pages, payments, webhooks, accounts and exports. A single route table line is over 3,000 characters. | Hard to read, hard to review, hard to diff. This is the main reason a full review is slow. | Medium to large, mechanical. Split `app.php` into `account.php`, `send.php` (compose and review), `pay.php`, `hooks.php`; one route per line; break long string concatenations into short pieces or small template functions. No behaviour change, and the tests catch mistakes. |
| 11 | **The permission check is repeated 20 times**: `need_admin(); if (!can_any(...)) fail(403, ...)`. | Easy to get wrong when roles change (the review in v2.10 found two such mistakes). | Small. Add `need_role(...$roles)` (a single-role version already exists in `lib.php`) and use it everywhere. The workspace manifest already knows each route's roles, so routes could read their roles from it. |
| 12 | **The settings screen is described twice**: `config_spec()` in `admin.php` and the code that reads each setting. | Adding a setting means touching two places; some settings are read but never editable (see 14). | Medium. Keep as is until it hurts. |

## Leftovers from removed features

| # | Finding | Effort |
|---|---|---|
| 13 | The `decisions` table, the `D-xx` references in `README.md` (lines 37, 40, 46) and the "draft wording" notes in `docs/` describe the Launch checklist and Gift Aid approval that no longer exist. | Small. Update the README and docs; leave the table (dropping it needs a migration). |
| 14 | Settings that are read but have no screen: `legal_reviewed` (shown as "Last reviewed" on the privacy page, never set), `library_publish_roles`. | Small. Either add them to Campaign settings or remove the reads. |
| 15 | The Platform controls and health pages still report backup and off-server copy status. They only warn now. | Decision for you: keep the warnings or remove them. |
| 16 | The docs folder still contains the gap matrices and analyses for features that were removed (Trustee greetings, section leaders). | Small. Move to `docs/archive/` or delete (git history keeps them). |

## Improve (quality of life)

| # | Finding | Effort |
|---|---|---|
| 17 | **The CSP allows `style-src 'unsafe-inline'`**, because there are four inline `style=` attributes. | Small. Move those four to classes, then drop `unsafe-inline`. |
| 18 | **The full test suite takes about 10 minutes** because several tests start a PHP server and log in with MFA for each role. | Medium. Share one logged-in session per role across a file, or add a quick `make test-fast` that skips the HTTP suites. |
| 19 | **No automated check on the build.** `build-dist.sh` is not tested, and `dist/` is only verified by hand. | Small. A test that unpacks the zip and boots the app against a temporary database. |
| 20 | **Card artwork definitions are one huge array** in `cards.php` with the alt text inline. | Small. Move to a data file (`cards.json`) so adding a card does not mean editing PHP. |
| 21 | **Version stamp** shows `-modified` whenever the working tree is dirty, but the zip is still produced. | Optional. Refuse to build `-modified` for deployment unless forced. |

## What I checked and found fine

- SQL: parameterised everywhere; table names in dynamic SQL come from fixed lists.
- Output: escaped with `h()`; plain text rendered with `nl2br(h())`.
- CSRF: checked for every POST except the two webhooks, which verify a Stripe signature (with a 5 minute tolerance) or a shared key.
- Sessions: id regenerated on sign in; cookies are HttpOnly, SameSite Lax and Secure on HTTPS.
- Login, MFA, reset and per-account actions have rate limits keyed on the account, not just the visitor's address.
- Open redirects: `safe_next()` is used for every `back` parameter.
- Uploads: size, type and dimensions checked, re-encoded, stored outside the web root, served with `nosniff`.
- Dangerous functions: no `eval`, `unserialize` or shell calls in the app. The only `exec` is in the command line tools.
- Webhook handling is idempotent (the donations table has a unique Stripe session).
- Mail header injection: line breaks are stripped (tested).

## Suggested order

1. Items 1, 2, 4, 5 and 6 together (about half a day, all small and testable).
2. Items 7 and 9 (faster, steadier database).
3. Items 11, 13, 14 and 16 (tidying).
4. Item 10 only if you plan to keep changing the app a lot; it is mechanical but touches a lot of lines.
