# OSM Connect Test Harness

A read-only diagnostic tool that proves whether a third-party application can authenticate with
Online Scout Manager (OSM), read the groups, sections and permissions available to the signed-in
user, and complete a simple API request — with every failure explained in plain English.

Built to the *OSM Connection Test Application* FRD v1.0 (23 July 2026), release 1 scope
(the FRD's own recommended MVP, section 29).

**Release 1 is strictly read only.** There is no write endpoint in the codebase, and any endpoint
definition using a method other than `GET`/`HEAD` is refused before a request is built.

---

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Tester guide](#tester-guide)
- [Administrator guide](#administrator-guide)
- [Technical integration guide](#technical-integration-guide)
- [Testing without OSM](#testing-without-osm)
- [Deployment](#deployment)
- [What is deliberately not built](#what-is-deliberately-not-built)

---

## Quick start

```bash
npm install
cp .env.example .env   # then fill in the OSM values
npm start
```

Node 22.5 or later is required — the app uses the built-in `node:sqlite` module, so there are no
native build steps.

---

## Configuration

Every setting can come from an environment variable or be overridden by an administrator in the
Administration screen. Database values win over environment variables.

| Setting | Environment variable | Notes |
|---|---|---|
| Client identifier | `OSM_CLIENT_ID` | From OSM Developer Tools |
| Client secret | `OSM_CLIENT_SECRET` | **Write only** — never displayed once set |
| Callback address | `OSM_CALLBACK_URL` | Must exactly match the one registered with OSM. HTTPS required except `http://localhost` |
| Authorisation endpoint | `OSM_AUTHORIZE_URL` | Default `https://www.onlinescoutmanager.co.uk/oauth/authorize` |
| Token endpoint | `OSM_TOKEN_URL` | Default `https://www.onlinescoutmanager.co.uk/oauth/token` |
| API base | `OSM_API_BASE` | Default `https://www.onlinescoutmanager.co.uk` |
| Approved hostnames | `OSM_ALLOWED_HOSTS` | The server refuses to call anything else |
| Session signing key | `SESSION_SECRET` | Long random string |
| Token encryption key | `TOKEN_ENCRYPTION_KEY` | 32 bytes as hex or base64. If unset, a key file is generated in `data/` and a warning is logged |
| Setup key | `SETUP_KEY` | Unlocks the browser first-run setup screen. See [First-run setup](#first-run-setup) |
| Administrators | `ADMIN_EMAILS`, `ADMIN_OSM_USER_IDS` | Comma separated. Matched against the OSM identity at connection time |
| Developers | `DEVELOPER_EMAILS` | Expanded diagnostics, no extra OSM access |
| High-risk tests | `ALLOW_PERSONAL_DATA_TESTS` | Must be `true` before a test that may return young people's information can even be enabled |

> **The default OSM endpoints are based on community-maintained documentation, not a supported
> specification.** OSM does not publish a versioned public API. Verify them during setup and expect
> them to change — that is precisely what this tool exists to detect.

---

## First-run setup

The Administration screen requires an OSM sign-in, which requires the OSM configuration to already
exist — a deadlock on a fresh deployment. The **first-run setup screen** breaks it.

1. Set a `SETUP_KEY` (16+ random characters) in the environment and restart.
2. Open `/setup.html`, enter the key, and fill in the client identifier, client secret, callback and
   endpoint addresses.
3. A readiness check (which never displays the secret) confirms when everything is in place, then
   links straight to **Connect to OSM**.

The setup screen writes through exactly the same guarded path as the admin screen: the secret is
stored encrypted and write-only, and host/URL fields are validated. Access is gated by the setup
key (timing-safe comparison, with a lockout after repeated failures) and each save is audited.

If `SETUP_KEY` is not set, the whole `/setup` route reports itself unavailable and returns `404`.
**Remove `SETUP_KEY` once configuration is complete** to close the screen; from then on, change
settings from the Administration screen after an administrator has signed in.

## Tester guide

1. **Home** explains what will be tested and shows the connection state.
2. **Connect to OSM** redirects you to the OSM sign-in page. Your password is entered on OSM's own
   site. This application never sees it and has no forgotten-password function.
3. **Guided test** runs 23 stages in order. Each shows Waiting → Running → then Passed, Passed with
   warning, Failed, Skipped or Cancelled, with start time and duration. Expand any stage for
   sanitised technical detail.
4. **Sections and permissions** lists every group and section your OSM account can reach, with the
   raw permission value, the interpreted meaning and any interpretation warning. Choose the active
   section here — this changes nothing in OSM.
5. **Individual tests** runs one endpoint at a time. Each test states what it requests, whether
   personal information could be returned, what is retained and which permission is likely needed.
6. **Test history** and **Diagnostic report** give you a sanitised export to send to a developer.
7. **Disconnect** removes the tokens held by this application. It may not remove authorisation
   recorded inside OSM itself.

**Reading a failure:** look at the *first* failed stage, not the later skipped ones. Quote the
message code (e.g. `OSM-API-012`) and the correlation identifier (e.g. `OSM-20260723-8F4K2`).

### Statuses you may see

`Not connected` · `Connecting` · `Connected` · `Connected with warnings` · `Authentication expired`
· `Reconnection required` · `Rate limited` · `Client blocked` · `OSM unavailable` ·
`Application configuration incomplete`

---

## Administrator guide

The Administration screen is available to users whose OSM email or user id appears in
`ADMIN_EMAILS` / `ADMIN_OSM_USER_IDS`. Administrative writes additionally require a sign-in
completed within the last 30 minutes.

- **Configuration** — edit any setting. Leaving a field blank keeps the current value. The client
  secret shows only *Secret configured / not configured*, the date it last changed and who changed
  it. There is no code path that returns it.
- **Configuration test** — checks each item without exposing the secret.
- **Test endpoints** — enable or disable an endpoint without a release. A `high` personal-data-risk
  endpoint cannot be enabled unless `ALLOW_PERSONAL_DATA_TESTS=true` for that environment.
- **Circuit breaker** — a blocked-client response puts the application into a `critical` state that
  stops every OSM call. Only an administrator can clear it, and the attempt is audited with the
  reason given.
- **Retention** — removes test sessions, results and request records older than the configured
  period. Audit records are kept.
- **Audit log** — connections, tests, exports, configuration changes, endpoint toggles, rate-limit
  and blocked-client events. No secrets, tokens or member information.

### If OSM blocks the client

1. All OSM requests stop immediately — this is deliberate, and retrying makes a block worse.
2. Export the diagnostic report and review the requests made immediately before the block.
3. Fix the cause (usually a repeated invalid request) before clearing the breaker.

---

## Technical integration guide

The pieces intended for reuse in 7thPortal (FRD phase 5) are all in `src/lib/`:

| Module | Responsibility |
|---|---|
| `osmClient.js` | The whole outbound-request contract: approved hosts, no blind redirect following, read-only method enforcement, response size cap, defensive parsing, rate-limit / deprecation / blocked-client header inspection, retry rules |
| `oauth.js` | Authorisation code flow, single-use time-limited state, server-side token exchange, one controlled refresh, encrypted token storage |
| `redact.js` | Central sanitisation. Everything shown, logged or exported passes through here |
| `crypto.js` | AES-256-GCM at rest, one-way user references, identifier masking |
| `permissions.js` | Safe interpretation of OSM permission values — unknown means no access |
| `context.js` | Shape-tolerant extraction of user, groups, sections and permissions from a startup response |
| `messages.js` | The message catalogue, keyed by permanent code |
| `breaker.js` | Circuit breaker and local rate-limit counter |
| `endpoints.js` | Configurable endpoint definitions and high-level schema checking |

### Retry rules

Automatic retry is attempted **only** for timeout, DNS, connection-interrupted, HTTP 500 and HTTP
502/503/504, capped by `MAX_AUTOMATIC_RETRIES` (default 1) with a short exponential delay plus
jitter. Retries reuse the parent correlation identifier with a new attempt identifier.

Never retried: invalid credentials, invalid client secret, state mismatch, expired or reused
authorisation code, permission denied, validation failure, HTTP 410, HTTP 429 before the retry
period, blocked-client responses, schema failures, and any write request.

### Parsing

`parseBody` tries strict JSON first, then falls back to extracting a JSON payload from a wrapper —
some OSM endpoints have historically returned JSON wrapped in JavaScript. A recovered wrapper is
reported as `OSM-PARSE-003` rather than being silently accepted.

### Data model

`app_users` · `osm_connections` · `osm_section_refs` · `oauth_attempts` · `test_sessions` ·
`test_results` · `endpoint_definitions` · `request_log` · `audit_log` · `app_config` ·
`breaker_state` · `rate_state`. See `src/db.js`.

---

## Testing without OSM

`test/mock-osm.js` stands in for OSM and can act out each scenario in FRD section 25.
`test/e2e.js` boots a clean database per scenario, walks the full OAuth flow, runs the guided test,
asserts the outcome, and checks that no token, secret, name or email address appears in either
export format.

```bash
npm test
```

```bash
node test/e2e.js happy
```

Scenarios covered: happy path, no sections, unknown permission value, HTTP 429, blocked client,
HTTP 410, HTTP 403, HTTP 500, invalid JSON, wrapped response, empty response, unexpected content
type, missing mandatory field, deprecation header, user declines access, missing authorisation
code, incorrect OAuth state, and token rejection.

To drive the UI against the mock:

```bash
npm run mock-osm
```

then point `OSM_AUTHORIZE_URL`, `OSM_TOKEN_URL` and `OSM_API_BASE` at `http://localhost:3999` and
set `OSM_ALLOWED_HOSTS=localhost`.

---

## Deployment

Runs on Railway from this monorepo with the service root directory set to `osm-connect-test`.

- Attach a **persistent volume mounted at `/app/data`** — the SQLite database and, if you have not
  set `TOKEN_ENCRYPTION_KEY`, the generated encryption key both live there. Without the volume,
  every redeploy invalidates all stored connections.
- Set `TOKEN_ENCRYPTION_KEY` and `SESSION_SECRET` explicitly in the service variables.
- Set `OSM_CALLBACK_URL` to the deployed HTTPS callback and register exactly that URL against the
  OSM developer application.
- `trust proxy` is enabled so session cookies are marked `Secure` behind Railway's TLS termination.

---

## What is deliberately not built

Out of scope for release 1, per FRD section 8.2: local user accounts, any OSM write operation,
member editing, attendance, badges, programmes, events, email, payments, uploads, bulk or scheduled
synchronisation, parent or young-person access, and permanent storage of member records.

Deferred from release 1 but in the FRD: PDF export (JSON and plain text are provided), the Support
Viewer role beyond its read-only definition, and the phase 5 extraction of the connection layer
into 7thPortal.
