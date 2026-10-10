# 7th Swindon Christmas E-Cards

MVP of the Christmas E-Card FRD v2.0 plus the v2.1 launch Musts (docs/FRD_v2_1_additions.md) (9 Oct 2026). PHP 8.2+, SQLite, no dependencies.

    php -S localhost:8060 -t public public/index.php    # run locally
    php tests/smoke.php                                  # core-logic checks
    php src/cli.php admin you@example.com [roles]        # make an admin with all roles (MFA enrolled at first /admin visit)
    php src/cli.php queue                                # cron, every 5 min: send/retry queued cards
    php src/cli.php digest                               # cron, daily: summary emails for senders who opted in
    php src/cli.php alerts                               # cron, every 5 min: email new alerts, escalate unacknowledged ones
    php src/cli.php alerts-daily                         # cron, daily: summary to the alert list while the campaign is open
    php src/cli.php reset-demo                           # staging only: clear cards, donations and non-admin accounts (refuses in production)
    php src/cli.php backup                               # cron, nightly: SQLite snapshot into data/backups (kept 30 days); copy off-site
    php src/cli.php purge                                # cron, daily: blank content past retention (90 days)

With no keys in `.env` (copy `.env.example`): emails go to `data/outbox.log` and payment is a simulated page.

## Going live
- Set `APP_URL`, `POSTMARK_TOKEN`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT` (acct_ of 7th Swindon).
- Stripe webhook: `/hooks/stripe` (`checkout.session.completed`; Connect webhook if using a connected account).
- Postmark webhook: `/hooks/postmark?k=<POSTMARK_HOOK_KEY>` (Delivery, Bounce, SpamComplaint, Open).
- Point the web root at `public/`; keep `data/` and `.env` outside `public_html` on cPanel.

## Payment recovery rules (FR-077 to FR-079)
One submission intent: "Send cards for free" queues once; "Donate and send cards" parks the same card as awaiting payment and verified payment resolves it, with no second send step. Cancelled or failed checkout returns to a recovery panel (retry or deliberate free send). An unknown outcome shows a pending panel that blocks both a second charge and the free bypass until Check status or Cancel attempt resolves it safely. A payment that lands after cancellation is recorded but never dispatches cards.

## Admin areas and roles (FRD 2.0 section 8)
Roles: Campaign manager, Application administrator, Finance administrator, Delivery support, Complaints reviewer, Restricted administrator. Admin pages are split by task (overview, delivery, finance, reports, campaign, application, email, privacy, access, health, change history) and every page and action re-checks the role on the server. Settings pages show old and new values and need a confirm step; saves are versioned (a stale form is rejected and your entries are kept) and audited. Expiry and retention need a reason and approval reference and show affected record counts first. Pause and resume are limited to application and restricted administrators and show queue impact.

## Address book and groups (FR-100 to FR-116)
Per-account contacts (name and email only) and groups, searchable, picked into a draft as snapshots. Duplicate rule: whole address case-folded, plus tags and dots kept. Defaults 200 contacts and 20 groups are the FRD proposals, pending approval. Account deletion (Dashboard > Delete my account) cancels unsent cards, switches off sent links, deletes drafts, contacts and groups, and keeps finance, audit and opt-out records.

## FRD 2.1 launch Musts
Privacy, cookie and terms pages (draft wording, flagged until decision D-14 is approved); 18-or-over and terms acceptance at registration with re-acceptance when `TERMS_VERSION` changes; sender suspension (Admin > Senders); alert emails with acknowledgement and escalation (set recipients in Admin > Application settings, run `alerts` from cron); launch readiness register (Admin > Launch readiness) which locks the campaign in production (`APP_ENV=production`) while required decisions are open, unless a restricted administrator records an override; staging banner; row-based recipient entry; human-written artwork descriptions. The accessibility test plan is in docs/AT_test_plan.md and has not been run yet.

## Roles and launch decisions
Roles: finance, delivery, campaign, complaints, role administrator (assigned in Admin > Roles, audited). Launch values the FRD says must be agreed, not guessed (campaign dates, queue handling at closure, expiry, retention, message limits, donation purpose wording) are in Admin > Campaign settings; current defaults are placeholders. Set `SUPPORT_EMAIL` for the Help page.

## Known gaps vs the FRD
- **Legal wording** (privacy notice, terms, safeguarding statement) is a draft written by me, not reviewed by anyone responsible. It must be replaced or approved by the Trustees (D-14).
- FRD 2.1 Shoulds and conditional items (rehearsal allow-list, email preview, success measures, recipient donations, Gift Aid, Christmas Day delivery, printable card, next-year reminder) are not built.
- **Artwork** is placeholder SVG. Drop real files at `public/assets/cards/<id>.png` (ids in `src/cards.php`).
- **MySQL**: uses SQLite. Moving to MySQL needs the DDL in `src/lib.php` and `insert or ignore` / `on conflict` adjusted.
- v1.2 conditional enhancements (scheduling FR-068 to 070, private link sharing FR-071 to 073, keepsake, collaborative cards, artwork management) are not built; the FRD keeps them out of the launch gate.
- The campaign QR code is generated by api.qrserver.com from the public campaign URL (nothing private is sent). Replace with a local generator if you prefer.
- Abuse rules are simple: web addresses blocked by default plus a configurable word list; agree the policy with Trustees.
- Opt-out suppression is kept until the retention purge never removes it; agree its retention (FR-041).
- Stripe fees are entered by hand in Admin > Payments; no automatic refund sync.
- Not built from FRD 2.0: restore of previous configuration (FR-095, Should); alert recipients with acknowledgement and escalation (FR-130: health page lists alerts, nothing is sent or acknowledged); in-app refund execution (by design, refunds are done in Stripe and recorded by hand); Postmark/Stripe event import for refunds; email subject patterns and help content editing (FR-084 partly: preview and test only); beneficiary change workflow and diagnostics beyond the health page; the S30 to S39 screens are real pages but have had no assistive technology audit.
- The FRD 2.0 section 15 proposed defaults (dates, retention, limits, rates) are NOT applied; the app keeps its earlier placeholders until the Trustees approve values in Admin.
- Not done: WCAG audit, security review, backup/restore drill, cPanel staging test (AC-16, AC-18).
