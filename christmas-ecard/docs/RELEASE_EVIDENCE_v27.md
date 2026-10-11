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

## Decisions recorded

- ED-01 who may publish: confirmed by Rob on 11 October 2026. Restricted administrators only (the setting `library_publish_roles` can widen it later). This is the project owner confirming the default, not a recorded Trustee minute.
- ED-02 upload limits: confirmed by Rob on 11 October 2026: 8 MB, 12 megapixels, 6000 pixels on the longest side, at least 800 wide.
- "Woggle all the way": stays held back until the corrected picture is supplied (see below).

## Decisions still open (do not guess)

ED-03 how long old versions are kept: nothing is deleted today. ED-04 to ED-10 only matter when another occasion is proposed.

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

## Putting the corrected Woggle picture in

In Admin > Campaign setup > eCard Library open "Woggle all the way" and choose Create new version. Upload the corrected picture, fix the printed words and the description so they match the new year, tick the rights and wording and year checks, and save. A restricted administrator then publishes version 2 and uses Put back in the gallery. Cards already sent with the old picture keep it.

## Volunteer test (CAT-15)

Give someone who has not used the screen the approved picture and the wording. Time how long it takes them to add the card, check the preview and have a publisher publish it, without help. Record problems. The target in the pack is five minutes with no critical errors.

## Local QR code (11 October 2026)

The campaign QR code is now made inside the application (`src/qr.php`, byte mode, error correction level M, versions 1 to 6, up to 106 characters) and shown and downloaded as an SVG from the campaign settings page, so the address is no longer sent to a third party website. Checked by decoding five different strings, across versions 1 to 6 and including accented and emoji text, with an independent QR reader (jsQR, loaded once for the check and not part of the application); all five decoded exactly. `tests/qr_test.php` (13 checks) pins the code for the campaign address and checks its structure; 4 more checks over HTTP cover the download and its permissions. Not tested: scanning a printed copy with real phones, which is worth doing once.

## Account page (11 October 2026)

FR-005 is now complete: signed in senders have an Account page (menu link "Account") where they can change their name, change their email address, change their password, set their email preferences and reach account deletion. Changing the email or the password needs the current password. A new email address only takes effect when its owner opens the confirmation link, which works once, for one hour, only while signed in as that account, and is stored as a hash; the old address gets a warning with the new one masked, and a second notice when the change completes. A password change tells the owner by email and refreshes the session. Nothing in the change history holds an address, link or password. `tests/account_test.php` has 28 checks over real HTTP. Not done: keyboard and screen reader testing of the page, and showing a reminder that an unconfirmed address cannot send.

## Editable email and help wording (11 October 2026)

FR-085 is now met for wording: Admin > Campaign setup > Email and help wording (application administrators and restricted administrators; everyone else who can view settings sees it read only). It changes the subject of the card email, the opening line, the words on the button, the public support address, and up to 10 extra Help questions. It uses the same review screen as other settings (old and new values, optional reason, a version check so two people cannot overwrite each other) and every change is in the change history. Safeguards: the subject and opening line must keep `{sender}` and may use no other placeholder; wording is plain text only (no markup, line breaks flattened so a subject cannot carry a header); every merged name is escaped for where it lands; the private link, the stop and report routes and the privacy link cannot be removed because they are not part of the wording; extra Help answers are always shown as plain text. With nothing set, emails are exactly as before. `tests/wording_test.php` has 24 checks, including the admin page and the Help page over real HTTP. Logos and colours remain fixed approved files and are not editable here. Not done: wording for non-Christmas campaigns (still waits for approved text, ED-08).

## Administrator invitations (11 October 2026)

FR-088 now has its invitation step. A restricted administrator can invite someone by email, choosing the roles (Admin > Administration > Administrator access). The invitation is for one address and a fixed set of roles, works once and for seven days, and only a hash of the link is stored. It is accepted only by a signed in account with that same, confirmed address; anyone else, a made up link, a used, replaced, revoked or expired link all get the same "not valid" answer. Accepting adds the invited roles to any roles the person already had, and the new administrator cannot use Admin until they have set up two step sign in. Pending invitations can be sent again (which kills the old link) or revoked, with an immediate effect; at most 20 can wait at once; one live invitation per address. Everything is in the change history without addresses or links. Revoking an administrator's roles through the existing form takes effect on their next request, and the app still refuses to remove the last restricted administrator. `tests/invites_test.php` has 22 checks over real HTTP. The older form is renamed "Give roles to a registered user by email" because it applies roles straight away to someone who already has an account. Not done: automatic reminder before an invitation expires, and keyboard and screen reader testing.

## Restore an earlier configuration (11 October 2026)

FR-095 is built. In Admin > Change history a restricted administrator sees "Restore the earlier values" beside each past settings change (campaign, application, privacy and retention, email wording). It opens that settings page with the values from before that change filled in and a plain warning that restoring cannot undo emails already sent, payments already taken, links that have already expired or records that have been deleted. Nothing is saved until the person goes through the normal review (old against new, impact for retention changes, reason and approval reference where that page asks for them) and confirms. It is a new configuration version, and the change history records it with the change it came from. Only restricted administrators can do it: for anyone else the restore request is ignored, a forged restore marker is refused, and a marker from a different settings page or a change that does not exist is refused. Gift Aid cannot be switched on by a restore, because the normal rule still needs the approved decision. There is no bulk reset. `tests/restore_test.php` has 18 checks over real HTTP. Secrets are never part of this (they are not stored in settings).

## Change history export (11 October 2026)

FR-159 and AC-133 are built. Restricted administrators and application administrators can export the change history from Admin > Change history > Export entries as a spreadsheet. They choose a start and end date (no more than a year, no more than 10,000 entries), may filter by the start of an action name, and must give a reason. The file holds only the entries their roles already let them see on the change history page (an application administrator does not get delivery or finance entries), with email addresses partly hidden, long link and token strings removed, and cells that start with a formula character made safe. Each export is itself recorded before the file is handed over, with its dates, filter, number of entries and reason, but none of the content. Exports are limited to five tries an hour per person. Campaign managers, finance and everyone else are refused. `tests/audit_export_test.php` has 16 checks over real HTTP. Not done: a file format other than CSV, and keyboard and screen reader testing of the form.

## Email delivery settings in Admin (11 October 2026)

All email configuration can now be done in Admin > Administration > Email delivery (application administrators and restricted administrators): how to send (automatic, Postmark, the Group's own mail account over SMTP, or "do not send" for testing), the sender address, the Postmark token, the mail server, port, connection security, user name and password, and how many emails to send each time the queue runs. What is saved there wins over the `.env` file; anything left unset falls back to `.env`. Passwords and tokens are write-only: they are never shown again (the page only says they are saved), a blank field keeps the stored value, there are separate "remove" boxes, saving needs the administrator's own password, and the change history records which settings changed but never their values. "Send a test email" sends to the signed in administrator's own address using what is saved now, shows the mail server's plain answer if it fails, remembers the last result, and is limited to five an hour. `tests/mailconfig_test.php` has 20 checks over real HTTP, including a real test email through a pretend mail server. Caveat: saved secrets live in the database (outside the public folder and inside the encrypted backup) rather than in `.env`, because the settings page has to be able to change them; the older guidance to keep secrets only in protected server configuration still applies to everything else (Stripe keys stay in `.env`).

Not built, on purpose: a development sign in shortcut that skips the password and two step code. The site is on the public internet, so an authentication bypass is not something to add even as a temporary measure; the safer routes are the `ADMIN_EMAIL` first-administrator set up and the command line `admin` helper.

## Volunteer workspace (build pack v2.10, 11 October 2026)

ADM-01 to ADM-07 are built. Every admin page now sits in one workspace shell (`src/workspace.php`): a persistent menu on the left on a computer, a "Workspace menu" disclosure that starts closed on a phone, a breadcrumb, a current-page marker and 44 pixel high links. The menu, the overview shortcuts and the breadcrumbs all come from one manifest, grouped by what people are doing: Start, Member greetings, Cards and campaigns, Support and delivery, Fundraising, and Administration. The many settings and tools sit one step inside "Platform controls" so the menu stays one level deep. The Overview opens with "What would you like to do?" (a card for each destination the person may use), then "Where things stand" and "Needs your attention". A person with only a Trustee greeting role sees just Overview and the greetings entry, with no operational numbers. The pages that every administrator could open before (Launch checklist, System health, Change history) now need one of the six administrator roles, and two settings pages that were readable by more roles than the menu showed (Application settings for finance, Email and help wording for campaign managers, delivery support and finance) are narrowed to match. `tests/workspace_test.php` (14 checks, real HTTP, seven roles) checks both what each role is shown and that each role can open exactly the destinations it should and nothing else; it found and fixed the two over-wide pages. Checked in the browser at 320 pixels: no sideways scrolling on the overview or the library, the menu starts closed and opens on click, and all menu links are at least 44 pixels high. Not done: usability review with a Trustee, a section leader and an occasional operator (ADM-08), keyboard and screen reader testing, and the section leader screens (those are not built).

## Section leader suggestions (SL-01 to SL-09, 11 October 2026)

Built behind `private_section_greetings` (off by default; cannot be switched on until Trustee greetings is on). Code: `src/section_leaders.php`. Tests: `tests/section_leaders_test.php` (39 checks over real HTTP, made up members only).

Safe defaults used where the Trustees have not decided: one current assignment per leader and one suggestion per member (D-T5); a deadline per section, after which leaders cannot write (D-T7); first names only, so no surname, age, address, guardian or email is stored or shown (D-T2 and D-T3 are therefore not needed by this part); a Trustee approver can erase everything (D-T6 still needs a retention period). Roster tables are only created once the feature is used.

Covered: leader sees only their own section (other sections look like a missing page, including direct posts); reassignment, removal and end dates cut access at once; revisions are immutable and edits need the current revision; accepted text is copied to a Trustee draft and nothing is sent; decisions apply to the exact revision read; pending submissions are counted (`sl_pending_count()`) so batch approval can block on them; audit records ids and outcomes, never text or names; the dispatch operator, campaign manager and every other role are refused.
Not done: the roster is typed in by a Trustee (no import from OSM, which needs a Trustee decision), no accessibility or usability testing with a real leader, and no email notice (leaders see status and feedback on screen).
