# Implementation inventory (build pack v2.4, first pass)

Date: 10 October 2026. Produced by reading the repository, not from the pack's assumptions. Companion file: `gap_matrix.csv` (one row per FR-001 to FR-164 plus UX24-01 to UX24-12). The pack warned it could not certify the code; this inventory is the evidence it asked for. Status is tracked separately: built, automated-tested, UAT-verified, security-reviewed, approved, production-ready. Only the first two are claimed anywhere here.

## Runtime and layout

| Item | Finding |
|---|---|
| Stack | Plain PHP 8.2+ (8.3 locally), SQLite through PDO, no Composer dependencies. Matches the pack's "existing PHP/cPanel application". |
| Required extensions | pdo_sqlite, curl, zip (for encrypted backups). `sodium` and `openssl` are not installed on the dev machine, so the code does not need them. |
| Entry point | `public/index.php` calls `dispatch()` in `src/app.php`. Routes are one array of path to `r_*` handler. Webhooks at `/hooks/stripe` and `/hooks/postmark`; frozen artwork at `/art/<name>`. |
| Code | `src/lib.php` (db, helpers, rate limits), `core.php` (payments, queue), `app.php` (sender, recipient pages), `admin.php` `admin2.php` `admin3.php` (admin), `contacts.php`, `cards.php`, `legal.php`, `ops.php`, `giftaid.php`, `resilience.php` (v2.3 work), `cli.php`. |
| Database | Created in code (`SCHEMA` in `lib.php` plus an ensure-columns list), so there are no migration files. Tables include users, sends, recipients, donations, contacts, groups, decisions, alerts, audit, settings, stripe_events, bounces, gift aid declarations. Changing a table means editing `lib.php`. |
| Secrets | Read from environment (`.env`), kept outside the web root in the distribution build. `.env.example` lists them. Not logged. |
| Jobs | `php src/cli.php queue | alerts | alerts-daily | purge | remind | digest | backup | restore`. Cron lines are in `DEPLOY.md` in the build. |
| Build | `scripts/build-dist.sh` makes `dist/app`, `dist/public_html`, `DEPLOY.md` and a zip. |

## Security controls found

Session CSRF on every POST except webhooks; password hashing; email verification before sending; TOTP two step sign in enforced for all admin pages and actions; per-action role map checked on the server (`r_admin_action`); rate limits per visitor and per account/email/token with audit of refusals; hidden trap field on public forms; Stripe signature check and event dedupe; Postmark hook secret; recipient tokens are random and opt-out needs a POST so link scanners cannot opt anyone out; audit log. Recipient tokens are stored in plain text, not hashed (the pack says "if architecture permits"): see the gap list.

## Tests found and run

| Suite | Checks | Covers |
|---|---|---|
| tests/smoke.php | 52 | Core journeys, payments, queue, recipient view |
| tests/contacts_test.php | 14 | Address book, groups, ownership |
| tests/admin_test.php | 29 | Config engine, roles, designs |
| tests/ops_test.php | 33 | Terms, suspension, alerts, readiness, reminders |
| tests/giftaid_test.php | 23 | Gift Aid |
| tests/resilience_test.php | 47 | Frozen art, Stripe events, bounces, backup and restore, gates, rate limits |
| tests/ux24_test.php | 5 | New in this pass: skip control, five area navigation |

All pass (contacts_test failed once with a stale temporary database name and passed on rerun). The suites are plain PHP scripts with exit codes; there is no browser, accessibility, load or live provider test.

## Findings against the pack

1. **Already built, as the pack proposes:** combined compose and recipient entry (S03, no recipients page), compose before sign in with the draft kept through registration and verification (anonymous drafts 7 days), free and donate as separate review buttons, human readable statuses, stable hero, immutable sent artwork, read only previews, Stripe replay safety, bounce handling, MFA, backups and restore, hard launch gates, Gift Aid off until D-12.
2. **Gaps closed in this pass:** UX24-06 Skip animation control on the recipient reveal; UX24-07 admin navigation grouped into five areas.
3. **Still open:**
   - UX24-03: the review page has two equal buttons rather than a free default with the donation behind an explicit choice. Needs a UI decision and UAT.
   - UX24-07 is navigation only. The Overview is not yet "actions first".
   - UX24-11: the three stage progress bar exists but its wording around sign in and payment has not been tested.
   - The campaign QR image is fetched from a third party service. The pack prefers local generation; that needs a QR library or a small generator and a privacy decision.
   - Recipient tokens are stored unhashed.
   - No staging run, live Stripe or Postmark verification, assistive technology test, security review or load test. These are the release gates and cannot be satisfied by code.
   - The pack's FR to AC mapping for FR-001 to FR-145 is provisional because the original v2.0 and v2.1 acceptance wording was not in the pack. The merged baseline in `docs/FRD_baseline_v2_3.md` now supplies it, so the mapping can be reconciled against that file.
4. **Conflicts to record, not resolved:** the pack says "Postmark appears planned"; the code supports Postmark and a local log fallback, with no live account verified. The pack's Admin tab names (Cards & delivery and so on) are used with "and" in place of "&" to follow the Group's copy rule against symbols and abbreviations.

## Proposed order of further work (pack backlog mapping)

WP-00 done (this file and the matrix). WP-01 safety tests: covered by resilience_test and smoke; add a requirement level mapping. WP-02 and WP-03: UX24-03 review wording and UAT. WP-04: done. WP-05: skip added; keyboard and screen reader UAT to do. WP-06: navigation done; Overview needs an actions first design. WP-07 and WP-08: built (v2.3). WP-09 and WP-10 need real staging and Trustee decisions.
