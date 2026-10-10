# Unified Development Spec v2.3: what has been built, and where the spec and the application differ

Date: 10 October 2026. Written from the application as built, in answer to `7th_Swindon_Christmas_ECard_Unified_Development_Spec_v2_3.md`. The spec says it was written from `FRD_v2_2.md` alone, without the application, so a few of its statements about the current position need correcting.

## 1. The R1 proposals

Status key: Built means code exists and automated tests pass (`tests/resilience_test.php`, 47 checks, plus the earlier suites). None of it has had UAT, a security assessment or a staging run.

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

## 2. Where the spec differs from the application

1. The spec's FR-161 says MFA status display alone is insufficient. MFA was already enforced, not just displayed.
2. The spec assumes no application screenshots or role matrix were available. The roles are: campaign manager, application administrator, finance administrator, delivery support, complaints reviewer, restricted administrator. The matrix and pages are described in `README.md` and `FRD_v2_2.md`.
3. Section 3.1 of the spec correctly notes that the claim "only two SQL statements would change" for a MySQL move was unverified. It is: `insert or ignore`, `on conflict` and the SQLite specific table definitions, plus `vacuum into` in the backup code. A tested migration would still be needed.
4. The spec's proposal that held-back status be managed in administration is already true: enabling a held back design is an Admin action. The held back list itself is in code.
5. Guest sending (FR-150), autosave (FR-151), contact autocomplete (FR-152), full journey preview (FR-153), annual rollover (FR-154), the extra dashboard (FR-155), task lists (FR-158), audit export (FR-159) and the archive (FR-164) are not built, as the spec says they are R1.1 or R2.

## 3. The baseline documents the spec asks for

The spec's next editorial step is to import the original requirement texts. They exist, outside this repository except the ones marked:

- `FRD_v2_1_additions.md`, `FRD_palette_update.md`, `FRD_v2_2.md`, `AT_test_plan.md` are in `docs/`.
- Version 2.0 is the PDF `Scout_ECard_FRD_v2_0_Branded.pdf` and versions 1.1 to 1.3 are Markdown files, all in the owner's Downloads folder. They have not been merged into one document.

## 4. Still open

Everything in section 6 of `FRD_v2_2.md`, plus: the Trustees confirm or change the proposed limits (5 submissions an hour, 90 day access review), decide whether the gates above are the right non-waivable list, record G-SEC and G-SUP when the evidence exists, and set `BACKUP_KEY` and an off-server route before launch.
