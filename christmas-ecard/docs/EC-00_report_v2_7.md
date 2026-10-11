# EC-00: source audit for build pack v2.7 (eCard Library and occasions)

Date: 11 October 2026. Scope: read the repository and compare it with FR-165 to FR-188, CAT-01 to CAT-15 and OCA-01 to OCA-12. No application code was changed. Full row by row evidence is in `gap_matrix_v27.csv`. Anything I could not verify is labelled UNVERIFIED. Built, tested, reviewed and approved are separate claims; only "built" and "automated tests" are made here.

## Result in one line

Of the 51 items, 3 are implemented, 22 partial and 26 missing. The library (upload, versions, publishing) and every occasion or campaign feature are missing. What exists is a single Christmas campaign with a hardcoded set of twelve illustrated designs that managers can enable, disable, reorder and re-describe.

## Verified findings by source path

| Area | Finding | Path |
|---|---|---|
| Design catalogue | Designs are a hardcoded PHP array. Enabled state, order and descriptions are overrides held in the `settings` table. Images are files deployed with the code. | `src/cards.php` `cards()`; `src/admin.php` `admin_designs_and_share` |
| Upload | None. No route accepts a file. | `src/app.php` `dispatch()` |
| Image tooling | PHP `gd` is loaded on the dev machine; `fileinfo` is not. The cPanel host's extensions are UNVERIFIED. | `php -m` |
| Versions | Not modelled. A card's picture is copied to `data/art/<design>-<sha12>.<ext>` when it leaves draft and its name is stored in `sends.art_ref`. The copy is served immutable at `/art/<name>`. Title and alt text of a sent card still come from the current catalogue. | `src/resilience.php` `freeze_art`, `r_art`; `src/cards.php` `card_art` |
| Campaign | One implicit campaign in settings (name, dates, donation purpose, amounts, target). `campaign_state()` gives open, before, closed or locked. No campaigns table, no occasion, no `group_id` anywhere. | `src/admin.php` `config_spec`; `src/core.php`; `src/lib.php` SCHEMA |
| Christmas wording | Hardcoded in about 79 places: cards 46, core 12, app 10, ops 6, admin 2, lib 2, resilience 1. Email subject and body are in `src/core.php`. | `grep -c Christmas src/*.php` |
| Publishing authority | Design changes sit behind the campaign or restricted administrator role in the action permission map. There is no separate publisher or second approver. | `src/admin.php` `r_admin_action` |
| Direct start and hero | Disabled or held back designs are rejected at the start route and excluded from the hero. | `src/app.php` `r_compose`; `src/cards.php` `hero_for_session` |
| Audit | Changes to designs and settings are audited with actor. No version, approval or hold events exist because those concepts do not. | `src/lib.php` `audit()` |
| Backup | Encrypted backup bundles the database and `data/art`. The master artwork in `public/assets` ships with the code and is not in the backup. | `src/resilience.php` `backup_run` |
| Tests | Eight plain PHP scripts, all passing. Reordering designs and a finance user trying to publish have no test of their own. | `tests/` |

## Conflicts and caveats

1. The pack says FR-148 holds designs back "in code"; that is still true. A held back list lives in `src/cards.php`.
2. The pack's schema suggests `design_versions`, `campaign_designs`, `design_drafts` and `design_audit`. This repo already has `sends.art_ref` and an `audit` table, so the new tables should extend those rather than duplicate them (the pack itself asks for reuse).
3. FR-165 to FR-188 are numbered after FR-164 and the merged baseline (`docs/FRD_baseline_v2_3.md`) ends at FR-164, so numbering is free. They are still unapproved proposals.
4. The pack says an uploaded SVG is not allowed. Today's drawn designs are PHP-generated SVG, not uploads, so there is no conflict.
5. `fileinfo` is missing locally, so signature checks must use GD decoding rather than `finfo`. That should be confirmed on the real host first.

## Proposed PR order (smallest first, each reversible)

| PR | Content | Notes |
|---|---|---|
| EC-01 | Additive migration: `occasions`, `campaigns`, `designs`, `design_versions`, `campaign_designs`; `sends.campaign_id` and `design_version_id` nullable; import the twelve existing designs as version 1 of one Christmas 2026 campaign. | Pure additions. Rollback is dropping the new tables and columns; the old code path keeps working because nothing reads them yet. Needs ED-03 (retention) before anything is deleted. |
| EC-02 | Upload service: GD decode, size and pixel caps, EXIF stripping, opaque file names outside the web root, quarantine then commit. | Needs ED-02 limits from the real artwork. Write CAT-01, 02, 10, 12 tests first. |
| EC-03 | Library screen and editor in the existing admin (five area menu, Campaign setup). | Mobile and keyboard evidence required. |
| EC-04 | Publish, hold, archive, version pinning (including alt text and title), rollback, concurrency. | Needs ED-01 (who can publish). Default: draft only until agreed. |
| EC-05 to EC-09 | Campaign aware gallery, draft occasions, campaign scoped donations, scope helper, release evidence. | Do not enable any non-Christmas campaign. Needs ED-04 to ED-10. |

## Decisions needed before coding past EC-01

ED-01 who may publish; ED-02 upload size, dimension and pixel limits (needs the twelve real files measured: the current ones are webp, see `public/assets`); ED-03 retention of pinned versions; ED-08 approved wording for non-Christmas emails. ED-04 to ED-07, ED-09 and ED-10 only matter once a second occasion is proposed.

## Not covered by this pass

No live host inspection (cPanel PHP version and extensions, upload limits), no review of the unseen original FRD v2.0 and v2.1 beyond the merged baseline, and no security review. The pack requires independent review of uploads and permissions before EC-02 ships.

## EC-01 status (11 October 2026)

Built: `src/library.php` adds `occasions`, `campaigns`, `designs`, `design_versions` and `campaign_designs`, plus nullable `sends.campaign_id` and `sends.design_version_id`. On first start it imports the 12 existing designs plus the 10 drawn ones as version 1 of one Christmas campaign (with SHA-256 and pixel size for the illustrated images) and links every existing send to its design version. Nothing reads these tables yet, so Christmas behaviour is unchanged and the settings table stays the source of truth until EC-04. The imported published or held back state is a one-time copy and will drift if an admin changes a design before EC-04; that is intended and noted. Rollback: `php src/cli.php library-rollback`, then set `LIBRARY_MIGRATE=off`. Tested in `tests/library_migration_test.php` (9 checks: upgrade of an old database, idempotence, linking, rollback). Not verified: the real cPanel SQLite version (rollback drops columns, which needs SQLite 3.35 or later; the code leaves the harmless nullable columns if it cannot).

## EC-02 status (11 October 2026)

Built: `src/uploads.php`, a safe intake service with no route calling it yet. It decides the file type from the first bytes (PNG, JPEG, WebP only; SVG, GIF, scripts renamed to .png are refused), reads the size from the header before decoding, refuses anything over the byte, pixel or side limits or too big for the server's memory, then proves the picture decodes. It keeps the original byte for byte, makes a 1600 pixel wide picture and a 480 pixel thumbnail as WebP with no metadata (GD writes pixels only), turns sideways phone photos upright, works in a quarantine folder and moves files into place only when every step has worked, and stores everything under `data/library` with random names outside the web root. `purge` clears interrupted uploads and the encrypted backup now includes `data/library`. Tested in `tests/uploads_test.php` (26 checks).

Proposed limits for ED-02 (settings `art_max_bytes`, `art_max_pixels`, `art_max_side`, `art_min_width`, `art_full_width`, `art_thumb_width`; a blank setting means the default): 8 MB, 12 megapixels, 6000 pixels on a side, at least 800 wide. They come from the twelve real designs, all 1060 by 1484 (portrait, 1.6 megapixels, 340 to 490 KB), so they leave plenty of room. These are proposals until the Group approves them. Not verified: the cPanel host's GD and WebP support and memory limit; run the upload test there before EC-03 depends on it.

## EC-03 status (11 October 2026)

Built: Admin > Campaign setup > eCard Library (`src/library_admin.php`, role: campaign manager or restricted administrator, behind the usual two-step sign in). It lists the twelve illustrated designs with status tabs (Published, Held back, Draft, Archived), and lets a manager add a draft: upload, name, printed words, a screen reader description, rights and year confirmations, and a thumbnail start point. Previews show the gallery thumbnail at desktop and phone size, the full card, and the sender and recipient views. Drafts can be edited (with a revision check so two people cannot overwrite each other), have their picture replaced, or be discarded if no sent card refers to them. A draft shows what still blocks publishing. The error summary links to each field, keeps what was typed and moves focus to the first problem. Draft pictures are served only through a role checked route. Drafts are private: the public gallery still reads the fixed design list, so nothing made here can reach a sender until EC-04. Existing designs are read only here (preview only) and the ten older drawn designs are hidden because they have no picture.

Tested: `tests/library_admin_test.php` (23 checks) plus a manual run in the browser pane with a real multipart upload, a validation failure, and mobile widths at 375 pixels (no horizontal scroll on the list, editor or preview). Not done: keyboard and screen reader testing, an independent security review of the upload screen, and the five minute volunteer test (CAT-15). Found and fixed during testing: thumbnails would not have been served, because the file name check did not allow the `t-` prefix.

## EC-04 status (11 October 2026)

Built: publishing and the design lifecycle. A publisher can publish a ready draft, hold a design back, put it back, archive it (not the original twelve), restore it, start a new version of a published design, and tell new cards to use an earlier published version. Every action first shows what it will do and asks for confirmation, and is audited with before and after. Safeguards: publishing needs the picture, a full description, the rights confirmation and the human check of wording and year (CAT-04: no software detection is claimed); the person must have seen the current revision (CAT-11); a published version can never be edited, so replacing artwork always makes a new version; the publisher role is checked inside each action by user id, not just on the screen, so a forged request is refused (CAT-06, OCA-08). Published pictures are copied to a public, hash named, immutable file; a card sent now is tied to the version published at that moment, keeps its own copy of the picture, and its description and title come from that version (FR-170, FR-183). New designs appear in the gallery, hero and start routes only while published; held back, draft and archived designs never do.

Decision ED-01 (who publishes): the safe default from the pack is applied. Only restricted administrators can publish, put back in the gallery, archive, restore or roll back; campaign managers can make drafts, hold designs back and start new versions. The Group can widen this with the setting `library_publish_roles` (for example `campaign,rolesadmin`). No second approver is built.

Tested: `tests/library_lifecycle_test.php` (45 checks) and a manual run in the browser pane: upload, publish through the confirmation page, the gallery thumbnail served with a one year immutable cache, hold back removing it from the gallery. Not done: keyboard and screen reader testing, an independent security review, per campaign ordering and featuring (FR-171), and the five minute volunteer test.

## EC-05 status (11 October 2026)

Built: one function, `gallery_cards()`, is the only list the gallery, the home page picture and the start route use, so a draft, held back or archived design cannot be reached from any of them (FR-171, FR-177, OCA-01). A publisher can feature a design (the home page picture then comes only from featured designs that senders can choose, and falls back to all available designs if the featured one is held back). Managers can move published designs earlier or later in the library; the library and the older design screen share one ordering function, and the stored campaign order is kept in step. A saved draft whose design is later held back is no longer thrown away: compose shows "no longer available, pick another" with the message and recipients kept, and review sends the sender back to compose; a direct link to an unavailable design goes to the gallery with a message. Checked over real HTTP with a held back design and a saved draft, and by `tests/library_gallery_test.php` (18 checks).

Not done: the campaign closed and locked wording on the gallery is unchanged (sending is blocked at review, preparation stays open), and there is still one campaign, so "campaign aware" is the single Christmas campaign until EC-06.
