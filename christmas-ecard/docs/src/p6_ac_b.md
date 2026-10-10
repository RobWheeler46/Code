
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

### Illustrated card scenarios AC-106 to AC-109 (version 2.2)

| ID | Scenario and expected result |
|---|---|
| AC-106 | The gallery shows only enabled designs; a held back design and its direct link are unavailable; the hero never shows a disabled design. |
| AC-107 | Every illustrated design has alternative text containing its printed words. |
| AC-108 | Thumbnails keep the headline in view on desktop and phone, and the full card shows the whole picture. |
| AC-109 (amended by FR-156) | Replacing a design's image file changes it for new selections without code changes. Cards already sent keep the picture they were sent with. |

