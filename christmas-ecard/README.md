# 7th Swindon Christmas E-Cards

MVP of the Christmas E-Card FRD v1.0 (9 Oct 2026). PHP 8.2+, SQLite, no dependencies.

    php -S localhost:8060 -t public public/index.php    # run locally
    php tests/smoke.php                                  # core-logic checks
    php src/cli.php admin you@example.com                # make an admin (MFA enrolled at first /admin visit)
    php src/cli.php queue                                # cron, every 5 min: send/retry queued cards
    php src/cli.php purge                                # cron, daily: blank content past retention (90 days)

With no keys in `.env` (copy `.env.example`): emails go to `data/outbox.log` and payment is a simulated page.

## Going live
- Set `APP_URL`, `POSTMARK_TOKEN`, `STRIPE_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ACCOUNT` (acct_ of 7th Swindon).
- Stripe webhook: `/hooks/stripe` (`checkout.session.completed`; Connect webhook if using a connected account).
- Postmark webhook: `/hooks/postmark?k=<POSTMARK_HOOK_KEY>` (Delivery, Bounce, SpamComplaint, Open).
- Point the web root at `public/`; keep `data/` and `.env` outside `public_html` on cPanel.

## Known gaps vs the FRD
- **Artwork** is placeholder SVG. Drop real files at `public/assets/cards/<id>.png` (ids in `src/cards.php`).
- **MySQL**: uses SQLite. Moving to MySQL needs the DDL in `src/lib.php` and `insert or ignore` / `on conflict` adjusted.
- Registration happens when you press Continue (compose requires sign in), not before editing.
- Stripe fees are entered by hand in Admin > Payments; no automatic refund sync.
- Not done: WCAG audit, security review, backup/restore drill, cPanel staging test (AC-16, AC-18).
