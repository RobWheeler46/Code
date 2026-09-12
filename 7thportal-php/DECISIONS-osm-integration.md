# Decisions needed before using live OSM data in the application

This is a checklist for the Group Leadership Team and trustees to work through **before** any Online Scout Manager (OSM) member data is pulled into 7thPortal and used by features. It follows the same pattern as `DECISIONS-finance-module.md`: work through each item, write the answer on the "Decision" line, and keep this file as the source of truth. A "not yet, park it" answer is a valid decision.

## Why this doc exists now

The portal was originally built on the assumption that OSM data could not be read from the server, so it uses admin-created parent accounts, manual member linking, and one read-through service connection. The OSM Discovery feature (Admin > Integrations > OSM > Discovery) has now **tested that assumption against the live server and found it is partly wrong**. With the service connection, the server can actually read:

- the 9 real sections and their names and meeting days;
- the member roster per section (about 384 references), including each member's name and patrol or six;
- patrol and six groupings (about 50);
- per-section membership counts;
- the current term per section;
- the programme endpoint (readable; it was empty only because a new term had just started);
- the badge catalogue, and per-member badge progress.

It could **not** read events, attendance, risk assessments, event payments, custom or flexi fields, quartermaster or finance data, so those are out of scope for now.

This changes what the app could do, but reading real member data also turns questions that were previously theoretical (retention, consent, who sees what) into live ones. Those are governance decisions, not technical ones. Building before they are answered risks putting member personal data into the database in a shape that later has to be reworked or removed. This doc does not change anything already live; it gates the *new* use of OSM data.

A note on evidence: everything above is what Discovery actually read on the live server, not what OSM's documentation claims. Re-run Discovery after any OSM subscription, permission or section change to confirm the picture still holds before relying on it.

---

## Decisions log

**2026-09-12 - Badges Awarded summary.** A first feature drove these P0 answers. The goal is
a per-section count of badges awarded. Evidence: OSM's badge catalogue read
(`getAvailableBadges`) returns which badges each section offers but carries no award counts,
so counting awarded badges requires reading each member's badge record (Tier B). The design
chosen reads Tier B but stores only Tier A aggregate counts - no member name and no per-child
progress is ever written to the database. On that narrow basis items 1, 2, 4 and 5 are settled
below; item 3 (consent) is the one open blocker, and no live member read runs until it is
confirmed.

---

## P0 - blocks starting any live OSM data work

### 1. Read model: cached mirror, not live reads
- **Question:** Should features read a periodically synced, local copy of OSM data (a mirror), rather than calling OSM live on each page load?
- **Why it matters:** The server is rate limited. Discovery saw OSM begin throttling after roughly two dozen rapid calls. Reading OSM live on every page view would be slow and would trip the throttle. A scheduled or manual sync into the local database, paced and rate-limit aware, is the only workable pattern, and it also means features keep working when OSM is briefly unavailable. This is a real architecture decision because it introduces a second copy of member data that has to be kept fresh, secured and eventually removed.
- **Recommended:** Yes, mirror into the local database on a schedule, with a manual "Sync now" for admins. Features read the mirror. Never read OSM live in a request path.
- **Decision:** Decided (2026-09-12): Yes. Features read a locally cached mirror, refreshed by a paced, admin-triggered "Refresh from OSM"; OSM is never read in a page-load path. This is already how the Badges Awarded summary works.

### 2. Which data classes may be stored, by sensitivity
- **Question:** Which of these three tiers is 7thPortal allowed to hold in its own database?
  - Tier A - counts and structure only: section list, patrol or six names, membership counts. No individual people.
  - Tier B - member references: member name, OSM member id, section, patrol. Enough to build a roster and match parents.
  - Tier C - contact, emergency and medical fields from the member contact grid.
- **Why it matters:** This is the core privacy decision the whole design hangs on. Tier A is low risk and unlocks the capacity and structure features on its own. Tier B is what most roster and linking features need, and it is real personal data of children, so it brings retention and access rules with it. Tier C is safeguarding-sensitive and is exactly the territory the master FRD keeps behind a controlled decision; the contact grid can technically be read, but "can" is not "should."
- **Recommended:** Approve Tier A now. Approve Tier B only with items 3, 4 and 5 answered. Keep Tier C out of scope entirely until a separate, explicit safeguarding decision with trustee sign-off.
- **Decision:** Decided (2026-09-12): Tier A approved. For the Badges Awarded summary, the sync may READ Tier B member badge records but STORES only Tier A aggregate counts per section - no member name and no per-child progress is written to the database. This does NOT approve storing Tier B itself (rosters, member references, parent matching); that remains a separate future decision, still gated on items 3, 4 and 5 for the storing case. Tier C stays out of scope (see Hard line).

### 3. Consent and lawful basis for holding member data
- **Question:** On what basis does 7thPortal hold the member data in the approved tier, and does that basis already exist through OSM and the group's existing privacy notice, or is a new notice or consent step needed?
- **Why it matters:** OSM is the system of record and families have already consented to the group holding their data there. Copying a subset into 7thPortal needs a clear basis, especially for children's data. This is a question for whoever owns data protection for the group, not a technical default.
- **Recommended:** Confirm with the group's data controller that the existing OSM consent and privacy notice cover an internal operational copy; update the privacy notice to name 7thPortal as a processor of the specific fields if needed, before Tier B data is synced.
- **Decision:** PENDING (2026-09-12) - the one open blocker. To be confirmed by the group's data controller. The ask here is narrow: a transient read of members' badge completion to produce per-section counts, with nothing personal stored. No live member read will run until this is confirmed. Recommended basis to confirm: the existing OSM consent and privacy notice cover an internal operational read that stores only aggregate counts; update the privacy notice to note 7thPortal reads (does not store) this field if the controller judges it needed.

### 4. Access rules: who can see synced member data
- **Question:** Who may see the synced roster and member details, at what scope? For example: a section leader sees only their own sections; group leadership and admins see all; treasurers and trustees see counts and structure but not individual member detail; parents see only their own children.
- **Why it matters:** The moment real member data is in the app, wrong-role visibility is the main risk, the same way it was for finance claims. The rule must be section-scoped and enforced on the server, not just hidden in the interface.
- **Recommended:** Section leaders see their own sections' rosters; group leadership and admin see all; treasurer, chair and trustee roles see Tier A counts and structure only; parents see only their linked children. Enforce server side, reusing the capability and section-scoping model already built for Patrol Points.
- **Decision:** Decided (2026-09-12) for the aggregate case: because the Badges Awarded summary stores only counts, viewing follows the Tier A rules already built - any leader or trustee role sees the per-section counts; parents do not. Enforced server side (osmBadgesCanView); the refresh that spends OSM budget is admin only. If any Tier B data is ever STORED, the fuller section-scoped rule in the recommendation must be built and this line revisited.

### 5. Retention and removal
- **Question:** How long is synced member data kept, and what happens when a member leaves a section or is removed in OSM, or when the group stops using 7thPortal?
- **Why it matters:** A mirror that only ever adds data quietly becomes a stale, uncontrolled second copy. Removal has to be part of the design from the start, not added later. A member who leaves OSM should disappear from the mirror on the next sync, and there needs to be a defined maximum age for anything the sync stops seeing.
- **Recommended:** The sync is authoritative and destructive in one direction: anything no longer returned by OSM is removed from the mirror on the next successful sync (mirroring how an expired access group drops access in Patrol Points). Set a hard maximum age for orphaned records, and document a full-wipe path for decommissioning. Align the maximum age with the retention already agreed for the finance module.
- **Decision:** Decided (2026-09-12) for the aggregate case: trivial, because only per-section counts are stored and each successful sync overwrites them - there is no per-child record to retain or remove. A section no longer returned by OSM keeps its last row until the next successful sync replaces it (a prune-on-missing step is a later refinement). If any Tier B data is ever STORED, the destructive-sync, maximum-age and full-wipe rules in the recommendation must be built and this line revisited.

---

## P1 - needed before the sync is switched on, but not before design starts

### 6. Sync identity and permissions
- **Question:** Which OSM connection does the sync read through - the existing service connection, and is the OSM account behind it the right one (it currently sees all 9 sections)?
- **Why it matters:** Discovery showed the service connection has full section access, while an individual administrator's own OSM sign-in returned no sections. The sync should read through a known, least-privilege account that sees exactly the sections the group wants mirrored, and no more.
- **Recommended:** Use the existing service connection. Record which OSM identity it is and review it if sections appear or disappear in Discovery.
- **Decision:**

### 7. Sync cadence and rate-limit handling
- **Question:** How often does the mirror refresh - daily overnight, manually on demand, or both - and how does it behave when OSM throttles mid-sync?
- **Why it matters:** Too frequent and it wastes the rate-limit budget for no benefit, since section rosters change slowly. Mid-sync throttling must leave the previous good data in place rather than half-updating.
- **Recommended:** Once daily overnight, plus a manual "Sync now" for admins, paced well under the throttle. A throttled or failed sync keeps the last good mirror and is flagged, never partially overwrites (the same fail-safe stance Discovery already takes).
- **Decision:**

### 8. Parent-to-child linking by member id
- **Question:** Should the app automatically match existing and new parent accounts to their children using the OSM member id from the roster, and how are ambiguous or unmatched cases handled?
- **Why it matters:** This is the biggest day-to-day win - it removes most manual linking - but automatic matching can get it wrong, and a wrong link shows one family another family's child. It needs a confident match key (the OSM member id) and a manual review path for anything uncertain.
- **Recommended:** Auto-link only on an exact OSM member id match; queue everything else for an admin to confirm; never guess from names alone. Keep the current manual linking as the fallback.
- **Decision:**

### 9. Names on or off for the first phase
- **Question:** For the initial build, are individual member names shown, or does the first phase run on counts and structure only (Tier A) with names held back until the roster features are proven?
- **Why it matters:** It is possible to deliver real value (capacity, section health, patrol structure) with no individual names at all, which lets the sync and its controls be proven on low-risk data before any child's name is displayed.
- **Recommended:** First phase Tier A only, names synced but not surfaced until item 4's access rules are built and checked.
- **Decision:**

---

## P2 - can be decided during the build

### 10. Which features are wired to the mirror first
- **Question:** In what order are the candidate features built, and which are deferred?
- **Why it matters:** Sequencing keeps each step shippable and lets the low-risk wins land first.
- **Recommended build order** (each step gated by the P0 answers above):
  1. Section list and per-section counts feed the existing Sections and capacity dashboard. Tier A only, no names.
  2. Patrol and six structure, and the roster, become available to section-scoped leaders. Tier B, behind item 4's access rules.
  3. Patrol Points team and participant seeding from real patrols and members.
  4. Parent-to-child auto-linking by member id (item 8).
  5. Badge opportunity view per section, using catalogue plus per-member progress.
  6. Programme feeds Leader Today, Meeting Mode and the calendar, once a term has entries.
- **Decision:**

### 11. Programme and badges refresh separately
- **Question:** Do programme and badge data, which change more often and by term, sync on the same cadence as the slow-moving roster, or on their own schedule?
- **Why it matters:** Roster changes slowly; programme can change weekly. Forcing them onto one cadence either wastes calls or leaves programme stale.
- **Recommended:** Roster and structure daily; programme and badges on demand from the relevant leader view, cached briefly. Decide once items 1 and 7 are settled.
- **Decision:**

---

## Out of scope until a supported read exists

Events, attendance, risk assessments, event payments, custom or flexi fields, quartermaster and finance stay local or manual. Discovery could not read them from the server, so no feature should assume them. Re-run Discovery periodically; if any of these move to Available, revisit this doc rather than wiring them in ad hoc.

## Hard line

Tier C contact, emergency and medical data is not synced or displayed under any of the decisions above. Enabling it is a separate decision with its own trustee sign-off and acceptance evidence, consistent with the master FRD's controlled open decisions on safeguarding data. The fact that the contact grid can be read does not authorise reading it.
