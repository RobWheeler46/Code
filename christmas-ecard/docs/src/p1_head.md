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

