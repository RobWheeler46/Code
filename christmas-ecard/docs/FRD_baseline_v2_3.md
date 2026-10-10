# 7th Swindon Scouts Christmas E Card: Consolidated Functional Requirements Baseline

Baseline v2.3 | 10 October 2026 | Draft for Trustee and development review

This is the single requirements document for the Christmas e-card application. It merges, in order, the original simplified FRD (version 1.0), versions 1.1, 1.2 and 1.3, version 2.0 (which already folded in 1.4 to 1.9), the version 2.1 additions, the blue palette update, version 2.2, and the v2.3 launch-critical proposals together with their build status. Where a later document changed an earlier requirement, only the latest wording appears here, marked "(amended)". Nothing in the earlier documents has been dropped unless the change record at the end says so.

Trustee approval is still pending. No policy value, proposed default or draft legal wording in this document has been approved.

Source documents merged: `7th_Swindon_Scouts_Christmas_ECard_Simplified_FRD_Branded.pdf` (1.0), `Scout_ECard_FRD_v1_1.md`, `v1_2.md`, `v1_3.md`, `Scout_ECard_FRD_v2_0_Branded.pdf`, `docs/FRD_v2_1_additions.md`, `docs/FRD_palette_update.md`, `docs/FRD_v2_2.md`, `docs/SPEC_v2_3_status.md`, and the Unified Development Spec v2.3 for the R1 proposals. `Scout_ECard_User_Journey_Review.md` is a companion review, not a requirements source, and is not merged. `docs/AT_test_plan.md` stays separate as a test plan and is referenced by FR-145.

## Contents

1. Purpose and objectives
2. Scope and users (amended)
3. Core business rules
4. Requirements FR-001 to FR-037
5. Added launch requirements FR-038 to FR-067
6. Status meanings and recovery
7. User journeys, screens and journey requirements FR-077 to FR-080
8. Dashboards, permissions, address book, groups and administration (FR-081 to FR-123)
9. Quality, security, operations and branding (FR-096 to FR-099 amended)
10. Delivery clarifications FR-124 to FR-130
11. Launch protection and sender experience FR-131 to FR-139, decision dependent FR-140 to FR-145
12. Illustrated cards FR-146 to FR-149 and v2.3 resilience FR-150 to FR-164
13. Acceptance scenarios AC-01 to AC-109
14. Roadmap and conditional requirements FR-068 to FR-076
15. Decisions D-01 to D-16, proposed defaults and gates
16. Build status
17. Needed before launch
18. Approval and change record

## 1 Purpose and objectives

Allow supporters to choose a Scout-themed Christmas card, personalise a greeting and email it to friends and family. Sending is free. A supporter may optionally donate to 7th Swindon Scouts.

Recipients can view a private greeting without creating an account. Volunteers can monitor delivery, resolve problems and reconcile donations.

The pilot should work on mobile and desktop, be accessible, keep recipient information private and minimise volunteer intervention.

Objectives (from version 1.0): make personalised card sending simple on mobile and desktop; offer humorous Scout themed designs (ten originally, twelve illustrated designs now, see FR-007); raise optional donations directly for 7th Swindon Scouts; make delivery and viewed status understandable and trustworthy; give volunteers practical reporting, monitoring and abuse handling tools; and preserve a path to supporting other Scout Groups in future releases.

## 2 Scope and users (amended)

Launch includes 7th Swindon Scouts as the only beneficiary; the approved illustrated designs; personalisation; one to twenty recipients per session; registration and verification; drafts and test cards; a private sender address book and groups; optional donations and receipts; optional Gift Aid once approved (D-12); delivery and viewing status; sender history; administration, complaints and recovery.

Remaining outside launch scope: scheduled delivery with free date choice, bulk contact import, device contact integration, WhatsApp or SMS delivery, AI generated messages, user uploads, corporate campaigns, advanced analytics, private link sharing, keepsake downloads other than the printable card, collaborative cards and additional Groups. Recipient donations (FR-140) and Christmas Day delivery (FR-142) depend on decisions D-11 and D-13.

| User | Permitted experience |
|---|---|
| Visitor | Browse cards and understand the campaign; must register before sending. |
| Registered sender | Create, test, send and track cards; view donation history; keep a private address book and groups. |
| Recipient | Open and view a card without an account; report an unwanted card; stop further cards. |
| Administrator | Individual authorised accounts with multifactor authentication; role limited tools for campaign operations, finance, delivery support, complaints and access. |

## 3 Core business rules

1. Email verification is required before sending. Preparing and previewing a card does not require verification.
2. A session contains one to twenty recipients. Each receives a separately addressed email and a unique private link.
3. Sending is always free. One optional donation may cover the session.
4. Only verified payment confirmations count as money received. Payments go to the verified 7th Swindon beneficiary.
5. A session with a donation waits for verified payment completion or an explicit choice to send for free. A later payment confirmation must never dispatch the session again.
6. Payment and dispatch operations must prevent duplicate charges and duplicate sends.
7. Delivery, email opening and card viewing are different events. Automated scanning must not be counted as a confirmed human view.
8. Card links, messages and recipient information are private. Expiry, retention and deletion periods must be agreed before launch.
9. Recipient opt-outs are enforced at dispatch, including queued cards and resends.
10. Cancellation is available until an individual delivery has been claimed for dispatch. Sent email cannot be recalled. Administrators can revoke access to a card when justified.
11. Campaign closure stops new submissions. Previously accepted work and existing viewing links follow explicitly configured closure and expiry rules.

## 4 Requirements FR-001 to FR-037

The original requirement IDs are retained. All are Must unless marked Should.

| ID | Requirement | Priority |
|---|---|---|
| FR-001 | Register with name, email and password. | Must |
| FR-002 | Verify the sender email before dispatch. | Must |
| FR-003 | Provide secure sign-in and sign-out. | Must |
| FR-004 | Provide time-limited password reset links. | Must |
| FR-005 | Provide profile and card history access. | Must |
| FR-006 | Provide a Christmas card gallery. | Must |
| FR-007 (amended) | Provide the approved illustrated designs supplied by the Group, currently twelve, each with the greeting painted into the picture. Each has a name, a written description that includes the printed words, and a thumbnail cropped to the headline. A design whose artwork is not yet fit for use (for example, shows an out of date year) can be held back and stays off until the picture is replaced and a campaign manager enables it. Version 1.0 to 2.0 required ten designs; the earlier drawn designs remain available but off by default. | Must |
| FR-008 | Allow design selection and preview. | Must |
| FR-009 (amended) | Allow authorised campaign managers to enable, disable and reorder approved designs and edit their descriptions, as detailed in FR-083. | Must |
| FR-010 | Allow a personalised Christmas message. | Must |
| FR-011 | Allow an editable sender or family display name. | Must |
| FR-012 | Enforce a maximum of twenty recipients on the server. | Must |
| FR-013 | Collect and validate recipient names and email addresses. | Must |
| FR-014 | Show a full preview before sending. | Must |
| FR-015 | Save and resume unfinished drafts. | Must |
| FR-016 | Allow verified senders to email themselves a test card. | Must |
| FR-017 | Offer an optional donation during sending. | Must |
| FR-018 | Allow sending without payment. | Must |
| FR-019 | Offer suggested and custom donation amounts. | Must |
| FR-020 | Process donations through a secure payment provider. | Must |
| FR-021 | Attribute donations to the verified 7th Swindon beneficiary account. | Must |
| FR-022 | Issue confirmation and a receipt after verified payment. | Must |
| FR-023 | Allow administrators to review donations, fees and refunds and reconcile payments. | Must |
| FR-024 | Generate an individually addressed email for each recipient. | Must |
| FR-025 | Include a secure personalised viewing link in each email. | Must |
| FR-026 | Use unique non-guessable links. | Must |
| FR-027 | Record dispatch and provider delivery states. | Must |
| FR-028 | Surface failed and uncertain deliveries for review. | Must |
| FR-029 | Allow correction of failed addresses and controlled resends. | Must |
| FR-030 | Provide delivery monitoring and queue health. | Must |
| FR-031 | Allow recipients to open cards without registration. | Must |
| FR-032 | Show artwork, recipient name, message and sender name. | Must |
| FR-033 | Provide an animated envelope reveal and reduced-motion alternatives. | Must |
| FR-034 | Allow reopening while the link remains valid. | Must |
| FR-035 | Record genuine card viewing separately from email opening. | Must |
| FR-036 | Invite recipients to create a card, subject to registration. | Should |
| FR-037 | Allow unwanted or inappropriate cards to be reported. | Must |

## 5 Added launch requirements FR-038 to FR-067

| ID | Requirement | Priority |
|---|---|---|
| FR-038 | After a failed donation, offer retry or sending without a donation. Preserve the card and recipients. Prevent late payment events from triggering another send. | Must |
| FR-039 | For uncertain or pending payments, explain the status and avoid inviting another charge until the original attempt has been resolved or safely cancelled. | Must |
| FR-040 | Let recipients stop further cards from a sender or from the service. Offer this from the email and card view without account registration. Use a protected confirmation flow and avoid disclosing whether an address has opted out. | Must |
| FR-041 | Check opt-outs before initial dispatch, retry and resend. Keep only the minimum suppression information needed to honour the preference under an agreed retention policy. | Must |
| FR-042 | Identify repeated email addresses within a session and prevent accidental duplicates. Warn about a matching card already sent in the campaign; allow a deliberate repeat where permitted. | Must |
| FR-043 | Allow cancellation of queued recipient deliveries until claimed for dispatch. Show which deliveries were cancelled and which had already progressed. Cancelling a card does not automatically refund a donation. | Must |
| FR-044 | Show helpful expired and withdrawn card screens with a support route. Do not reveal the private message or recipient details. | Must |
| FR-045 | Provide an FAQ and monitored support contact for verification, missing emails, spam folders, correction, donation queries and unwanted cards. Show a support reference that exposes no private viewing token. | Must |
| FR-046 | Allow administrators to set campaign opening and closing dates using Europe/London time and define the behaviour of accepted queues at closure. Explain availability and card expiry publicly. | Must |
| FR-047 | Permit existing cards to remain viewable after campaign closure until their agreed expiry, unless withdrawn. Keep campaign closure separate from an emergency dispatch pause. | Must |
| FR-048 | Export date-filtered finance records to CSV with campaign, transaction reference, date, currency, gross donation, fees, refunds, net proceeds and payment status. Donor identity is included only for authorised finance users where needed. Protect against spreadsheet formula injection. | Must |
| FR-049 | Provide separate finance, delivery support and campaign management permissions, with a named administrator authorised to assign roles. Check permissions on the server. | Must |
| FR-050 | Limit access to private messages to authorised complaint investigation. Require a reason and audit access, role changes, exports, refunds, resends, withdrawals and campaign changes. | Must |
| FR-051 | Identify 7th Swindon Scouts as beneficiary and explain the approved purpose of donations. Make free sending equally clear. | Must |
| FR-052 | Optionally display an approved fundraising target and confirmed donation progress. Define whether the amount is gross or net of fees and refunds, and label it consistently. Do not publish donor names by default. | Should |
| FR-053 | Preserve the current design, greeting and recipient list through registration, verification, sign-in and payment recovery. After verification, return the user to the saved draft. | Must |
| FR-054 | Provide clear review and confirmation screens showing recipient count, card preview, donation choice and next action. Confirm acceptance into the queue without implying delivery. | Must |
| FR-055 | Use inline errors, retain valid input and focus the first invalid field accessibly. Warn before leaving unsaved work; make draft saving visible. | Must |
| FR-056 | Define card and donation status separately. Provide Queued, Sent, Delivered, Viewed, Failed, Delivery unconfirmed and Cancelled where supported by evidence. | Must |
| FR-057 | Provide visible greeting and sender-name length limits, a live character count and server-side validation. Handle special characters safely and warn before submission when content exceeds the agreed limits. | Must |


### Research informed launch additions

These requirements adapt documented patterns from other platforms to the Scout pilot. Must is required for launch; Should may be deferred if it threatens launch readiness. Existing FR-001 to FR-057 continue to apply.

| ID | Requirement | Priority |
|---|---|---|
| FR-058 | Provide one shared greeting with an optional individual override per recipient. Preview the resolved greeting for each recipient, identify overrides and require confirmation before overwriting them with a shared edit. Include overrides in drafts and dispatch snapshots. | Should |
| FR-059 | Allow a previous card to be copied into a new draft. Copy design, greeting and sender display name; recipient reuse requires explicit selection. Never copy payment references, dispatch IDs, viewing tokens or statuses, and never dispatch automatically. | Should |
| FR-060 | Use approved 7th Swindon branding and the sender or family display name in recipient emails. Include a recognisable subject, a plain-text alternative, a clear viewing action and report and opt-out routes. Never spoof the sender's email or expose other recipients. | Must |
| FR-061 | Keep donation amount, financial identifiers and donor identity private in recipient greetings. Any optional donation statement must require sender choice and verified payment, identify the beneficiary accurately and never imply that a free sender donated. Receipt details stay in the sender's private history and email. | Must |
| FR-062 | Provide a public campaign link and downloadable QR code for newsletters, posters and social promotion. The destination opens the campaign or gallery and contains no personal greeting, recipient information or private token. Optional referral labels identify a promotion source rather than a person. | Should |
| FR-063 | After card viewing, offer Create your own card and, where appropriate, Send a card back. Reuse only the approved sender display name; the user supplies the destination address. Preserve the new draft through verification and do not disclose the original sender's account email. | Should |
| FR-064 | Offer a small collection of editable, approved Christmas greeting starters, including family-friendly and Scout-themed wording. Clearly indicate examples; do not send or replace existing text without the user's action. This does not introduce AI generation. | Should |
| FR-065 | Allow senders to choose optional sent and viewed notifications or a summary. Default optional status mail off; deduplicate notifications and qualify viewing evidence. Essential verification, security, payment receipts and recovery messages remain separate. No automatic nudges to unviewed recipients. | Should |
| FR-066 | Treat greeting text as escaped plain text. Do not allow HTML or automatically turn sender-supplied URLs into clickable links. Apply configurable abuse rules, give a clear validation message and retain the draft when content is rejected. Approved application actions remain functional. | Must |
| FR-067 | Allow recipients to reveal the greeting immediately and replay approved animations. Do not autoplay sound. Ensure artwork and text remain readable when motion is reduced, media fails or scripts are limited. Preserve keyboard and screen-reader operation. | Must |

Research traceability: FR-058 adapts DontSendMeACard personalisation; FR-060 adapts Paperless Post's recipient-email design; FR-062 adapts charity campaign sharing; FR-063 strengthens the existing recipient invitation; FR-064 is a simpler Scout alternative to commercial writing tools; FR-065 adapts Jacquie Lawson notification preferences; FR-066 adapts the abuse-control principle documented by Blue Mountain. FR-059, FR-061 and FR-067 include Scout-specific privacy and usability decisions. Detailed source references and evidence limitations are in the companion research report.

The precise message limits, campaign dates, card expiry, support ownership and retention periods are launch configuration decisions. They require recorded agreement, not guessed defaults.


## 6 Status meanings and recovery

| Card status | Meaning shown to the sender |
|---|---|
| Queued | Accepted and waiting for dispatch. |
| Sent | Accepted by the email provider; inbox placement is not confirmed. |
| Delivered | Provider delivery confirmation received; this does not prove the card was read. |
| Viewed | A qualifying card-view event occurred. Do not claim certainty beyond available evidence. |
| Failed | A confirmed failure requires correction or permitted retry. |
| Delivery unconfirmed | Delivery confirmation is unavailable or remains unresolved. |
| Cancelled | Dispatch was cancelled before the delivery was claimed. |

Store delivery and viewing evidence separately even if the dashboard shows one simple summary. Donation status must remain independent of card status.

If payment fails, the parent can retry or explicitly proceed for free. If payment is pending, explain it and resolve that attempt before starting another charge. If the parent chooses free dispatch, a later successful payment may update their receipt and donation history but must not enqueue the same cards again.

After submission, emails and greetings are treated as a snapshot. Correcting a failed email creates a controlled new delivery attempt with an audit record. Editing a draft must not silently change already sent cards.

## 7 User journeys, screens and journey requirements

The companion Scout E Card User Journey Review and Revised Wireframes define a proposed interaction design. They derive from this FRD; they are not an audit of deployed screens or a code change.

### Sender flow

Show three preparation stages: Choose a card, Message and recipients, Review and send. Combine message and recipient entry with a responsive preview. Registration or sign-in is a contextual interruption after preparation; existing verified users skip it. Verification returns to the same draft and intended next step.

Final review includes design, From name, resolved greeting for each recipient, edit actions and donation choice. Send cards for free queues one submission without checkout. Donate and send cards creates one submission intent and hands off to the provider. Verified payment completion resolves that same intent and dispatches once; there is no second independent Send action after payment.

A failed or cancelled checkout preserves the card and offers retry or deliberate free sending. An unknown payment outcome shows a pending screen without a second charge or free bypass until the attempt is safely resolved. Confirmation states Queued and presents donation outcome separately.

### Recipient flow

Individually addressed branded email opens an account-free envelope or immediate static greeting. Recipients can read, replay, create their own card, report it or manage future-card preferences. Reporting and opting out are distinct submissions. Expired or withdrawn cards reveal no private greeting content.

### Volunteer flow

Individual administrator sign-in and MFA precede role-limited tools. Delivery operations prioritise actionable failures, unknown delivery and reports. Finance reconciles confirmed records and authorised exports. Campaign management maintains approved dates, purpose, designs and pause controls. Private message inspection requires separate permission and an audited reason.

### Screen inventory (consolidated)

| Screens | Purpose |
|---|---|
| S01 to S03 | Campaign landing, gallery, combined message and recipient editor |
| S04 to S05 | Contextual account and verification steps |
| S06 to S10 | Review, checkout hand-off, failed payment, pending payment and confirmation |
| S11 to S13 | My cards, drafts and failed-address correction |
| S14 | Future scheduling and private sharing; outside pilot launch |
| S15 to S19 | Recipient email, envelope, greeting, unavailable card and report or opt-out |
| S20 to S24 | Operations, finance, queued cancellation, admin MFA and campaign controls |
| S25 to S27 | Private address book, contact editor and recipient picker |
| S28 to S29 | Private group management and group editor |
| S30 to S39 | Administration expansion, see 8.3 |
| S40 | Privacy notice, cookies and terms (public) |
| S41 | Sender suspension and reinstatement (administration) |
| S42 | Launch readiness and decision register (administration) |
| S43 | Recipient rows editor (replaces the entry part of S03) |
| S44 | Recipient email preview (sender) |
| S45 | Campaign measures (administration) |
| S46 | Recipient donation prompt (conditional on D-11) |
| S47 | Gift Aid declaration (conditional on D-12) |
| S48 | Delivery date choice and Scheduled status (conditional on D-13) |

These are screen states, not steps imposed on a parent. Screens may be routes, panels or dialogs. The prototype wireframes held 29 states; with S30 to S39 the planned inventory is 39, and with S40 to S48 it is 48. The older count of fourteen logical capability views is not a constraint on implementation.

### Journey requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-077 | Use one final submission intent for card content, recipients and optional donation. Label free and donation actions explicitly. Verified payment completion must resolve the same intent without a second send action. Preserve existing duplicate-charge and duplicate-dispatch protections. | Must |
| FR-078 | Place authentication contextually after card preparation, while explaining verification before dispatch. Verified users may skip the interruption. Preserve the draft and intended destination across sign-in, verification and recoverable session expiry. | Must |
| FR-079 | Provide explicit queued, failed-payment, pending-payment, failed-address, cancellation-conflict and unavailable-link views. Keep valid input and distinguish confirmed outcomes from unknown ones. Do not treat a cancelled checkout as permission to dispatch free cards. | Must |
| FR-080 | Give each administrative role an actionable task view and appropriate empty state. Keep finance, delivery support and campaign controls separately permissioned. Confirmation of high-impact changes must identify the affected records and retain the audit requirements. | Must |

Launch Should features in the wireframes are optional scope items, not new mandatory controls. Future scheduling and private sharing remain governed by section 11.

## 8 Dashboards, permissions, address book, groups and administration

The sender dashboard provides previous cards, recipients, dates, evidence based status, correction and cancellation actions, drafts and donation history.

The administration control centre provides confirmed gross donations, donor count, average donation, fees, refunds, target configuration, card activity and design popularity, delivery queue health, bounces and failures, uncertain delivery, payment exceptions, transaction lookup, reconciliation, complaints, suppression and campaign pause controls. (Version 1.0 also required: total sent, delivered and viewed; template popularity and basic trends; and abuse handling that prevents further unwanted sends where necessary.)

Finance users access transaction reports and authorised financial actions. Delivery support users resolve queues and address problems without routine financial or message access. Campaign managers maintain approved designs, campaign dates, donation purpose and targets. Privileged role assignment requires a named authorised administrator.

Any refund operation must be separately authorised and reconciled. Card cancellation and withdrawal must not imply a refund.

### 8.1 Private sender address book

The address book is part of launch scope. Core contact management and selecting contacts into a sending session are launch Must features. Bulk import, device contact access, shared household books and automatic contact harvesting remain outside launch scope.

| ID | Requirement | Priority |
|---|---|---|
| FR-100 | Provide a private address book accessible only to its signed in verified owner. Enforce owner isolation on every read, search, edit, selection and deletion request; never expose another sender's contacts through identifiers or autocomplete. | Must |
| FR-101 | Allow the owner to add, edit and delete contacts containing display name and email address. Require a valid name and email and defined field lengths; no telephone number, postal address or date of birth is required. Use the same safe text handling as recipient entry. | Must |
| FR-102 | Search saved contacts by name or email and show clear empty and no match states. Provide manual contact entry and a clear Add contact action. Search only the current owner's saved contacts. | Must |
| FR-103 | Provide Choose from address book within the card editor. Let the owner select multiple contacts, show selected count and remaining capacity, preview the selected names and emails and deliberately add them to the current draft. Enforce the configured one to twenty session limit, including recipients already entered manually. | Must |
| FR-104 | Detect duplicate addresses on saving contacts and on adding them to a draft. Offer review of an existing contact instead of silently overwriting it. Prevent accidental duplicates between saved and manually entered recipients. Trim surrounding whitespace and normalise domains; use a documented consistent duplicate rule without removing plus tags or dots. | Must |
| FR-105 | Allow manual recipient details to be saved to the address book only through an explicit owner action. Do not automatically save every recipient, import a user's device contacts or grant marketing permission from saving a contact. | Must |
| FR-106 | Copy selected contact values into the draft as recipient snapshots. Later contact edits or deletion must not silently change an existing draft, accepted session or sent greeting. The sender may explicitly replace draft details from an updated contact before final review. | Must |
| FR-107 | Continue to enforce recipient opt outs and abuse controls at submission and dispatch regardless of contact presence. Saved contacts confer no permission to bypass suppression. Give non revealing outcomes for blocked delivery without exposing another person's preferences or account status. | Must |
| FR-108 | Confirm contact deletion, explaining that it removes the saved contact but does not recall sent cards, cancel queued cards or clear suppression records. Provide confirmed deletion of all saved contacts with an explicit impact summary. Handle contact data under the account's agreed retention and deletion policy. | Must |
| FR-109 | Prevent ordinary campaign, finance and delivery support roles from browsing private address books. Any exceptional access must be separately authorised, narrowly scoped and audited. Keep contact emails out of public URLs, logs, analytics payloads and unauthorised exports. | Must |
| FR-110 | Preserve the prepared card when sign in or verification is needed to use the address book, then return to the intended contact picker or management screen. Show saved and error feedback accessibly, reject stale contact edits and apply approved per account storage and request limits. | Must |

Store only contact name and email for the core feature. The contact count limit and retention period are launch configuration decisions; the twenty recipient sending session maximum is not an address book storage limit. The duplicate comparison policy must be resolved consistently across contact management, selection and manual recipients.

Journey: add Address book to the sender navigation. From an empty book, add a contact and return to the list. From the editor, Choose from address book opens a picker with search, checkboxes, an explicit selected count and Add selected recipients. The picker includes existing draft recipients when calculating capacity and duplicates. Management and selection are separate; cancelling selection must not change the prepared draft. Contacts are private to one sender account, with no shared household or Group directory implied.

### 8.1.1 Private contact groups

Groups organise the sender's own contacts; they do not create shared household address books or Group wide mailing lists. Family and Friends are suggested names, not compulsory groups.

| ID | Requirement | Priority |
|---|---|---|
| FR-111 | Let the verified owner create, rename and delete private contact groups. Require a non empty name within the approved length and reject duplicate names using a consistent whitespace and case comparison. Enforce ownership for every operation. | Must |
| FR-112 | Allow a contact to belong to zero, one or multiple groups. Assign or remove memberships during contact editing without duplicating the underlying contact. Provide All contacts and Ungrouped system filters; these are not editable user groups. | Must |
| FR-113 | Filter the address book and recipient picker by group, alongside name or email search. Show useful empty group and no match states and preserve selected contacts when changing filters. Selection remains an explicit per contact action. | Must |
| FR-114 | Count a contact only once when it belongs to multiple groups or appears through different filters. Keep duplicate email checks, existing manual recipients, the configured twenty recipient maximum and live suppression controls. | Must |
| FR-115 | Confirm group deletion and explain that it removes the group and its memberships only. Retain contacts, other memberships, draft recipient snapshots, queued and sent cards, and recipient suppression records. | Must |
| FR-116 | Keep group names and memberships private to the owner and covered by account retention, deletion and approved storage limits. Exclude group information from recipient emails, private greeting views, public links and unauthorised administration. | Must |

Group membership changes do not change prepared or submitted cards. Bulk select all by group remains a separate optional enhancement and is not introduced here.

### 8.2 Administration configuration

Provide four configuration areas: Campaign settings, Application settings, Access and System health. Only authorised individual administrator accounts with MFA may access them. Campaign operations and finance reporting remain separate task views. This section expands the requirements behind S24 Campaign controls.

| ID | Requirement | Priority |
|---|---|---|
| FR-081 | Provide an administration configuration area with Campaign settings, Application settings, Access and System health. Enforce permissions on the server for viewing and changing every setting, including direct requests and exports. | Must |
| FR-082 | Allow campaign managers to configure campaign name, opening and closing dates in Europe/London, approved donation purpose, optional target and suggested donation amounts. Validate dates, currency and values. Preserve an equally clear free sending route and do not enable mandatory payments. | Must |
| FR-083 | Allow campaign managers to preview approved designs, set display order, enable or disable designs and maintain accessible descriptions. Launch uses the approved designs; new uploads remain governed by deferred FR-076. Changes must preserve artwork and message snapshots for cards already submitted. | Must |
| FR-084 | Allow application administrators to configure the recipient limit within one to twenty, approved message and display name limits, self test sending limits, approved address book contact storage limits and abuse or rate limit presets. Show units, supported bounds and effects; enforce the effective values consistently in the interface and on the server. | Must |
| FR-085 | Allow application administrators to maintain approved recipient email subject patterns, branding assets, support contact and help content. Use constrained templates and approved assets rather than unrestricted executable content or arbitrary HTML. Preview email and plain text output and send a test only to the administrator's verified address. | Must |
| FR-086 | Allow restricted administrators to manage approved card expiry, record retention policies and privacy wording. Before reducing a period, show affected record counts, the proposed effective date and any deletion or link expiry consequences. Require a reason and recorded approval reference before activation; do not delete data merely by saving a draft policy. | Must |
| FR-087 | Show finance authorised users the verified beneficiary name, masked account identifier, provider verification status, transaction currency, connection status and approved reconciliation configuration. Do not provide an ordinary editable destination account field. Beneficiary changes require a separate restricted verification process and recorded Treasurer or Trustee approval before activation. | Must |
| FR-088 | Allow restricted administrators to invite verified administrators, assign only approved roles, revoke access and review MFA enrolment status. Prevent removal or demotion of the last active restricted administrator. Do not expose MFA secrets or permit shared identities; revocation must invalidate privileged access promptly. | Must |
| FR-089 | Show application administrators and restricted administrators current email and payment connection status, queue state, last successful scheduled job execution, last observed backup outcome and unresolved operational alerts. Display when each status was last checked; stale or missing evidence must show Unknown or Stale rather than Healthy. Health views contain no secrets or private greeting content. | Must |
| FR-090 | Keep passwords, API keys, webhook secrets, encryption keys, database credentials and provider endpoint credentials in protected server configuration. Never show secret values or place them in configuration exports, diagnostics or audit history. Show masked identifiers and connection status where appropriate. | Must |
| FR-091 | Validate all changes and show an old versus new review with scope and effective timing before significant changes are saved. Require explicit confirmation for access changes, dispatch pause or resume, campaign closure, retention activation and beneficiary activation. Save each approved configuration version atomically. | Must |
| FR-092 | Record actor, time, setting, before and after values or redacted descriptions, reason and approval reference where required. Keep configuration audit history append only to ordinary administrators. Allow authorised review and export without disclosing secrets or unnecessary personal data. | Must |
| FR-093 | Detect concurrent configuration edits and reject an update based on an outdated version with a clear reload and review message. Preserve the user's proposed values for comparison and prevent silently overwriting another administrator's changes. | Must |
| FR-094 | Distinguish prospective settings from immediate operational controls. Template and artwork edits affect new submissions; submitted card snapshots remain intact. Recipient suppression and emergency dispatch pause apply immediately at the defined dispatch boundary. Any policy change affecting existing links or records requires explicit impact review. | Must |
| FR-095 | Permit authorised restoration of a previous non secret configuration through the same validation, permission, impact review and audit flow as a new change. State that restoring configuration cannot undo sent emails, completed payments, expired access already used, or deleted records. Do not offer bulk destructive resets as a normal configuration action. | Should |

#### Settings ownership

Roles are explicit permissions, not a hierarchy in which every administrator automatically sees all information. A person may hold multiple approved roles. Restricted administrator is the existing privileged role assignment authority; it does not automatically confer donor record or private message access.

| Setting or action | Campaign manager | Application administrator | Finance administrator | Delivery support | Restricted administrator |
|---|---|---|---|---|---|
| Campaign content, dates, target and suggested amounts | Edit | View | View relevant financial configuration | View availability | Edit |
| Approved design order, availability and descriptions | Edit | View | No access | View active designs | Edit |
| Sending limits and approved email or support content | View | Edit within approved bounds | No access | View relevant limits and help | Edit |
| Card expiry, retention and privacy wording | View policy | View policy | View relevant retention | View expiry guidance | Edit with impact review and recorded approval |
| Beneficiary verification and reconciliation settings | View beneficiary name | View connection health only | View verified details; edit approved reconciliation settings | No access | Manage separate approved beneficiary change workflow |
| Administrator invitations, role assignment and revocation | No access | No access | No access | No access | Edit |
| System health | View campaign availability | View diagnostic health | View payment health | View delivery health | View diagnostic health |
| Emergency dispatch pause and resume | View status | Edit with reason | View status | View status | Edit with reason |
| Configuration audit history | Relevant campaign entries | Relevant application entries | Relevant finance entries | Relevant operational entries | Review configuration history |
| Previous configuration restoration | No access | No access | No access | No access | Conditional (FR-095) with full review |

Permission to inspect a reported greeting remains separately assigned under FR-050. This matrix does not grant refunds, secret rotation or unrestricted provider access.

#### Configuration behaviour and operational boundaries

A campaign closing date controls new submissions and the approved handling of accepted work. It does not itself expire all existing cards. An emergency pause stops eligible dispatch work without changing campaign dates or disabling viewing links. Resume must show delayed work and the applicable late send policy.

Reducing the configured recipient limit must remain within the launch ceiling of twenty. Existing drafts are preserved, but a draft above the new limit must be corrected before a new submission. Already accepted batches retain their accepted recipient count and remain subject to live suppression, pause and dispatch controls.

Artwork or template retirement must not silently change submitted greetings. Retention changes require documented treatment of live records, finance records, audit history and suppression information; do not apply one indiscriminate deletion period to all data.

Diagnostics may perform rate limited, non destructive checks. Production or test environment must be clearly labelled, and a diagnostic action must never start a real donation or email recipients. No web control may silently switch payment mode, replace provider credentials or change the beneficiary.

The default configuration must keep all required launch protections active. Draft policy or configuration changes do not take effect until explicitly reviewed and activated.

### 8.3 Administration screen specification and mobile layouts

Ten additional states, grouped under Campaign settings, Application settings, Access and System health. Donation configuration remains restricted to its finance permissions. Existing delivery support and finance task views remain separate.

| State | Screen | Content and actions | Mobile layout |
|---|---|---|---|
| S30 | Admin overview | Role permitted campaign availability, dispatch state, unresolved alerts, pending configuration changes and relevant shortcuts. Show timestamps and explicit empty or unknown states. | Single column status cards and task links; urgent actionable issues first. |
| S31 | Campaign settings | Name, Europe/London opening and closing dates, queue at closure handling, approved donation purpose, optional target and suggested amounts. Free sending stays available. | Stacked fields with explicit date, time and zone labels; inline validation and retained entries. |
| S32 | Approved card designs | Preview the approved designs; order, enable or disable and accessible descriptions. Changes preserve submitted artwork snapshots. | One design card per row; labelled Move up and Move down controls alongside any drag interaction. |
| S33 | Application settings | Recipient ceiling, approved text limits, contact storage limits, verified self test and rate limit presets. Show bounds, units and draft effects. | Short labelled form sections; current effective values alongside proposed values. |
| S34 | Branding, email and help | Approved assets and constrained templates; HTML and plain text previews, support contact, help content and verified administrator test. | Preview adapts to viewport; test destination and rate limit feedback remain visible. |
| S35 | Privacy, expiry and retention | Policy wording, effective timing, affected record counts, consequences, reason and approval reference. Draft saving does not expire links or delete records. | Impact summary precedes activation; counts and consequences use readable stacked sections. |
| S36 | Donation configuration | Verified beneficiary, masked identifier, currency, verification and connection evidence; approved reconciliation settings. Beneficiary change uses a separate restricted workflow. | Masked details and labelled status cards; no ordinary destination account input. |
| S37 | Administrator access | Verified invitations, approved role assignments, MFA enrolment and revocation. Protect the last active restricted administrator. | Administrator cards with explicit role labels and named actions; confirmation identifies the affected account. |
| S38 | System health and dispatch controls | Timestamped email, payment, queue, job and backup evidence, Unknown or Stale states, non destructive diagnostics and authorised pause and resume. | Status cards replace wide tables; pause and resume opens a dedicated impact confirmation. |
| S39 | Change review and configuration audit | Old and new values, scope, timing, reason and approvals; conflict recovery and authorised history or restoration. | Before and after values stacked vertically with repeated labels; impact and consequences precede confirmation. |

Standard configuration journey: open a permitted setting, edit a draft, validate, review old and new values and impact, explicitly confirm when required, atomically save and show the effective version. Sensitive policy or beneficiary activation additionally requires its existing approval and verification conditions. A concurrency conflict retains proposed input for reload and comparison; it never silently overwrites a newer version.

Pause and resume are immediate operational controls rather than ordinary campaign edits. Confirmation explains eligible queued work, accepted work already claimed for dispatch, delayed work and the applicable late send policy. Counts must identify their observation time and are rechecked at execution. Sent emails cannot be recalled. Closure, pause and expiry remain separate actions.

| ID | Requirement | Priority |
|---|---|---|
| FR-117 | Provide the administration screen inventory S30 to S39 above, with explicit role permitted navigation, status, validation, empty, error and confirmation states. Preserve FR-081 to FR-095 and the settings ownership matrix. Hidden controls are not a substitute for server authorisation. | Must |
| FR-118 | Support administration at 320 CSS pixels wide without horizontal page scrolling or loss of content or actions, except genuinely two dimensional content where an accessible alternative is provided. Forms use one column; routine records and before and after comparisons use stacked labelled cards. | Must |
| FR-119 | Provide a labelled keyboard accessible mobile administration menu showing only permitted destinations. Expose expanded state, support Escape and sensible focus return, and show the current screen and signed in context. | Must |
| FR-120 | Provide labelled touch controls with a minimum 44 by 44 CSS pixel target for primary mobile administration interactions. Keep visible keyboard focus, accessible names and adequate spacing. Provide non drag alternatives for design ordering. | Must |
| FR-121 | Preserve proposed administrative entries through validation and review navigation. Associate inline errors with fields, provide an error summary and focus the first invalid field. Unsaved change handling must not silently activate configuration. | Must |
| FR-122 | On mobile, show change scope, old and new values, effective timing, impact, reason and required approvals before confirmation. Confirm and cancel controls remain available without obscuring fields, focus, errors or consequences. No device layout may bypass review or role checks. | Must |
| FR-123 | Present authorised dispatch pause and resume in a dedicated confirmation with queue impact and late send handling, observation time and execution time checks. Require a reason, audit the outcome and report changed or partial eligibility accurately. | Must |

Mobile administration does not shrink desktop tables or hide required information. Responsive cards retain field labels, statuses and named actions. A mobile configuration review must support portrait and landscape, browser zoom, screen reader navigation and an on screen keyboard without losing access to actions.

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

## 11 Launch protection, sender experience and decision dependent requirements

Version 2.1 additions. Nothing here activates a policy value. Wording that has legal effect (privacy notice, terms, safeguarding statement, Gift Aid declaration) must be written or approved by the named owner and checked against current guidance before launch.

### 11.1 Protecting the Group and its supporters

| ID | Requirement | Priority |
|---|---|---|
| FR-131 | Publish a plain-language privacy notice, cookie statement and terms of use, linked from every page, the registration form, recipient emails and the card view. The privacy notice states who runs the service, what is stored (sender account, drafts, recipient names and emails, greetings, contacts, donation records, opt-outs), why, for how long, who receives it (email and payment providers), and how to ask for access, correction or deletion. State that the service sets only essential cookies and no analytics or advertising cookies. Explain to recipients, on the card page and in the email, why they received it, that the sender asked for it, that it is a one-off email, and how to stop further cards. Record an owner and a review date. | Must |
| FR-132 | At registration, require the sender to confirm they are 18 or over and accept the terms of use and acceptable-use rules. Store the version accepted and the time. Ask again when a material version changes, before the next submission. Do not offer accounts to under-18s. Show a short safeguarding statement approved by the Trustees: the service does not collect children's data, is not for contacting children the sender does not know, and how to report a concern. | Must |
| FR-133 | Let authorised administrators suspend a sender account with a recorded reason. Suspension blocks new submissions and test sends, cancels the account's unclaimed queued deliveries, and shows the sender a neutral message with the support route. It does not by itself withdraw cards already sent, delete data or clear opt-outs. Withdrawal of existing cards remains a separate audited decision. Reinstatement is possible, audited and requires a reason. Suspended accounts cannot use the address book to send. Do not disclose other people's reports to the sender. | Must |
| FR-134 | Deliver operational alerts to named people. For stalled queue, unresolved payment beyond the agreed threshold, failed scheduled job, failed backup and unresolved deliveries, send a timestamped alert to the configured recipients with severity, a link to the relevant admin view and an acknowledgement action. Escalate unacknowledged alerts to a second named person after an agreed time. Send a daily summary while the campaign is open. Do not rely only on the email provider being healthy: provide a second route such as a monitored mailbox plus the health page. Never include private greetings or secrets in an alert. | Must |
| FR-135 | Provide a launch readiness view for restricted administrators and the project lead. It lists the decision register (D-01 to D-16) with the owner, approved value, approval date and reference for each, plus the launch gates in section 12. Items without recorded approval show as Open. Opening the campaign while a launch Must decision is Open requires an explicit override with a reason, which is audited. Show clearly whether the environment is Staging or Production. Staging shows a visible banner, uses test payment and email modes only, and can be reset to demonstration data. A reset is impossible in production. | Must |
| FR-136 | Support a Trustee rehearsal on staging. An administrator can send real test cards to an approved allow-list of addresses, with the payment provider in test mode, and record the result of each UAT task against its acceptance scenario. Allow-listed sends are labelled as tests in history and excluded from fundraising and card counts. | Should |

### 11.2 Sender experience

| ID | Requirement | Priority |
|---|---|---|
| FR-137 | Enter recipients as rows, each with name, email and an optional personal message revealed on request. Provide Add another recipient and Remove, show the count against the limit, validate each row inline, keep valid rows when another is wrong, and focus the first error. Paste of several lines (name, email) fills rows. The control works by keyboard and on a phone, and each row has a visible label. The one-box text format used in the prototype is not the specified experience. | Must |
| FR-138 | Before sending, let the sender preview the recipient email for any chosen recipient: subject, From display, HTML and plain-text versions and the position of the open, report and stop-cards links, using a dummy link that cannot open a real card. | Should |
| FR-139 | Provide aggregate campaign measures to authorised administrators: drafts started, cards submitted, senders who donated, share of submitted cards by status, average donation, and the stage where drafts are abandoned. Counts under an agreed small number are shown as "fewer than N". No individual behaviour tracking, fingerprinting, third-party analytics or advertising pixels. Definitions are shown on the page. | Should |

### 11.3 Decision dependent requirements and other additions

These apply only if the named decision is taken to include the feature. If deferred, record the decision and make sure no design choice blocks it.

| ID | Requirement | Priority |
|---|---|---|
| FR-140 | Recipient donation (D-11). On the opened card offer an optional "Support 7th Swindon Scouts" link to the same payment provider flow. The amount and donor identity are never shown to the sender or other recipients and are not added to the card. The donation is recorded against the campaign and, for fraud and reconciliation only, a reference to the card it came from, which is not shown to the sender. Receipts and refunds follow FR-021 to FR-023. The wording is never pressuring and sending, reading and replying remain free. The link is hidden when the campaign is closed or the card is withdrawn. | Should if included |
| FR-141 | Gift Aid (D-12). If included, capture an approved declaration and only the donor details needed to claim, kept separate from card data, with restricted access, an export for the claim, correct treatment of refunds, and a record of the declaration wording version shown. The Treasurer confirms the Group's eligibility to claim before it is offered. The declaration is optional and never blocks a donation. If deferred, store the donor's name on donations only if the privacy notice allows it. | Must if included |
| FR-142 | Christmas Day delivery (D-13). Offer Send now or Deliver on 25 December at one approved time in Europe/London. No free date selection. Resolve any donation at submission using the existing payment recovery. Scheduled cards are held, shown in the sender's history as Scheduled (not Queued), can be edited or cancelled until the delivery is claimed, and are rechecked at dispatch for suppression, pause, suspension and campaign rules. Apply an agreed late-send policy after an outage. State that exact inbox arrival time is not guaranteed. | Must if included |
| FR-143 | Printable card. Provide a print stylesheet or downloadable page showing the artwork, greeting and display names only. It contains no email addresses, tokens, donation information or live links, and fits A4 and US Letter. Explain that a printed copy outlives expiry or withdrawal. | Should |
| FR-144 | Next-year reminder. Offer an unticked, optional box on registration or in account settings to be emailed once next November about the campaign. Store the choice separately from the account, honour withdrawal in every message, and send no other marketing. Without this consent the service sends no promotional email. | Should |
| FR-145 | Accessible, human-written artwork descriptions for all designs (FR-083), a reading-level check of all sender and recipient wording against the agreed plain-language standard, and an assistive-technology test plan (screen reader on phone and desktop, keyboard only, 200 percent zoom) with results recorded before launch. | Must |

Recommended handling: FR-131, FR-132, FR-133, FR-134, FR-135, FR-137 and FR-145 are launch Musts. FR-136, FR-138, FR-139, FR-143 and FR-144 are launch Shoulds that can be dropped if time is short. FR-140, FR-141 and FR-142 depend on D-11 to D-13. FR-133 adds to the audit list in FR-050, FR-134 completes FR-130, and FR-137 replaces the entry method inside S03 without changing FR-012 or FR-013.

## 12 Illustrated cards, Gift Aid, version 2.2 requirements and version 2.3 proposals

### 12.1 Designs (version 2.2)

Currently held back: "Woggle all the way", because the picture says "S'more adventures in 2025". Drawn designs built earlier are kept as optional extras, switched off by default.

FR-009 is unchanged: campaign managers can enable, disable and reorder designs and edit their descriptions.

### 12.2 Gift Aid (supplements FR-141)

Gift Aid is offered only when all three of these are true: decision D-12 is recorded as approved with a reference; the charity name as HMRC knows it is set; and the switch in Campaign settings is on. Saving the switch is refused until D-12 is approved.

When on, a donor who ticks Gift Aid at review gives their name, home address (house name or number and a valid UK postcode), and confirms HMRC's model declaration naming the charity. The wording shown is stored with the declaration. The declaration stays pending until payment is verified, is removed if the donor chooses to send for free, and is never duplicated by repeated payment callbacks.

Finance users see claimable declarations, which exclude withdrawn and already claimed ones and use the amount after refunds. They can download a claim schedule in the HMRC column layout (title, first name, last name, house name or number, postcode, aggregated donations, sponsored event, donation date, amount), then mark the rows as claimed with a reference. Exports and withdrawals are audited. Donor details are separate from card data and visible to finance users only. The Treasurer must confirm the Group's eligibility to claim, approve the wording, and confirm how long declarations are kept.

### 12.3 Other decisions recorded

Hero card: the home page hero shows a random enabled design on each visit. Launch lock: in production the campaign stays locked while a required decision is open, unless a restricted administrator records an override with a reason. Drafts: anonymous drafts are removed after seven days.

### 12.4 Illustrated card requirements (version 2.2)

| ID | Requirement | Priority |
|---|---|---|
| FR-146 | Illustrated card handling. Each illustrated design is an image file named after its design. The page shows it in full on the card, crops thumbnails to the top so the headline stays visible, loads thumbnails lazily, and does not repeat the title and joke already painted into the picture. The alternative text carries the printed words and a description of the scene. | Must |
| FR-147 | Home page hero. Show one randomly chosen enabled design on each visit. A disabled or held back design is never chosen. If no design is enabled, omit the picture. | Should |
| FR-148 | Held back designs. A design can be held back in the code until its artwork is corrected, and enabled by a campaign manager afterwards. Held back and disabled designs cannot be started from a direct link. Cards already sent with a design still display. | Must |
| FR-149 | Unique art identifiers. Several copies of the same drawn design on one page must not share an identifier, so a hidden copy cannot blank a visible one. | Must |

### 12.5 Version 2.3 requirements FR-150 to FR-164

Proposed in the Unified Development Spec v2.3. Phase R1 is launch critical; R1.1 is the first enhancement after launch; R2 follows. Build status is in section 16. Do not read a requirement as built because it appears here.

| ID | Priority | Phase | Requirement | Dependencies |
|---|---|---|---|---|
| FR-150 | Should | R1.1 | Allow an adult to compose/send without permanent registration, verifying control of sender email with short-lived, single-purpose proof; provide secure recovery of their submission. Preserve 18+ affirmation, terms acceptance, anti-abuse limits, privacy and free send. | Security/product approval; FR-160 |
| FR-151 | Should | R1.1 | Autosave eligible drafts with clear saving/saved/error states, recovery on return and explicit deletion; unauthenticated drafts continue to expire after seven days. | Consent/storage design |
| FR-152 | Should | R1.1 | Address-book autocomplete, accessible multi-select of contacts/groups, duplicate detection and review of recipient count/addresses before committing; all recipients private from each other. | FR-100–116 |
| FR-153 | Should | R1.1 | Preview the sender-visible card **and** simulated recipient email/envelope/reveal experience; clearly mark test content as not delivered. | FR-136,138 |
| FR-154 | Should | R2 | Create next-year campaigns from an approved template, selectively copying eligible settings/designs but not personal data or donation records; require renewed approval for policy settings. | Role model and campaign records |
| FR-155 | Should | R1.1 | Role-aware campaign dashboard with sends, verified donations, net receipts, delivery problems, conversion and historical comparisons, subject to small-number suppression. | D-16; privacy |
| FR-156 | Must | R1 | Publish versioned artwork with immutable sent-card references; holdback/publish changes audited; invalid year and alt text can block new publishing. A content replacement must not alter an already-sent card. | Amend AC-109 |
| FR-157 | Must | R1 | Reconcile each payment attempt to signed/verified provider events, internal donation, associated card send, refund and receipt; exceptions visible to finance with tracked disposition. No automatic resend/charge under uncertain state. | Stripe integration, FR-125/129 |
| FR-158 | Should | R2 | Show admin action lists with responsible role, due date, evidence and completion state; distinguish readiness from ongoing operations. | Existing readiness register |
| FR-159 | Should | R2 | Allow authorised admins to filter/export relevant audit entries securely, with reasons and export logging; mask sensitive data. | FR-089–094 |
| FR-160 | Must | R1 | Enforce rate limits, bot/abuse detection and escalation for registration, verification, test email, sending, recovery and reporting; allow suspension/review without suppressing legitimate support. | FR-131–135; privacy |
| FR-161 | Must | R1 | Enforce MFA for privileged roles, least-privilege authorisation on every protected route/action, and periodic access review. MFA status display alone is insufficient. | FR-088 |
| FR-162 | Must | R1 | Capture recoverable, consistent backups off-server and prove controlled restoration of database, assets, configuration and secrets references within agreed recovery objectives. | D-09, hosting |
| FR-163 | Must | R1 | Process verified delivery provider bounce/complaint events, suppress repeat sends where required, record diagnostics, preserve retry bounds, and alert support. | Postmark, FR-124/126/130 |
| FR-164 | Should | R2 | Archive yearly campaigns; apply approved retention/deletion rules independently to messages, contacts, financial evidence, Gift Aid declarations and audit logs, with protected finance exceptions. | D-14; Treasurer policy |

#### Amendments to existing requirements proposed in v2.3

- **FR-148 / FR-156:** held-back status can be maintained in authorised administration; published versions and sent-card references cannot be silently mutated.
- **AC-109:** eligible future catalogue uses update after new artwork publication; historical sent-card views do not change.
- **FR-125/129:** manual reconciliation remains a documented fallback, but automated verified evidence and exception review become launch requirements under FR-157.
- **FR-088:** privileged MFA **enforced** under FR-161; invitation workflow deferred unless separately approved.
- **FR-131–135 / readiness:** security, production payment integrity, approved privacy notice, and tested restoration are non-waivable gates; discretionary content items may have controlled exceptions.
- **FR-058–067:** use locally generated campaign QR images where practical, following a privacy/design assessment; not a requirement to remove the existing function before launch.

## 13 Acceptance scenarios

All acceptance scenarios are listed here, in ID order within each group. Scenarios for features that depend on a decision or that are conditional apply only when that feature is included.

### Original launch scenarios AC-01 to AC-18

| ID | Scenario and expected result |
|---|---|
| AC-01 | Registration and email verification work before dispatch. |
| AC-02 | A user can select and personalise a card. |
| AC-03 | One to twenty recipients are accepted; 21 are rejected on the server. |
| AC-04 | Drafts can be saved and resumed. |
| AC-05 | A test card can be sent to the verified sender. |
| AC-06 | A card can be sent without a donation. |
| AC-07 | Stripe test donations reconcile to the correct beneficiary. |
| AC-08 | Payment failures and repeated callbacks do not create incorrect charges or duplicate sends. |
| AC-09 | Each recipient gets an individually addressed email and a functional link. |
| AC-10 | The recipient can open and read the correct personalised card. |
| AC-11 | Genuine card viewing activity is tracked accurately. |
| AC-12 | The sender can review delivery and viewed status. |
| AC-13 | Failed addresses may be corrected and requeued without unintended duplicates. |
| AC-14 | An administrator can review donations, delivery failures and complaints. |
| AC-15 | Unauthorised users cannot access other users' accounts or administration. |
| AC-16 | Backups, recovery, monitoring and scheduled jobs are tested on cPanel staging. |
| AC-17 | Core journeys work on desktop and mobile, including accessible card opening. |
| AC-18 | Security review, full end to end testing and Trustee UAT are signed off. |

AC-01 to AC-18 remain required: verification before dispatch; card selection and personalisation; server enforcement of one to twenty recipients; draft save and resume; verified self-test; free sending; correct beneficiary reconciliation; safe failed payments and repeated callbacks; separate emails and working links; correct recipient content; appropriately evidenced viewing; sender tracking; safe address correction; administrator monitoring; account isolation; staging backup and recovery checks; accessible desktop and mobile journeys; and technical review plus Trustee UAT.

### Launch scenarios AC-19 to AC-32

| ID | Scenario and expected result |
|---|---|
| AC-19 | Failed donation retains the card. Retry works and free dispatch is available. A late successful payment event never dispatches the card twice. |
| AC-20 | Pending payment gives an accurate explanation. Repeated clicks, refreshed pages and repeated callbacks cause no extra charge or duplicate queue entry. |
| AC-21 | Recipient opt-out works without login. Further initial sends, queued sends, retries and resends are suppressed within the selected scope. Automated link fetching alone does not opt someone out. |
| AC-22 | An email repeated within a batch is flagged and cannot accidentally receive duplicate cards. An intentional repeat of a previous card requires an explicit permitted choice. |
| AC-23 | Cancellation and dispatch are triggered concurrently. Each recipient has one consistent outcome and the UI does not falsely promise cancellation of an email already claimed. |
| AC-24 | Expired and withdrawn links show helpful pages without exposing private data. |
| AC-25 | Campaign dates respect UK local time. Closure blocks new sends while accepted work and viewing links follow the approved policy. Emergency pause behaves independently. |
| AC-26 | Finance CSV totals agree with transaction records including partial refunds, fee treatment and currencies. Only finance-authorised users can export. Formula-like user values cannot execute as spreadsheet formulas. |
| AC-27 | Direct requests cannot bypass role restrictions. Message access requires the correct permission, a reason and an audit record. |
| AC-28 | Card preparation survives verification in another tab, sign-in and a failed payment. The parent returns to the correct draft. |
| AC-29 | Confirmation distinguishes Queued from Sent and Delivered. Viewing and donation status remain separate and no automated scan is labelled a confirmed human view. |
| AC-30 | Mobile and keyboard users can correct errors, preview the card, find the free sending option and complete the core flow without losing valid input. |
| AC-31 | Help routes, support ownership, approved donation purpose, expiry wording, message limits and privacy wording are complete before launch. |
| AC-32 | If fundraising progress is enabled, pending and failed payments are excluded and refunds and fees follow the published calculation. |


### Research informed scenarios AC-33 to AC-44

AC-33 to AC-39 apply when their corresponding launch features are included. AC-35, AC-36 and AC-39 cover new launch Must controls. AC-40 to AC-44 apply only to an activated enhancement.

| ID | Scenario and expected result |
|---|---|
| AC-33 | A batch with a shared greeting and two overrides previews and sends the correct text to each recipient. Changing the shared greeting does not silently replace overrides. Drafts retain them. |
| AC-34 | Copying a previous card produces an unsent draft with new identifiers. Recipients are copied only after selection. No donation or dispatch is repeated. |
| AC-35 | Email previews and delivered test emails use approved branding and the family name, include plain text and correct actions, and expose no other recipient or spoofed sender address. |
| AC-36 | Free cards never claim a donation. Paid cards reveal no amount or financial details. Any optional donation statement appears only after sender choice and verified payment. |
| AC-37 | Campaign links and QR codes open the public campaign without private tokens. Returning a card never exposes an account email; the new sender enters the destination. |
| AC-38 | Greeting starters require deliberate selection. Optional status notifications follow preferences, are deduplicated and never create unviewed-recipient reminders. Essential receipts still arrive. |
| AC-39 | HTML-like greeting content is escaped, sender URLs are not clickable and rejected text remains recoverable. Reduced motion, failed media, keyboard use and sound defaults leave the greeting readable. |
| AC-40 | Scheduling handles UK time, invalid and ambiguous local times, campaign limits and displayed confirmation. Repeated submission or callbacks cause no duplicate dispatch or unattended charge. |
| AC-41 | Scheduled editing, cancellation and dispatch race safely. Pause and outage recovery show lateness and obey the agreed late-send policy. |
| AC-42 | Private sharing works with device sharing and copy fallback, uses a separate revocable token, respects expiry and exposes no private content in public previews. |
| AC-43 | Shared-card history records creation and sharing separately from email provider delivery. Link viewing never asserts the viewer's identity. |
| AC-44 | A keepsake contains no private email, payment detail or token. Collaborative cards, if introduced, enforce the approved contributor visibility and moderation policy. |



### Journey scenarios AC-45 to AC-48

| ID | Scenario and expected result |
|---|---|
| AC-45 | A new sender prepares a card, registers, verifies in another tab and returns to the same draft. A verified sender reaches review without a redundant account step. |
| AC-46 | Final review creates one submission intent. Free sending avoids checkout; confirmed donation resolves the same intent. Double clicks, reloads and late events never create a second send. |
| AC-47 | Cancelled checkout, failed payment and unknown payment use distinct recovery rules. Corrections retain valid content; cancellation conflicts report the actual recipient outcome and do not imply a refund. |
| AC-48 | Mobile and keyboard UAT covers the complete sender journey and recipient report and opt-out flows. Administrator roles see only permitted task views, with useful empty states and audited changes. |



### Administration configuration scenarios AC-49 to AC-57

| ID | Scenario and expected result |
|---|---|
| AC-49 | Each role sees only its permitted settings and actions. Direct requests, export endpoints and altered form values cannot bypass permissions; MFA is required. |
| AC-50 | Invalid dates, negative donation values, unsupported currency, out of bounds lengths and recipient limits above twenty are rejected without losing proposed values. Free sending remains available. |
| AC-51 | Email and design configuration can be previewed. A test goes only to the verified administrator, subject to rate limits. Retired artwork and changed templates do not alter submitted cards. |
| AC-52 | A retention reduction shows record impact, expiry or deletion consequences and effective timing. A draft save deletes nothing. Activation requires a reason and approval reference. |
| AC-53 | Beneficiary details are masked appropriately. Ordinary configuration cannot reroute payments, expose credentials or switch live and test payment mode. A separately authorised beneficiary change cannot activate before verification and approval. |
| AC-54 | Administrator invitation, role change and revocation are audited. Revocation invalidates privileged access; an attempt to remove the last active restricted administrator is rejected. |
| AC-55 | Health displays use current evidence and timestamps. Missing or old evidence shows Unknown or Stale. Non destructive diagnostics reveal no secrets and initiate no real donation or recipient email. |
| AC-56 | Significant changes show old and new values and effect before confirmation. Atomic saving prevents partial settings; concurrent edits produce a conflict instead of a silent overwrite. Configuration history is not editable by ordinary administrators. |
| AC-57 | Pause, closure and expiry have distinct effects. New limits revalidate drafts without silently dropping recipients or altering accepted batches. Restoration, if enabled, creates an audited new configuration version and does not claim to reverse external or destructive effects. |

### Branding scenarios AC-58 to AC-61 (amended for the blue scheme)

| ID | Scenario and expected result |
|---|---|
| AC-58 | Sender, recipient and administration screens use the blue scheme and Nunito Sans. If the font fails to load, controls and layout stay readable. |
| AC-59 | The circular logo displays at the correct proportions on desktop and mobile, with useful alternative text, and is not altered. |
| AC-60 | Branded recipient and test emails show the blue header, yellow action button, readable font fallbacks and a plain text version, and keep private links, recipient isolation, opt out actions and donation privacy. |
| AC-61 | Every text and control colour pairing in the contrast table meets the stated ratio. Status and errors always have words as well as colour. Focus is visible on light and dark surfaces. Brand configuration accepts only approved assets and supported design tokens, with preview and audit before activation. |

### Address book and group scenarios AC-62 to AC-72

Version 2.0 lists the following scenarios under the ranges AC-62 to AC-68 (address book) and AC-69 to AC-72 (groups). The source gives nine address book scenarios against seven identifiers and five group scenarios against four, so individual numbers are not assigned here; test cases should reference the range and a short title.

Address book (AC-62 to AC-68):

- Create, edit, search and delete. An owner creates, edits, searches and deletes valid contacts. Empty and no match states are useful.
- Validation and stale edits. Invalid fields and stale edits are rejected while preserving proposed input.
- Isolation. Another sender cannot read, search, update, select or delete the owner's contacts by changing identifiers. Ordinary administrator roles cannot browse the book.
- Selection and capacity. Selecting saved contacts counts manually entered recipients, stays within the configured maximum of twenty and prevents duplicates. Over capacity attempts explain the remaining space without dropping existing recipients.
- Snapshots and explicit saving. Recipient saving is explicit. Editing or deleting a saved contact leaves existing draft and sent card snapshots unchanged until the sender deliberately updates a draft.
- Suppression. Suppressed contacts cannot bypass opt out controls through initial selection, retries or resends. Responses do not disclose the recipient's suppression scope or account status.
- Deletion. Confirmed deletion removes saved contact entries but does not recall cards, cancel queued dispatch or erase suppression. Account deletion and retention follow the approved contact data policy.
- Interruption and limits. A sender interrupted by authentication returns to the intended address book action with the card preserved. Search, multi selection, validation and feedback work by keyboard and on mobile; storage and request limits are enforced.

Groups (AC-69 to AC-72):

- Management and isolation. The owner creates, renames and deletes groups. Empty or duplicate names are rejected. Another sender cannot read or alter the owner's groups or memberships by changing identifiers.
- Membership and filters. Contacts may belong to multiple groups without duplicate contact records. All contacts, Ungrouped, group filtering and name or email search produce correct results and useful empty states.
- Selection. Changing filters preserves explicit contact selections. The same contact is selected once, existing draft recipients count towards the maximum, and grouping cannot bypass duplicates or suppression.
- Deletion and privacy. Deleting a group retains contacts, other memberships and existing card recipients. Group labels remain absent from recipient emails, public content and unauthorised administration.

### Mobile administration scenarios AC-73 to AC-78

| ID | Scenario and expected result |
|---|---|
| AC-73 | S30 to S39 expose only permitted screens and actions for each role. Navigation and direct requests cannot bypass server checks. Overview and health cards show source timestamps and Unknown or Stale evidence accurately. |
| AC-74 | At 320 CSS pixels and in portrait and landscape, admin forms, record cards and change reviews remain readable with no horizontal page scroll, lost content or clipped actions. Browser zoom and the on screen keyboard do not obscure focused fields or confirmation. |
| AC-75 | Keyboard and screen reader users open and close the mobile menu, identify current location and return focus appropriately. Primary touch targets meet the 44 by 44 design requirement; design ordering works without dragging. |
| AC-76 | Invalid mobile form entries produce associated errors, an accessible summary and focus handling. Correct fields and proposed values survive validation, review and cancel and concurrency conflict recovery. No review cancellation activates a change. |
| AC-77 | Mobile review shows before and after values, scope, timing, impact and required approval details before confirmation. Saving is atomic and audited; the same authorisation and sensitive change conditions apply on desktop and mobile. |
| AC-78 | Pause and resume confirmation distinguishes eligible queued work, already claimed dispatch and delayed work. Eligibility is rechecked at execution, outcomes are accurate, and campaign closure and card expiry stay independent. |

### Delivery clarification scenarios AC-79 to AC-85

| ID | Scenario and expected result |
|---|---|
| AC-79 | Correcting an eligible address creates a fresh private token, invalidates the superseded token and retains an audit trail. Unknown previous delivery prompts the authorised warned decision. Concurrent correction and resend cannot produce duplicate attempts; permissions and suppression still apply. |
| AC-80 | A pending payment exceeding the approved investigation threshold alerts the named owner without silently becoming failed or creating another charge. Verified late or out of order evidence updates the original payment and submission exactly once. |
| AC-81 | Transient, permanent, complaint and unknown delivery cases obey the approved attempt and time policy. Permanent rejection and complaint are not automatically retried. Every eligible retry checks live pause and suppression; uncertain provider acceptance is reconciled before duplication risk recovery. |
| AC-82 | Confirmed account deletion revokes account sessions and stops new submissions. Contacts, groups and other categories follow the approved policy, and queued work and live links have an explicit recorded outcome. Retained finance, audit and suppression information remains protected and is explained to the account owner. |
| AC-83 | Representative scanners, genuine interactions, disabled scripts and incomplete evidence produce statuses consistent with the documented view qualification. Email delivery or opening alone never produces a human read claim. |
| AC-84 | Full and partial refunds, failed and pending refund outcomes and repeated or out of order events reconcile without duplicated refunds. Only the approved role and execution route can initiate a refund; card cancellation alone initiates none. |
| AC-85 | Stalled queue, unresolved payment, failed job and failed backup simulations produce timestamped alerts through the approved monitored route, with acknowledgement and escalation evidence. Unobserved recovery does not silently mark the incident resolved. |

### Version 2.1 scenarios AC-86 to AC-105

| ID | Scenario and expected result |
|---|---|
| AC-86 | Every page, the registration form, recipient emails and the card view link to the privacy notice and terms. The notice names the data held, purposes, providers, retention and how to make a request. Only essential cookies are set. |
| AC-87 | A recipient who opens an email and card can see why they received it and stop further cards without an account. |
| AC-88 | Registration cannot complete without the 18-or-over and terms confirmation. The accepted version and time are stored. A new terms version prompts re-acceptance before the next submission. |
| AC-89 | Suspending a sender blocks new submissions and tests, cancels unclaimed queued deliveries and records the reason. Already claimed or sent cards are unaffected. Reinstatement restores access and is audited. The sender sees a neutral message. |
| AC-90 | A suspended sender cannot send through the address book picker, a copied card or a direct request. |
| AC-91 | A simulated stalled queue, unresolved payment, failed job and failed backup each produce a timestamped alert to the named recipients. An unacknowledged alert escalates after the agreed time. Acknowledgement is recorded. Missing evidence is never reported as healthy. |
| AC-92 | The launch readiness view shows every decision as Approved or Open. Opening the campaign with an Open launch Must needs an override with a reason, recorded in the audit trail. |
| AC-93 | Staging shows a banner and uses test modes. A demonstration reset works on staging and is refused in production. |
| AC-94 | Rehearsal cards go only to allow-listed addresses, are labelled as tests, and are excluded from totals. |
| AC-95 | Rows can be added, removed, pasted and corrected by keyboard and on a phone. An invalid row does not discard valid rows. The count never exceeds the limit. |
| AC-96 | The email preview shows the true subject, From display, HTML and plain text, and its links cannot open a real card. |
| AC-97 | Campaign measures use the stated definitions, hide counts below the agreed threshold, and add no third-party tracking. |
| AC-98 | If recipient donation is included: no amount or donor appears to the sender or on any card, the link is absent when the campaign is closed or the card withdrawn, and free actions are unaffected. |
| AC-99 | If Gift Aid is included: the declaration version is recorded, the claim export matches eligible confirmed donations only, and refunds are reflected. |
| AC-100 | If Christmas Day delivery is included: a scheduled card is sent once at the approved UK time, can be edited or cancelled until claimed, rechecks suppression, pause and suspension, and obeys the late-send policy. |
| AC-101 | The printable card contains no email address, token, donation detail or live link. |
| AC-102 | The next-year reminder box is unticked by default, withdrawal works in one step, and users who did not tick it receive no promotional email. |
| AC-103 | Every design has a human-written description. Sender and recipient wording meets the agreed reading standard. |
| AC-104 | Assistive-technology testing covers the sender journey, recipient reveal, report and stop-cards, and the main admin tasks, with results and fixes recorded. |
| AC-105 | The decision register D-11 to D-16 is complete, each with an owner, approved value and date, before the features they govern are enabled. |

### Illustrated card scenarios AC-106 to AC-109 (version 2.2)

| ID | Scenario and expected result |
|---|---|
| AC-106 | The gallery shows only enabled designs; a held back design and its direct link are unavailable; the hero never shows a disabled design. |
| AC-107 | Every illustrated design has alternative text containing its printed words. |
| AC-108 | Thumbnails keep the headline in view on desktop and phone, and the full card shows the whole picture. |
| AC-109 (amended by FR-156) | Replacing a design's image file changes it for new selections without code changes. Cards already sent keep the picture they were sent with. |

### Version 2.3 proposed scenarios AC-110 to AC-143

Proposed with FR-150 to FR-164. Not evidence of implementation.

| AC | Parent | Verifiable scenario / expected outcome |
|---|---|---|
| AC-110 | FR-150 | Guest cannot send without verifying control of sender email; verification expires and cannot be reused. |
| AC-111 | FR-150 | Guest sees clearly that registering is optional and free sending remains available. |
| AC-112 | FR-150 | Invalid/expired guest recovery link fails securely without disclosing account existence. |
| AC-113 | FR-151 | Interrupting the browser restores the last successfully saved eligible draft with visible saved state. |
| AC-114 | FR-151 | Anonymous draft is deleted at the seven-day limit; no unsupported persistence is promised. |
| AC-115 | FR-152 | Contact/group selection cannot exceed the twenty-recipient server limit. |
| AC-116 | FR-152 | Duplicate email entries are flagged before submission; recipient list and counts are accurately shown. |
| AC-117 | FR-152 | A recipient email/link never discloses other recipient addresses or card delivery states. |
| AC-118 | FR-153 | Preview renders recipient email, envelope and revealed card without actual delivery. |
| AC-119 | FR-153 | Preview identifies example sender and recipient details without leaking unrelated private content. |
| AC-120 | FR-154 | Campaign copy omits donor, recipient and private contact data. |
| AC-121 | FR-154 | Critical campaign policy/approval decisions are reset to pending for the next year. |
| AC-122 | FR-155 | Dashboard values reconcile to the defined event/source-of-truth ledger; net amount reflects verified refunds. |
| AC-123 | FR-155 | Restricted financial and small-population metrics are inaccessible to unauthorised roles. |
| AC-124 | FR-156 | Sending a card stores the precise artwork version identifier/content reference. |
| AC-125 | FR-156 | Replacing/publishing an asset changes new selections but cannot change previously sent cards. |
| AC-126 | FR-156 | Held-back/disabled designs reject direct-start requests; sent cards of those designs still render. |
| AC-127 | FR-156 | Design publishing records who changed what, when, previous and new status, and approval. |
| AC-128 | FR-157 | Duplicate or out-of-order payment callbacks do not double-charge, double-create donations or double-send. |
| AC-129 | FR-157 | Unknown/pending attempt creates an actionable exception, not a false failure or automatic repeat charge. |
| AC-130 | FR-157 | Verified refund changes net financial metrics and eligible Gift Aid; audit trail preserved. |
| AC-131 | FR-157 | Reconciliation dashboard shows unmatched, disputed and resolved entries with role-limited detail. |
| AC-132 | FR-158 | Admin task owner, evidence and completion status appear and are auditable. |
| AC-133 | FR-159 | Audit export is permission-checked, time-scoped and itself logged. |
| AC-134 | FR-160 | Repeat sending/testing/recovery above approved limits is throttled and raises appropriate traceable signals. |
| AC-135 | FR-160 | Suspension blocks further sending, retains appropriate support/review route and prevents privacy leakage. |
| AC-136 | FR-161 | Privileged operation is denied until MFA requirement is met, including direct/API requests. |
| AC-137 | FR-161 | A user lacking role privilege cannot access financial, admin, sender or card data by modifying identifiers. |
| AC-138 | FR-162 | Restore rehearsal produces a working environment with verified database and artwork integrity. |
| AC-139 | FR-162 | Failed backup/copy or failed scheduled job raises an actionable alert. |
| AC-140 | FR-163 | Verified bounce/complaint is recorded with suppression and bounded retry handling as configured. |
| AC-141 | FR-163 | Forged/unverified webhook content causes no privileged state change. |
| AC-142 | FR-164 | Archive closes new sends while preserving access and records only for approved periods/roles. |
| AC-143 | FR-164 | Erasure/retention processing preserves only justified legally necessary finance records, segregated from cards/contacts. |

#### Cross cutting UAT checks (v2.3)

- 320px-wide mobile layout, portrait and landscape, 200%/400% browser zoom, visible focus, complete keyboard journey, reduced motion, screen readers and form errors announced appropriately.
- Verify no double sends after refresh, back navigation, payment abandonment, repeat webhook and simultaneous action.
- Verify every public URL against unauthorised enumeration, expired private links, and malformed card identifiers.
- Test deliverability/complaints in production-equivalent Postmark configuration; cover both accessible HTML and plain text.
- Test database locking/concurrent updates and recovery from missing cron runs on the selected cPanel/SQLite environment.

## 14 Roadmap and conditional requirements FR-068 to FR-076

Scheduling and private messaging sharing remain outside launch scope. These requirements define the accepted design direction for an enhancement; they do not silently make it a Christmas pilot launch gate. Conditional Must means required when that feature is enabled.

| ID | Requirement | Phase and priority |
|---|---|---|
| FR-068 | Offer Send now or Schedule for later. Display date, time and Europe/London zone before confirmation; store a stable dispatch instant. Restrict dates to the campaign's supported window, reject invalid local times and explicitly resolve ambiguous daylight-saving times. | First enhancement Must if enabled |
| FR-069 | Show scheduled cards in an Upcoming area with resolved recipient messages. Allow editing, rescheduling and cancellation until dispatch claims the individual card. Revalidate recipient limits, permissions, abuse rules, campaign availability and suppression. Prevent concurrent edits, cancellation and dispatch from producing duplicate or stale sends. | First enhancement Must if enabled |
| FR-070 | Resolve an optional donation at submission using existing payment recovery. Do not initiate unattended future charges. Separate Scheduled from Queued; show delays and apply a configured late-send policy after outage or pause. Explain that exact inbox arrival is not guaranteed and cancellation does not automatically refund a donation. | First enhancement Must if enabled |
| FR-071 | Allow a verified sender to create a greeting specifically for private link sharing and deliberately invoke device sharing or Copy link. Provide a fallback when device sharing is unavailable. This is separate from the public campaign share action. | First enhancement Should |
| FR-072 | Give each shared greeting its own non-guessable token, expiry and revoke control. Explain that anyone holding the link can view the card. Do not reuse an emailed recipient token or include private content in social previews. Collect no phone number solely to open a device sharing action. | First enhancement Must if sharing enabled |
| FR-073 | Show Link created or Share initiated for shared cards. Do not label them Sent by email or Delivered by WhatsApp without provider evidence. Qualifying views may be recorded but must not identify a viewer from possession of a link. | First enhancement Must if sharing enabled |
| FR-074 | Offer an accessible printable or downloadable keepsake containing only the resolved card, message and display names. Exclude email addresses, financial details and live tokens. Explain that a downloaded copy survives expiry or withdrawal; require artwork rights to permit export. | Later Should |
| FR-075 | Treat collaborative cards as a separate product mode with invitations, contributor permissions, a clear message visibility model, content approval and a closing or locking process. Do not launch public contribution links without moderation and an agreed policy. | Separate phase Must if enabled |
| FR-076 | Permit authorised campaign managers to add or refresh approved designs with accessible descriptions, preview and rights records. Preserve sent artwork versions. User-uploaded artwork remains excluded unless separately scoped. | Later Should |

### Delivery priorities

Effort is a relative product assessment, not a code estimate. Small generally means bounded content, interface or configuration work; Medium needs coordinated application changes; Large introduces a new operational workflow. Validate estimates against the implementation before planning delivery.

| Order | Feature | Value | Effort | Timing |
|---|---|---|---|---|
| 1 | Branded emails, donor privacy, safe message rendering and immediate reveal | High trust and recipient usability | Small to medium | Launch Must |
| 2 | Public campaign link and QR code | High promotion value | Small | Launch Should |
| 3 | Individual message overrides | High personal value | Medium | Launch Should |
| 4 | Previous card copied into a draft | High repeat-use convenience | Small to medium | Launch Should |
| 5 | Return-card journey and curated greetings | Medium to high completion value | Small to medium | Launch Should |
| 6 | Optional sender notification preferences | Medium reassurance value | Medium | Launch Should |
| 7 | Scheduling with pending edit and cancellation | High seasonal usefulness | Medium to large | First enhancement |
| 8 | Private link sharing | High mobile convenience | Medium | First enhancement |
| 9 | Keepsake download | Medium recipient value | Medium | Later |
| 10 | Annual campaign reuse and approved artwork refresh | High future volunteer value | Medium | Before the next campaign |
| 11 | Bulk contact import and device contact integration (the address book itself is in launch scope) | Medium convenience; further privacy controls | Medium | Later |
| 12 | Collaborative cards | Useful for section or leader appreciation | Large | Separate phase |
| 13 | Additional Groups (Gift Aid is now in launch scope subject to D-12) | Expansion value | Large | Separately scoped phase |

The twenty-recipient limit, verified sender accounts, approved artwork and free sending remain unchanged. Competitor paid memberships, mandatory donations, card credits, gift cards, unrestricted media uploads, native mobile apps, public donor leaderboards and automatic recipient reminders are not incorporated.

AI generated messages, bulk contact import, device contact integration, SMS provider integration, corporate campaigns and multi-Group payment routing remain deferred. Device link sharing does not imply a WhatsApp or SMS provider integration.

Sources and rationale: companion E card platform research and recommendations for 7th Swindon Scouts, researched 9 October 2026.



## 15 Decisions, proposed defaults and launch gates

### 15.1 Decision register

No value below is an invented default. Record the approved value, accountable owner, date and reference in Admin under Launch readiness (S42).

| ID | Decision or evidence | Accountable owner | Required by |
|---|---|---|---|
| D-01 | Campaign dates; closure treatment of accepted queues; expiry; contact, draft, card, finance, audit and suppression retention; deletion processing time. | Trustees with operational and privacy owner | Before affected configuration and lifecycle implementation is frozen |
| D-02 | Message, name and group lengths; address book and group capacities; self test and rate limits; supported email address forms; one consistent duplicate address rule. | Project lead with application administrator | Before validation implementation |
| D-03 | Currency and permitted custom donation bounds; suggested amounts; payment investigation thresholds and who resolves exceptions. | Treasurer with project lead | Before payment implementation |
| D-04 | Refund role, provider console versus in app execution, approval conditions, receipt treatment and reconciliation ownership. | Treasurer and Trustees | Before finance workflow implementation |
| D-05 | Retry limits and backoff, uncertain send reconciliation, support contact and hours, complaint handling, emergency pause and late send policy. | Operations owner with project lead | Before delivery implementation |
| D-06 | Expected campaign volume and peak concurrency; measurable response and queue delay targets; provider and hosting capacity evidence. | Technical lead with campaign owner | Before load test acceptance |
| D-07 | Recovery point and time objectives, monitoring cadence, backup restoration evidence and administrator MFA recovery or break glass procedure. | Technical and restricted administrator owners | Before operational sign-off |
| D-08 | Include or defer decision for every launch Should; individually numbered AC-01 to AC-18; FR to test mapping, UAT owners and results; approval of additions FR-124 to FR-130. | Project lead with Trustees | Before development baseline and sign-off |
| D-09 | Reconcile the FRD with the SDD and OpenSpec, confirm provider and hosting choices (including the SQLite departure in 9.1), validate authenticated callbacks and verified sending domain setup in staging. | Technical lead | Before integration sign-off |
| D-10 | Account deletion effects on accepted queued cards and live links, retained categories and support handling; approved view qualification method and public wording. | Trustees with privacy and technical owners | Before lifecycle and tracking sign-off |
| D-11 | Include or defer recipient donations (FR-140), and the approved wording. | Treasurer with Trustees | Before the card view is frozen |
| D-12 | Include or defer Gift Aid (FR-141); confirmation of eligibility; declaration wording; retention of declaration records; the charity name as HMRC knows it. | Treasurer with Trustees | Before payment implementation is frozen |
| D-13 | Include or defer Christmas Day delivery (FR-142); the approved time; late send policy. | Campaign owner with operations owner | Before the sender journey is frozen |
| D-14 | Wording and ownership of the privacy notice, terms, acceptable use rules and safeguarding statement, a review date, and the plain language reading standard. | Trustees with the responsible administrator | Before any public launch |
| D-15 | Alert recipients, the second route, escalation time, daily summary recipients and out of hours expectations. | Operations owner with project lead | Before operational sign-off |
| D-16 | Success measures and any targets; the small number threshold; who reviews them and when. | Project lead with campaign owner | Before campaign opens |

In production the application treats 13 of these as required before the campaign opens. Gift Aid, recipient donation and Christmas Day delivery (D-11 to D-13) never block, and are only relevant when included.

### 15.2 Proposed Christmas 2026 pilot defaults (version 2.0 section 15)

Status: recommendations for approval, not Trustee approved policy. They should be validated in staging and recorded against the decision register before activation. The values are product and operating recommendations, not provider guarantees or statutory retention periods; the ICO states that UK GDPR does not prescribe specific retention periods, so each category needs a documented purpose.

| Decision | Proposed default | Rationale |
|---|---|---|
| D-01 Campaign window | Open 1 November 2026 at 00:00 Europe/London; close 26 December 2026 at 23:59:59 Europe/London. | A preparation month and Boxing Day. |
| D-01 Accepted work and expiry | Continue previously accepted work for up to 24 hours after closure; unresolved eligible work then needs manual review, with no silent late send. End viewing at 23:59:59 on 31 January 2027 unless withdrawn sooner. | Separates submission closure from delivery recovery and viewing expiry. Pause still stops eligible dispatch. |
| D-01 Drafts and greetings | Delete abandoned drafts after 90 days without activity (anonymous drafts after 7 days). Delete greeting content and recipient delivery details 90 days after viewing expiry unless a documented complaint or incident hold applies; retain anonymous campaign totals. | Bounded seasonal storage. Notify owners before draft deletion where practicable. |
| D-01 Accounts, contacts and groups | Retain while the account is active. At 12 months without sign in, notify the owner and allow 30 days to retain the account; otherwise close and delete ordinary account, contact and group data. Account deletion requests: notify immediately and target processing within 30 days. | Annual reuse without indefinite inactivity storage. |
| D-01 Logs and suppression | Routine technical logs 30 days, without private tokens or messages. Security and configuration audit 12 months initially. Minimal suppression while the service operates or until the recipient deliberately withdraws, with annual necessity review. | Preserve opt outs across campaigns; never reuse suppression for marketing. |
| D-01 Finance records | Use the existing approved Scout finance retention schedule; obtain the Treasurer's written confirmation before launch. | No guessed statutory period for donor or accounting records. |
| D-02 Field limits | Greeting 1 to 1,000 Unicode characters; sender, contact and recipient display names 1 to 100; group names 1 to 50. Plain text, no executable markup. | Family greetings and manageable mobile reading. Count consistently in browser and server. |
| D-02 Address book | 200 contacts and 20 groups per owner; a contact may belong to several groups. Keep 20 recipients per send. | Practical family use. Capacity errors never discard saved entries. |
| D-02 Email policy | Trim outer whitespace, normalise domain case and IDN domains; preserve the local part. For duplicate matching, case fold the comparison and document the conservative treatment. Never remove plus tags or dots. Standard non SMTPUTF8 mailboxes on internationalised domains are supported; explain unsupported forms. | Avoid hidden normalisation; show review feedback rather than silently merging contacts. |
| D-02 Rate limits | Verified self test 3 an hour and 10 a day per account; ordinary submission 5 batches an hour and 100 recipient attempts a day per account; verification resend 3 an hour; sign in failures throttled progressively after 5 in 15 minutes. | Initial abuse presets for monitored tuning. Deduplicated retries of one intent do not count as fresh submissions. |
| D-03 Donations | GBP only; suggestions £5, £10, £20; custom £1 to £500; a separate equally clear free send action. Public target off until approved. | Simple seasonal fundraising within provider limits. Pending and failed payments never count as donations. |
| D-03 Payment investigation | Reconcile pending outcomes automatically with verified provider evidence; flag unresolved attempts after 15 minutes and escalate after 24 hours. Treasurer owns manual resolution. | Thresholds start investigation, not failure or another charge. |
| D-04 Refunds | Execute in the restricted Stripe dashboard for the pilot by the Treasurer or a named delegated finance operator with MFA. Record reason and transaction reference; reconcile verified refund outcomes in the app. Full and partial refunds supported in reporting; no in app refund button initially. | Avoid adding refund execution to ordinary finance visibility. |
| D-05 Retry policy | Up to 3 automated retries after the original attempt, at about 1, 5 and 30 minutes, only for a safely classified transient pre acceptance failure. Never automatically resend after unknown provider acceptance, hard rejection or complaint. | Provider transport retries and application retries must not compound. |
| D-05 Pause and support | Resume eligible queued work automatically only within the 24 hour recovery window; show age and counts and require review for older work. Nominate a primary and backup support volunteer; publish monitored hours; aim to acknowledge ordinary queries within 2 working days. Daily queue and payment review while the campaign is live. | No invented support email or continuous coverage claim. |
| D-06 Performance | Test 50 concurrent active users and a 1,000 recipient daily campaign workload. Target 95% of normal interactive responses under 2 seconds excluding third party checkout; 95% of healthy accepted deliveries handed to the provider within 5 minutes. | Planning hypotheses, not measured capacity. |
| D-07 Monitoring and recovery | Queue job each minute if hosting supports it; stale job alert after 5 minutes; review operational evidence at least daily. Encrypted off site nightly backup retained 30 days. Proposed RPO 24 hours and RTO 4 hours; rehearse restoration before launch. | A daily backup alone does not preserve all transactions; reconcile provider records and never blindly replay restored queues. |
| D-07 Privileged recovery | Two individually named restricted administrators with MFA; separately protected recovery codes; recorded identity checks and recovery audit. No shared admin password. | Prevents a single person access dependency. |
| D-08 Launch scope | Keep all current launch Must requirements. Recommended include: greeting starters, message overrides, public campaign sharing. Defer optional status notifications and copy card reuse if the schedule is tight. Restore individual AC-01 to AC-18 and map every launch Must to test evidence. | Scope recommendations only; scheduling, CSV import, group select all and a guided launch checklist remain outside authorised scope. |
| D-09 Technical baseline | Retain PHP and cPanel, Postmark and Stripe pending technical validation. Verify callbacks, domain authentication, TLS, cron limits and protected configuration in staging. | No readiness claim without implementation review. |
| D-10 Account deletion | On confirmed request stop new submissions and sessions, cancel unclaimed deliveries and revoke active greeting links owned by the account. Already claimed or sent email cannot be recalled; explain that. Apply category specific deletion and documented holds. | Finance, audit and suppression records remain protected and separate. |
| D-10 Viewing | Qualify a view by deliberate reveal or read interaction where supported; exclude known scanner events and deduplicate counts. Static or no script opens remain unconfirmed unless comparable evidence exists. Use "Viewed" with explanatory uncertainty, never "read by this person". | No fingerprinting; possession of a link cannot establish identity. |

Approval sequence: (1) campaign owner approves dates, wording, support coverage and included Should features; (2) Treasurer confirms GBP limits, refund delegation, pending payment ownership and finance retention; (3) privacy and operational owners approve category retention, deletion effects, suppression and incident holds; (4) technical lead validates capacity, provider behaviour, retries, monitoring and restore objectives in staging; (5) Trustees record policy approval and any exceptions, after which approved values become the configuration baseline through the existing review and audit process.

Sources checked 10 October 2026: ICO storage limitation guidance; Stripe supported currencies and charge constraints (docs.stripe.com/currencies); Stripe refund API (docs.stripe.com/api/refunds); Postmark bounce webhook and email API documentation. They support constraints and evidence handling; they do not prescribe the proposed campaign dates, capacities, retention durations, support targets or recovery objectives.

### 15.3 Launch gates

Technical acceptance, security and privacy, operational resilience, Trustee user acceptance and campaign approval remain launch gates (version 1.0 and 2.0 section 12).

| Gate | Evidence or approval |
|---|---|
| Technical acceptance | Database, Stripe test payments, email delivery and scheduled jobs verified in staging. |
| Security and privacy | MFA, account permissions, abuse controls, privacy wording and retention agreed. |
| Operational resilience | Backups, restoration, monitoring and incident ownership demonstrated. |
| Trustee user acceptance | Core sender and recipient journeys tested; outstanding defects resolved or accepted. |
| Campaign approval | Beneficiary information, artwork, donation wording and public launch date approved. |

Non waivable gates (proposed in v2.3 and implemented as hard gates in the application): approved public privacy text (D-14); privileged MFA; verified payment events (Stripe keys, webhook secret and a signed event received); an off server backup within 48 hours and a restore rehearsal within 60 days; a recorded security assessment reference (G-SEC) and a recorded support route test (G-SUP). If any fails in production, sending stays locked and the launch override cannot unlock it. Waivable by a limited Trustee authorised exception, with risk, mitigation, approver and expiry recorded: non critical campaign imagery or content changes and approved deferred UX features. In production the other required decisions can still be overridden by a restricted administrator with a recorded reason.

## 16 Build status and test evidence

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

### 16.1 Version 2.3 launch critical items (built 10 October 2026)

Automated tests after this work: smoke 52, contacts 14, admin 29, operations 33, Gift Aid 23, resilience 47; all pass. FR-146 to FR-149 and the earlier rows above are unchanged. No UAT, assistive technology audit, security assessment or staging run has taken place.

| Proposal | Status | What exists |
|---|---|---|
| FR-156 immutable artwork | Built | When a card leaves draft (free send or the start of a donation), the picture is copied to `data/art` under a name containing a content hash, and the send stores that name. Sent cards, My cards thumbnails and reported cards show the frozen copy, served from `/art/<name>` with a one year immutable cache. Replacing a design's file changes new cards only. Drawn designs have no file and are not frozen. Holding a design back or enabling it is already done by a campaign manager in Admin, and is audited. Year checks on artwork text are not possible automatically; the check stays a human one. |
| FR-157 payment reconciliation | Built, with a manual fallback | Every Stripe event is stored once by its id; replays are ignored; the same payment under a new event id still makes one donation and one dispatch. Refund events are imported (`charge.refunded`), expired checkouts return the card to draft, and wrong amounts, unmatched refunds, disputes and gifts received for unsent cards appear under Finance > Payment exceptions until finance records what was done. Nothing is charged, sent or refunded automatically. Disputes are listed but not otherwise handled. |
| FR-160 abuse limits | Built | Limits now also apply per account or key as well as per visitor: 5 submissions an hour per account (the proposed D-02 value), test cards per account, password recovery per email, reports per card. A hidden trap field on registration, recovery and report forms. Refused attempts leave an audit signal, and 20 or more in an hour raises an alert. Suspension already existed. Limits are placeholders until D-02 is approved. |
| FR-161 MFA, least privilege, access review | Mostly already true; one part added | Two-step sign in has been required for every admin page and action since the admin area was built, not just displayed, and a test now checks that every `/admin` route calls the server side role check and that every action in the permission map has a handler. Added: last sign in time, an Access review panel, a record of each review, and an alert when none has been done in 90 days (placeholder period). |
| FR-162 backups | Built | `backup` makes an AES-256 encrypted archive of the database and frozen artwork using `BACKUP_KEY`, and copies it off the server to `BACKUP_COPY_DIR` or emails it to `BACKUP_EMAIL`. `restore <file>` unpacks it beside the live data, never over it, checks integrity and row counts, and records the rehearsal. Health shows Unknown or Stale for the off-server copy and for the last rehearsal. Without a key or an off-server route it warns and exits with an error. Restoring a backup over the live database is a manual step by design. |
| FR-163 bounces and complaints | Built | Delivery events update recipient state and keep the provider's diagnostic. A hard bounce stops any later card to that address (it fails immediately with a clear message rather than retrying). A spam complaint opts the address out for every sender. Soft bounces change nothing beyond that card. The webhook already rejected requests without the correct key and forged content changes nothing. |
| Non-waivable gates (section 8) | Built | Readiness now shows six gates that no override can pass: privacy wording approved (D-14), two-step sign in, verified payment events (Stripe keys, webhook secret and one signed event received), an off-server backup within 48 hours and a restore rehearsal within 60 days, a security assessment reference (G-SEC), and a support route test reference (G-SUP). In production the campaign stays locked while any fails. The existing override still covers the other open decisions. |
| UX-12 hero stable within a visit | Built | The hero is chosen at random for a new visit and then stays the same for that visitor's session. |

Not built: FR-150 to FR-153 and FR-155 (R1.1); FR-154, FR-158, FR-159 and FR-164 (R2). Two earlier rows change: FR-129 now imports refund events from Stripe (charge.refunded) as well as manual entry, and FR-130 alerts also cover off server backup, restore rehearsal, payment exceptions, abuse and access review. FR-160 bot detection is limited to a hidden trap field and limits.

## 17 Needed before launch

Trustee decisions, each needing an owner, approved value, date and reference in Admin under Launch readiness: D-01 to D-10 from version 2.0; D-11 to D-13 (recipient donations, Gift Aid, Christmas Day delivery); D-14 wording and ownership of the privacy notice, terms and safeguarding statement; D-15 alert recipients and escalation; D-16 measures and the small number threshold. In production 13 of these are required before the campaign opens, unless overridden.

Content and evidence: a corrected "Woggle all the way" picture; final approved wording for the privacy notice, terms, safeguarding statement and Gift Aid declaration; confirmation of the charity name and eligibility for Gift Aid; the Treasurer's retention periods for finance records and Gift Aid declarations; confirmation of colours against the official Scouts guidance and with a contrast tool.

Testing and operations: the assistive technology tests; structured Trustee testing using the rehearsal tool; a security and privacy review; a load test; staging on cPanel with HTTPS, cron jobs, Postmark domain authentication and Stripe in test mode; backups copied off the server with a restore rehearsal; a named support contact and hours.

Also from v2.3: set `BACKUP_KEY` and an off server route (`BACKUP_COPY_DIR` or `BACKUP_EMAIL`); record the security assessment (G-SEC) and the support route test (G-SUP); the Trustees confirm or change the proposed limits (5 submissions an hour, 90 day access review) and the list of non waivable gates.

## 18 Approval and change record

### Approval

Scope and acceptance criteria: Trustee and project lead approval pending.
Donation arrangements and target: Treasurer and Trustees approval pending.
Privacy, reporting and retention: responsible administrator and Trustees approval pending.
Artwork and brand approval: 7th Swindon Scouts approval pending.

Trustee approval date: ____________________
Approved by: ____________________
Release decision: Approved / Approved with conditions / Not approved

### Change record

| Version | Date | Change |
|---|---|---|
| Baseline v2.3 | 10 October 2026 | Merges versions 1.0 to 2.2 and the v2.3 proposals into one document. Wording is carried over from the sources; where an earlier document was replaced, the later wording is shown and marked amended. Scenarios AC-62 to AC-72 are grouped because the source lists more scenarios than identifiers. Section 16 records build status. No requirement from an earlier version has been removed. |
| 2.3 proposed | 10 October 2026 | FR-150 to FR-164, AC-110 to AC-143, launch gates (Unified Development Spec). |
| 2.2 | 10 October 2026 | Blue scheme and logo, twelve designs, SQLite pilot, Gift Aid controls, FR-146 to FR-149, AC-106 to AC-109, build status. |
| 2.1 | 10 October 2026 | FR-131 to FR-145, AC-86 to AC-105, D-11 to D-16, S40 to S48; blue palette replaces purple (FR-096 to FR-099, AC-58 to AC-61). |
| 2.0 | 10 October 2026 | Proposed pilot defaults for D-01 to D-10. |
| 1.9 | 10 October 2026 | Development readiness review; FR-124 to FR-130 and AC-79 to AC-85; ten decision and evidence items. |
| 1.8 | | Administration screens S30 to S39 and mobile layouts; FR-117 to FR-123, AC-73 to AC-78. |
| 1.7 | | Private contact groups; FR-111 to FR-116, AC-69 to AC-72; S28 and S29. |
| 1.6 | | Private address book in launch scope; FR-100 to FR-110, AC-62 to AC-68; S25 to S27. |
| 1.5 | | Verified local Scout branding; FR-096 to FR-099, AC-58 to AC-61. |
| 1.4 | | Administration configuration; FR-081 to FR-095, AC-49 to AC-57. |
| 1.3 | 9 October 2026 | Revised journeys; FR-077 to FR-080, AC-45 to AC-48. |
| 1.2 | 9 October 2026 | Comparative research; FR-058 to FR-076, AC-33 to AC-44. |
| 1.1 | 9 October 2026 | FR-038 to FR-057, AC-19 to AC-32; status meanings, cancellation, opt outs, closure, support, finance exports, role separation. |
| 1.0 | 9 October 2026 | Simplified branded FRD: FR-001 to FR-037, AC-01 to AC-18. |

Source for the original scope: 7th Swindon Scouts Christmas ECard Simplified FRD Branded version 1.0, issued 9 October 2026. Competitor capabilities in versions 1.2 and later came from desk research of official product pages; no implementation inspection or live usability test of those versions was performed.
