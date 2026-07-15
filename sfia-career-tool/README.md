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

`src/update-sfia-content.js` is a second, non-destructive one-off script that fills in real skill names,
skill overviews and level-specific descriptions, transcribed from the official SFIA 9 framework reference
PDF the user supplied (and confirmed is cleared for public display). It only touches the 24 of the
spreadsheet's 37 codes that actually match a real SFIA 9 skill; the other 13 (`BUAN`, `QUMT`, `VUIM`,
`AUTH`, `OPSG`, `INAN`, `MLEN`, `SYAS`, `STRP`, `SADM`, `PLMT`, `STAD`, `STRT`) don't correspond to any
code in the official SFIA 9 reference &mdash; likely a different SFIA version or spreadsheet-author
shorthand &mdash; and are left showing their raw code pending review. An administrator can correct or
fill these in via Admin &gt; SFIA skills.

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

- Public site: browse/search/filter published role profiles, compare any two roles to get a skill-by-skill
  gap analysis (level uplift / new skill required / aligned / current-role-strength), with matching
  learning resources and practical development suggestions shown against each gap
- Engaging role profile detail page (FRD v0.3, section 8.1): hero with purpose statement and tags,
  at-a-glance cards, "what this role does" (outputs / day-in-the-life / success indicators), a skills
  landscape grouped by importance, a progression panel with related roles, and a learning preview &mdash;
  all built with accessible, keyboard-operable `<details>`/`<summary>` and real `<a>` links (no
  click-only `<div>`s)
- Full SFIA skill/level detail on demand: each mapped skill expands to show the full SFIA skill
  description, the full level responsibility description, and (where an admin has added one) the exact
  skill-at-level wording, alongside role-specific notes and rationale
- SFIA skills & levels comparison table (FRD v0.7, section 8.2): a scannable table of every mapped skill
  (importance / SFIA code / skill / required level / summary / jump-to-detail), groupable by importance,
  required level or SFIA category, responsive (stacks to cards on mobile via `data-label`), and
  print-friendly (forces closed `<details>` open under `@media print`)
- Role-to-role gap analysis engine (FRD 10.1) with gap severity (no gap / minor / moderate / significant /
  new skill required) and learning-resource matching by skill, level range, role family, capability area
  and gap type, ordered by priority
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
- Aviva-inspired visual design (FRD v0.9): navy/blue/yellow/green colour palette applied via the existing
  CSS custom properties, yellow reserved for primary calls to action per the FRD's "use sparingly"
  guidance, 44px-minimum touch targets on buttons and nav links, and a mobile sticky action bar (Compare /
  Select aspirational) on the role profile page. Colour values are product-design tokens inspired by
  Aviva's public brand colours, not official Aviva brand assets &mdash; no Aviva logos or brand assets are
  used, per the FRD's own explicit restriction
- SFIA version badge on role profile pages (FRD v0.11 MVP-foundation slice only) &mdash; every SFIA skill
  and level was already scoped to a `sfia_version_id`, so this just surfaces it in the UI

## Known gaps / follow-ups (deliberately out of scope for this first pass)

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
- **Phases 2&ndash;5 are not built**: user registration, self-assessment, personal gap analysis, saved
  comparisons, development plans, evidence, sharing with managers/mentors/coaches, and aggregated
  organisational reporting are all out of scope here. The schema in `src/db.js` intentionally does not yet
  include the future-phase tables from the FRD's data model (User Career Profile, User Skill Assessment,
  Saved Comparison, Personal Development Plan, Development Plan Item, Evidence, Sharing Permission,
  Notification) &mdash; add them when that phase is scoped.
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
