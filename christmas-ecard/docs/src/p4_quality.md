## 9 Quality, security, operations and branding

Retain all original launch expectations: HTTPS, protected passwords, secure sessions, CSRF protection, input validation, abuse and rate limits, administrator MFA, minimum personal data, protected private links, agreed retention and deletion, appropriate tracking and a WCAG 2.2 AA accessibility target (keyboard and screen reader navigation, contrast, reduced motion).

Use idempotent payment and sending operations, verified callbacks, recoverable queues and safe retries. Monitor cron health, payment exceptions, email failures and incidents with actionable alerts. Maintain encrypted off site backups and demonstrate restoration in staging.

Recipient opt out controls, cancellation races, finance exports and private message access must be included in the security and operational review. Suppression must continue to work during retries, recovery and campaign reuse.

### 9.1 Hosting and database (amended by version 2.2, recorded against D-09)

The pilot uses SQLite. PHP 8.2 or later with the pdo_sqlite and curl extensions is required, with cPanel cron and the application code and database file outside the public web root. The data folder must be writable. Backups follow FR-162. A move to MySQL or MariaDB later needs the table definitions and the SQLite specific statements (`insert or ignore`, `on conflict`, `vacuum into`) changed and a tested migration. Version 1.0 to 2.0 said MySQL or MariaDB; this departure is for the technical lead and Trustees to confirm under D-09.

### 9.2 Scout branding and presentation (replaces the purple palette of version 2.0)

Use the Group's blue scheme and the approved circular 7th Swindon logo, with Nunito Sans served from the application's own files. The local design reference is https://www.7thswindon.org.uk/branding.html; national guidance and any conflict follow the official Scouts source. The palette was taken from the Group's 7thPortal theme. The purple tokens listed in version 2.0 (Purple #6D28D9, Purple dark #4C1D95, Navy #1B1533) are withdrawn; Green, Yellow and Warm are unchanged. Contrast ratios were computed on 10 October 2026 against WCAG 2.2 (4.5 to 1 for normal text, 3 to 1 for large text and controls) and still need confirming with a contrast checking tool.

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
| Muted text | #5c6470 | Hints and small print |
| Border | #d9e1ee | Panels, tables, outlines |
| Error | #b3261e | Errors, always with words as well as colour |
| Typeface | Nunito Sans | All text; self hosted with system sans serif fallback |

| Pairing | Ratio | Result |
|---|---|---|
| Text on warm page background | 14.20 | Pass |
| Logo blue on warm (links) | 8.40 | Pass |
| White on logo blue | 9.23 | Pass |
| Deep navy on yellow (primary buttons) | 9.25 | Pass |
| Yellow on logo blue (hero label, active navigation) | 5.16 | Pass |
| Yellow on deep navy | 9.25 | Pass |
| Muted text on warm | 5.44 | Pass |
| Light footer text #e8e4f5 on deep navy | 13.28 | Pass |
| Error on white | 6.54 | Pass |
| Green on white, or white on green | 3.43 | Fails for text; decoration only |
| Deep navy on green | 4.82 | Passes, avoid mixing |
| Yellow focus ring on white alone | 1.79 | Fails; a deep navy outer ring (16.55) is always added |

The focus indicator is a yellow ring with a deep navy outer ring so it is visible on light and dark backgrounds. Do not use green text, white text on green, yellow text or lines as the only cue on white, or colour alone to show status or errors. Use friendly conversational wording consistent with the Group website.

| ID | Requirement | Priority |
|---|---|---|
| FR-096 (amended) | Apply the blue scheme and Nunito Sans across sender, recipient and administration screens, with accessible font fallbacks. Do not use green as a text colour. | Must |
| FR-097 (amended) | Use the approved circular logo unaltered: on the top bar, in the page footer and in recipient emails. Give it meaningful alternative text. Preserve proportions; do not recolour, redraw or stretch it or combine it with decorations. | Must |
| FR-098 (amended) | Apply the scheme to recipient, test and system emails: blue header with the logo and a yellow rule, a yellow primary button with deep navy text, a plain text alternative, readable font fallbacks, and the report, stop and privacy routes. The logo image address comes from the configured site address. Keep the private recipient, opt out and donation privacy controls. | Must |
| FR-099 (amended) | Treat colours as controlled design tokens. Administrators cannot introduce arbitrary markup, logos or colour pairings that fail the contrast figures. Changes are previewed and audited. | Must |

## 10 Delivery clarifications FR-124 to FR-130

These close gaps in already scoped delivery, payment, account and operations features. They do not authorise a new payment provider, new admin powers or deferred enhancements.

| ID | Requirement | Priority |
|---|---|---|
| FR-124 | Correct an address only through an authorised delivery recovery flow. Record the original and corrected destination securely, create a fresh recipient token, and revoke the superseded token on accepted correction. Recheck ownership, address validity, duplicate rules and suppression. For uncertain earlier delivery, require an explicit warned and audited resend decision; do not treat uncertainty as proven failure. Prevent correction and resend races from creating duplicate attempts. | Must |
| FR-125 | Maintain pending payment as a distinct unresolved outcome. Use a configured reconciliation and escalation policy with a named finance owner. Resolve through verified provider evidence and audited transitions. An elapsed timeout alone cannot declare a payment failed or authorise another charge; unknown outcomes retain recovery information and a support reference. | Must |
| FR-126 | Define bounded retry and escalation policies for transient failure, permanent rejection, complaint and unknown delivery, including maximum attempts and elapsed time. Recheck suppression and pause controls on every eligible attempt. Do not automatically retry permanent rejections or complaints. Unknown provider acceptance requires reconciliation before a repeat that could duplicate an email. | Must |
| FR-127 | Provide an authenticated account deletion request and explicit impact confirmation covering contacts and groups, drafts, queued deliveries, live card links and retained finance, audit and suppression categories. Reauthenticate for confirmation, revoke account sessions and prevent further submission when deletion begins. Explain processing status and retained categories; follow the approved category specific retention policy rather than deleting required operational records indiscriminately. | Must |
| FR-128 | Document the event qualification used for Viewed, including known scanner handling, script and media limitations and uncertain cases. Store source evidence separately from delivery. If evidence cannot support a qualifying view, show unconfirmed viewing rather than asserting a human read. No new fingerprinting or unrelated tracking is implied. | Must |
| FR-129 | Define the launch refund route, authorised role and approval conditions before finance implementation. Distinguish requested, pending, confirmed and failed refunds from card cancellation. Reconcile partial refunds and repeated or out of order provider events without duplicate financial actions. If execution remains in the provider console, document that hand off and import and reconcile its verified outcome. | Must |
| FR-130 | Implement timestamped operational alerts with accountable recipients, severity, acknowledgement and escalation rules for stalled queues, unresolved payments, failed scheduled jobs and backup failures. Do not label missing evidence healthy. A health dashboard does not replace an agreed monitored response process. | Must |

