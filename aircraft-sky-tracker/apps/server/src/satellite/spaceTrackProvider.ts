/**
 * Space-Track.org orbital-data provider (FRD §77 backup). Space-Track is the
 * authoritative origin of the GP/TLE data that CelesTrak repackages, so it makes
 * an independent secondary source when CelesTrak is unreachable. It needs a free
 * account (SPACETRACK_USER / SPACETRACK_PASSWORD); when unset the provider is
 * "not configured" and the failover skips it.
 *
 * Space-Track has no equivalent of CelesTrak's curated "stations"/"visual"
 * groups, so this backup queries a bundled set of well-known bright objects (and,
 * when enabled, Starlink by name). CelesTrak stays primary for the full groups.
 */

import type { SatelliteCategory } from "@ast/shared";
import { elementFromLines, type OrbitalDataProvider, type OrbitalElement } from "./orbitalProvider.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("orbital.spacetrack");
const BASE = "https://www.space-track.org";
const REQUEST_TIMEOUT_MS = 20000;
const COOKIE_TTL_MS = 55 * 60 * 1000; // reuse the session cookie (Space-Track rate-limits logins)

/**
 * Curated bright/visible objects, mirroring the spirit of CelesTrak's stations +
 * visual groups. Kept small and to catalogue numbers that are stable and known.
 */
const CATALOG: ReadonlyArray<{ id: string; category: SatelliteCategory }> = [
  { id: "25544", category: "station" }, // ISS (ZARYA)
  { id: "48274", category: "station" }, // CSS (TIANHE)
  { id: "20580", category: "bright" }, // Hubble Space Telescope
  { id: "25338", category: "bright" }, // NOAA 15
  { id: "28654", category: "bright" }, // NOAA 18
  { id: "33591", category: "bright" }, // NOAA 19
  { id: "43013", category: "bright" }, // NOAA 20
  { id: "25994", category: "bright" }, // Terra
  { id: "27424", category: "bright" }, // Aqua
  { id: "27386", category: "bright" }, // Envisat
  { id: "40069", category: "bright" }, // Meteor-M 2
  { id: "39084", category: "bright" }, // Landsat 8
  { id: "37849", category: "bright" }, // Suomi NPP
  { id: "36508", category: "bright" }, // CryoSat-2
  { id: "39634", category: "bright" }, // Sentinel-1A
];

export class SpaceTrackProvider implements OrbitalDataProvider {
  readonly name = "Space-Track";
  private cookie: string | undefined;
  private cookieAt = 0;

  constructor(
    private readonly user: string | undefined,
    private readonly password: string | undefined,
  ) {}

  /** Usable only when credentials are configured. */
  get configured(): boolean {
    return Boolean(this.user && this.password);
  }

  async fetchElements(includeStarlink: boolean): Promise<OrbitalElement[]> {
    if (!this.configured) throw new Error("Space-Track not configured");
    const cookie = await this.login();

    const categoryOf = new Map(CATALOG.map((c) => [c.id, c.category]));
    const ids = CATALOG.map((c) => c.id).join(",");
    const url =
      `${BASE}/basicspacedata/query/class/gp/NORAD_CAT_ID/${ids}` +
      `/orderby/NORAD_CAT_ID%20asc/format/3le`;
    const text = await this.get(url, cookie);
    const elements = parseThreeLe(text, (cat) => categoryOf.get(cat) ?? "bright");

    if (includeStarlink) {
      try {
        const slUrl =
          `${BASE}/basicspacedata/query/class/gp/OBJECT_NAME/~~STARLINK` +
          `/orderby/NORAD_CAT_ID%20asc/limit/400/format/3le`;
        const slText = await this.get(slUrl, cookie);
        for (const el of parseThreeLe(slText, () => "starlink")) elements.push(el);
      } catch (err) {
        log.warn("starlink query failed", { error: String(err) });
      }
    }

    log.info("orbital elements fetched from Space-Track", { loaded: elements.length });
    return elements;
  }

  private async login(): Promise<string> {
    if (this.cookie && Date.now() - this.cookieAt < COOKIE_TTL_MS) return this.cookie;
    const res = await fetch(`${BASE}/ajaxauth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        identity: this.user as string,
        password: this.password as string,
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Space-Track login HTTP ${res.status}`);
    const cookies = res.headers.getSetCookie?.() ?? [];
    const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookie) throw new Error("Space-Track login returned no session cookie");
    this.cookie = cookie;
    this.cookieAt = Date.now();
    return cookie;
  }

  private async get(url: string, cookie: string): Promise<string> {
    const res = await fetch(url, {
      headers: { Cookie: cookie, Accept: "text/plain" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) {
      // Session expired - drop the cookie so the next attempt re-logs in.
      this.cookie = undefined;
    }
    if (!res.ok) throw new Error(`Space-Track HTTP ${res.status}`);
    return res.text();
  }
}

/**
 * Parse Space-Track "3le" text: repeating [name, line1, line2] triples where the
 * name line is prefixed with "0 ".
 */
export function parseThreeLe(
  text: string,
  categoryOf: (catalogNumber: string) => SatelliteCategory,
): OrbitalElement[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const out: OrbitalElement[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const nameLine = lines[i] ?? "";
    const l1 = lines[i + 1] ?? "";
    const l2 = lines[i + 2] ?? "";
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) {
      i -= 2; // resync: skip a stray line and retry from the next
      continue;
    }
    const name = nameLine.replace(/^0 /, "").trim();
    const catalogNumber = l1.slice(2, 7).trim();
    const el = elementFromLines(name, l1, l2, categoryOf(catalogNumber));
    if (el) out.push(el);
  }
  return out;
}
