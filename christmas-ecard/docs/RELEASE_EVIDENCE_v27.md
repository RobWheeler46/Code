# Release evidence and deployment checklist: eCard Library (build pack v2.7, EC-01 to EC-05 and EC-08)

Date: 11 October 2026. This is evidence, not approval. Each row records what has actually been done. "Tests" means the automated scripts in `tests/`, run on a development machine. Nothing here has been through user acceptance testing, an independent security review, a staging run on the real host or Trustee sign-off, and the application has not been shown to be production ready.

## Status by area

| Area | Built | Automated tests | Browser or HTTP checked | UAT | Independent review | Approved |
|---|---|---|---|---|---|---|
| Additive library tables and import (EC-01) | Yes | `library_migration_test` (9) | Deployed copy loaded, database not inspected | No | No | No |
| Safe upload service (EC-02) | Yes | `uploads_test` (25) | Real multipart upload in the browser pane | No | No (the pack asks for one) | No |
| Library screens (EC-03) | Yes | `library_admin_test` (23) | Browser pane, 375 pixel width, no horizontal scroll | No | No | No |
| Publishing, versions, rollback (EC-04) | Yes | `library_lifecycle_test` (44) | Browser pane: publish, public thumbnail, hold back | No | No | No |
| Gallery, hero, order, featured (EC-05) | Yes | `library_gallery_test` (18) | HTTP: held back design, saved draft, direct link | No | No | No |
| Sign in, roles, CSRF, scope, replay, upload abuse (EC-08) | Yes | `library_security_test` (27, real HTTP) | Same | No | No | No |
| Draft campaigns, design reuse, per campaign donations (EC-06, EC-07) | Yes, draft only | `campaigns_test` (23), plus 11 checks in `library_security_test` | HTTP: finance refused, no activation route, occasion route, greeting only review | No | No | No |
| Dynamic occasion wording (FR-179, OCA-12) | **Not built** (needs ED-08 approved text) | n/a | n/a | n/a | n/a | n/a |

Christmas sending, payments, recipient view and the earlier suites still pass (smoke, contacts, admin, operations, Gift Aid, resilience, UX, token hash).

## Pack release checks that these results do and do not cover

| Check | Result |
|---|---|
| CAT-01, 02 valid and malicious uploads | Passed in tests and over HTTP |
| CAT-03, 04 rights, alt text, year check before publish | Passed; year is a human check, no automatic detection |
| CAT-05 publish appears in gallery, hero and start route | Passed |
| CAT-06 unauthorised publish rejected | Passed over HTTP and by direct function call |
| CAT-07 hold back, sent cards unchanged | Passed |
| CAT-08, OCA-06 new version, old sent card unchanged | Passed |
| CAT-09 reorder persists | Passed, including in a second process |
| CAT-10 320 pixel crop and overflow | Checked at 375 pixels only; no automated visual test |
| CAT-11 concurrent edits | Passed for save and publish |
| CAT-12 failure leaves nothing | Passed for uploads and for publish file copying; not exercised against a full disk |
| CAT-13 backup and restore include library files | Passed in a rehearsal; **not done on the real host** |
| CAT-14 rollback | Passed |
| CAT-15 volunteer adds and publishes in five minutes | **Not done**: needs a real volunteer and the real artwork |
| OCA-01, 08, 10, 11 | Passed (OCA-11 only as a Group filter on the server, with one Group) |
| OCA-02 to 05, 09, 10 | Passed (draft campaigns only; none can go live) |
| OCA-07 pause a campaign | Existing dispatch pause only; no per campaign pause |
| OCA-12 thank you wording has no Christmas text | **Not built** |
| Accessibility: keyboard, screen reader, zoom | **Not done** |
| Security review of uploads and permissions | **Not done** |
| Load or concurrency test | **Not done** |

## Decisions still open (do not guess)

ED-01 who may publish: the safe default is applied (restricted administrators only; change with the setting `library_publish_roles`). ED-02 upload limits: proposed 8 MB, 12 megapixels, 6000 pixels, at least 800 wide; approve or change. ED-03 how long old versions are kept: nothing is deleted today. ED-04 to ED-10 only matter when another occasion is proposed.

## Deploying this build

1. Back up the live database and `data/` first (`php src/cli.php backup`, with `BACKUP_KEY` set), and keep a copy off the server.
2. Upload the new `app/` and `public_html/`. Keep the existing `.env`.
3. On the first request the app adds the library tables and columns and imports the twelve designs. Nothing is deleted or rewritten. To go back: `php src/cli.php library-rollback`, then `LIBRARY_MIGRATE=off` in `.env`, and put the previous files back.
4. Confirm the server can handle uploads: PHP `gd` with WebP support, `upload_max_filesize` and `post_max_size` of at least 10M, and `data/` writable. Run `php tests/uploads_test.php` there if you can.
5. Sign in to Admin and open Campaign setup > eCard Library. You should see the twelve designs, eleven published and one held back ("Woggle all the way", until its picture is corrected).

## Smoke checks after deploying (about ten minutes)

- Home page shows the illustrated cards and a hero picture; the gallery order is as expected.
- Pick a design, write a card, sign in and review: free sending is first, donation optional.
- Library: add a draft with a real picture; the preview shows gallery, full card, sender and recipient views; the page does not scroll sideways on a phone.
- Publish the draft (as a restricted administrator), see it in the gallery, hold it back, and see it leave. Check the Change history shows each step.
- Try the same as a campaign manager: the Publish button is replaced by "Only a publisher can publish".

## Volunteer test (CAT-15)

Give someone who has not used the screen the approved picture and the wording. Time how long it takes them to add the card, check the preview and have a publisher publish it, without help. Record problems. The target in the pack is five minutes with no critical errors.
