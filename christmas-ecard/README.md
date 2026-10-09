# 7th Swindon Christmas E-Cards

MVP of the Christmas E-Card FRD v1.1 (9 Oct 2026). PHP 8.2+, SQLite, no dependencies.

    php -S localhost:8060 -t public public/index.php    # run locally
    php tests/smoke.php                                  # core-logic checks
    php src/cli.php admin you@example.com [roles]        # make an admin with all roles (MFA enrolled at first /admin visit)
    php src/cli.php queue                                # cron, every 5 min: send/retry queued cards
    php src/cli.php purge                                # cron, daily: blank content past retention (90 days)

With no keys in `.env` (copy `.env.example`): emails go to `data/outbox.log` and payment is a simulated page.

## Going live
- Set `APP_URL`, `POSTMARK_TOKEN`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT` (acct_ of 7th Swindon).
- Stripe webhook: `/hooks/stripe` (`checkout.session.completed`; Connect webhook if using a connected account).
- Postmark webhook: `/hooks/postmark?k=<POSTMARK_HOOK_KEY>` (Delivery, Bounce, SpamComplaint, Open).
- Point the web root at `public/`; keep `data/` and `.env` outside `public_html` on cPanel.

## Roles and launch decisions
Roles: finance, delivery, campaign, complaints, role administrator (assigned in Admin > Roles, audited). Launch values the FRD says must be agreed, not guessed (campaign dates, queue handling at closure, expiry, retention, message limits, donation purpose wording) are in Admin > Campaign settings; current defaults are placeholders. Set `SUPPORT_EMAIL` for the Help page.

## Known gaps vs the FRD
- **Artwork** is placeholder SVG. Drop real files at `public/assets/cards/<id>.png` (ids in `src/cards.php`).
- **MySQL**: uses SQLite. Moving to MySQL needs the DDL in `src/lib.php` and `insert or ignore` / `on conflict` adjusted.
- Section 11 enhancements (QR link, per-recipient greetings, scheduling...) are not built; v1.1 says they are post-launch.
- Opt-out suppression is kept until the retention purge never removes it; agree its retention (FR-041).
- Stripe fees are entered by hand in Admin > Payments; no automatic refund sync.
- Not done: WCAG audit, security review, backup/restore drill, cPanel staging test (AC-16, AC-18).
