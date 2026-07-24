# 7thPortal (Node)

Parent + leader portal for 7th Swindon Scout Group. This build is the **foundation
slice** of the 7thPortal FRD:

- **OSM OAuth login** for leaders/admins, plus locally-issued password accounts for parents (and seeded demo logins).
- **Parent dashboard** — a parent's linked children (with OSM hand-off links) and their latest notices.
- **Notices** — group/section notices, audience-scoped (everyone / parents / leaders).
- **Leader document library** — upload, version, acknowledge and download leader-only policies, templates and guidance (wireframes 48–51).
- **Admin shell** — users & roles, children, notice management, an audit log and settings.

The photo gallery and the expenses/mileage finance module described elsewhere in the
FRD pack are **not** in this build.

## Stack

Node ≥ 22.5 with Express, `express-session`, and the built-in `node:sqlite` module —
**no native modules and no build step**, so it installs and runs anywhere Node does.
Uploaded document files are stored on disk (under `DATA_DIR`), never in the database
and never behind a public URL — downloads are streamed through the authenticated
`/api/documents/:id/download` route.

## Local development

```bash
cp .env.example .env      # optional; sensible defaults work out of the box
npm install
npm start                 # http://localhost:8050
```

On first boot (with `SEED_DEMO_USERS=true`) three demo accounts are created:

| Role   | Email                     | Password        |
| ------ | ------------------------- | --------------- |
| Admin  | `admin@7thportal.local`   | `portal-admin`  |
| Leader | `leader@7thportal.local`  | `portal-leader` |
| Parent | `parent@7thportal.local`  | `portal-parent` |

Set `SEED_DEMO_USERS=false` once real accounts exist. **Change or remove these before
any real use.**

## OSM sign-in

Until `OSM_CLIENT_ID` / `OSM_CLIENT_SECRET` are set, the OSM button on the login page
shows as unavailable and everyone uses local accounts. To enable it:

1. Create an OSM developer application and register the exact callback URL
   (`https://<your-domain>/auth/osm/callback`).
2. Set `OSM_CLIENT_ID`, `OSM_CLIENT_SECRET` and `OSM_CALLBACK_URL`.
3. List admin OSM emails/ids in `ADMIN_EMAILS` / `ADMIN_OSM_USER_IDS`; everyone else
   who signs in through OSM becomes a Leader.

OSM access/refresh tokens are encrypted at rest with `TOKEN_ENCRYPTION_KEY`. The
client secret never leaves the server and is never sent to the browser.

## Deployment (Railway)

Deployed with the Railway CLI (`railway up`) from this folder.

- Attach a **persistent volume mounted at `/app/data`** and set `DATA_DIR=/app/data`
  so the SQLite database and uploaded documents survive redeploys.
- Set `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` explicitly (32-byte hex for the key):
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- Set `OSM_CALLBACK_URL` to the deployed HTTPS callback and register exactly that URL
  against the OSM developer application.
- `trust proxy` is enabled, so session cookies are marked `Secure` behind Railway's TLS.

## What each part maps to

| Area              | Routes                          | Frontend                    |
| ----------------- | ------------------------------- | --------------------------- |
| Auth (local+OSM)  | `src/routes/auth.js`            | `login.html`                |
| Parent dashboard  | `src/routes/api.js` `/dashboard`| `dashboard.html`            |
| Notices           | `src/routes/api.js` `/notices`  | `notices.html`              |
| Document library  | `src/routes/documents.js`       | `documents.html`, `document.html` |
| Admin shell       | `src/routes/admin.js`           | `admin.html`                |
