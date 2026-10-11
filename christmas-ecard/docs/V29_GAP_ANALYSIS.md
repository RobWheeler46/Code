# Gap analysis: private Trustee member greetings (v2.8) and section leader suggestions (v2.9)

Date: 11 October 2026. Source: `7th_Swindon_ECard_AI_Build_Pack_v2_9_Section_Leader_Collaboration.zip`. This is the audit the pack asks for before any code (TG-01 and SL-01). No application code has been written for these features, on purpose: they handle personal data about children, and the pack itself says to stop at the blocking decisions below. Row by row detail is in `gap_matrix_v29.csv` (FR-189 to FR-224: 2 implemented, 11 partial, 23 missing).

## What the features are

Trustees prepare a one-off, individual eCard for each current Group member, delivered to the member's parent or carer, with a Trustee approval step by a second person and an operator who sends. Section leaders may suggest wording for members of their own section only; a Trustee must accept, ask for changes or decline each suggestion, and nothing a leader writes can be sent without that. It is private, switched off by default, and kept out of public pages, search engines and the ordinary sender accounts.

## What this application already has that the features can reuse

- **Delivery:** queueing, bounded retries, hard bounce suppression, recipient opt-out, hashed unguessable card links, pinned artwork and wording. The safest design is to deliver each member greeting as a normal card to the guardian's address, so these protections apply without new code.
- **Access:** two-step sign in for every admin page, a role map checked on the server for every action, the Group scope helper, and the confirmation, revision-check and audit patterns from the Library.
- **Content:** immutable design versions, the 12 approved designs, safe plain-text rendering, rehearsal sends to an allow list.
- **New this session:** every non public page now sends `X-Robots-Tag: noindex, nofollow, noarchive` and `Cache-Control: private, no-store` (card links, accounts, drafts, admin); the public home, help, privacy and terms pages are left indexable. This closes a gap the pack flags (FR-189) and applies to the existing app too. Tested over HTTP.

## What does not exist at all

- **Any member data.** There are no members, sections, guardians, eligibility flags or import. The app only knows senders and the people senders type in. The sender address book and groups are private to each sender and must never be used for a roster.
- Trustee roles and a batch and approval model (including "author cannot approve").
- Section leader accounts and time-limited section assignments. Leaders are not administrators today.
- A suggestion store with immutable revisions, and the decision records.
- The two-person approval of an exact snapshot, and an idempotent dispatch intent.

## Decisions needed from the Trustees before any code (the pack's blockers)

| Ref | Decision | Why it blocks | Safe default if undecided |
|---|---|---|---|
| D-T1 | Which Trustees may write, review, approve and send; is a second person mandatory | Defines every role and the approval rule | Author cannot approve; second person required |
| D-T2 | The authoritative member source and how data reaches this app (a reviewed export, or a permitted integration) | Nothing can be built or tested without it. No integration is assumed | None. Do not use made-up or real member data in development |
| D-T3 | Delivery only to a parent or carer? Policy for members aged 18 or over, and for Explorers run by the District | Decides who gets email | Parent or carer only; Beavers, Cubs, Scouts only |
| D-T4 | Lawful basis and communication preferences for a Trustee to member message, and who signs the purpose off | Legal and safeguarding | Feature stays off |
| D-T5 | Which leader appointments count, whether more than one leader can suggest for one member, and word limits | Scopes leader access | One current assignment per leader, one suggestion per member |
| D-T6 | Retention and deletion for member snapshots, suggestions and delivery evidence | Required before storing anything | Delete after the batch closes plus a short fixed period, to be set |
| D-T7 | Contribution deadlines, who can reopen, and what happens to late suggestions | Lifecycle rules | A deadline per section; late items go to a new batch |

The OSM question in the pack ("no integration is presumed") is open. Your 7thPortal project already has an OSM connection, but its Badges permission is blocked at the account level and nobody has confirmed that the Group may use member data from OSM for this purpose. That is a Trustee and data owner decision, not a coding one, and I have assumed nothing.

## Proposed order once the decisions exist

1. TG-02: Trustee roles, hidden private route and feature flag, everything off, with negative access tests. Needs D-T1 only, and can be built without any member data.
2. TG-03 to TG-04: a read-only snapshot importer and the batch and item tables with a state machine. Needs D-T2, D-T3 and D-T6.
3. TG-05 to TG-09: editor, preview and dry run, two-person approval, dispatch through the existing queue, delivery outcomes.
4. SL-01 to SL-09: leader accounts and assignments, scoped lists, drafting, the Trustee decision screen, and the rule that a pending suggestion blocks approval. Needs D-T5 and D-T7.
5. Independent safeguarding and security review, accessibility checks and Trustee sign-off before the flag is ever turned on.

Test data rule: development uses made-up members only, using obviously fake `.example` addresses, and no real member details go into prompts, screenshots, logs or this repository.

## What I can start now without any member data

TG-02 only: the Trustee roles, the hidden feature-flagged route, and the access tests that prove public, support, finance and ordinary campaign managers are refused. It would not store or show a single member.

## TG-02 built (11 October 2026)

The hidden, flagged Trustee greetings entry now exists and holds no member data. Four new roles (Trustee greeting editor, reviewer, approver and private greeting dispatch operator) are separate from the administrator roles: a restricted administrator, a campaign manager, finance or delivery support cannot open it, and the command line admin helper does not hand them out. The route `/private/trustee-greetings` answers with the same "Page not found" as a missing page for signed out visitors, ordinary senders and anyone without a Trustee greeting role, and for everyone while the switch is off. The switch (Admin > Administration > Private features, restricted administrators only) needs a reason and a Trustee approval reference to turn on, is audited, and switching off hides the console at once. The console only says it is not connected and lists who holds each role. The section leader switch exists but cannot be turned on because that part is not built. `tests/trustee_access_test.php` has 35 checks over real HTTP, including that no member, guardian or greeting table exists. The next step needs decisions D-T1 to D-T3 (roles, member source, routing).

## Pack v2.9.1: visual card picker for the Trustee editor (11 October 2026)

Read, not built. It only changes the per-member artwork choice inside the Trustee message editor (TG-05, FR-195), which cannot start until the member source and role decisions exist. What it asks for, so it is ready when TG-05 starts:

- Replace the text dropdown with a "Current eCard design" block (thumbnail, name, "Change card design" button) and a modal chooser built on a native dialog: thumbnails with names and selected state, a search box, a meaningful empty state, Escape and Cancel leave the choice alone, "Use [design]" is disabled until a valid design is picked, usable at 320 and 390 pixels without sideways scrolling.
- Options must come from the eCard Library for the batch's own campaign, never a fixed list and never unpublished designs. Today that is `gallery_cards()` for the one Christmas campaign; once other campaigns can go live it must take the batch's campaign.
- The choice is stored per member as a published design version id, so sent cards keep their snapshot. This matches how sends are pinned today (`design_version_id`).
- Changing a design must invalidate any batch approval in the same transaction and need a fresh approval; the server checks that the member belongs to the batch, the user can edit it, the batch is not dispatched, and the design is permitted for that campaign; each change is audited.
- A draft whose design is no longer published keeps showing its artwork, but a replacement is required before dispatch.

Nothing in the public sender journey changes. One possible reuse: the public compose page still picks a design from a plain dropdown, and the same thumbnail chooser would suit it. Not started.

## Removed (11 October 2026)

Decision: the service has registered users and administrators only. The Trustee greeting roles, the section leader role and screens, and the private feature switches were deleted from the code (commits 613e635 and earlier hold them if ever needed). Leftover role values on old user rows do nothing.
