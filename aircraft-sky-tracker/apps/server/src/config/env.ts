/** Environment configuration (FRD §83). */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_POSTCODE, DEFAULT_RADIUS_MILES } from "@ast/shared";

// Load a local .env file if present (optional convenience; Node 24 built-in).
const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // Ignore malformed .env; fall back to process defaults.
  }
}

export type AircraftProviderName =
  | "failover"
  | "airplaneslive"
  | "adsbfi"
  | "opensky"
  | "simulation";
export type RouteProviderName = "adsbdb";
export type LogLevel = "debug" | "info" | "warn" | "error";

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

// Default to failover (adsb.fi primary, OpenSky backup) for resilience:
// airplanes.live restricted its public API to 403 for general clients after
// this project's spec was written (FRD §9).
const aircraftProviderRaw = str("AIRCRAFT_PROVIDER", "failover");
function parseProvider(value: string): AircraftProviderName {
  switch (value) {
    case "simulation":
    case "airplaneslive":
    case "adsbfi":
    case "opensky":
    case "failover":
      return value;
    default:
      return "failover";
  }
}
const aircraftProvider: AircraftProviderName = parseProvider(aircraftProviderRaw);

export interface Env {
  nodeEnv: string;
  isProduction: boolean;
  httpPort: number;
  databasePath: string;
  /** Optional HTTP Basic Auth for internet-facing deployments (FRD §79). */
  siteUsername: string;
  sitePassword: string | undefined;
  aircraftProvider: AircraftProviderName;
  aircraftPollIntervalMs: number;
  defaultPostcode: string;
  defaultRadiusMiles: number;
  routeProvider: RouteProviderName;
  logLevel: LogLevel;
  /** Optional Host allow-list for LAN deployments (FRD §80). Empty = allow all. */
  allowedHosts: string[];
  localAdsbUrl: string | undefined;
  /** Push alerts (FRD Phase 3): ntfy topic + server. Push is off unless a topic is set. */
  notifyNtfyTopic: string | undefined;
  notifyNtfyServer: string;
  /** Optional Airframes flight-intelligence provider (FRD §24-26). */
  airframesApiKey: string | undefined;
  airframesUrl: string;
  /** Optional Space-Track.org credentials for the orbital-data backup (§77). */
  spaceTrackUser: string | undefined;
  spaceTrackPassword: string | undefined;
  /** Optional Google Sign-In for personal saved locations (FRD v3.6 §12, §26). */
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  /** Secret used to sign session cookies; defaults to sitePassword if unset. */
  sessionSecret: string | undefined;
}

const nodeEnv = str("NODE_ENV", "production");

export const env: Env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  // Railway (and most PaaS) inject PORT; fall back to HTTP_PORT then 3000.
  httpPort: int("PORT", int("HTTP_PORT", 3000)),
  databasePath: str("DATABASE_PATH", "./data/tracker.sqlite"),
  siteUsername: str("SITE_USERNAME", "tracker"),
  sitePassword: process.env["SITE_PASSWORD"] || undefined,
  aircraftProvider,
  aircraftPollIntervalMs: int("AIRCRAFT_POLL_INTERVAL_MS", 1100),
  defaultPostcode: str("DEFAULT_POSTCODE", DEFAULT_POSTCODE),
  defaultRadiusMiles: int("DEFAULT_RADIUS_MILES", DEFAULT_RADIUS_MILES),
  routeProvider: "adsbdb",
  logLevel: str("LOG_LEVEL", "info") as LogLevel,
  allowedHosts: str("ALLOWED_HOSTS", "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0),
  localAdsbUrl: process.env["LOCAL_ADSB_URL"] || undefined,
  notifyNtfyTopic: process.env["NOTIFY_NTFY_TOPIC"] || undefined,
  notifyNtfyServer: str("NOTIFY_NTFY_SERVER", "https://ntfy.sh"),
  airframesApiKey: process.env["AIRFRAMES_API_KEY"] || undefined,
  airframesUrl: str("AIRFRAMES_URL", "https://api.airframes.io"),
  spaceTrackUser: process.env["SPACETRACK_USER"] || undefined,
  spaceTrackPassword: process.env["SPACETRACK_PASSWORD"] || undefined,
  googleClientId: process.env["GOOGLE_CLIENT_ID"] || undefined,
  googleClientSecret: process.env["GOOGLE_CLIENT_SECRET"] || undefined,
  sessionSecret: process.env["SESSION_SECRET"] || undefined,
};
