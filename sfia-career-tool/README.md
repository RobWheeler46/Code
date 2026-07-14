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

## SFIA content is placeholder data, not the real licensed catalogue

SFIA is a licensed framework. Rather than scrape or hardcode the real SFIA skill catalogue, the seed
script populates the database with **fictional example data** (skill codes prefixed `EX-`, a framework
version literally named "Example Framework v1 (placeholder)", generic level names). The schema and admin
UI fully support entering the real SFIA 9 catalogue once a licence is confirmed &mdash; an administrator
would replace the placeholder skills/levels/categories through Admin > SFIA skills, or a future import
script could load a real dataset.

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
- Career pathway map (FRD v0.8, Part J): admin-managed pathways group role profiles into stages with
  labelled connections (progression / lateral / specialisation / management / architecture / stretch /
  alternative). Public pathway list (filterable by role family/type) and detail view render stages as
  columns of role cards, each showing level range and core-skill count, with "View role", "Compare from
  here" and "Set as aspirational" actions, plus an "Explore career paths from this role" link on the role
  profile page that opens the pathway with that role highlighted

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
- **No real SFIA content** &mdash; see above. This is the biggest thing to do before real users see the
  tool.
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
