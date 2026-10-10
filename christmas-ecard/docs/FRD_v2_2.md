# 7th Swindon Scouts Christmas E Card Functional Requirements

Version 2.2 | 10 October 2026 | Draft for Trustee and development review

This version brings the requirements up to date with the decisions taken and the application built since version 2.0. It is a consolidating update. Everything in version 2.0 continues to apply unless this document says otherwise, and the additions in `FRD_v2_1_additions.md` (FR-131 to FR-145, AC-86 to AC-105, decisions D-11 to D-16) and `FRD_palette_update.md` are incorporated here.

Section 3 records decisions and replacement wording. Section 4 adds four small requirements. Section 5 gives the build status of every requirement, with test references, so the Trustees and testers can see what exists. Section 6 lists what is still needed before launch. Trustee approval remains pending, and no policy value in this document has been approved.

## 1 Summary of changes since version 2.0

| Area | Change |
|---|---|
| Colour and logo | Blue (navy) scheme and the circular 7th Swindon logo adopted. Purple tokens in version 2.0 section 9.1 are withdrawn. |
| Designs | Twelve illustrated cards supplied by the Group replace the ten placeholder designs. The earlier drawn designs remain available but are switched off by default. |
| Hosting | SQLite accepted as the database for the pilot, instead of MySQL or MariaDB. |
| Gift Aid | Included in launch scope, switched off until decision D-12 is approved. |
| Launch requirements | Privacy and terms pages, 18 or over confirmation, sender suspension, alert emails, launch readiness register and row based recipient entry added (FR-131 to FR-137, FR-145). |
| Shoulds built | Email preview, campaign measures, rehearsal sends, printable card and yearly reminder (FR-136, FR-138, FR-139, FR-143, FR-144). |
| Presentation | Redesigned screens: home page with random hero card, how it works and cause panel, envelope reveal, card style My cards list, mobile layouts. |
| Not built | Recipient donations (FR-140) and Christmas Day delivery (FR-142), which wait for decisions D-11 and D-13. |

## 2 Scope update

Section 2 of version 2.0 is amended as follows.

Launch includes 7th Swindon Scouts as the only beneficiary; the approved illustrated designs; personalisation; one to twenty recipients per card; registration, verification, drafts and test cards; a private sender address book and groups; optional donations and receipts; optional Gift Aid once approved; delivery and viewing status; sender history; administration, complaints and recovery.

Gift Aid moves from deferred to included, subject to D-12. Recipient donations and Christmas Day delivery remain conditional on D-11 and D-13. Scheduled delivery with free date choice, private link sharing, keepsake downloads other than the printable card, collaborative cards, bulk contact import and additional Groups remain outside launch scope.

## 3 Decisions and replacement wording

### 3.1 Hosting and database (replaces the database statement in section 9)

The pilot uses SQLite. PHP 8.2 or later with the pdo_sqlite and curl extensions is required. The database file and application code sit outside the public web root, and the data folder must be writable. A nightly snapshot is made with the backup command and must be copied off the server. A move to MySQL or MariaDB later needs the table definitions and two SQL statements changed. This departs from the version 2.0 hosting statement and is recorded against D-09 for the technical lead and Trustees to confirm.

### 3.2 Designs (replaces FR-007)

| ID | Requirement | Priority |
|---|---|---|
| FR-007 | Provide the approved illustrated designs supplied by the Group, currently twelve, each with the greeting painted into the picture. Each has a name, a written description that includes the printed words, and a thumbnail cropped to the headline. A design whose artwork is not yet fit for use (for example, shows an out of date year) can be held back and stays off until the picture is replaced and a campaign manager enables it. | Must |

Currently held back: "Woggle all the way", because the picture says "S'more adventures in 2025". Drawn designs built earlier are kept as optional extras, switched off by default.

FR-009 is unchanged: campaign managers can enable, disable and reorder designs and edit their descriptions.

### 3.3 Branding (replaces section 9.1 and FR-096 to FR-099)

Use the Group's blue scheme and the approved circular 7th Swindon logo, with Nunito Sans served from the application's own files. Contrast figures were computed on 10 October 2026 against the WCAG 2.2 targets (4.5 to 1 for normal text, 3 to 1 for large text and controls) and need confirming with a contrast checking tool before launch.

| Token | Value | Use |
|---|---|---|
| Logo blue | #024593 | Top bar, links, secondary buttons, step indicator, hero, email header |
| Dark blue | #013163 | Hover states, hero gradient |
| Deep navy | #041f3d | Text on yellow, footer, focus ring outer edge |
| Blue | #2a5fb0 | Supporting accents |
| Yellow | #f5b800 | Primary buttons with deep navy text, top bar rule, active navigation on blue |
| Green | #0f9d78 | Decoration only. Never for text or for white text on green (3.43 to 1) |
| Warm | #f6f4f0 | Page background |
| Text | #1c2431 | Body text |
| Muted text | #5c6470 | Hints and small print (5.44 to 1 on the page background) |
| Border | #d9e1ee | Panels, tables, outlines |
| Error | #b3261e | Errors, always with words as well as colour |

| Pairing | Ratio |
|---|---|
| Text on page background | 14.20 |
| Logo blue on page background | 8.40 |
| White on logo blue | 9.23 |
| Deep navy on yellow | 9.25 |
| Yellow on logo blue | 5.16 |
| Yellow focus ring on white alone | 1.79 (fails; a deep navy outer ring, 16.55, is always added) |

| ID | Requirement | Priority |
|---|---|---|
| FR-096 | Apply the blue scheme and Nunito Sans across sender, recipient and administration screens, with accessible font fallbacks. Do not use green as a text colour. | Must |
| FR-097 | Use the approved circular logo unaltered: on the top bar, in the page footer and in recipient emails. Give it meaningful alternative text. | Must |
| FR-098 | Apply the scheme to recipient, test and system emails: blue header with the logo and a yellow rule, a yellow primary button with deep navy text, a plain text alternative, and the report, stop and privacy routes. The logo image address comes from the configured site address. | Must |
| FR-099 | Treat colours as controlled design tokens. Administrators cannot introduce arbitrary markup, logos or colour pairings that fail the contrast figures. Changes are previewed and audited. | Must |

AC-58 to AC-61 apply with "the blue scheme" in place of the purple tokens, and AC-61 requires every text and control pairing to meet its stated ratio.

### 3.4 Gift Aid (supplements FR-141)

Gift Aid is offered only when all three of these are true: decision D-12 is recorded as approved with a reference; the charity name as HMRC knows it is set; and the switch in Campaign settings is on. Saving the switch is refused until D-12 is approved.

When on, a donor who ticks Gift Aid at review gives their name, home address (house name or number and a valid UK postcode), and confirms HMRC's model declaration naming the charity. The wording shown is stored with the declaration. The declaration stays pending until payment is verified, is removed if the donor chooses to send for free, and is never duplicated by repeated payment callbacks.

Finance users see claimable declarations, which exclude withdrawn and already claimed ones and use the amount after refunds. They can download a claim schedule in the HMRC column layout (title, first name, last name, house name or number, postcode, aggregated donations, sponsored event, donation date, amount), then mark the rows as claimed with a reference. Exports and withdrawals are audited. Donor details are separate from card data and visible to finance users only. The Treasurer must confirm the Group's eligibility to claim, approve the wording, and confirm how long declarations are kept.

### 3.5 Other decisions recorded

Hero card: the home page hero shows a random enabled design on each visit. Launch lock: in production the campaign stays locked while a required decision is open, unless a restricted administrator records an override with a reason. Drafts: anonymous drafts are removed after seven days.

## 4 New requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-146 | Illustrated card handling. Each illustrated design is an image file named after its design. The page shows it in full on the card, crops thumbnails to the top so the headline stays visible, loads thumbnails lazily, and does not repeat the title and joke already painted into the picture. The alternative text carries the printed words and a description of the scene. | Must |
| FR-147 | Home page hero. Show one randomly chosen enabled design on each visit. A disabled or held back design is never chosen. If no design is enabled, omit the picture. | Should |
| FR-148 | Held back designs. A design can be held back in the code until its artwork is corrected, and enabled by a campaign manager afterwards. Held back and disabled designs cannot be started from a direct link. Cards already sent with a design still display. | Must |
| FR-149 | Unique art identifiers. Several copies of the same drawn design on one page must not share an identifier, so a hidden copy cannot blank a visible one. | Must |

AC-106: The gallery shows only enabled designs; a held back design and its direct link are unavailable; the hero never shows a disabled design. AC-107: Every illustrated design has alternative text containing its printed words. AC-108: Thumbnails keep the headline in view on desktop and phone, and the full card shows the whole picture. AC-109: Replacing a design's image file changes it everywhere without code changes.

## 5 Build status and test evidence

Status key: Built means working in the application and covered by the tests named. Partly means some of the requirement exists. Not built means no code. Decision means built or blocked by a pending decision. Automated tests run on 10 October 2026: smoke 52, contacts 14, admin 29, operations 33, Gift Aid 23; all pass. No requirement has been through user acceptance testing, an assistive technology audit, a security review or a staging run.

| Requirements | Status | Notes and tests |
|---|---|---|
| FR-001 to FR-004 | Built | Register, verify, sign in and out, password reset. |
| FR-005 | Partly | Card history, preferences and account deletion exist. There is no profile editing page. |
| FR-006 to FR-009 | Built | See 3.2. Tested in the admin tests. |
| FR-010 to FR-016 | Built | Message, From name, 20 recipient limit on the server, validation, preview, drafts, test email. |
| FR-017 to FR-023 | Built | Optional donation, free sending, suggested and custom amounts, Stripe Checkout (or simulated), beneficiary header, receipt, manual fee and refund entry. |
| FR-024 to FR-030 | Built | Individual emails, private links, delivery states, failures, correction and resend, queue health. Smoke tests. |
| FR-031 to FR-037 | Built | Opening without an account, envelope with reduced motion, reopening, viewing recorded separately, invitation, reporting. |
| FR-038 to FR-045 | Built | Payment recovery, opt-outs, duplicates, cancellation, unavailable cards, FAQ and support reference. The monitored support contact is an operational matter. |
| FR-046 to FR-057 | Built | Campaign dates, closure, finance export, roles, audit, beneficiary wording, progress, draft preservation, review, status model, limits. |
| FR-058 to FR-067 | Built | Overrides, copy card, branded email, donation privacy, campaign link and QR (QR image comes from a third party service), send a card back, greeting examples, optional status emails, safe text, immediate reveal. Operations tests. |
| FR-068 to FR-076 | Not built | Conditional enhancements. Printable card (FR-143) covers part of FR-074. FR-076 is partly covered by design ordering, descriptions and enabling in FR-083. |
| FR-077 to FR-080 | Built | One submission intent, contextual sign in, recovery views, role task views with empty states and confirmations. |
| FR-081 to FR-083 | Built | Separate admin pages, campaign settings, design management. |
| FR-084, FR-085 | Partly | Limits and test send rate are editable. Email subject lines, branding assets and help content are not editable; they can be previewed and a test sent to the administrator. |
| FR-086, FR-089 to FR-094 | Built | Expiry and retention with impact review, health evidence, secrets kept out of the interface, old and new review, audit, concurrent edit detection, prospective and immediate changes. Audit export is not built. |
| FR-087 | Partly | Beneficiary shown masked. No change workflow. |
| FR-088 | Partly | Roles can be given to registered, verified users with MFA status shown. There is no email invitation. |
| FR-095 | Not built | Restoring a previous configuration (Should). |
| FR-096 to FR-099 | Built | See 3.3. |
| FR-100 to FR-116 | Built | Address book and groups. Contacts tests. |
| FR-117 to FR-123 | Partly | Admin pages, role limited menus, stacked layouts, 44 pixel targets and non drag ordering exist. No assistive technology audit has been run. |
| FR-124, FR-126 | Built | Fresh private link on correction, bounded retries, no automatic repeat after unknown or permanent failure. Operations tests. |
| FR-125 | Partly | Pending payments are flagged at 15 minutes and 24 hours and never declared failed by time alone. Resolution is by checking or cancelling the attempt. |
| FR-127, FR-128 | Built | Account deletion with password check; view recorded only by a deliberate open, link scanners excluded. |
| FR-129 | Partly | Refund status and amounts are recorded by hand. No import from the payment provider. |
| FR-130 | Built | Alert emails, acknowledgement, escalation, daily summary. Recipients set in Application settings. |
| FR-131 to FR-135 | Built | Privacy and terms pages (draft wording), age and terms acceptance, sender suspension, alerts, launch readiness. Operations tests. |
| FR-136 to FR-139 | Built | Rehearsal, row entry, email preview, campaign measures. |
| FR-140 | Decision | Recipient donation (D-11). Not built. |
| FR-141 | Decision | Built and off until D-12 is approved. Gift Aid tests. |
| FR-142 | Decision | Christmas Day delivery (D-13). Not built. |
| FR-143, FR-144 | Built | Printable card, yearly reminder. |
| FR-145 | Partly | Written descriptions for every design are done. The assistive technology tests in `docs/AT_test_plan.md` have not been run. |
| FR-146 to FR-149 | Built | Section 4. Admin tests. |

## 6 Needed before launch

Trustee decisions, each needing an owner, approved value, date and reference in Admin under Launch readiness: D-01 to D-10 from version 2.0; D-11 to D-13 (recipient donations, Gift Aid, Christmas Day delivery); D-14 wording and ownership of the privacy notice, terms and safeguarding statement; D-15 alert recipients and escalation; D-16 measures and the small number threshold. In production 13 of these are required before the campaign opens, unless overridden.

Content and evidence: a corrected "Woggle all the way" picture; final approved wording for the privacy notice, terms, safeguarding statement and Gift Aid declaration; confirmation of the charity name and eligibility for Gift Aid; the Treasurer's retention periods for finance records and Gift Aid declarations; confirmation of colours against the official Scouts guidance and with a contrast tool.

Testing and operations: the assistive technology tests; structured Trustee testing using the rehearsal tool; a security and privacy review; a load test; staging on cPanel with HTTPS, cron jobs, Postmark domain authentication and Stripe in test mode; backups copied off the server with a restore rehearsal; a named support contact and hours.

## 7 Change record

Version 2.2 consolidates versions 2.0 and 2.1 and the palette update; records the decisions on colour, logo, designs, hosting and Gift Aid; amends FR-007 and FR-096 to FR-099; adds FR-146 to FR-149 and AC-106 to AC-109; and adds the build status in section 5. It does not change any other requirement.
