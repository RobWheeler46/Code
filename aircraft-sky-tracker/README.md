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

## Tech stack

| Layer | Technology |
| --- | --- |
| Backend | Node.js 22+, TypeScript, Express, `ws` (WebSocket), `node:sqlite` |
| Frontend | React, TypeScript, Vite, HTML Canvas 2D |
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
| `NOTIFY_NTFY_TOPIC` | *(unset)* | ntfy topic for interesting-aircraft push alerts; push is off until set |
| `NOTIFY_NTFY_SERVER` | `https://ntfy.sh` | ntfy server for push alerts |
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
| `GET` | `/api/aircraft` | Current aircraft snapshot (diagnostics/dev) |
| `GET` | `/api/aircraft/photo?reg=&hex=` | Aircraft photo (proxies planespotters.net) |
| `GET` | `/api/view?postcode=` | Per-viewer snapshot for any postcode (read-only) |
| `GET` | `/api/health` | Source/route health |
| `GET` | `/api/diagnostics` | Counts, timings, provider status |
| `WS` | `/ws` | Live `aircraft.snapshot` / `source.status` / `config.updated` |

## Interesting-aircraft alerts

Notable traffic is flagged automatically and highlighted in amber on the display
(toggle in Settings): **military** and DB-flagged special aircraft (from the
provider's dbFlags), **heavy/unusual types** (A380, 747, Antonov), **helicopters**,
and **low** aircraft (< 1000 ft). Add your own **watchlist** of registrations or
type codes in Settings (e.g. `G-EUUA, A388, SPIT`).

For phone push notifications when something notable enters the area, set
`NOTIFY_NTFY_TOPIC` to a private topic and subscribe to it in the
[ntfy](https://ntfy.sh) app — you'll get alerts like
*"Military: RRR2718 — 3.1 mi NW · 1,200 ft"*. Each aircraft alerts at most once
per 30 minutes. Alerts fire only for the saved location, not per-viewer URLs.

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

**Out of scope for MVP** — street/satellite maps, airspace charts, weather, user
accounts, aircraft photos/history, notifications.

**Phase 1.1 (done)** — type-aware silhouettes (jet / turboprop / light /
helicopter, chosen from the ICAO type code); aircraft photos in the detail
overlay via a backend planespotters.net proxy (with attribution); optional
**trails** and **destination arcs** (Settings toggles).

**Multi-provider failover (done)** — the default `failover` provider uses
adsb.fi with OpenSky as an automatic backup (per-provider cooldown, auto
recovery), so one source going down can't take the display offline.

**Interesting-aircraft alerts (done)** — military / heavy / helicopter / low /
watchlist detection, amber highlight on the display, and opt-in ntfy push
notifications.

**Future phases** — local RTL-SDR ADS-B (`LocalReadsbProvider`) and hybrid
local+internet source; optional aircraft history; projector/ceiling features.
The core "minimal" display philosophy stays unchanged.
```
