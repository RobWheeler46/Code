# 7th Swindon Form Request Manager

A standalone form and request management system, built from the *Functional Requirements Document* for
7th Swindon Scout Group. This first build focuses on the core workflow plus the fully-specified
**7th Swindon Scout Activity Approval Form**.

Stack: Node.js + Express + the built-in `node:sqlite` module (no native build step) + vanilla JS/HTML on
the frontend. No frameworks, no build tooling &mdash; matches the style of the other tools in this repo.

## Requirements

- Node.js 22.5 or later (uses the built-in `node:sqlite` module; tested on Node 24)

## Authentication: sign in with OSM

There are no local passwords. Everyone &mdash; requesters, approvers, and administrators &mdash; signs in
with their own **Online Scout Manager email and password**. The server exchanges those credentials for
an access token via OSM's OAuth2 `password` grant (`POST /oauth/token`), the same mechanism the
[osm-badges](../osm-badges) project uses. The password is only ever used for that one request to OSM and
is never logged or stored; nothing except the resulting local account (name, email, group membership) is
persisted.

You need an **OSM API application** (a `client_id` / `client_secret` pair from OSM) that supports the
password grant &mdash; you can reuse the one already set up for `osm-badges`, or register a new one the
same way.

OSM only proves *who someone is*; it has no concept of this app's requester/approver groups, and a valid
OSM login on its own is **not** enough to get in. An administrator must add the person first (Admin >
Users, by their OSM email address) before they can sign in at all &mdash; login checks for an existing,
active local profile and is denied otherwise, even with a correct OSM password. Group membership (who's
in the "7th Swindon Activity Approvers" group, who's an admin) is then managed locally in the same place.

There's no forgotten-password or password-reset flow in this app at all (by design &mdash; see FRD 4.4).
If OSM rejects someone's credentials, the login page points them at the OSM website to reset their
password there; this app cannot do it for them.

**Security tradeoff worth knowing:** because login collects the OSM password directly on this app's own
page (rather than redirecting to OSM's login page), users are trusting this app with their real OSM
credentials. That's a reasonable tradeoff for a small, trusted, group-run tool, but it's a materially
different (weaker) trust model than a proper OAuth redirect flow, so don't treat it as equivalent to
"Login with OSM" buttons you might see on larger third-party products.

## Setup

```bash
cd swindon-form-manager
npm install
cp .env.example .env      # edit OSM_CLIENT_ID / OSM_CLIENT_SECRET / ADMIN_EMAIL / SESSION_SECRET
npm run seed               # creates the database, groups, form and workflow, and pre-registers the admin
npm start
```

The app listens on `http://localhost:3000` by default (or `PORT` from `.env`).

The seed script registers `ADMIN_EMAIL` as an administrator (in the "7th Swindon Administrators" group)
so that person can log straight in as an admin using their normal OSM password &mdash; no local password
to set or remember. Everyone else must be added the same way before their first login: go to
Admin > Users, add them by their OSM email address, and assign requester/approver group membership. A
correct OSM email/password alone does not grant access &mdash; the person must already exist here.

Uploaded documents are stored under `uploads/<request-id>/` on disk; the SQLite database lives at
`data/swindon-forms.db`. Both are gitignored &mdash; back them up together if you need to preserve data.

**I haven't been able to test the live OSM login end-to-end** (it needs a real OSM email/password and a
registered OSM API app, which I don't have). The token exchange and role-lookup calls reuse the same
`oauth/token` and `getUserRoles` endpoints already working in `osm-badges`, but please verify the full
login flow with a real account once `OSM_CLIENT_ID`/`OSM_CLIENT_SECRET` are set.

## What's implemented

- OSM-backed login (see above) with requester / approver / administrator roles (a user can hold several)
- Requester groups and approver groups, with group-based form visibility and approval assignment
- The full 7th Swindon Scout Activity Approval Form (FRD section 8.4), with conditional fields,
  file uploads (risk assessment required, up to 10 files/10MB each), and client + server-side validation
- Draft saving, submission, and administrator "submit on behalf of a requester"
- Single-stage approval workflow by default (7th Swindon Activity Approvers), built on a
  `workflow_stages` table that already supports **sequential multi-stage** workflows (FRD 6.2, 8.6) &mdash;
  adding more stages today just needs rows inserting into that table; there's no admin UI for it yet
- Approve / reject (with required reason) / withdraw / resubmit, where resubmission restarts the
  workflow from stage one on the same request record (FRD 6.4)
- Full audit trail and in-app notifications (bell icon) for submission, assignment, approval, rejection,
  resubmission
- Document access restricted to the requester, assigned approvers, and administrators
- Admin area: manage users (add by OSM email &mdash; required before that person can log in at all,
  activate/deactivate, promote/demote admin, group membership), manage groups, and view/filter all requests
- Manual archive / mark-completed / permanently-delete actions (admin-triggered), including a minimal
  deletion record (FRD 13.4) left behind after permanent deletion

## Known gaps / follow-ups (deliberately out of scope for this first pass)

- **No generic form builder.** The Activity Approval Form's fields are hardcoded (in
  `src/lib/activityForm.js` and the form HTML) rather than driven by an admin-configurable schema.
  Adding a second form currently means adding code, not clicking through a UI.
- **No scheduled retention jobs.** FRD section 13 asks for automatic archiving after 6 months and
  permanent deletion after 7 years. This build gives admins manual "Archive" / "Permanently delete"
  buttons instead of a background scheduler. Wiring in a cron-style job (e.g. `node-cron`, checked on
  server start) to enforce this automatically would be the natural next step.
- **No reporting dashboards.** FRD section 12 lists a set of report views (by form, by status, by
  approver group, etc). The admin "All requests" table supports filtering by status only.
- **Sessions are in-memory.** Restarting the server logs everyone out. Fine for a single small-group
  deployment; swap in a persistent session store (e.g. `connect-sqlite3`) if that becomes annoying.
- **No email notifications**, only in-app ones. Wiring up SMTP (e.g. via `nodemailer`) is a reasonable
  addition once real usage starts.
- **Group membership isn't auto-derived from OSM roles.** OSM knows which sections someone leads; this
  app doesn't automatically turn that into "requester"/"approver" group membership here &mdash; an
  administrator still assigns groups by hand. `getUserRoles` data is fetched at login time (see
  `src/lib/osm.js`) but only used to populate `req.session.osmSections`, which isn't surfaced in the UI
  yet. Auto-suggesting group membership from OSM section roles would be a reasonable enhancement.
