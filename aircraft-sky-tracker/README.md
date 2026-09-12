# Local Aircraft Sky Tracker

An exceptionally simple real-time view of the aircraft flying within ~10 miles of
a configured UK postcode (default **SN25 4TP**). Inspired by
[Skylight](https://github.com/) but deliberately stripped back to the three
questions that matter at a glance:

> **What aircraft is that? · Where is it relative to me? · Where is it going?**

There is **no conventional map**. The display is a geographic projection on a
black background: each aircraft sits at its true relative position, its outline
points along its real track, and a small label shows its registration and
destination.

```
        ✈
     G-EUUA
    Edinburgh
```

## How it works

```
 SN25 4TP → Postcodes.io → lat/lon → ADS-B provider → nearby aircraft
   → local 10-mile Haversine filter → adsbdb destination enrichment
   → normalised aircraft → WebSocket → HTML Canvas display
```

> **Route confidence:** destinations run through a confidence engine (FRD
> §22-40) — an identity gate (a reused/mismatched callsign is rejected rather
> than shown), 0-100 scoring (identity + explicit route + geographic
> plausibility + recency + provider agreement), classification
> (Confirmed/High/Medium/Low/Unknown), conflict suppression and dropout
> hysteresis. Only Confirmed/High/Medium show a destination; Low/Unknown show a
> compass heading instead. adsbdb is the default source (combined
> aircraft+callsign query with a callsign-only fallback); Airframes plugs in as a
> second source to unlock "Confirmed" and conflict detection.

> **Data-source note:** the spec named **airplanes.live** as the MVP provider,
> but it has since restricted its public REST API to HTTP 403 for general
> clients. The app therefore defaults to **`failover`** — **adsb.fi** primary
> (same open community ADS-B format) with **OpenSky** as an automatic backup: if
> the primary starts failing it switches over, then recovers once the primary is
> healthy again. `adsbfi`, `opensky`, `airplaneslive` and `simulation` are also
> selectable via `AIRCRAFT_PROVIDER`, all behind the same `AircraftProvider`
> interface.

The **frontend has no knowledge of the aircraft provider** (FRD §102). All
third-party calls happen on the backend; the browser only ever receives
normalised aircraft over a single WebSocket. Swapping Airplanes.live for a local
ADS-B receiver or another API is an implementation detail behind the
`AircraftProvider` interface.

> **Satellite layer (FRD v3.2 §41-58):** alongside aircraft, the same sky view
> plots overhead satellites. The backend fetches orbital elements (TLEs) from
> **CelesTrak** (`stations`, `visual`, and — optionally — `starlink` groups,
> refreshed every 8 h), propagates each one with **SGP4** (`satellite.js`) every
> 2 s, and computes observer-relative azimuth/elevation, range, sub-point,
> altitude and velocity for the configured postcode. A cylindrical Earth-shadow
> test against the Sun's position marks whether a satellite is sunlit and, with
> the observer in darkness, **potentially visible** to the naked eye. Only
> satellites above the minimum elevation (default 15°) in enabled groups are
> broadcast, over the same WebSocket as `satellite.snapshot`. The Canvas renders
> them on an **observer-sky projection** (zenith at centre, horizon at the edge):
> ◇ stations, ◆ bright/interesting, · Starlink — cyan when potentially visible —
> and clicking one opens a detail drawer. Runs against live CelesTrak data, or a
> synthetic set (ISS/HST/…) under `AIRCRAFT_PROVIDER=simulation`.
>
> **Resilience (FRD §77):** CelesTrak is a single free source, so the app is
> hardened three ways against it going down. (1) An optional **Space-Track.org
> backup** behind a failover — the authoritative origin of the data — is used
> automatically if CelesTrak fails (set `SPACETRACK_USER` / `SPACETRACK_PASSWORD`;
> it covers a curated bright-object set, CelesTrak stays primary for the full
> groups). (2) Every successful download is **saved to the data volume**
> (`orbital-elements.json`) and reloaded at startup, so the sky stays populated
> from the last-good elements across a restart (TLEs stay usable for SGP4 for
> several days). (3) Until a live fetch succeeds, the backend **retries on a short
> backoff** (30 s → 10 min) instead of waiting for the 8-hour cycle, so the layer
> self-heals within minutes of a source recovering.

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 22+, TypeScript, Express, `ws` (WebSocket), `node:sqlite`, `satellite.js` (SGP4) |
| Frontend | React, TypeScript, Vite, HTML Canvas 2D, Leaflet (map mode) |
| Persistence | SQLite (settings, location / route / aircraft caches) |
| Tests | `node:test` |

> This project uses Node's **built-in `node:sqlite`** — no native module
> compilation is required. Node **22.5+** is needed (developed on Node 24).

## Repository layout

```
aircraft-sky-tracker/
├── apps/
│   ├── server/        # Express + WebSocket backend, providers, services
│   └── web/           # React + Canvas frontend (display / settings / diagnostics)
├── packages/
│   └── shared/        # Shared types + geographic maths (used by both sides)
├── data/              # SQLite database (created at runtime)
├── deploy/            # Raspberry Pi systemd service + Chromium kiosk launcher
└── docker/            # Dockerfile + compose
```

## Prerequisites

- Node.js **22.5 or newer** (`node --version`)
- npm 10+

## Quick start (development)

```bash
npm install
npm run build:shared      # compile the shared package once
npm run dev               # shared watch + server (:3000) + Vite (:5173)
```

Open **http://localhost:5173**. Vite proxies `/api` and `/ws` to the backend on
port 3000.

To develop without live aircraft overhead, use the built-in **simulation
provider** (generates aircraft that enter, cross, turn and leave the area, with a
mix of known/unknown destinations and registrations):

```bash
# PowerShell
$env:AIRCRAFT_PROVIDER = "simulation"; npm run dev
# bash
AIRCRAFT_PROVIDER=simulation npm run dev
```

## Production build & run

```bash
npm run build             # builds shared, server and web
npm start                 # node apps/server/dist/index.js, serves the built UI
```

Then open **http://localhost:3000** (the backend serves the compiled frontend).

## npm scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Watch-mode shared build + backend + Vite dev server |
| `npm run build` | Build shared, server and web for production |
| `npm start` | Run the compiled backend (serves the built UI) |
| `npm test` | Run the shared + server test suites |
| `npm run typecheck` | Type-check all packages |

## Configuration

Runtime configuration is stored in SQLite and editable from the **Settings**
screen. Startup defaults come from the environment (see `.env.example`):

| Variable | Default | Notes |
| --- | --- | --- |
| `HTTP_PORT` | `3000` | |
| `DATABASE_PATH` | `./data/tracker.sqlite` | |
| `AIRCRAFT_PROVIDER` | `failover` | `failover` \| `adsbfi` \| `opensky` \| `airplaneslive` \| `simulation` |
| `AIRCRAFT_POLL_INTERVAL_MS` | `1100` | ~1 Hz, within provider limits |
| `SITE_PASSWORD` | *(unset)* | When set, changing config / viewing diagnostics needs this password; the display stays open (FRD §79) |
| `AIRFRAMES_API_KEY` | *(unset)* | Optional 2nd route source; enables "Confirmed" routes + conflict detection (FRD §24-26) |
| `NOTIFY_NTFY_TOPIC` | *(unset)* | ntfy topic for interesting-aircraft push alerts; push is off until set |
| `NOTIFY_NTFY_SERVER` | `https://ntfy.sh` | ntfy server for push alerts |
| `SPACETRACK_USER` / `SPACETRACK_PASSWORD` | *(unset)* | Optional Space-Track.org backup for satellite orbital data; used only if CelesTrak fails. Both must be set |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(unset)* | Optional Google Sign-In for per-account saved locations; both must be set |
| `SESSION_SECRET` | *(SITE_PASSWORD)* | Secret used to sign session cookies; stable value keeps users signed in across restarts |
| `PORT` | *(from host)* | Honoured for PaaS (Railway); falls back to `HTTP_PORT` |
| `DEFAULT_POSTCODE` | `SN25 4TP` | |
| `DEFAULT_RADIUS_MILES` | `10` | statute miles |
| `ROUTE_PROVIDER` | `adsbdb` | |
| `LOG_LEVEL` | `info` | `debug`\|`info`\|`warn`\|`error` |
| `ALLOWED_HOSTS` | *(empty = allow all)* | Host allow-list for LAN safety (FRD §80) |

A local `.env` file (copied from `.env.example`) is loaded automatically.

## Internal REST API

The browser talks only to the backend (FRD §39):

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Current configuration |
| `PUT` | `/api/config` | Update configuration |
| `POST` | `/api/config/reset` | Restore defaults (SN25 4TP, 10 mi, minimal) |
| `POST` | `/api/location/validate` | Validate a UK postcode + resolve coordinates |
| `GET` | `/api/location/detect` | Approximate location from the caller's IP (never stored) |
| `POST` | `/api/location/apply` | Set the observer location from a detected/device fix |
| `GET` | `/api/auth/config` · `/api/auth/me` | Whether Google Sign-In is enabled; the signed-in user |
| `GET` | `/api/auth/google` · `/callback` | Google OAuth sign-in flow (when configured) |
| `GET/POST/DELETE` | `/api/account/locations…` | Per-user saved locations (list/add/delete/home/use) |
| `GET` | `/api/aircraft` | Current aircraft snapshot (diagnostics/dev) |
| `GET` | `/api/aircraft/photo?reg=&hex=` | Aircraft photo (proxies planespotters.net) |
| `GET` | `/api/aircraft/{icaoHex}` | Aircraft detail + registry metadata (adsbdb) |
| `GET` | `/api/aircraft/{icaoHex}/flight-intelligence` | Operational flight data: state, OOOI, ETA, route (§102) |
| `GET` | `/api/aircraft/{icaoHex}/insights` | Active Sky Insights for one aircraft, with evidence (§103) |
| `GET` | `/api/insights` | All currently-active Sky Insights (§103) |
| `GET` | `/api/looknow` | Approaching-aircraft closest-approach predictions (v4.0 §16-19) |
| `GET` | `/api/aviation-context` | Observer airspace + nearest METAR/TAF + military context (v4.0 §35-47) |
| `GET` | `/api/aircraft/{icaoHex}/aviation` | Airspace membership + contrail estimate for one aircraft |
| `GET` | `/api/aircraft/{icaoHex}/messages` | Live ACARS/VDL2 datalink messages for one aircraft (v3.9) |
| `GET` | `/api/view?postcode=` | Per-viewer snapshot for any postcode (read-only) |
| `GET` | `/api/history?date=` | Aircraft pass history for a date (default today) |
| `GET` | `/api/history/dates` | Retained dates with pass counts |
| `DELETE` | `/api/history/{date}` | Clear a date's history (needs the password) |
| `GET` | `/api/satellites` | Current overhead-satellite snapshot |
| `GET` | `/api/satellites/{catalogNumber}` | Satellite detail by NORAD catalog number |
| `GET` | `/api/satellites/{catalogNumber}/detail` | Live state + orbit characteristics + next pass |
| `GET` | `/api/satellite-passes` | Upcoming overhead passes (next 24 h) |
| `GET` | `/api/orbital-status` | Orbital-element source status + satellite counts |
| `GET` | `/api/health` | Source/route health |
| `GET` | `/api/diagnostics` | Counts, timings, provider status |
| `WS` | `/ws` | Live `aircraft.snapshot` / `satellite.snapshot` / `satellite.alert` / `source.status` / `config.updated` |

## Aircraft history

The tracker records a **pass** for each aircraft that comes within the radius —
one summary row per visit (not every raw position), capturing closest approach,
lowest/highest altitude, top speed, best-confidence destination and any
interesting reasons. Press **H** (or go to `/history` behaviour via the History
view) to see today's passes, switch between retained dates, or clear a date.
Retention defaults to **31 days** (configurable 7–365 in Settings); expired
records are pruned automatically. History only reflects times the tracker was
actually running (FRD §63).

## Interesting-aircraft alerts

Notable traffic is flagged automatically and highlighted in amber on the display
(toggle in Settings): **military** and DB-flagged special aircraft (from the
provider's dbFlags), **heavy/unusual types** (A380, 747, Antonov), **helicopters**,
and **low** aircraft (< 1000 ft). Add your own **watchlist** of registrations or
type codes in Settings (e.g. `G-EUUA, A388, SPIT`).

When an interesting aircraft **enters** the area you get an on-screen **in-app
alert** banner (toggle in Settings) and, if you opt in, a permission-based
**browser/OS notification** — plus a phone **push** via ntfy when
`NOTIFY_NTFY_TOPIC` is set (subscribe to that topic in the [ntfy](https://ntfy.sh)
app). Alerts read like *"Military: RRR2718 — 3.1 mi NW · 1,200 ft"*. Each
aircraft alerts once per continuous visit (it must leave and genuinely re-enter
to alert again), and alerts fire only for the saved location, not per-viewer
URLs.

## Per-viewer postcode (URL override)

Add `?postcode=` to the URL to show the sky around a different postcode **for
that tab only** — the saved default and other screens are unaffected, so you can
point different displays at different areas at once:

```
https://<host>/?postcode=EH1 1BB      # Edinburgh
https://<host>/?postcode=SW1A 1AA     # London
```

It is read-only (no password needed) and reuses your saved display settings and
radius, overriding only the centre. The backend resolves the postcode on demand
and caches per-centre to stay gentle on the aircraft provider.

## Keyboard shortcuts

Kiosk mode needs no interaction. On a desktop:

| Key | Action |
| --- | --- |
| Click aircraft | Show detail overlay |
| `Esc` | Close overlay / return to display |
| `S` | Settings |
| `D` | Diagnostics |
| `H` | History |
| `P` | Upcoming satellite passes |
| `F` | Toggle full screen |

## Tests

```bash
npm test
```

Covers the geographic logic (distance, bearing, projection, radius boundaries,
compass), aircraft normalisation (missing registration/callsign/altitude/track,
stale positions), the radius filter and stale-aircraft lifecycle, route-cache hit
/ expiry / negative caching, settings defaults & reset, and postcode validation.

## Deployment

### Docker

```bash
docker compose -f docker/docker-compose.yml up -d --build
# → http://localhost:3000
```

### Railway

The repo includes `railway.json` (Dockerfile builder + `/api/health` check).

```bash
railway init -n aircraft-sky-tracker
railway service aircraft-sky-tracker
railway volume add -m /app/data                 # persist settings + caches
railway variables set AIRCRAFT_PROVIDER=adsbfi DATABASE_PATH=/app/data/tracker.sqlite \
  DEFAULT_POSTCODE="SN25 4TP"
# optional: require a password to change config / view diagnostics (display
# stays open). Kept out of shell history:
printf '%s' 'your-password' | railway variables set SITE_PASSWORD --stdin
railway up --ci                                 # build + deploy
railway domain                                  # public URL
```

Railway injects `PORT` automatically. `/api/health` is intentionally left public
so the platform health check passes even with Basic Auth enabled. (On Windows
Git Bash, prefix volume/path commands with `MSYS_NO_PATHCONV=1` to stop `/app/...`
being rewritten to a Windows path.)

### Raspberry Pi kiosk (FRD §86–89)

1. Copy the repo to `/home/pi/aircraft-sky-tracker` and `npm run build`.
2. Install the service so the backend starts on boot and restarts on crash:
   ```bash
   sudo cp deploy/aircraft-sky-tracker.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now aircraft-sky-tracker
   ```
3. Launch Chromium full-screen on the desktop session:
   ```bash
   deploy/kiosk.sh   # add to autostart for hands-off boot
   ```

## Scope

**MVP (Release 1.0)** — postcode resolution + caching, 10-mile radius, live
Airplanes.live polling, local Haversine filter, adsbdb destination enrichment
with confidence + caching, normalised WebSocket stream, Canvas display with
rotation / interpolation / fade, settings, diagnostics, simulation provider,
automatic reconnection, Raspberry Pi kiosk deployment.

**Out of scope for MVP** — airspace charts, weather, user accounts,
aircraft photos/history, notifications. (Later releases added optional screen and
map view modes — see below.)

**Phase 1.1 (done)** — type-aware silhouettes chosen from the ICAO type code;
aircraft photos in the detail overlay via a backend planespotters.net proxy
(with attribution); optional **trails** and **destination arcs** (Settings
toggles).

**Richer silhouettes (done, FRD v3.0 §20)** — a most-specific-first classifier
draws distinct outlines for the A320 and 737 families, A380, 747, business jet,
turboprop, helicopter, light aircraft, A400M, C-17, fighter/fast-jet, generic
military and a generic fallback. Military and fighter **types** now also trigger
interesting-aircraft detection.

**Vertical-trend colouring (done)** — aircraft icons are coloured by climb/descent:
**green** when climbing, **coral** when descending, and unchanged **white** when
maintaining height (a small ±300 ft/min band counts as level, so minor corrections
don't flicker). Interesting-aircraft **amber** still takes precedence. Classified by
the shared `verticalTrend` helper.

**Multi-provider failover (done)** — the default `failover` provider uses
adsb.fi with OpenSky as an automatic backup (per-provider cooldown, auto
recovery), so one source going down can't take the display offline.

**Interesting-aircraft alerts (done)** — military / heavy / helicopter / low
(configurable threshold, default 3,000 ft) / watchlist detection, amber
highlight on the display, and opt-in ntfy push notifications.

**Aircraft history (done, FRD v3.0)** — per-aircraft pass records, `/history`
view with date filter + clear, configurable retention.

**Hide ground aircraft (done)** — an optional Settings toggle (off by default)
excludes aircraft reporting as on the ground (ADS-B ground bit / `alt_baro`
"ground"; OpenSky `on_ground`), so the display shows only airborne traffic.

**Satellite layer (done, FRD v3.2 §41-58)** — overhead satellites from CelesTrak
orbital elements, SGP4-propagated to observer az/el/range with naked-eye
visibility (sunlit satellite + observer in darkness). Rendered on the
observer-sky projection with a click-through detail drawer; group + minimum-
elevation toggles in Settings; `/api/satellites`, `/api/orbital-status` and a
Diagnostics panel.

**Satellite pass prediction (done, FRD v3.2 §59-60)** — a pure SGP4 engine scans
a 24 h look-ahead window for each enabled satellite and reports every *meaningful*
pass (one whose maximum elevation clears the configured minimum): rise / maximum /
set times, peak elevation, rise→set compass direction, duration and whether it is
potentially naked-eye visible (sunlit satellite over a dark sky). Served at
`/api/satellite-passes` and shown on an **Upcoming passes** screen (keyboard `P`).

**Satellite pass alerts (done, FRD v3.2 §61-62)** — an opt-in advance-warning
alert ("**ISS visible in 10 minutes**"). A service watches the upcoming-pass
predictions and fires once per pass when it comes within the configured lead time
(default 10 min), for the satellite groups you're showing and — by default — only
naked-eye-visible passes. Each alert shows an on-screen banner (and, when enabled,
a browser/OS notification), plus a phone push when a ntfy topic is configured on
the server. Off by default; Settings has the toggle, lead time and visible-only
option. Satellite **history** (§63-64) remains a future follow-up.

**Satellite detail drawer — orbit + next pass (done, FRD v3.2 §57-58)** — clicking
a satellite now also shows, alongside the live look-angles, an **Orbit** section
(period, inclination, apogee/perigee altitude, international designator, and how
old the orbital elements are) derived from the TLE, and the satellite's **next
pass** (rise time, max elevation, direction, visibility). Served by
`/api/satellites/{catalogNumber}/detail` and fetched when the drawer opens.

**True Sky (done, FRD v4.0 §9-11)** — a display mode that places **aircraft *and*
satellites by their real azimuth and elevation** — where you would physically
look. Each aircraft's position is derived from its lat/lon **and altitude** versus
the observer via ECEF→ENU look angles (`observerLookAngles` in `@ast/shared`), so
a high aircraft directly overhead sits near the **zenith (centre)** and a distant
low one near the **horizon (edge)**, on the same 90°→0° scale as satellites.
Concentric elevation rings (60°/30°/horizon) and N/E/S/W compass labels orient
the view. This supersedes the earlier flat ground projection (kept as *Ceiling*).

**Automatic location discovery (done, FRD v3.6)** — the location no longer has to
be typed. Settings → Location can **detect an approximate area from the network
(IP)** — server-side via a key-free geolocation lookup using the client IP from
`X-Forwarded-For` (or Cloudflare edge headers where present), with the raw IP used
only for the lookup and never stored — or **use the device's GPS** (browser
geolocation, precise). Every location carries a **source** (default / ip / device
/ postcode) and a **confidence** (precise / good / approximate / coarse), shown by
a 📍 indicator; a coarse fix triggers an "improve your location" notice in True
Sky (which needs an accurate observer). A postcode remains the manual path.

**Operational flight intelligence (done, FRD v3.8 §21-44, §53)** — beyond the
route, aircraft can carry *operational* enrichment: **OOOI flight events**
(out/off/on/in, shown human-readably), a derived **flight state** (at gate →
departed → airborne → en route → landed → arrived), **ETA**, stronger route
corroboration, and **possible route-change / diversion** insight — all on top of
ADS-B positional truth, which is never overridden (§17, §124). Airframes is the
Tier-1 provider behind a provider abstraction (env-gated: `AIRFRAMES_ENABLED` +
`AIRFRAMES_API_KEY`, credentials server-side); its live REST mapping awaits
confirmed API access, so the whole pipeline is exercised by a **simulation
operational provider** (§106) covering the confirmed / Airframes-only / conflict /
stale-ACARS / possible-diversion / OOOI scenarios. Served at
`/api/aircraft/{hex}/flight-intelligence` and shown in the detail drawer's
**Flight Intelligence** section. If the provider fails, only enrichment degrades —
tracking, routes and history continue (§108).

**Sky Insights engine (done, FRD v3.8 §55-63, §90-92, §103-104)** — the engine
turns each aircraft's evidence (operational + route + per-aircraft trajectory
history) into short, validated statements: **possible route change**, **route
updated**, **recently airborne**, **likely landing**, **landed**, **flight
confirmed**. Every insight carries a **confidence** and its own **evidence**
("Why?", §92); a low-confidence inference is never stated as fact. The main
display shows at most **one** prominent contextual insight at a time (§91,
bottom-centre banner, toggle in Settings via `showSkyInsights`); the rest appear
in the drawer's **Sky insights** section. The engine bounds and throttles
operational enrichment (nearest aircraft, cached per hex) so a future live
Airframes path can't fan out. Served at `/api/insights` and
`/api/aircraft/{hex}/insights`.

*Event stream (§104):* a full `insights.snapshot` is sent on connect for state
sync; thereafter the engine streams **`insight.created` / `insight.updated` /
`insight.expired`** deltas and **`route.updated`** so already-connected clients
stay in step without resending the whole set each cycle.

*History-based route-change detection (§43-44, §59):* the engine keeps a bounded
per-aircraft trail of positions and resolved-destination decisions and feeds it to
`assessRouteChange`, so a diversion is backed by real trajectory evidence rather
than a single provider field. Three recognisers: a **decision change** (the
resolved destination airport changed → *ROUTE UPDATED*, §59), an **operational
report** that geometry can corroborate to lift confidence (§44 "likely = strong
operational evidence plus geographic movement"), and a geometric **divergence**
(sustainedly tracking away from the filed destination → capped at *possible*,
since geometry alone is not corroboration). Manoeuvring (a wide track spread) is
discounted so a normal turn is not mistaken for a diversion.

**Look Now closest-approach prediction (done, FRD v4.0 §15-19)** — answers "what
is likely to enter my sky shortly?". A wider **prediction radius** (default 40 mi,
configurable) is polled and aircraft between the display radius and it are
**tracked but not displayed** (§15) — so the sky stays uncluttered while approaches
can still be predicted. For each such aircraft the engine projects its **closest
point of approach** from position, ground track, ground speed and vertical rate
(`predictClosestApproach`): time to the closest point, predicted horizontal and
slant range, elevation, altitude, and the compass direction to look (§16-17). A
**confidence** rating (§18) falls when the aircraft is turning (a tracked
track-spread check), climbing/descending hard, its position is stale, or the
projection reaches far ahead — so an alert never implies certainty. The single
most imminent approach shows as a top-centre **Look Now banner** (toggle
`showLookNow`), highlighted when the aircraft is interesting (§19). Broadcast as
`looknow.update` and served at `/api/looknow`.

**Aviation context (done, FRD v4.0 §35-47 — Release 4.3)** — the "where and in
what conditions" layer, shown in the aircraft details drawer. **Nearest aviation
weather** (§46): free **METAR/TAF** from AviationWeather.gov for the closest UK
reporting aerodrome (station picked from a curated list, cached, backend-only).
**Airspace** (§35): which curated UK regions the observer / a selected aircraft is
inside, with a vertical-band check — behind an `AirspaceProvider` seam so a real
**NATS AIP** dataset can replace the curated set later; per §36 it deliberately does
**not** scrape NOTAMs. **Contrail estimate** (§47, experimental): *Likely / Possible
/ Unlikely* from the aircraft's altitude and **Open-Meteo** upper-air temperature
and humidity, always framed as an estimate. **Military context** (§37-38): a modest,
**context-only** note ("training activity may be elevated near …") derived from
proximity to curated military airspace — it never asserts a specific aircraft is on
an exercise. Each provider fails soft: a missing weather/upper-air fetch just omits
that part; curated airspace always works. Served at `/api/aviation-context` and
`/api/aircraft/{hex}/aviation`; toggle `showAviationContext`.

**Live ACARS messages (done, FRD v3.9)** — optional display of decoded ACARS/VDL2
datalink messages correlated to the tracked aircraft, in the details drawer.
Governed entirely by policy: **off by default**, **decoded‑only** when enabled, and
the **original raw payload is gated behind a deployment flag** (`ALLOW_RAW_ACARS_DISPLAY`,
default off) that a user preference can never override (§Legal / Deployment Control) —
all enforced **server‑side**. Messages are shown only for a **strongly correlated**
aircraft (registration/callsign); a conflicting or unmatched identity is never shown.
Each carries a timestamp, medium (VDL2/ACARS/…), decoded **category** (Position,
Weather, OOOI, Route, ETA, …) and a plain‑language summary, expandable for detail and
provenance; technical/operational categories are hidden from the default view.
New messages stream **live** over the WebSocket (`aircraft.message`) with a REST fallback
at `/api/aircraft/{hex}/messages`, and raw bodies are **never persisted** (short in‑memory
buffer only). Airframes is the Tier‑1 source (env‑gated, inert until access); a
**simulation** provider streams sample messages — including the unmatched and
conflicting‑identity cases — so the whole feature works without a feeder credential.
Attribution to Airframes.io is shown wherever messages appear. Toggle `showAcarsMessages`;
message‑display failure never affects tracking.

An optional **main‑screen ACARS feed** (§Kiosk) shows the most recent decoded messages
for the **currently visible** aircraft in a bottom‑left panel (aircraft · time · medium ·
category · summary), for an enthusiast/kiosk display. It has its own toggle
(`showAcarsFeed`, off by default) and either toggle activates the datalink pipeline, so
the feed works independently of the details‑drawer section under the same policy.

**Google account & saved locations (done, FRD v3.6 §12, §26)** — an optional
**Google Sign-In** (env-gated: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) lets the
owner save named locations (Home, Work…) to their Google account and switch the
display between them in one click. OAuth 2.0 authorization-code flow (profile read
from the userinfo endpoint — no JWT dependency); a **stateless HMAC-signed session
cookie** (no session store, pure `node:crypto`); saved locations stored per user
in SQLite. Saved-location management needs only the session; *applying* one to the
shared display also needs the settings password (it changes what everyone sees).
Disabled unless configured, so the kiosk is unchanged. (The full anonymous
onboarding wizard and household/travel model remain future work.)

**View modes** — a **View mode** setting (Settings → Display) offers four layouts,
defaulting to *Ceiling* so existing displays are untouched:

- **True Sky** — real azimuth/elevation look-up view (above).
- **Ceiling** — the earlier simplified ground projection for a projector.
- **Screen** — a schematic geographic backdrop for a desk monitor: concentric
  range rings labelled in miles, an 8-point compass rose with N/E/S/W cardinals,
  and a labelled centre (home) marker. Orientation chrome only — **no map
  tiles**, so it stays self-contained — with aircraft/satellites drawn over it
  unchanged (both already share the north-up bearing/azimuth convention).
- **Map** — aircraft plotted on a **real slippy map** (Leaflet + OpenStreetMap
  raster tiles, darkened with a CSS filter to suit the theme) at true lat/lon,
  auto-fitted to the postcode + radius. The aircraft canvas becomes a transparent
  overlay whose lat/lon projection is driven by the map, so icons, trails and
  labels stay aligned. Satellites can't sit at a ground position, so they move to
  a small **observer-sky inset** (top-right), keeping the two projection models
  separate (§65, §68). This is the one mode that fetches from the internet: map
  tiles load in the browser from OpenStreetMap (attribution shown), which is
  key-free — no API key or account is required.

**Adaptive display sizing (done, FRD v3.2 §12-13, §71-72)** — the canvas already
follows any resolution + device-pixel-ratio and re-lays out on resize; on top of
that, a **Display scale** setting (Automatic / Compact / Standard / Large — where
*Automatic* scales with the screen's smaller dimension) and a **Viewing distance**
setting (Close / Normal / Across room) combine into one multiplier that resizes
aircraft icons, satellite markers, registration/destination fonts, touch targets
and the detail/alert overlays. Satellite labels shorten on compact displays
(`ISS (ZARYA)` → `ISS`). The sizing maths live in `@ast/shared`
(`resolveDisplayScale`) and are unit-tested.

**Future phases** — local RTL-SDR ADS-B (`LocalReadsbProvider`) and hybrid
local+internet source; satellite history + advance-warning alerts (§61-64). The
core "minimal" display philosophy stays unchanged.
