// node docs/src/build.js : merges the source documents into docs/FRD_baseline_v2_3.md
const fs = require('fs'), path = require('path');
const here = __dirname, docs = path.join(here, '..'), dl = path.join(process.env.USERPROFILE, 'Downloads');
const lines = (f) => fs.readFileSync(f, 'utf8').replace(/\r/g, '').split('\n');
const slice = (f, a, b) => lines(f).slice(a - 1, b).join('\n') + '\n';
const part = (n) => fs.readFileSync(path.join(here, n), 'utf8').replace(/\r/g, '');
const v13 = path.join(dl, 'Scout_ECard_FRD_v1_3.md');
const v21 = path.join(docs, 'FRD_v2_1_additions.md');
const v22 = path.join(docs, 'FRD_v2_2.md');
const spec = path.join(dl, '7th_Swindon_Christmas_ECard_Unified_Development_Spec_v2_3.md');
const st = path.join(docs, 'SPEC_v2_3_status.md');
const must = (s, a, b) => { if (!s.includes(a)) throw new Error('missing: ' + a); return s.replace(a, b); };

let o = part('p1_head.md');

let s45 = slice(v13, 39, 129);
s45 = must(s45, '## 4 Existing functional requirements', '## 4 Requirements FR-001 to FR-037');
s45 = must(s45, '## 5 Added launch requirements', '## 5 Added launch requirements FR-038 to FR-067');
s45 = must(s45, '| FR-007 | Include the ten existing approved Scout-themed designs. | Must |',
  '| FR-007 (amended) | Provide the approved illustrated designs supplied by the Group, currently twelve, each with the greeting painted into the picture. Each has a name, a written description that includes the printed words, and a thumbnail cropped to the headline. A design whose artwork is not yet fit for use (for example, shows an out of date year) can be held back and stays off until the picture is replaced and a campaign manager enables it. Version 1.0 to 2.0 required ten designs; the earlier drawn designs remain available but off by default. | Must |');
s45 = must(s45, '| FR-009 | Allow administrators to enable or disable designs. | Should |',
  '| FR-009 (amended) | Allow authorised campaign managers to enable, disable and reorder approved designs and edit their descriptions, as detailed in FR-083. | Must |');
s45 = must(s45, '| FR-033 | Provide an animated envelope reveal and reduced-motion alternatives. | Must |', '| FR-033 | Provide an animated envelope reveal and reduced-motion alternatives. | Must |');
o += s45 + '\n';

o += slice(v13, 130, 167).replace('## 6 Status meanings and recovery', '## 6 Status meanings and recovery').replace('## 7 Revised user journeys and wireframes', '## 7 User journeys, screens and journey requirements');
o += part('p2_inventory_admin.md');
o += slice(v13, 182, 191) + '\n';
o += part('p3_section8.md');
o += part('p4_quality.md');

// 11 and 12
o += '## 11 Launch protection, sender experience and decision dependent requirements\n\nVersion 2.1 additions. Nothing here activates a policy value. Wording that has legal effect (privacy notice, terms, safeguarding statement, Gift Aid declaration) must be written or approved by the named owner and checked against current guidance before launch.\n\n';
let a = slice(v21, 9, 39);
a = must(a, '## A Launch requirements: protecting the Group and its supporters', '### 11.1 Protecting the Group and its supporters');
a = must(a, '## B Launch requirements: sender experience', '### 11.2 Sender experience');
a = must(a, '## C Decision-dependent requirements', '### 11.3 Decision dependent requirements and other additions');
o += a + '\n';
o += 'Recommended handling: FR-131, FR-132, FR-133, FR-134, FR-135, FR-137 and FR-145 are launch Musts. FR-136, FR-138, FR-139, FR-143 and FR-144 are launch Shoulds that can be dropped if time is short. FR-140, FR-141 and FR-142 depend on D-11 to D-13. FR-133 adds to the audit list in FR-050, FR-134 completes FR-130, and FR-137 replaces the entry method inside S03 without changing FR-012 or FR-013.\n\n';

o += '## 12 Illustrated cards, Gift Aid, version 2.2 requirements and version 2.3 proposals\n\n';
o += '### 12.1 Designs (version 2.2)\n\n' + slice(v22, 38, 44).replace(/^\| ID \| Requirement \| Priority \|\n\|---\|---\|---\|\n\| FR-007.*\n\n?/m, '') ;
o += '\n### 12.2 Gift Aid (supplements FR-141)\n\n' + slice(v22, 84, 88) + '\n';
o += '### 12.3 Other decisions recorded\n\n' + slice(v22, 92, 92) + '\n';
o += '### 12.4 Illustrated card requirements (version 2.2)\n\n' + slice(v22, 96, 103).split('\nAC-106')[0] + '\n';
o += '### 12.5 Version 2.3 requirements FR-150 to FR-164\n\nProposed in the Unified Development Spec v2.3. Phase R1 is launch critical; R1.1 is the first enhancement after launch; R2 follows. Build status is in section 16. Do not read a requirement as built because it appears here.\n\n';
o += slice(spec, 455, 471) + '\n';
o += '#### Amendments to existing requirements proposed in v2.3\n\n' + slice(spec, 474, 479) + '\n';

// 13 acceptance
o += part('p5_ac_a.md');
let ac = slice(v13, 215, 266);
ac = must(ac, 'Additional launch acceptance scenarios:', '### Launch scenarios AC-19 to AC-32');
ac = ac.replace('### Research informed acceptance scenarios', '### Research informed scenarios AC-33 to AC-44').replace('### Revised journey acceptance scenarios', '### Journey scenarios AC-45 to AC-48');
o += ac + '\n';
const p6 = part('p6_ac_b.md'); const cut = p6.indexOf('### Illustrated card scenarios');
o += p6.slice(0, cut);
o += '### Version 2.1 scenarios AC-86 to AC-105\n\n' + slice(v21, 59, 80) + '\n';
o += p6.slice(cut);
o += '### Version 2.3 proposed scenarios AC-110 to AC-143\n\nProposed with FR-150 to FR-164. Not evidence of implementation.\n\n' + slice(spec, 483, 518) + '\n';
o += '#### Cross cutting UAT checks (v2.3)\n\n' + slice(spec, 521, 525) + '\n';

// 14 roadmap
let rm = slice(v13, 268, 310);
rm = must(rm, '## 11 Research informed roadmap and conditional requirements', '## 14 Roadmap and conditional requirements FR-068 to FR-076');
rm = must(rm, '| 11 | Address book and controlled recipient import | Medium convenience; further privacy controls | Medium | Later |', '| 11 | Bulk contact import and device contact integration (the address book itself is in launch scope) | Medium convenience; further privacy controls | Medium | Later |');
rm = must(rm, '| 13 | Gift Aid and additional Groups | Potential fundraising and expansion value | Large | Separately scoped phases |', '| 13 | Additional Groups (Gift Aid is now in launch scope subject to D-12) | Expansion value | Large | Separately scoped phase |');
rm = rm.replace(/^Gift Aid, AI-generated messages, address books, SMS/m, 'AI generated messages, bulk contact import, device contact integration, SMS');
o += rm + '\n';

o += part('p7_decisions.md');

// 16 status
let bs = slice(v22, 105, 144);
bs = must(bs, '## 5 Build status and test evidence', '## 16 Build status and test evidence');
o += bs + '\n';
o += '### 16.1 Version 2.3 launch critical items (built 10 October 2026)\n\nAutomated tests after this work: smoke 52, contacts 14, admin 29, operations 33, Gift Aid 23, resilience 47; all pass. FR-146 to FR-149 and the earlier rows above are unchanged. No UAT, assistive technology audit, security assessment or staging run has taken place.\n\n';
let t = slice(st, 9, 18).replace(/\| Proposal \| Status \| What exists \|/, '| Proposal | Status | What exists |');
o += t + '\nNot built: FR-150 to FR-153 and FR-155 (R1.1); FR-154, FR-158, FR-159 and FR-164 (R2). Two earlier rows change: FR-129 now imports refund events from Stripe (charge.refunded) as well as manual entry, and FR-130 alerts also cover off server backup, restore rehearsal, payment exceptions, abuse and access review. FR-160 bot detection is limited to a hidden trap field and limits.\n\n';

// 17 needed
let nb = slice(v22, 146, 152);
nb = must(nb, '## 6 Needed before launch', '## 17 Needed before launch');
o += nb.replace('D-14 wording', 'D-14 wording').replace('13 of these are required', '13 of these are required') + '\nAlso from v2.3: set `BACKUP_KEY` and an off server route (`BACKUP_COPY_DIR` or `BACKUP_EMAIL`); record the security assessment (G-SEC) and the support route test (G-SUP); the Trustees confirm or change the proposed limits (5 submissions an hour, 90 day access review) and the list of non waivable gates.\n\n';

// 18 approval and change record
o += `## 18 Approval and change record

### Approval

Scope and acceptance criteria: Trustee and project lead approval pending.
Donation arrangements and target: Treasurer and Trustees approval pending.
Privacy, reporting and retention: responsible administrator and Trustees approval pending.
Artwork and brand approval: 7th Swindon Scouts approval pending.

Trustee approval date: ____________________
Approved by: ____________________
Release decision: Approved / Approved with conditions / Not approved

### Change record

| Version | Date | Change |
|---|---|---|
| Baseline v2.3 | 10 October 2026 | Merges versions 1.0 to 2.2 and the v2.3 proposals into one document. Wording is carried over from the sources; where an earlier document was replaced, the later wording is shown and marked amended. Scenarios AC-62 to AC-72 are grouped because the source lists more scenarios than identifiers. Section 16 records build status. No requirement from an earlier version has been removed. |
| 2.3 proposed | 10 October 2026 | FR-150 to FR-164, AC-110 to AC-143, launch gates (Unified Development Spec). |
| 2.2 | 10 October 2026 | Blue scheme and logo, twelve designs, SQLite pilot, Gift Aid controls, FR-146 to FR-149, AC-106 to AC-109, build status. |
| 2.1 | 10 October 2026 | FR-131 to FR-145, AC-86 to AC-105, D-11 to D-16, S40 to S48; blue palette replaces purple (FR-096 to FR-099, AC-58 to AC-61). |
| 2.0 | 10 October 2026 | Proposed pilot defaults for D-01 to D-10. |
| 1.9 | 10 October 2026 | Development readiness review; FR-124 to FR-130 and AC-79 to AC-85; ten decision and evidence items. |
| 1.8 | | Administration screens S30 to S39 and mobile layouts; FR-117 to FR-123, AC-73 to AC-78. |
| 1.7 | | Private contact groups; FR-111 to FR-116, AC-69 to AC-72; S28 and S29. |
| 1.6 | | Private address book in launch scope; FR-100 to FR-110, AC-62 to AC-68; S25 to S27. |
| 1.5 | | Verified local Scout branding; FR-096 to FR-099, AC-58 to AC-61. |
| 1.4 | | Administration configuration; FR-081 to FR-095, AC-49 to AC-57. |
| 1.3 | 9 October 2026 | Revised journeys; FR-077 to FR-080, AC-45 to AC-48. |
| 1.2 | 9 October 2026 | Comparative research; FR-058 to FR-076, AC-33 to AC-44. |
| 1.1 | 9 October 2026 | FR-038 to FR-057, AC-19 to AC-32; status meanings, cancellation, opt outs, closure, support, finance exports, role separation. |
| 1.0 | 9 October 2026 | Simplified branded FRD: FR-001 to FR-037, AC-01 to AC-18. |

Source for the original scope: 7th Swindon Scouts Christmas ECard Simplified FRD Branded version 1.0, issued 9 October 2026. Competitor capabilities in versions 1.2 and later came from desk research of official product pages; no implementation inspection or live usability test of those versions was performed.
`;

fs.writeFileSync(path.join(docs, 'FRD_baseline_v2_3.md'), o);
console.log('written', o.length, 'chars');
