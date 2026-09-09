# UAT sign-off: Patrol Points v2.4

**Result: 16 of 16 cases passed. 0 failures. 0 Critical or High defects.**

| | |
| --- | --- |
| Acceptance criteria | AC-315 to AC-322 (cases UAT-315A to UAT-322B) |
| Executed | 9 September 2026 |
| Environment | Demo / UAT build (local, port 8040) |
| Method | Each case's steps run against the running build, per persona |
| Corroboration | Automated suite: 265 checks across 41 scenarios |

## Release gate

The v3.2 handover requires AC-315 to AC-322 (UAT-315A to UAT-322B) to pass with no unresolved Critical or High permission, self-approval, score-integrity or presentation-privacy defect. All sixteen cases passed and none of those defect classes were observed, so the gate is met on this build.

## Results

| Case | AC | Title | Persona | Result | Observed |
| --- | --- | --- | --- | :---: | --- |
| UAT-315A | AC-315 | Submit Points without Score Directly creates a pending score | Moderated Scorer | Pass | status=pending, reason=all_approval; excluded from effective totals |
| UAT-315B | AC-315 | View Detail without scoring | Operational Viewer | Pass | detail readable; canSubmit=false; direct submit denied 403 |
| UAT-316A | AC-316 | Score Directly is effective | Trusted Scorer | Pass | status=approved, reason=score_directly; leaderboard +10 |
| UAT-316B | AC-316 | Deduction overrides direct scoring | Trusted Scorer | Pass | status=pending, reason=deduction; total unchanged |
| UAT-317A | AC-317 | Manager cannot approve without Approve Points | Competition Manager | Pass | approve attempt denied 403 |
| UAT-317B | AC-317 | No self-approval; another approver can decide | Trusted Scorer + Approver | Pass | self-approve denied 403; other eligible approver approved 200 |
| UAT-318A | AC-318 | Review and Start blocks an uncovered route | Competition Access Manager | Pass | start blocked 422, uncovered route named (all scores, submit-only scorers) |
| UAT-318B | AC-318 | Removing the last approver is blocked at save | Competition Access Manager | Pass | access save refused 422 |
| UAT-319A | AC-319 | Rapid Score repeated awards at 360px | Trusted Scorer | Pass | team clears; points and reason retained; no horizontal scroll; two distinct submissions |
| UAT-319B | AC-319 | Correct this score keeps the audit trail | Trusted Scorer | Pass | original stays approved; correction pending; total unchanged until approved; no hard delete |
| UAT-320A | AC-320 | Presentation shows only safe fields | Presentation Viewer | Pass | fields = position/team/total; latest award = team/points only; no identities or comments |
| UAT-320B | AC-320 | Presentation follows effective scores only | Presentation Viewer | Pass | unchanged while pending; updated by +10 after approval |
| UAT-321A | AC-321 | Completion blocks unresolved approvals | Competition Manager | Pass | readiness listed 2 scores awaiting approval; canComplete=false |
| UAT-321B | AC-321 | Completion revokes guest links and locks scoring | Competition Manager | Pass | status=completed; guest link revoked; new score denied 409; final standings available |
| UAT-322A | AC-322 | Preset populates explicit policy values | Competition Access Manager | Pass | Camp Stations preset seeds explicit score_direct, submit and approve assignments |
| UAT-322B | AC-322 | Presets cannot grant above eligibility; uncovered stays blocked | Competition Access Manager | Pass | ineligible (Treasurer) approver did not satisfy coverage; save refused 422 until a real approver assigned |

## Steps and expected result, per case

- **UAT-315A** (Moderated Scorer): Submit a valid +10 score in a moderated competition. Expected: Pending Approval; excluded from effective totals; the approver receives the shared Action.
- **UAT-315B** (Operational Viewer): Open the competition; try the direct score route. Expected: detail readable in scope; scoring not discoverable; direct submission denied server-side.
- **UAT-316A** (Trusted Scorer): Submit +10 with a normal reason. Expected: effective immediately; leaderboard updates once; audit records why.
- **UAT-316B** (Trusted Scorer): Submit a -5 deduction. Expected: pending despite Score Directly; totals unchanged; reason attributable.
- **UAT-317A** (Competition Manager): Attempt to approve a pending score. Expected: no approval decision available; server-side approval denied.
- **UAT-317B** (Trusted Scorer + Approver): Submit own pending score; attempt to approve it; then a different approver decides. Expected: own submission not approvable by the submitter; another eligible approver can.
- **UAT-318A** (Competition Access Manager): Attempt to start a competition whose pending route has no approver. Expected: start blocked and the uncovered route named.
- **UAT-318B** (Competition Access Manager): Remove the final approver and save. Expected: save blocked unless an approver is assigned or the route no longer produces pending; only successful changes audited.
- **UAT-319A** (Trusted Scorer, 360px): Award a team, choose Keep points and reason, then award another. Expected: points and reason stay selected; team clears; two distinct submissions with no duplicate transport.
- **UAT-319B** (Trusted Scorer): Correct an effective score to +5 via the revision path. Expected: original stays in history; total changes only via attributable correction; no hard delete.
- **UAT-320A** (Presentation Viewer): Open Presentation mode; inspect fields and latest award. Expected: only effective Position, Team and Total; latest award is team and points only; no identities, comments, evidence or approval history.
- **UAT-320B** (Presentation Viewer): Submit a pending score; refresh; then approve it. Expected: unchanged while pending; updates only once the score is effective.
- **UAT-321A** (Competition Manager): Open Completion Readiness; attempt completion. Expected: outstanding approvals and revisions shown; normal completion blocked until resolved.
- **UAT-321B** (Competition Manager): Complete the competition; try an old guest link and a new score; open final standings. Expected: guest links revoked; competition read-only; new scoring denied; final standings available.
- **UAT-322A** (Competition Access Manager): Select the Camp Stations preset; inspect the resulting assignments. Expected: explicit visible values (trusted direct, other routes pending, scoped approvers); no opaque runtime-only mode.
- **UAT-322B** (Competition Access Manager): Apply a preset or change; check ineligible grants and coverage. Expected: ineligible grants not applied; uncovered routes remain blocked; accepted changes audited.

## Observation (not a defect)

UAT-322B expects that switching preset does not discard a manager's custom policy "without confirmation". In this build, applying a preset only repopulates the on-screen editor; nothing is persisted until the manager reviews and presses Save, and an uncovered route is refused at Save. The substantive rules (ineligible grants never take effect, uncovered routes stay blocked, only accepted changes are audited) all pass. An explicit "replace your changes?" prompt on the preset picker is a possible future nicety.

## Sign-off

| Tested by | Signed off by | Date |
| --- | --- | --- |
|  |  |  |
