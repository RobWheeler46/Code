# 7th Swindon Scouts Christmas E Card Functional Requirements

Version 2.1 additions | Draft for Trustee and development review

This document adds to version 2.0. Everything in version 2.0 continues to apply. It adds FR-131 to FR-145, AC-86 to AC-105, decisions D-11 to D-16, and screen states S40 to S48. It is written in the same format so it can be merged into the main FRD.

Nothing here activates a policy value. Wording that has legal effect (privacy notice, terms, safeguarding statement, Gift Aid declaration) must be written or approved by the named owner and checked against current guidance before launch. Numbers shown as proposed need approval.

## A Launch requirements: protecting the Group and its supporters

| ID | Requirement | Priority |
|---|---|---|
| FR-131 | Publish a plain-language privacy notice, cookie statement and terms of use, linked from every page, the registration form, recipient emails and the card view. The privacy notice states who runs the service, what is stored (sender account, drafts, recipient names and emails, greetings, contacts, donation records, opt-outs), why, for how long, who receives it (email and payment providers), and how to ask for access, correction or deletion. State that the service sets only essential cookies and no analytics or advertising cookies. Explain to recipients, on the card page and in the email, why they received it, that the sender asked for it, that it is a one-off email, and how to stop further cards. Record an owner and a review date. | Must |
| FR-132 | At registration, require the sender to confirm they are 18 or over and accept the terms of use and acceptable-use rules. Store the version accepted and the time. Ask again when a material version changes, before the next submission. Do not offer accounts to under-18s. Show a short safeguarding statement approved by the Trustees: the service does not collect children's data, is not for contacting children the sender does not know, and how to report a concern. | Must |
| FR-133 | Let authorised administrators suspend a sender account with a recorded reason. Suspension blocks new submissions and test sends, cancels the account's unclaimed queued deliveries, and shows the sender a neutral message with the support route. It does not by itself withdraw cards already sent, delete data or clear opt-outs. Withdrawal of existing cards remains a separate audited decision. Reinstatement is possible, audited and requires a reason. Suspended accounts cannot use the address book to send. Do not disclose other people's reports to the sender. | Must |
| FR-134 | Deliver operational alerts to named people. For stalled queue, unresolved payment beyond the agreed threshold, failed scheduled job, failed backup and unresolved deliveries, send a timestamped alert to the configured recipients with severity, a link to the relevant admin view and an acknowledgement action. Escalate unacknowledged alerts to a second named person after an agreed time. Send a daily summary while the campaign is open. Do not rely only on the email provider being healthy: provide a second route such as a monitored mailbox plus the health page. Never include private greetings or secrets in an alert. | Must |
| FR-135 | Provide a launch readiness view for restricted administrators and the project lead. It lists the decision register (D-01 to D-16) with the owner, approved value, approval date and reference for each, plus the launch gates in section 12. Items without recorded approval show as Open. Opening the campaign while a launch Must decision is Open requires an explicit override with a reason, which is audited. Show clearly whether the environment is Staging or Production. Staging shows a visible banner, uses test payment and email modes only, and can be reset to demonstration data. A reset is impossible in production. | Must |
| FR-136 | Support a Trustee rehearsal on staging. An administrator can send real test cards to an approved allow-list of addresses, with the payment provider in test mode, and record the result of each UAT task against its acceptance scenario. Allow-listed sends are labelled as tests in history and excluded from fundraising and card counts. | Should |

## B Launch requirements: sender experience

| ID | Requirement | Priority |
|---|---|---|
| FR-137 | Enter recipients as rows, each with name, email and an optional personal message revealed on request. Provide Add another recipient and Remove, show the count against the limit, validate each row inline, keep valid rows when another is wrong, and focus the first error. Paste of several lines (name, email) fills rows. The control works by keyboard and on a phone, and each row has a visible label. The one-box text format used in the prototype is not the specified experience. | Must |
| FR-138 | Before sending, let the sender preview the recipient email for any chosen recipient: subject, From display, HTML and plain-text versions and the position of the open, report and stop-cards links, using a dummy link that cannot open a real card. | Should |
| FR-139 | Provide aggregate campaign measures to authorised administrators: drafts started, cards submitted, senders who donated, share of submitted cards by status, average donation, and the stage where drafts are abandoned. Counts under an agreed small number are shown as "fewer than N". No individual behaviour tracking, fingerprinting, third-party analytics or advertising pixels. Definitions are shown on the page. | Should |

## C Decision-dependent requirements

These apply only if the named decision is taken to include the feature. If deferred, record the decision and make sure no design choice blocks it.

| ID | Requirement | Priority |
|---|---|---|
| FR-140 | Recipient donation (D-11). On the opened card offer an optional "Support 7th Swindon Scouts" link to the same payment provider flow. The amount and donor identity are never shown to the sender or other recipients and are not added to the card. The donation is recorded against the campaign and, for fraud and reconciliation only, a reference to the card it came from, which is not shown to the sender. Receipts and refunds follow FR-021 to FR-023. The wording is never pressuring and sending, reading and replying remain free. The link is hidden when the campaign is closed or the card is withdrawn. | Should if included |
| FR-141 | Gift Aid (D-12). If included, capture an approved declaration and only the donor details needed to claim, kept separate from card data, with restricted access, an export for the claim, correct treatment of refunds, and a record of the declaration wording version shown. The Treasurer confirms the Group's eligibility to claim before it is offered. The declaration is optional and never blocks a donation. If deferred, store the donor's name on donations only if the privacy notice allows it. | Must if included |
| FR-142 | Christmas Day delivery (D-13). Offer Send now or Deliver on 25 December at one approved time in Europe/London. No free date selection. Resolve any donation at submission using the existing payment recovery. Scheduled cards are held, shown in the sender's history as Scheduled (not Queued), can be edited or cancelled until the delivery is claimed, and are rechecked at dispatch for suppression, pause, suspension and campaign rules. Apply an agreed late-send policy after an outage. State that exact inbox arrival time is not guaranteed. | Must if included |
| FR-143 | Printable card. Provide a print stylesheet or downloadable page showing the artwork, greeting and display names only. It contains no email addresses, tokens, donation information or live links, and fits A4 and US Letter. Explain that a printed copy outlives expiry or withdrawal. | Should |
| FR-144 | Next-year reminder. Offer an unticked, optional box on registration or in account settings to be emailed once next November about the campaign. Store the choice separately from the account, honour withdrawal in every message, and send no other marketing. Without this consent the service sends no promotional email. | Should |
| FR-145 | Accessible, human-written artwork descriptions for all designs (FR-083), a reading-level check of all sender and recipient wording against the agreed plain-language standard, and an assistive-technology test plan (screen reader on phone and desktop, keyboard only, 200 percent zoom) with results recorded before launch. | Must |

## D Screen inventory additions

| Screens | Purpose |
|---|---|
| S40 | Privacy notice, cookies and terms (public) |
| S41 | Sender suspension and reinstatement (administration) |
| S42 | Launch readiness and decision register (administration) |
| S43 | Recipient rows editor (replaces the entry part of S03) |
| S44 | Recipient email preview (sender) |
| S45 | Campaign measures (administration) |
| S46 | Recipient donation prompt (conditional on D-11) |
| S47 | Gift Aid declaration (conditional on D-12) |
| S48 | Delivery date choice and Scheduled status (conditional on D-13) |

These are screen states, not steps. Version 2.0 plus these gives a planned inventory of 48 states.

## E Acceptance scenarios

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

## F Decisions required

| ID | Decision or evidence | Accountable owner | Required by |
|---|---|---|---|
| D-11 | Include or defer recipient donations (FR-140), and the approved wording. | Treasurer with Trustees | Before the card view is frozen |
| D-12 | Include or defer Gift Aid (FR-141); confirmation of eligibility; declaration wording; retention of declaration records. | Treasurer with Trustees | Before payment implementation is frozen |
| D-13 | Include or defer Christmas Day delivery (FR-142); the approved time; late-send policy. | Campaign owner with operations owner | Before the sender journey is frozen |
| D-14 | Wording and ownership of the privacy notice, terms, acceptable-use rules and safeguarding statement, and a review date. | Trustees with the responsible administrator | Before any public launch |
| D-15 | Alert recipients, the second route, escalation time, daily summary recipients and out-of-hours expectations. | Operations owner with project lead | Before operational sign-off |
| D-16 | Success measures and any targets; the small-number threshold; who reviews them and when. | Project lead with Campaign owner | Before campaign opens |

## G Recommended handling

Treat FR-131, FR-132, FR-133, FR-134, FR-135, FR-137 and FR-145 as launch Musts. They close privacy, safeguarding, abuse and operational gaps that the current requirements leave open. Treat FR-136, FR-138, FR-139, FR-143 and FR-144 as launch Shoulds that can be dropped if time is short. FR-140, FR-141 and FR-142 depend on decisions D-11 to D-13; the two with the largest fundraising effect are recipient donation and Gift Aid, so decide them early.

FR-133 adds to the audit list in FR-050, and FR-134 completes FR-130. FR-137 replaces the entry method inside S03 without changing FR-012 or FR-013.

## H Change record

Version 2.1 adds FR-131 to FR-145, AC-86 to AC-105, decisions D-11 to D-16 and screens S40 to S48. It does not change any version 2.0 requirement. No application code is changed by this document, and the legal wording it calls for has not been written or reviewed.
