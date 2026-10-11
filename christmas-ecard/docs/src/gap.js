// node docs/src/gap.js <traceability.csv> : writes docs/gap_matrix.csv from the pack's traceability plus repository evidence
const fs = require('fs'), path = require('path');
const csvIn = fs.readFileSync(process.argv[2], 'utf8').replace(/\r/g, '').trim().split('\n');
const parse = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = ''; } else c += ch; } o.push(c); return o; };
const esc = (v) => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
// [from, to, class, evidence, tests, note]
const R = [
  [1, 4, 'implemented', 'src/app.php r_register, r_verify, r_login, r_logout, r_forgot, r_reset', 'tests/smoke.php', ''],
  [5, 5, 'implemented', 'src/account.php r_account (name, email with confirmation, password, preferences); r_dashboard; r_account_delete', 'tests/account_test.php', ''],
  [6, 9, 'implemented', 'src/cards.php, src/app.php r_compose, src/admin.php (design management)', 'admin_test, smoke', ''],
  [10, 16, 'implemented', 'src/app.php r_compose, r_preview, r_review; src/core.php', 'smoke', ''],
  [17, 23, 'implemented', 'src/app.php r_review, r_return, r_dev_pay; src/core.php confirm_payment', 'smoke, resilience_test', 'Refund import: charge.refunded handled in src/resilience.php; Stripe live mode untested.'],
  [24, 30, 'implemented', 'src/core.php process_queue, requeue_recipient; src/admin.php delivery view', 'smoke, ops_test', 'Postmark live behaviour unverified (no live account in tests).'],
  [31, 37, 'implemented', 'src/app.php r_card, r_optout; public/assets/style.css', 'smoke', 'No Skip animation control (see UX24-06).'],
  [38, 57, 'implemented', 'src/app.php, src/core.php, src/ops.php, src/admin.php', 'smoke, ops_test, admin_test', 'Support contact and hours are operational, not code.'],
  [58, 67, 'implemented', 'src/app.php (overrides, copy, QR, send back, starters, notifications); src/cards.php', 'ops_test, smoke', 'QR image comes from a third party service.'],
  [68, 76, 'missing', '-', '-', 'Conditional enhancements. Printable card (FR-143) covers part of FR-074; FR-076 partly covered by FR-083.'],
  [77, 80, 'implemented', 'src/app.php r_review, steps(); src/admin.php', 'smoke, admin_test', ''],
  [81, 83, 'implemented', 'src/admin.php config engine; src/admin2.php', 'admin_test', ''],
  [84, 85, 'partial', 'src/admin.php config_spec', 'admin_test', 'Subject lines, branding assets and help content are not editable.'],
  [86, 86, 'implemented', 'src/admin.php (retention impact review)', 'admin_test', ''],
  [87, 88, 'partial', 'src/admin.php r_admin_access', 'admin_test', 'No beneficiary change workflow; no email invitation.'],
  [89, 94, 'implemented', 'src/admin.php, src/ops.php health_alerts', 'admin_test, ops_test', 'Audit export is not built (FR-159).'],
  [95, 95, 'missing', '-', '-', 'Restore previous configuration (Should).'],
  [96, 99, 'implemented', 'public/assets/style.css; src/app.php page(); email_html()', 'ops_test (email logo)', 'Contrast computed, not checked with an external tool.'],
  [100, 116, 'implemented', 'src/contacts.php', 'tests/contacts_test.php', ''],
  [117, 123, 'partial', 'src/admin.php; public/assets/style.css', 'admin_test', 'No assistive technology audit; nav grouped into five areas (UX24-07).'],
  [124, 124, 'implemented', 'src/core.php requeue_recipient', 'ops_test', ''],
  [125, 125, 'partial', 'src/app.php (pending checks); src/ops.php', 'ops_test', 'Resolution is by checking or cancelling the attempt.'],
  [126, 126, 'implemented', 'src/core.php process_queue retry policy', 'ops_test', ''],
  [127, 128, 'implemented', 'src/app.php r_account_delete, is_scanner()', 'smoke', ''],
  [129, 129, 'partial', 'src/resilience.php stripe_handle_event (charge.refunded); src/admin.php manual entry', 'resilience_test', 'Disputes listed only.'],
  [130, 130, 'implemented', 'src/ops.php alerts_tick, health_alerts', 'ops_test', ''],
  [131, 135, 'implemented', 'src/legal.php, src/ops.php, src/admin2.php', 'ops_test', 'Legal wording is draft and unapproved (D-14).'],
  [136, 139, 'implemented', 'src/admin3.php, src/app.php r_email_preview', 'ops_test', ''],
  [140, 140, 'missing', '-', '-', 'Blocked by D-11. Not built, not visible.'],
  [141, 141, 'implemented', 'src/giftaid.php', 'tests/giftaid_test.php', 'Flag off until D-12.'],
  [142, 142, 'missing', '-', '-', 'Blocked by D-13. Not built, not visible.'],
  [143, 144, 'implemented', 'src/app.php (print stylesheet, remind-off); src/ops.php send_reminders', 'ops_test', ''],
  [145, 145, 'partial', 'src/cards.php descriptions; docs/AT_test_plan.md', '-', 'Assistive technology tests not run.'],
  [146, 149, 'implemented', 'src/cards.php', 'admin_test, resilience_test', ''],
  [150, 150, 'missing', '-', '-', 'R1.1 guest sending, not approved.'],
  [151, 153, 'missing', '-', '-', 'R1.1. Draft saving exists (FR-015); no autosave, autocomplete or journey preview.'],
  [154, 155, 'missing', '-', '-', 'R2 / R1.1.'],
  [156, 156, 'implemented', 'src/resilience.php freeze_art, r_art; src/core.php', 'resilience_test', ''],
  [157, 157, 'implemented', 'src/resilience.php stripe_handle_event, payment_exceptions', 'resilience_test', 'Live Stripe verification not done.'],
  [158, 159, 'missing', '-', '-', 'R2.'],
  [160, 160, 'partial', 'src/lib.php limit_for, honeypot', 'resilience_test', 'No bot detection beyond trap field and limits.'],
  [161, 161, 'implemented', 'src/admin.php need_role; src/lib.php; access review', 'resilience_test', ''],
  [162, 162, 'implemented', 'src/resilience.php backup_run, backup_restore; src/cli.php', 'resilience_test', 'Needs BACKUP_KEY and off server route; staging restore not run.'],
  [163, 163, 'implemented', 'src/resilience.php postmark_handle_event', 'resilience_test', 'Live Postmark webhook untested.'],
  [164, 164, 'missing', '-', '-', 'R2 archive.'],
];
const pick = (n) => R.find(([a, b]) => n >= a && n <= b);
const rows = [['Requirement', 'Area', 'Reported status (pack)', 'Audited status', 'Evidence (files)', 'Automated tests', 'Notes']];
for (const l of csvIn.slice(1)) {
  const f = parse(l); const n = parseInt(f[0].slice(3), 10); const r = pick(n);
  rows.push([f[0], f[1], f[6], r ? r[2] : 'unverified', r ? r[3] : '', r ? r[4] : '', r ? r[5] : '']);
}
const UX = [
  ['UX24-01', 'Compose and recipients on one screen', 'Must', 'implemented', 'src/app.php r_compose (recipient rows, FR-137)', 'smoke', 'No standalone recipients route exists, so SCR-04 redirect is not needed.'],
  ['UX24-02', 'Compose before sign-in', 'Should', 'implemented', 'src/app.php r_compose, r_register, r_verify (anonymous drafts kept 7 days)', 'smoke', 'Cross-session leak check not explicitly tested.'],
  ['UX24-03', 'Free selected first, donation explicit', 'Must', 'implemented', 'src/app.php r_review (free button first, donation in an expandable section)', 'tests/ux24_test.php, smoke', 'Changed in this pass. Wording and layout need UAT.'],
  ['UX24-04', 'Progressive rows, count, no recipient disclosure', 'Must', 'implemented', 'src/app.php r_compose; src/core.php email_html', 'ops_test', ''],
  ['UX24-05', 'Human readable states', 'Must', 'implemented', 'src/core.php rstatus()', 'smoke', ''],
  ['UX24-06', 'Skippable animation, reduced motion', 'Must', 'implemented', 'public/assets/style.css (reduced motion, .noanim); src/app.php r_card; public/assets/app.js', 'tests/ux24_test.php', 'Skip animation added in this pass. Screen reader and keyboard UAT still to do.'],
  ['UX24-07', 'Five role safe admin areas', 'Should', 'implemented', 'src/admin.php admin_page (five areas)', 'tests/ux24_test.php, admin_test', 'Grouped in this pass; routes and permissions unchanged. Overview now lists each exception with an Open link or its owning role.'],
  ['UX24-08', 'Stable hero, never held back', 'Should', 'implemented', 'src/cards.php hero_for_session', 'resilience_test', ''],
  ['UX24-09', 'Immutable sent artwork', 'Must', 'implemented', 'src/resilience.php freeze_art', 'resilience_test', ''],
  ['UX24-10', 'Preview and test cannot send or charge', 'Must', 'implemented', 'src/app.php r_preview, r_email_preview (GET, read only)', 'smoke', 'Test card goes only to the verified sender.'],
  ['UX24-11', 'Three stage progress model', 'Should', 'partial', 'src/app.php steps()', '-', 'Progress bar exists; accuracy during auth and payment subflows needs UAT.'],
  ['UX24-12', 'No safeguards removed by simplification', 'Must', 'implemented', 'Navigation change only; src/admin.php need_role unchanged', 'admin_test, resilience_test', ''],
];
for (const u of UX) rows.push([u[0], u[1], u[2], u[3], u[4], u[5], u[6]]);
fs.writeFileSync(path.join(__dirname, '..', 'gap_matrix.csv'), rows.map((r) => r.map(esc).join(',')).join('\n') + '\n');
const cnt = {}; rows.slice(1).forEach((r) => cnt[r[3]] = (cnt[r[3]] || 0) + 1); console.log(cnt);
