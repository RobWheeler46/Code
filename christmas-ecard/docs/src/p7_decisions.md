## 15 Decisions, proposed defaults and launch gates

### 15.1 Decision register

No value below is an invented default. Record the approved value, accountable owner, date and reference in Admin under Launch readiness (S42).

| ID | Decision or evidence | Accountable owner | Required by |
|---|---|---|---|
| D-01 | Campaign dates; closure treatment of accepted queues; expiry; contact, draft, card, finance, audit and suppression retention; deletion processing time. | Trustees with operational and privacy owner | Before affected configuration and lifecycle implementation is frozen |
| D-02 | Message, name and group lengths; address book and group capacities; self test and rate limits; supported email address forms; one consistent duplicate address rule. | Project lead with application administrator | Before validation implementation |
| D-03 | Currency and permitted custom donation bounds; suggested amounts; payment investigation thresholds and who resolves exceptions. | Treasurer with project lead | Before payment implementation |
| D-04 | Refund role, provider console versus in app execution, approval conditions, receipt treatment and reconciliation ownership. | Treasurer and Trustees | Before finance workflow implementation |
| D-05 | Retry limits and backoff, uncertain send reconciliation, support contact and hours, complaint handling, emergency pause and late send policy. | Operations owner with project lead | Before delivery implementation |
| D-06 | Expected campaign volume and peak concurrency; measurable response and queue delay targets; provider and hosting capacity evidence. | Technical lead with campaign owner | Before load test acceptance |
| D-07 | Recovery point and time objectives, monitoring cadence, backup restoration evidence and administrator MFA recovery or break glass procedure. | Technical and restricted administrator owners | Before operational sign-off |
| D-08 | Include or defer decision for every launch Should; individually numbered AC-01 to AC-18; FR to test mapping, UAT owners and results; approval of additions FR-124 to FR-130. | Project lead with Trustees | Before development baseline and sign-off |
| D-09 | Reconcile the FRD with the SDD and OpenSpec, confirm provider and hosting choices (including the SQLite departure in 9.1), validate authenticated callbacks and verified sending domain setup in staging. | Technical lead | Before integration sign-off |
| D-10 | Account deletion effects on accepted queued cards and live links, retained categories and support handling; approved view qualification method and public wording. | Trustees with privacy and technical owners | Before lifecycle and tracking sign-off |
| D-11 | Include or defer recipient donations (FR-140), and the approved wording. | Treasurer with Trustees | Before the card view is frozen |
| D-12 | Include or defer Gift Aid (FR-141); confirmation of eligibility; declaration wording; retention of declaration records; the charity name as HMRC knows it. | Treasurer with Trustees | Before payment implementation is frozen |
| D-13 | Include or defer Christmas Day delivery (FR-142); the approved time; late send policy. | Campaign owner with operations owner | Before the sender journey is frozen |
| D-14 | Wording and ownership of the privacy notice, terms, acceptable use rules and safeguarding statement, a review date, and the plain language reading standard. | Trustees with the responsible administrator | Before any public launch |
| D-15 | Alert recipients, the second route, escalation time, daily summary recipients and out of hours expectations. | Operations owner with project lead | Before operational sign-off |
| D-16 | Success measures and any targets; the small number threshold; who reviews them and when. | Project lead with campaign owner | Before campaign opens |

In production the application treats 13 of these as required before the campaign opens. Gift Aid, recipient donation and Christmas Day delivery (D-11 to D-13) never block, and are only relevant when included.

### 15.2 Proposed Christmas 2026 pilot defaults (version 2.0 section 15)

Status: recommendations for approval, not Trustee approved policy. They should be validated in staging and recorded against the decision register before activation. The values are product and operating recommendations, not provider guarantees or statutory retention periods; the ICO states that UK GDPR does not prescribe specific retention periods, so each category needs a documented purpose.

| Decision | Proposed default | Rationale |
|---|---|---|
| D-01 Campaign window | Open 1 November 2026 at 00:00 Europe/London; close 26 December 2026 at 23:59:59 Europe/London. | A preparation month and Boxing Day. |
| D-01 Accepted work and expiry | Continue previously accepted work for up to 24 hours after closure; unresolved eligible work then needs manual review, with no silent late send. End viewing at 23:59:59 on 31 January 2027 unless withdrawn sooner. | Separates submission closure from delivery recovery and viewing expiry. Pause still stops eligible dispatch. |
| D-01 Drafts and greetings | Delete abandoned drafts after 90 days without activity (anonymous drafts after 7 days). Delete greeting content and recipient delivery details 90 days after viewing expiry unless a documented complaint or incident hold applies; retain anonymous campaign totals. | Bounded seasonal storage. Notify owners before draft deletion where practicable. |
| D-01 Accounts, contacts and groups | Retain while the account is active. At 12 months without sign in, notify the owner and allow 30 days to retain the account; otherwise close and delete ordinary account, contact and group data. Account deletion requests: notify immediately and target processing within 30 days. | Annual reuse without indefinite inactivity storage. |
| D-01 Logs and suppression | Routine technical logs 30 days, without private tokens or messages. Security and configuration audit 12 months initially. Minimal suppression while the service operates or until the recipient deliberately withdraws, with annual necessity review. | Preserve opt outs across campaigns; never reuse suppression for marketing. |
| D-01 Finance records | Use the existing approved Scout finance retention schedule; obtain the Treasurer's written confirmation before launch. | No guessed statutory period for donor or accounting records. |
| D-02 Field limits | Greeting 1 to 1,000 Unicode characters; sender, contact and recipient display names 1 to 100; group names 1 to 50. Plain text, no executable markup. | Family greetings and manageable mobile reading. Count consistently in browser and server. |
| D-02 Address book | 200 contacts and 20 groups per owner; a contact may belong to several groups. Keep 20 recipients per send. | Practical family use. Capacity errors never discard saved entries. |
| D-02 Email policy | Trim outer whitespace, normalise domain case and IDN domains; preserve the local part. For duplicate matching, case fold the comparison and document the conservative treatment. Never remove plus tags or dots. Standard non SMTPUTF8 mailboxes on internationalised domains are supported; explain unsupported forms. | Avoid hidden normalisation; show review feedback rather than silently merging contacts. |
| D-02 Rate limits | Verified self test 3 an hour and 10 a day per account; ordinary submission 5 batches an hour and 100 recipient attempts a day per account; verification resend 3 an hour; sign in failures throttled progressively after 5 in 15 minutes. | Initial abuse presets for monitored tuning. Deduplicated retries of one intent do not count as fresh submissions. |
| D-03 Donations | GBP only; suggestions £5, £10, £20; custom £1 to £500; a separate equally clear free send action. Public target off until approved. | Simple seasonal fundraising within provider limits. Pending and failed payments never count as donations. |
| D-03 Payment investigation | Reconcile pending outcomes automatically with verified provider evidence; flag unresolved attempts after 15 minutes and escalate after 24 hours. Treasurer owns manual resolution. | Thresholds start investigation, not failure or another charge. |
| D-04 Refunds | Execute in the restricted Stripe dashboard for the pilot by the Treasurer or a named delegated finance operator with MFA. Record reason and transaction reference; reconcile verified refund outcomes in the app. Full and partial refunds supported in reporting; no in app refund button initially. | Avoid adding refund execution to ordinary finance visibility. |
| D-05 Retry policy | Up to 3 automated retries after the original attempt, at about 1, 5 and 30 minutes, only for a safely classified transient pre acceptance failure. Never automatically resend after unknown provider acceptance, hard rejection or complaint. | Provider transport retries and application retries must not compound. |
| D-05 Pause and support | Resume eligible queued work automatically only within the 24 hour recovery window; show age and counts and require review for older work. Nominate a primary and backup support volunteer; publish monitored hours; aim to acknowledge ordinary queries within 2 working days. Daily queue and payment review while the campaign is live. | No invented support email or continuous coverage claim. |
| D-06 Performance | Test 50 concurrent active users and a 1,000 recipient daily campaign workload. Target 95% of normal interactive responses under 2 seconds excluding third party checkout; 95% of healthy accepted deliveries handed to the provider within 5 minutes. | Planning hypotheses, not measured capacity. |
| D-07 Monitoring and recovery | Queue job each minute if hosting supports it; stale job alert after 5 minutes; review operational evidence at least daily. Encrypted off site nightly backup retained 30 days. Proposed RPO 24 hours and RTO 4 hours; rehearse restoration before launch. | A daily backup alone does not preserve all transactions; reconcile provider records and never blindly replay restored queues. |
| D-07 Privileged recovery | Two individually named restricted administrators with MFA; separately protected recovery codes; recorded identity checks and recovery audit. No shared admin password. | Prevents a single person access dependency. |
| D-08 Launch scope | Keep all current launch Must requirements. Recommended include: greeting starters, message overrides, public campaign sharing. Defer optional status notifications and copy card reuse if the schedule is tight. Restore individual AC-01 to AC-18 and map every launch Must to test evidence. | Scope recommendations only; scheduling, CSV import, group select all and a guided launch checklist remain outside authorised scope. |
| D-09 Technical baseline | Retain PHP and cPanel, Postmark and Stripe pending technical validation. Verify callbacks, domain authentication, TLS, cron limits and protected configuration in staging. | No readiness claim without implementation review. |
| D-10 Account deletion | On confirmed request stop new submissions and sessions, cancel unclaimed deliveries and revoke active greeting links owned by the account. Already claimed or sent email cannot be recalled; explain that. Apply category specific deletion and documented holds. | Finance, audit and suppression records remain protected and separate. |
| D-10 Viewing | Qualify a view by deliberate reveal or read interaction where supported; exclude known scanner events and deduplicate counts. Static or no script opens remain unconfirmed unless comparable evidence exists. Use "Viewed" with explanatory uncertainty, never "read by this person". | No fingerprinting; possession of a link cannot establish identity. |

Approval sequence: (1) campaign owner approves dates, wording, support coverage and included Should features; (2) Treasurer confirms GBP limits, refund delegation, pending payment ownership and finance retention; (3) privacy and operational owners approve category retention, deletion effects, suppression and incident holds; (4) technical lead validates capacity, provider behaviour, retries, monitoring and restore objectives in staging; (5) Trustees record policy approval and any exceptions, after which approved values become the configuration baseline through the existing review and audit process.

Sources checked 10 October 2026: ICO storage limitation guidance; Stripe supported currencies and charge constraints (docs.stripe.com/currencies); Stripe refund API (docs.stripe.com/api/refunds); Postmark bounce webhook and email API documentation. They support constraints and evidence handling; they do not prescribe the proposed campaign dates, capacities, retention durations, support targets or recovery objectives.

### 15.3 Launch gates

Technical acceptance, security and privacy, operational resilience, Trustee user acceptance and campaign approval remain launch gates (version 1.0 and 2.0 section 12).

| Gate | Evidence or approval |
|---|---|
| Technical acceptance | Database, Stripe test payments, email delivery and scheduled jobs verified in staging. |
| Security and privacy | MFA, account permissions, abuse controls, privacy wording and retention agreed. |
| Operational resilience | Backups, restoration, monitoring and incident ownership demonstrated. |
| Trustee user acceptance | Core sender and recipient journeys tested; outstanding defects resolved or accepted. |
| Campaign approval | Beneficiary information, artwork, donation wording and public launch date approved. |

Non waivable gates (proposed in v2.3 and implemented as hard gates in the application): approved public privacy text (D-14); privileged MFA; verified payment events (Stripe keys, webhook secret and a signed event received); an off server backup within 48 hours and a restore rehearsal within 60 days; a recorded security assessment reference (G-SEC) and a recorded support route test (G-SUP). If any fails in production, sending stays locked and the launch override cannot unlock it. Waivable by a limited Trustee authorised exception, with risk, mitigation, approver and expiry recorded: non critical campaign imagery or content changes and approved deferred UX features. In production the other required decisions can still be overridden by a restricted administrator with a recorded reason.

