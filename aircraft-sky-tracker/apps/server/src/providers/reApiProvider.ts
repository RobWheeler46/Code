/**
 * Provider for "re-api" style ADS-B aggregators (FRD §9-12).
 *
 * Airplanes.live, adsb.fi and adsb.lol all expose the same readsb/re-api JSON
 * shape (an array of aircraft with fields hex/r/t/flight/lat/lon/alt_baro/gs/
 * track/seen_pos). They differ only in base URL, the point-query path, and the
 * array key ("ac" vs "aircraft"), so one generic adapter covers them all.
 *
 * NOTE: airplanes.live restricted its public REST API to 403 for general
 * clients after this project's spec was written; adsb.fi remains openly
 * available with the same data format and is the working default.
 *
 * The radius is expressed in nautical miles; a slightly larger area than the
 * exact statute-mile filter is requested (FRD §10). The adapter never enforces
 * the radius itself - that is the local distance filter's job (FRD §14).
 */

import type { ProviderAircraft } from "@ast/shared";
import { providerQueryRadiusNm } from "@ast/shared";
import type { AircraftProvider } from "./types.js";
import { createLogger } from "../logging/logger.js";

const REQUEST_TIMEOUT_MS = 5000;
const USER_AGENT = "LocalAircraftSkyTracker/1.0 (+personal-non-commercial)";

/** Raw re-api aircraft record (subset used, FRD §12). */
interface RawAircraft {
  hex?: string;
  r?: string;
  t?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  seen_pos?: number;
  dbFlags?: number;
  // Extended fields for the detail drawer (FRD §10, §43, §46).
  alt_geom?: number;
  baro_rate?: number;
  geom_rate?: number;
  ias?: number;
  tas?: number;
  mach?: number;
  mag_heading?: number;
  true_heading?: number;
  squawk?: string;
  emergency?: string;
  nav_modes?: string[];
  nav_altitude_mcp?: number;
  nav_altitude_fms?: number;
  nav_heading?: number;
  nav_qnh?: number;
  oat?: number;
  version?: number;
  nic?: number;
}

export interface ReApiOptions {
  name: string;
  /** Build the point-query URL. radiusNm is a fixed(2) string. */
  buildUrl: (lat: number, lon: number, radiusNm: string) => string;
  /** JSON key holding the aircraft array ("ac" for airplanes.live/adsb.lol). */
  arrayKey: "ac" | "aircraft";
}

function num(v: number | string | undefined): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** alt_baro can be the string "ground"; treat that as 0 ft. */
function altitude(v: number | string | undefined): number | undefined {
  if (typeof v === "number") return v;
  if (v === "ground") return 0;
  return undefined;
}

export class ReApiProvider implements AircraftProvider {
  readonly name: string;
  private readonly opts: ReApiOptions;
  private readonly log;

  /** Exposed so diagnostics can report the last HTTP status (FRD §67). */
  lastHttpStatus: number | undefined;

  constructor(opts: ReApiOptions) {
    this.opts = opts;
    this.name = opts.name;
    this.log = createLogger(`provider.${opts.name}`);
  }

  async fetchAircraft(
    latitude: number,
    longitude: number,
    radiusMiles: number,
  ): Promise<ProviderAircraft[]> {
    const radiusNm = providerQueryRadiusNm(radiusMiles).toFixed(2);
    const url = this.opts.buildUrl(latitude, longitude, radiusNm);

    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.lastHttpStatus = res.status;
    if (!res.ok) {
      throw new Error(`${this.opts.name} HTTP ${res.status}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const rawList = body[this.opts.arrayKey];
    const raw = Array.isArray(rawList) ? (rawList as RawAircraft[]) : [];
    const mapped = raw
      .filter((a): a is RawAircraft & { hex: string } => typeof a.hex === "string")
      .map((a) => this.map(a));

    this.log.debug("fetched aircraft", { received: mapped.length });
    return mapped;
  }

  /** Map re-api fields to the internal ProviderAircraft (FRD §12, §46). */
  private map(a: RawAircraft & { hex: string }): ProviderAircraft {
    const callsign = typeof a.flight === "string" ? a.flight.trim() : undefined;
    const technical = {
      altitudeGeomFeet: num(a.alt_geom),
      indicatedAirspeedKnots: num(a.ias),
      trueAirspeedKnots: num(a.tas),
      mach: num(a.mach),
      magHeadingDegrees: num(a.mag_heading),
      trueHeadingDegrees: num(a.true_heading),
      navModes: Array.isArray(a.nav_modes) && a.nav_modes.length > 0 ? a.nav_modes : undefined,
      selectedAltitudeMcpFeet: num(a.nav_altitude_mcp),
      selectedAltitudeFmsFeet: num(a.nav_altitude_fms),
      selectedHeadingDegrees: num(a.nav_heading),
      qnhHpa: num(a.nav_qnh),
      outsideAirTempC: num(a.oat),
      adsbVersion: num(a.version),
      navIntegrityCategory: num(a.nic),
    };
    const hasTechnical = Object.values(technical).some((v) => v !== undefined);
    return {
      icaoHex: a.hex.trim().toUpperCase(),
      registration: a.r?.trim() || undefined,
      aircraftTypeCode: a.t?.trim() || undefined,
      callsign: callsign && callsign.length > 0 ? callsign : undefined,
      latitude: num(a.lat),
      longitude: num(a.lon),
      altitudeFeet: altitude(a.alt_baro),
      groundSpeedKnots: num(a.gs),
      trackDegrees: num(a.track),
      positionAgeSeconds: num(a.seen_pos),
      providerFlags: a.dbFlags,
      verticalRateFpm: num(a.baro_rate) ?? num(a.geom_rate),
      squawk: typeof a.squawk === "string" ? a.squawk : undefined,
      emergency:
        typeof a.emergency === "string" && a.emergency !== "none" ? a.emergency : undefined,
      technical: hasTechnical ? technical : undefined,
    };
  }
}

/** airplanes.live (currently 403s for general clients - see file header). */
export function createAirplanesLiveProvider(): ReApiProvider {
  return new ReApiProvider({
    name: "airplanes.live",
    arrayKey: "ac",
    buildUrl: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
  });
}

/** adsb.fi open data - same format, currently available (default). */
export function createAdsbFiProvider(): ReApiProvider {
  return new ReApiProvider({
    name: "adsb.fi",
    arrayKey: "aircraft",
    buildUrl: (lat, lon, nm) =>
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
  });
}
