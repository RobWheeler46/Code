# SFIA Career Tool

A public role-profile, gap-analysis and learning-recommendation tool, built from the *SFIA Role Profile,
Gap Analysis and Personal Career Development* Functional Requirements Document. This build covers the
full Phase 1 MVP scope (public browsing, role-to-role comparison, learning recommendations, and the admin
backend) as agreed with the product owner. Phases 2&ndash;5 (personal accounts, self-assessment, development
plans, sharing/review, organisational reporting) are out of scope for this build &mdash; the schema and
UI are deliberately left room to add them later without rework.

Stack: Node.js + Express + the built-in `node:sqlite` module (no native build step) + vanilla JS/HTML on
the frontend. No frameworks, no build tooling &mdash; matches the style of the other tools in this repo.

## Requirements

- Node.js 22.5 or later (uses the built-in `node:sqlite` module; tested on Node 24)

## Content: real role/skill data, imported from a spreadsheet

`npm run seed` still seeds **fictional placeholder** demo content (skill codes prefixed `EX-`, a framework
version literally named "Example Framework v1 (placeholder)") &mdash; useful for a fresh local checkout or
for testing, but not what's actually running in production.

The deployed app's real content comes from `src/import-career-paths.js`, a one-off script that replaces
the placeholder data with 33 real role profiles across 8 tracks, imported from the user's own
`EngineeringCareerPathsV3.xlsx` (an internal engineering career framework, not the official SFIA
catalogue). It uses **real SFIA 9 skill codes** (e.g. `PROG`, `ARCH`, `DATM`) with real per-role levels.

`src/update-sfia-content.js` was an early, non-destructive one-off script that filled in real skill names,
overviews, guidance notes and level-specific descriptions (plus official SFIA source URLs) for the 24 of
37 skill codes that could be hand-verified before a structured source workbook was available - extracted
first from the official SFIA 9 PDF reference, later cross-checked against the source workbook itself. Kept
for history; superseded by the import below.

**`src/import-sfia-9-reference-data.js`** (added for FRD v0.21-v0.23 Part K / the "SFIA 9 Workbook
Re-check and Clean Import Template" appendix) is the current, complete source of SFIA reference data. It
imports the **full official SFIA 9 catalogue** - all 147 professional skills, 672 skill-at-level
descriptions, 7 levels of responsibility, 16 attributes/business skills and 112 attribute-at-level
descriptions - from `src/data/sfia9-reference.json`. That JSON was generated once from
`SFIA_9_Clean_Import_Template_v0_23.xlsx` (a pre-cleaned, validated export of the official source workbook
the user supplied; see `Appendix and Import Model Validation` for how that extraction was checked) and
committed, so the import needs no xlsx dependency and no binary workbook in the repo or the deployment
container - the same "extract to committed JSON" pattern used for `src/data/sfia-skills-content.json`.
Safe to re-run: every write is an update-if-exists/insert-if-not against a stable natural key (skill code,
level number, attribute code), so existing `sfia_skills` rows keep their id and `role_profile_skills`
foreign keys are never disturbed.

Run it with `node src/import-sfia-9-reference-data.js` (locally) or `railway ssh node
src/import-sfia-9-reference-data.js` (production) - no arguments, it reads the committed JSON. Of the 37
skill codes referenced by the
imported role profiles, 13 (`BUAN`, `QUMT`, `VUIM`, `AUTH`, `OPSG`, `INAN`, `MLEN`, `SYAS`, `STRP`, `SADM`,
`PLMT`, `STAD`, `STRT`) still don't correspond to any of the 147 official skills - confirmed against the
complete list, not a guess - likely a different SFIA version or spreadsheet-author shorthand, and are left
showing their raw code pending review (`src/flag-unmatched-skills.js`, unchanged). An administrator can
correct or remap these via Admin &gt; SFIA skills.

Run it with `node src/import-career-paths.js` (needs `ADMIN_EMAIL` already seeded via the normal seed
script first, so a super admin exists to own the imported content). It is **destructive**: it deletes all
existing role families, capability areas, SFIA skills/categories/versions, role profiles, learning
resources, and career pathways before importing &mdash; it does not touch users/admin roles/audit log.
Re-running it is safe in the sense that it produces the same result each time, but anything an admin has
added on top since the last run will be lost.

## Setup

```bash
cd sfia-career-tool
npm install
cp .env.example .env      # edit SESSION_SECRET / ADMIN_EMAIL
npm run seed               # creates the database, admin roles, placeholder SFIA data, and the first admin
npm start
```

The app listens on `http://localhost:3000` by default (or `PORT` from `.env`).

The seed script creates `ADMIN_EMAIL` as a Super Admin and prints a randomly generated password **once**
to the console &mdash; there is no password reset flow, so save it or change it after first login (Admin
users tab currently supports role/status changes but not self-service password change; that would be a
follow-up). Running the seed script again is safe: it only inserts records that don't already exist.

The SQLite database lives at `data/sfia-career-tool.db` (gitignored).

## Deployment (Railway)

Deployed at `https://sfia-tool.up.railway.app` (project `radiant-enthusiasm`, service
`shimmering-caring`), building from this repo's `sfia-career-tool` subfolder (root directory set in
Railway service settings, since the repo is a monorepo with no top-level `package.json`).

**A persistent Volume must be attached at `/app/data`.** Without one, `/app/data` is ordinary container
storage and the SQLite database is wiped on every redeploy &mdash; this happened once during setup (a
volume was believed to be attached but wasn't; `railway volume list` showed none, confirmed by `/proc/mounts`
inside the container). Check `railway status` shows a `volume:` line before assuming data will survive a
deploy.

To run the seed or import scripts against the live deployment (not your local machine): the environment
variables (`ADMIN_EMAIL`, `SESSION_SECRET`) live in Railway's Variables tab, not this repo's `.env`. Use
`railway ssh npm run seed` or `railway ssh node src/import-career-paths.js` &mdash; `railway ssh` connects
into the actual running container (with the volume mounted), unlike `railway run`, which executes locally
with Railway's env vars injected and can't reach a volume that only exists inside the container.

## What's implemented

- **Simplified role profile model (FRD v0.19/v0.20, superseding the earlier "engaging content" model
  from v0.3/section 8.1)**: a role profile's public-facing business data is now just Role Name, Grade
  (optional, organisation-defined, separate from SFIA level), Role Description, and validated SFIA
  skills/levels. The richer v0.3 fields (purpose statement, at-a-glance cards, day-in-the-life,
  success indicators, related-roles roster, skill importance core/important/optional) were explicitly
  listed by the FRD as "removed or demoted" &mdash; they're no longer collected via the primary admin
  form or shown on the public page, but the underlying database columns and existing data were
  **deliberately not dropped or deleted** (kept editable via a collapsed "Legacy enrichment fields"
  section in the admin role editor, in case they're needed again) since the FRD itself frames them as
  "may be reintroduced later as optional enrichment," and destroying real imported content for 33 live
  roles over a wording change would be irreversible. See "Known gaps" for the confirmation trail on this
  decision.
- Public site: browse/search/filter published role profiles, compare any two roles to get a skill-by-skill
  gap analysis (level uplift / new skill required / aligned / current-role-strength), with matching
  learning resources and practical development suggestions shown against each gap
- Role profile detail page: hero (Role Name, Grade, SFIA version badge), Role Description, a skills
  landscape, and full SFIA skill/level detail on demand &mdash; all built with accessible, keyboard-operable
  `<details>`/`<summary>` and real `<a>` links (no click-only `<div>`s)
- Full SFIA skill/level detail on demand: each mapped skill expands to show the full SFIA skill
  description, the full level responsibility description, and (where imported) the exact skill-at-level
  wording
- SFIA skills & levels table (FRD v0.7 section 8.2, columns simplified per v0.19/v0.20): a scannable table
  of every mapped skill (SFIA code / skill / required level / summary / jump-to-detail), groupable by
  required level or SFIA category, responsive (stacks to cards on mobile via `data-label`), and
  print-friendly (forces closed `<details>` open under `@media print`)
- Role-to-role gap analysis engine (FRD 10.1) with gap severity (no gap / minor / moderate / significant /
  new skill required) and learning-resource matching by skill, level range, role family, capability area
  and gap type, ordered by priority
- Enhanced role comparison layout (FRD v0.15, importance-based filter replaced with a severity-based one
  per v0.19/v0.20's removal of skill importance): a comparison hero with a plain-English overall-alignment
  summary and Grade (where set), filterable skill-by-skill cards (all / level uplifts / new skills /
  aligned / bigger gaps), and a side-by-side detail panel per skill showing the current and target SFIA
  skill-at-level (or generic level) description together with a plain-English difference explanation
  &mdash; stacks to one column on mobile. Account-dependent parts (evidence confidence,
  add-to-development-plan) and AI Career Coach integration are out of scope, same as elsewhere in this build
- Single SFIA version per role profile (FRD v0.17, s.70): `role_profiles.sfia_version_id` is now a
  mandatory field (added via an additive `ALTER TABLE` migration in `src/db.js`, safe to run against the
  live database without data loss). The admin API rejects adding a skill mapping from a different SFIA
  version than the role, and blocks publishing a role profile with any cross-version skill mapping. The
  admin skill-mapping picker also restricts the level dropdown to levels with imported skill-at-level data
  for the selected skill, where that data exists (FRD v0.17 s.69.1)
- Admin backend with four permission levels (Super Admin / Admin / Content Editor / Viewer), enforced both
  server-side (403 on unauthorised actions) and in the UI (buttons hidden when not permitted)
- Admin: full CRUD for role families, capability areas, SFIA versions/categories/skills/levels (including
  full descriptions), SFIA skill-at-level descriptions, role profiles (engaging content fields, skill
  mapping with per-mapping display notes and default-expanded control, draft/publish/unpublish/archive,
  version history on published edits), and learning resources (with skill mapping, publish/archive)
- Publishing guardrails: a role profile needs a title and at least one mapped skill to publish; removing
  the last skill from a role, or deactivating a skill used by published roles, requires confirmation
- Admin user management (Super Admin only), audit log (every create/edit/publish/archive/login is
  recorded and filterable), content-review dashboard (overdue / due soon / no review date), and a basic
  reporting tab (most viewed/compared roles, common aspirational roles, common comparisons)
- Usage events logged for public role views and comparisons, feeding the admin reports
- Career pathway map (FRD v0.8 Part J, layout reworked per FRD v0.10): admin-managed pathways group role
  profiles into stages with labelled connections (progression / lateral / specialisation / management /
  architecture / stretch / alternative). Public pathway detail view renders stages as a **vertical,
  collapsible list** (not a horizontal row) &mdash; each stage is a `<details>` section the user can expand
  or collapse, with a quick-jump nav row at the top, so a pathway with 7&ndash;8 roles stays scannable on
  both mobile and desktop. Role cards keep "View role", "Compare from here" and "Set as aspirational"
  actions, plus an "Explore career paths from this role" link on the role profile page that opens the
  pathway with that role highlighted (and its stage auto-expanded)
- Visual design aligned to the FRD wireframe images (not just the design *text*): light-tinted hero panels
  with an inline mountain/pathway SVG illustration, a mobile **bottom tab bar** (Home / Roles / Compare /
  Pathways) alongside the desktop top nav, icon-tiled action cards on the home page, role cards showing
  Grade, `Ln` level pills in tables and comparisons, and soft-tinted gap badges (minor uplift amber, new
  skill lilac). Primary buttons are **solid blue** with yellow kept as a small accent (nav active-underline,
  hero flag) &mdash; this follows the wireframe images, which differ from the v0.9 *text*'s "yellow for
  primary CTAs" wording; where the wireframes and the written requirements conflicted, the wireframes won
  per the product owner's instruction, **except** the role-profile wireframe's Importance column, which was
  left out because v0.19/v0.20 explicitly removed skill importance (the wireframes predate that change).
  Wireframe elements for deferred Phase-2 features (the "Start assessment" button, "Ask AI Career Coach"
  panels, and the bottom-nav "Coach" tab) are intentionally omitted rather than shown as dead controls.
  Colour values are product-design tokens inspired by Aviva's public brand colours, not official Aviva
  brand assets &mdash; no Aviva logos or brand assets are used, per the FRD's own explicit restriction.
- SFIA version badge on role profile pages (FRD v0.11 MVP-foundation slice only) &mdash; every SFIA skill
  and level was already scoped to a `sfia_version_id`, so this just surfaces it in the UI

## Known gaps / follow-ups (deliberately out of scope for this first pass)

- **FRD v0.19/v0.20's "removed" role profile fields were removed from the experience, not deleted from
  the database.** The FRD explicitly lists role family, capability area, role type, seniority, purpose
  statement, day-in-the-life, evidence examples, related-roles roster, role-specific SFIA rationale and
  skill importance (core/important/optional) as fields to remove from the MVP role profile. Confirmed with
  the user before implementing (given this reverses functionality built for an earlier FRD version, v0.3,
  and affects 33 live published roles with real imported content) that: (1) the public page should
  actually stop showing this content rather than just make it non-mandatory, (2) skill importance should
  be removed even though it drove the comparison page's severity/priority logic, and (3) Grade should stay
  optional with no invented values for existing roles, since the source spreadsheet import never had a
  grade concept. The database columns and existing data were kept (not dropped/nulled) &mdash; still
  editable via a "Legacy enrichment fields" section in the admin role editor &mdash; per the FRD's own
  "may be reintroduced later as optional enrichment" framing, and because destroying real content over a
  UI simplification would be irreversible. `role_description` was backfilled for the 33 existing roles by
  consolidating their existing purpose_statement/summary/responsibilities text (not invented content) so
  the simplified page isn't blank; `grade` was left null since there's no real source data for it.
- **FRD v0.17 s.69's full "validated SFIA selection" admin workflow is only partly built.** Skill and
  level mapping have always been controlled dropdowns (never free text, so most of s.69 was already
  satisfied architecturally), and level options are now filtered by imported skill-at-level data where it
  exists. Not built: a description preview step before saving a mapping, and an explicit admin validation
  panel listing all mapping issues (today, invalid attempts are just rejected with an error message).
- **No SFIA version switcher or migration workflow.** `role_profiles.sfia_version_id` is enforced, but
  since only one SFIA version has ever existed in this app, there's no UI to change a role's version or
  migrate mappings between versions &mdash; the FRD's own delivery notes defer this to "a later sprint if
  multiple SFIA versions are active."
- **Comparison AI Career Coach integration and account-dependent parts of FRD v0.15 are not built** (explain
  this difference / what should I focus on first / evidence confidence / add-to-development-plan) &mdash;
  same reasoning as the guided-assessment/coach deferral below.
- **Guided role-based SFIA self-assessment (FRD v0.7 Part E) and the AI Career Coach (FRD v0.7 Parts
  F&ndash;I) are not built.** Both are large new feature sets (question banks, scored attempts, save/resume,
  an LLM-backed coach with prompt templates, session/feedback logging, 20 test scenarios) that depend on
  registered user accounts, which this build deliberately does not have (see Phases 2&ndash;5 below). This
  isn't just a scope call on my part &mdash; the FRD's own phasing tables say the same thing: Table 56
  ("Phase 1 MVP: Do not include guided personal assessment... unless user accounts are also included") and
  Table 61 ("Phase 1: No personal coach. Optional static guidance only."). Build these once Phase 2
  (personal accounts) is scoped.
- **`role_at_a_glance` is simplified to a single "focus area" text field**, not the full structured
  card set the FRD describes (seniority/role type/capability/core-skill-count are already derived from
  existing columns and rendered directly, so the JSON field only needs to carry the one thing that isn't
  already structured data). Revisit if at-a-glance cards need more admin-authored content later.
- **13 of the 37 imported SFIA skill codes don't match the official SFIA 9 reference** &mdash; see the
  content section above. They still show their raw code as `skill_name` until an admin reviews them.
  `src/flag-unmatched-skills.js` (non-destructive, safe to re-run) replaces the generic "not yet
  populated" placeholder text with an explicit "not an official SFIA 9 code" explanation on these 13
  records, so it's clear to any visitor rather than silently looking unfinished &mdash; deliberately does
  not guess at what the code should actually mean. (This is now the only remaining data gap - the other
  123 of the 147 official skills are fully imported as of `import-sfia-9-reference-data.js`, browsable in
  the admin role-creation wizard even though 110 of them aren't mapped to any role profile yet.)
- **`sfia_attributes`/`sfia_attribute_level_descriptions` (all 16 attributes, 112 level descriptions) are
  imported but not surfaced anywhere in the UI yet.** The FRD frames these as supporting data for the
  future guided-assessment and AI-coach features (Parts E/F), which this build deliberately doesn't
  include (see below) - imported now anyway since the source data was available and re-importing later
  would be needless repeated work, not because anything in Phase 1 reads them yet.
- **No learning resources imported.** The source spreadsheet didn't include any, so every skill gap on the
  live site currently shows "No learning resources are linked yet." until an admin adds real ones.
- **No approval workflow for role profile changes.** Publishing is immediate for anyone with `canPublish`;
  the FRD lists this as an open question (19.5), not a Phase 1 requirement.
- **No PDF export, no bulk upload** for role profiles or SFIA mappings &mdash; listed as open questions /
  future enhancements in the FRD, not MVP requirements.
- **Career pathway map (FRD v0.8) is built minus its account/AI-dependent parts.** FR-CP5 (personalised
  readiness indicators) and FR-CP6 (AI Career Coach pathway explanations) are explicitly future-phase in
  the FRD itself and depend on features this build doesn't have (accounts, assessment, AI coach). The
  `user_saved_pathway` entity is likewise explicitly marked "Future phase entity" in the FRD and wasn't
  built. Pathways render as stage-columns with labelled connections rather than a free-form draggable
  canvas &mdash; `x_position`/`y_position` from the FRD's data model were left out of the schema since
  nothing in this build would populate or use them.
- **Sessions are in-memory.** Restarting the server logs admins out. Fine for a small deployment; swap in
  a persistent session store (e.g. `connect-sqlite3`) if that becomes annoying.
- **No self-service password change or reset flow** for admin users.
- **Phase 2 has started on the `phase-2` git branch** (not merged to `main`, not on the live Railway
  site). Built so far: the **registered end-user accounts foundation** (end users share the `users`
  table, distinguished by having no admin role; admin-invite-only registration via Admin &gt; End users;
  `/api/login` now admits any active user and the client routes on `isAdmin`; a `requireUser` middleware
  gates the new `/api/user/*` routes) and the **first personal feature: saved roles + saved comparisons +
  a personal dashboard** (`saved_roles`/`saved_comparisons` tables, "Save role" on the role page, "Save
  comparison" on the compare page, `dashboard.html`, and an auth-aware nav showing Sign in vs My
  dashboard/Sign out). No email service is configured, so no self-service sign-up or email-based password
  reset yet.
  Also built (2nd Phase-2 feature): **guided role-based SFIA self-assessment (FRD Part E)** &mdash; from a
  role page a signed-in user starts an assessment (the wireframe's "Start assessment", now real on this
  branch), works through a one-skill-per-step flow rating their current level against each required SFIA
  skill (the answer options are the **real imported skill-at-level descriptions**, so no hand-authored
  question bank or LLM is needed &mdash; skills without imported level text fall back to the 7 generic
  levels), with optional evidence + a confidence score, save &amp; resume (autosave per skill), then a
  **readiness result** (self-assessed vs required level per skill &rarr; met / minor / moderate /
  significant gap, an overall Ready / Nearly there / Development needed label and % met). Attempts appear
  on the dashboard. Tables: `assessment_attempts`, `assessment_responses`.
  Also built (3rd Phase-2 feature): **personal development plan** &mdash; a signed-in user builds a plan of
  SFIA skills to develop, each toward a target role + level with a status (not started / in progress /
  done), notes, and any matching learning suggestions. Items are added with one click from an **assessment
  gap** ("Add to plan" on the readiness results) or a **role-comparison gap** ("Add to development plan" on
  a gap row), or tracked on the plan page (`plan.html`); a summary shows on the dashboard. Table:
  `development_plan_items`. Still to come in Phase 2+: evidence capture, sharing with managers/mentors/
  coaches, the AI Career Coach (Parts F&ndash;I), and aggregated organisational reporting.
- **FRD v0.11's full multi-version SFIA support is not built.** Only the MVP-foundation slice (data already
  version-scoped, version badge shown on role profiles) is in place. Admin version-lifecycle management
  (draft/active/published-default/legacy/archived), cross-version comparison blocking, and the migration
  review workflow are all explicitly Phase 2&ndash;4 in the FRD's own suggested delivery approach, and
  there's only one SFIA version in use today &mdash; build these if/when a second version is actually needed.
- **FRD v0.13 Part K / Appendix L's SFIA workbook import pipeline is not built.** This specs a full
  admin-facing import system (upload &rarr; staging tables &rarr; validation &rarr; approval &rarr; publish,
  plus cross-version migration mapping) for a source file
  (`sfia-9_current-standard_en_260521.xlsx`) that wasn't provided alongside the FRD. The practical outcome
  this section is aiming for &mdash; real SFIA 9 content in the app &mdash; is already achieved via the
  one-off `src/import-career-paths.js` and `src/update-sfia-content.js` scripts documented above. Revisit
  as a proper admin feature only if SFIA content needs to be re-imported/updated regularly rather than as
  an occasional one-off.
