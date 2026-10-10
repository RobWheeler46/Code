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

