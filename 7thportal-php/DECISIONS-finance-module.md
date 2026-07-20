# Decisions needed before building the finance module (Expenses, Mileage, Treasurer, Trustee dashboard)

This is a checklist for trustees, the Treasurer and the Group Leadership Team to work through **before** any code is written for the new scope in `7thPortal_Final_Pack.zip` (the Expenses & Reimbursements, Mileage Claims, Treasurer payment queue and Trustee Board finance dashboard modules).

It exists because the FRD's own "Development Readiness Gap Review" (section 26) says these are governance decisions, not technical ones - the app can be built any number of ways once these are answered, but building before they're answered risks having to rework approval logic, data handling or access rules after the fact. This does **not** cover the parent/leader/gallery portal already live at `digital.7thswindon.org.uk` - that's unaffected and needs no new decisions.

How to use this: work through each item, write the decision in the "Decision" line (even "not yet, use X as a placeholder for the pilot" is a valid answer), and keep this file updated as the source of truth. Nothing here is copied verbatim from the FRD - the *why* below is a summary of the FRD's reasoning, this is a decisions doc, not the FRD.

---

## P0 - blocks starting the finance module build

### 1. OSM authentication and integration route
- **Question:** Does anything about the *existing* OSM integration model need to change for finance features, or does the current leader/admin-only OSM login plus locally-issued parent accounts stay as-is?
- **Why it matters:** Expense claims are submitted by leaders, who already log in via OSM in the current build - this is likely "no change needed," but worth confirming explicitly since the FRD treats it as a fresh open question.
- **Decision:** Stay as-is. No change to the current OSM leader/admin login model - leaders submit expense/mileage claims through the same accounts they already use.

### 2. Role and permission matrix
- **Question:** Sign off the full list of who can see/do what: Leader (submit claims), Section approver, Event approver, Treasurer, Chair, Trustee viewer, Admin. Does every section/event need its own named approver, or can one person cover several?
- **Why it matters:** Wrong-role visibility into claims or finance data is the main risk in this module - claims must route to a real, current person, and a user must never be able to approve their own claim (FRD EXP-003, a "Must").
- **Decision:** Accept the FRD's role list as-is (Leader, Section approver, Event approver, Treasurer, Chair, Trustee viewer, Admin) - no changes to the role types themselves.
- **Still open:** the actual named person (and deputy) per section/event account - a role type isn't enough for the system to route a claim, it needs a real user account to route to. Fill in under item 3's account table once section leads/budget holders are confirmed.

### 3. Expense accounts, approvers and thresholds
- **Question:** What are the actual budget accounts for the pilot (e.g. Beavers, Cubs, Scouts, Explorers, Group, one or two camps)? Who is the named approver and deputy for each? What are the £ thresholds for second approval?
- **Why it matters:** Claims can't route anywhere without this table existing first - it's the core data the whole approval engine runs on. FRD suggests starter thresholds (up to £50 single approver; £50-£250 approver + Treasurer; over £250 Treasurer + Chair/Trustee Board) - confirm or adjust.
- **Decision:** Accept the FRD's suggested threshold structure as-is:
  - Up to £50 → single account approver
  - £50-£250 → account approver + Treasurer review
  - Over £250 → Treasurer + Chair or Trustee Board review
  - Outside approved budget → Trustee Board or nominated finance approval
- **Still open:** the actual list of accounts and named approver/deputy per account for the pilot (e.g. who is the Cub Section Lead/budget holder that claims route to) - needed before the routing engine has real data to route against.

### 4. Payment/bank detail handling
- **Question:** Are claimants' bank details ever stored in 7thPortal, entered per-claim, restricted to Treasurer view only, or kept entirely outside the system (i.e. Treasurer already has this via the existing bank/payment process)?
- **Why it matters:** This is a real security/liability decision, not a UI detail - storing bank details at all is a decision to make deliberately, not a default to fall into.
- **Decision:** Outside. Bank details are not stored in 7thPortal - claims reference the payment as handled via the existing bank process, no account numbers held in-app.

### 5. Data retention periods
- **Question:** How long are photos, albums, reported-photo records, expense claims, receipts, mileage records, exports and audit logs kept for?
- **Why it matters:** Needed before the retention/deletion jobs can be built - too long is a privacy risk (especially for photos of young people), too short weakens the audit/finance trail HMRC or an independent examiner might expect.
- **Decision:** 2 years for all categories listed (photos, albums, reported-photo records, expense claims, receipts, mileage records, exports, audit logs), unless a specific category needs a different period - flag here if any do.

### 6. Hosting, backup, monitoring and support ownership
- **Question:** Who is the named system owner, admin owner, and Treasurer-side owner for this? What's the backup/restore process for the finance data specifically (separate from the existing gallery/parent-portal backup, since a lost expense/receipt record is a real accounting problem)?
- **Why it matters:** This module holds financial records that may need to survive an audit or examiner review - "the app just runs on shared hosting" isn't itself an answer for backups/restore testing.
- **Decision:** System owner and admin owner: Rob (the user). Treasurer-side owner (day-to-day finance process/data ownership) still to be confirmed - presumably the Group's actual Treasurer if that's a different person. Backup/restore process for finance data specifically: not yet defined.

### 7. Photo gallery safeguarding defaults (carried over, still open)
- **Question:** Does every album need two-leader approval, or only certain types? Are albums visible by section membership or event attendance by default? Is a reported photo auto-hidden pending review, or does it stay visible until a moderator acts?
- **Why it matters:** Already flagged as open in the earlier wireframes pack and still unresolved - the gallery module in production today does **not** yet implement two-leader approval, watermarking, or a report-photo/moderation flow (those were explicitly descoped to "layout only" last time, pending exactly these answers).
- **Decision:** "Use the pilot section defaults" - note the FRD doesn't state explicit defaults for these three sub-questions the way it does for expense thresholds (item 3), so this is my inferred pilot-scale reading of its "Safeguarding first" principle and general pilot-small-first guidance, **not a quoted FRD default - flag if this isn't right**:
  - Single-leader approval (the album owner) for the pilot's one event album + one general album, not two-leader approval - revisit if the pilot expands.
  - Visibility by section membership by default (simpler than event-attendance-based visibility at pilot scale).
  - A reported photo is auto-hidden immediately pending review, not left visible - the more cautious option, consistent with "Safeguarding first."

### 8. Pilot scope (build sequencing)
- **Question:** Confirm: which 1-2 sections, how many parent/leader pilot users, which gallery albums, and which 2-3 expense accounts will be used for the first four-week pilot before wider rollout?
- **Why it matters:** The FRD is explicit that trying to launch parent portal + gallery + expenses + dashboards to everyone at once is the highest-rated delivery risk in the whole document.
- **Decision:** Use the FRD's own "Recommended first pilot" (section 25.10) as the pilot definition:
  - One or two sections, not the whole Group.
  - A small set of parent users, leaders, one gallery approver, Treasurer, one administrator.
  - One event album and one general section album for the gallery pilot.
  - Two or three expense accounts only at first (e.g. Cubs, Scouts, Group).
  - Full claim workflow end-to-end, but actual payment stays in the existing bank process.
  - Review after four weeks before expanding to all sections.
  - **Still open:** which specific one or two sections, and which named users, for this Group.

---

## P1 - needed before the finance module ships, not before starting

### 9. Mileage rates and evidence
- **Question:** What's the actual £/mile rate per vehicle type (car/van, motorcycle, bicycle), how often is it reviewed, and is route evidence (e.g. a map screenshot) required or optional? Confirm the declaration wording claimants must agree to.
- **Decision:** Rates confirmed via `7th_Swindon_Scouts_Expenses_and_Mileage_Policy_Multi_Item_Claims.docx` section 13 - the 2026/27 HMRC AMAP rates: car/van 55p/mile for the first 10,000 miles in the tax year then 25p/mile, motorcycle 24p/mile flat, bicycle 20p/mile flat, effective from 6 April 2026. Route evidence and rate-review cadence still open - route evidence isn't built (optional per policy, not required at submission).

### 10. Trustee dashboard confidentiality
- **Question:** Does the Trustee dashboard show claimant names by default, or aggregated/anonymised figures with names only on drill-down? Are hardship-fund claims visible to anyone beyond Chair + Treasurer?
- **Decision:** _______________________________________________

### 11. Accessibility and mobile testing approach
- **Question:** Is WCAG 2.2 AA the actual target, and is there a specific set of devices (e.g. the phones leaders already use for photo upload) this should be tested on before pilot?
- **Decision:** _______________________________________________

### 12. Multi-item claims architecture
- **Question:** Should one claim be able to contain several items (receipt purchases and mileage journeys mixed together, across different accounts), with approval/rejection/payment happening per item - or should the simpler one-claim-one-amount model stand?
- **Decision:** Rebuild to the multi-item model, per `7thPortal_Final_Pack_with_Expenses_Technical_Appendices.zip` (`7thPortal_Expenses_Data_Model.docx` / `_Database_Schema.docx` / `_API_Requirements.docx`). A claim (`expense_claims`) is now a header; `expense_claim_items` carries the account, category, receipt(s), approval state and payment state per item, so one claim reference can cover a whole camp weekend's mixed costs. Simplified vs. the technical appendices for this project's actual scale (see README "Expenses, mileage and finance module" for the full list: integer IDs not UUID, no malware scanning, no idempotency/ETag concurrency control, no true split-amount partial payment, and no generic `ApprovalRule` matcher table since the real policy only ever varies by account + a global threshold pair).
- **Also decided:** the "Leader document library" feature that appeared alongside the multi-item wireframes was explicitly skipped - unrelated to expenses, not part of any prior decision.

---

## What happens after this is filled in

Once the P0 section above has answers (even provisional "pilot" answers), the existing MVP Build Plan in the FRD (section 25) gives a phased build order: platform foundation → parent/child portal (already live) → gallery pilot (already live, layout-only) → expenses/mileage pilot → reporting/trustee dashboard. Bring the completed checklist back and the finance module scaffold (data model, claim states, approval routing, Treasurer queue) can be built against real answers instead of placeholders.
