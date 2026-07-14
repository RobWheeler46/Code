# 7thPortal

Parent and Leader Portal for 7th Swindon Scout Group, built from the `7thPortal_FRD.docx` functional requirements document. OSM (Online Scout Manager) remains the source of truth - 7thPortal reads a limited set of OSM data and links back to OSM for anything that needs updating.

## Stack

Plain Node.js + Express + `node:sqlite` (no native build step) + hand-written HTML/CSS/JS in `public/`, following the same pattern as the other tools in this workspace (`market-research-tool`, `sfia-career-tool`).

## Running it

```
cd 7thportal
npm install
npm start
```

Open http://localhost:3000. With no OSM credentials configured, the homepage's **Demo Mode** buttons let you explore the parent, leader and admin views with sample data (`ALLOW_DEMO_MODE=true` by default in `.env`).

The first account to sign in via real OSM OAuth is automatically made a Portal Administrator (bootstrap). In demo mode, `/auth/demo/login?as=admin` plays the same role.

## Integration model - read this before connecting real OSM data

The FRD's own open questions (section 15) flag that OSM's authentication and integration model needed validating during solution design. Two decisions were made explicitly so the app could actually be built and demoed:

1. **Leaders and administrators authenticate directly with OSM OAuth2** (`Log in with OSM`), using the exact client-credentials + Basic-auth token flow already proven working in this workspace's `osm-badges-2025` tool. Their own OSM token then drives what sections/members they can see - 7thPortal does not duplicate OSM's own permission model, it inherits it.
2. **Parents/carers have no such route**, because OSM does not currently offer a public OAuth flow for parent accounts (only for leaders' section-scoped access). So Version 1 uses locally-issued parent accounts: a Portal Administrator creates the account and links it to specific OSM member ID(s) picked from a live member list (Admin → Parent accounts). Parent-facing pages then read OSM data through one designated **OSM service connection** (Admin → Integration health → "Connect service account") - functionally an org-level read-only API user, a common pattern for this kind of integration. This is surfaced in the UI, not hidden.

This should be revisited once 7th Swindon has validated exactly what OSM's approved integration route supports (FRD open question 15.2).

**Endpoint confidence**: the OAuth handshake and the badge-records endpoints (`getDataPayload`, `getAvailableBadges`, `getBadgeRecords`) mirror `osm-badges-2025` and are known to work. The member list, programme and event endpoints (`src/lib/osm.js`) are best-effort based on public community documentation of OSM's "ext" API, not an official spec - every call is wrapped so a shape mismatch degrades to "data not available" (NFR-017) instead of breaking a page. Validate these against a live sandbox account and adjust field mappings in `osm.js` as needed.

## Role model

`parent`, `section_leader`, `assistant_leader`, `group_leadership`, `trustee_viewer`, `admin` - matching FRD section 6. New OSM logins default to `section_leader` if OSM reports any section roles, otherwise `group_leadership`; an admin can change anyone's role in Admin → Users & roles. `trustee_viewer` is blocked from section member lists server-side (FRD 6: "no default access to medical or detailed child records"); `group_leadership` can see member lists but not date of birth.

## What's implemented (MVP, FRD section 11)

- OSM OAuth login for leaders/admins, local email+password for parents, secure sessions with idle timeout, logout.
- Parent dashboard (linked children, notices) and child profile (section, programme, events, badges, link back to OSM).
- Leader dashboard (permitted sections, member counts, next meeting/event) and section member list / member summary, scoped to the leader's own OSM permissions.
- Local notices: admin-authored, audience-targeted (all/parents/leaders/section), auto-expiring.
- Admin backend: integration health, OSM service connection, user & role management (including disabling accounts), parent account creation + child linking, visible-sections config (FR-057), session/audit settings, audit log viewer.
- Audit logging on login/logout, profile/member views, and all admin changes; automatic pruning past the configured retention period.
- Privacy notice page (placeholder content - needs governance sign-off before real child data is used, per NFR-008 to NFR-013).
- Demo Mode so the whole app is clickable before OSM credentials exist.
- Photo gallery (FRD 8.13) - see its own section below.

## Photo gallery (FRD 8.13, added in the "with Photo Gallery" FRD revision)

**Ships off by default.** The FRD itself recommends (§12.1) treating this as a Phase 2/3 feature rather than initial-MVP, given the safeguarding/consent work involved - so it's built but gated behind Admin → Settings → "Enable the photo gallery", which a Portal Administrator turns on once that groundwork is actually done, not before.

How it satisfies the FRD's controls:
- **Leader workflow**: create a draft album (title, grouping, section, visibility), upload photos, review, tick a consent-confirmation checkbox, submit for approval (FR-063 to FR-072).
- **Consent (FR-076)**: OSM has no public per-child photo-consent field, so this is a leader-ticked "I confirm everyone identifiable has valid consent" checkbox required before an album can be submitted - a placeholder for real consent data, not a substitute for it. Flagged as FRD open question 15.1 ("where will photo consent be mastered") - unresolved by design.
- **Approval**: only a Portal Administrator can publish (approve) or reject a pending album, or unpublish/delete a *published* one; the leader who created a draft/pending album can also delete it before publication (FR-072, FR-073).
- **No downloads, no public URLs (FR-069, NFR-026, NFR-027)**: images are never in `public/` or served by a static path. `GET /api/gallery/photos/:id/image` re-checks the requesting user's permission against the album on every single request (an authenticated proxy, one of the two options NFR-027 allows) and sets `Cache-Control: private, no-store`. There is no download or share button in the UI.
- **Web-optimised, EXIF-stripped copies (FR-070, FR-071, NFR-028, NFR-030)**: uploads are processed in-memory with `jimp` (pure JS, no native build step - matches this workspace's no-native-deps constraint) - resized to a 1600px max dimension and re-encoded as JPEG, which drops EXIF/GPS metadata as a side effect of building a fresh image. The original upload buffer is discarded after processing; only the processed copy is written to `data/gallery-uploads/` (gitignored, outside `public/`).
- **Optional watermark (NFR-031)**: per-album toggle, baked into the image at upload time (not applied dynamically per-view) using Jimp's built-in bitmap font.
- **Audit trail (FR-075, FR-179)**: album create/update/submit/approve/reject/unpublish/delete and photo upload/delete are all logged; opening a published album as a parent logs one `gallery_view_album` entry (logging is at album-open granularity, not per-photo-request, to keep the audit log readable).
- **Retention (FRD 13.1 risk mitigation)**: archived albums (and their files) are automatically deleted past a configurable retention period (Admin → Settings, default 365 days), checked once at server startup. This is a partial answer to FRD open question 15.1 ("should photos auto-delete after 12/24 months") - it only covers already-archived albums, not automatic archiving of old published ones, which the FRD leaves as an open question.
- **Demo Mode**: the first "Demo: Leader view" login seeds one published demo album with two generated placeholder images (not real photos) so the feature is clickable once enabled, without needing real uploads.

Not implemented from the FRD's gallery section: a formal two-person "another authorised leader" peer-review option (admin-only approval was chosen for simplicity); a parent-facing "request removal of a specific image" flow (FRD open question 15.1); syncing consent/exclusion flags from OSM (no such field is known to be exposed).

## Known follow-ups (see FRD "Open Questions" and "Risks")

- Validate real OSM field names/endpoints for members, programme and events (see "Endpoint confidence" above).
- Decide and document 7thPortal's formal GDPR status (controller/processor/integration layer - NFR-013) and get the privacy notice legally reviewed.
- Parent invite emails fall back to a copyable link when SMTP isn't configured (`SMTP_*` in `.env`) - wire up a real provider before rollout.
- No automated tests yet.
- Session timeout is read from Admin Settings only at server startup, not live - a restart is needed for a changed value to take effect.
- Photo gallery: resolve consent-data source, retention/auto-archive period and removal-request workflow (FRD open questions 15.1) before enabling it for real photos of real children.
