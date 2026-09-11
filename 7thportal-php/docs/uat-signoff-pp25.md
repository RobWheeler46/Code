# Patrol Points v2.5 - Subject-Based Access - UAT Sign-off

**Feature:** Patrol Points v2.5 "Subject-Based Access" (Master FRD v3.3, dedicated FRD `7thPortal_Patrol_Points_FRD_v2.5_Subject_Based_Access.docx`, section 17; FR-PP-017..022)
**UAT pack:** `7thPortal_UAT_Pack_v3.3_Patrol_Points_v2.5.xlsx` (v2.5 Subject Access Delta), cases UAT-323A..328B / AC-323..328
**Build under test:** 2026-09-10 22:02 (local demo/UAT environment, port 8040)
**Date executed:** 2026-09-10
**Result:** 12 of 12 cases PASS. 0 open defects. Release gate met (all cases are "Must pass").

## How these were executed

Each case was run against the real running application (the same PHP routes and resolution
code the deployed build uses), driving the live HTTP API as the relevant demo persona and
reading back the server's own responses. Effective access was read through the
`GET /api/patrol-points/competitions/:id/effective-access` inspector endpoint; capability
enforcement (submit / approve / self-approval) was exercised through the real submit and
approve endpoints; coverage was exercised through the access-save and status-open endpoints,
which validate approval coverage server-side. Group expiry and authoritative role-membership
loss were induced and then re-evaluated to confirm access is recomputed dynamically rather
than cached.

Platform ceiling for reference: Approve / Score directly / Manage / Manage access are held
only by Section Leader, Assistant Leader, Group Leadership and Portal Administrator. Treasurer,
Chair, Trustee and Quartermaster cap at Submit; Parent caps at View. A competition capability
assignment can only narrow within this ceiling, never widen it.

## Results

| Case | AC | Title | Priority | Result |
|------|----|-------|----------|--------|
| UAT-323A | AC-323 | Assign capabilities using Role, Group and Person in one competition | P0 | PASS |
| UAT-323B | AC-323 | Subject type does not imply other capabilities | P0 | PASS |
| UAT-324A | AC-324 | Custom group contains users with different application roles | P0 | PASS |
| UAT-324B | AC-324 | Group membership alone grants no Patrol Points access | P0 | PASS |
| UAT-325A | AC-325 | Effective Access combines role and group grants | P0 | PASS |
| UAT-325B | AC-325 | Effective Access shows not-granted and restrictive overrides | P0 | PASS |
| UAT-326A | AC-326 | Removing member removes future capability without rewriting history | P0 | PASS |
| UAT-326B | AC-326 | Group expiry removes access automatically | P1 | PASS |
| UAT-327A | AC-327 | Removing group member cannot strand approval route | P0 | PASS |
| UAT-327B | AC-327 | Dynamic role membership is included in coverage calculation | P0 | PASS |
| UAT-328A | AC-328 | Manage Access cannot grant above platform eligibility | P0 | PASS |
| UAT-328B | AC-328 | Custom group cannot bypass self-approval | P0 | PASS |

## Evidence per case

- **UAT-323A** - In one competition: role `Section Leader` was assigned Submit, a group was assigned Approve, a named person was assigned Manage. The inspector resolved each subject independently: Submit via "Treasurer" role, Approve via the group, Manage via the named person. A role-only user held exactly `[submit, view]`.
- **UAT-323B** - The role-only user gained no Approve (group grant) and no person's Manage; the group-only approver gained no Submit; the named person gained neither Submit nor Approve. No subject type inherited another's capability.
- **UAT-324A** - "UAT Cross-Role Leads" was created with four members of different application roles (Section Leader, Assistant Leader, Trustee, Quartermaster). All four coexisted in the group and every underlying portal role was unchanged after saving.
- **UAT-324B** - A treasurer in an unassigned group held only `[view]` in the competition. After the group was explicitly assigned Submit, the same user then held Submit, attributed to the group. Membership alone granted nothing.
- **UAT-325A** - A user in both a granting role and a granting group resolved to the union of capabilities. Every held capability named its source: Submit via the role, Approve via the group, and the manager-role baseline (Manage / View detail / View history) attributed to the manager role, View to the platform baseline.
- **UAT-325B** - The inspector showed Score directly granted via the group and Manage access not granted. A normal score by that member posted immediately (`score_directly`); a deduction on the same competition was forced to `pending` by the stricter deduction rule.
- **UAT-326A** - A group approver approved one score, then was removed from the group. On re-evaluation the member no longer held Approve and could no longer act on the still-open approval (denied). The earlier approval remained `approved` and stayed attributed to that member. History was not rewritten.
- **UAT-326B** - A temporary group with a future expiry granted Score directly; a score was recorded. After the expiry was moved into the past, the member's Score directly disappeared and a further submission was denied, while the earlier submission remained present.
- **UAT-327A** - A competition whose only approver was a single-member group had that member removed. Re-saving the identical access was blocked, and the coverage message named the affected routes.
- **UAT-327B** - A competition relied on an application role for Approve and opened while that role had an eligible member. After the sole holder of that role was reassigned in the identity source (zero holders remaining), coverage recomputed against current membership and blocked the save, naming the route - it did not use a stale role count.
- **UAT-328A** - Approve was assigned both to a platform-ineligible named person (Treasurer) and to a group of ineligible members. Both were omitted from resolved access, and because no eligible approver remained the competition could not be opened. The administrator could not elevate an ineligible subject through a group.
- **UAT-328B** - A member of an approver group submitted their own score and was refused approval of it ("You cannot approve your own submission."); a different eligible approver then approved it. Group-sourced Approve did not bypass the no-self-approval rule.

## Defects found and fixed during execution

Both were found while running these cases, fixed, re-verified against the same cases, and covered by new automated smoke assertions. Neither remains open.

1. **Effective Access left manager-baseline capabilities unattributed (AC-325 explainability).**
   `ppEffectiveAccess` had a dangling `else` (no braces): the manager-role contributor branch
   was nested inside the competition-creator branch, so for any non-creator manager the
   Manage / View detail / View history capabilities were held but shown with no source. Fixed
   by bracing the creator/manager branches and adding an explicit "platform baseline"
   attribution for View, so every held capability now names a contributor.

2. **Misleading approval-denial message after losing a group's Approve.**
   When a user who had lost the group's Approve tried to act on another person's submission,
   the API returned "You cannot approve your own submission." even though it was not their own.
   Fixed so the message distinguishes an own-submission block from a lost-capability block.

## Automated regression

Full dependency-free smoke suite: **278 checks, 0 failed across 42 scenarios**, including
`logic_pp_groups` (AC-323..328) which now also asserts that every effective capability names a
contributor and that a removed member's approval denial is a lost-capability case, not a
self-approval case.
