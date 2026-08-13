/**
 * OpenSky Network provider (FRD §22-23).
 *
 * A genuinely different backend to adsb.fi: a bounding-box query returning
 * "state vectors" (arrays), used mainly as a failover source. Anonymous access
 * is rate-limited, so results are cached for a short interval - safe to call at
 * the normal ~1 Hz polling rate. OpenSky does not supply registration or type;
 * the app's adsbdb metadata fallback (FRD §21) fills registration from the hex.
 */

import type { ProviderAircraft } from "@ast/shared";
import { toRadians } from "@ast/shared";
import type { AircraftProvider } from "./types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("provider.opensky");
const BASE = "https://opensky-network.org/api/states/all";
const REQUEST_TIMEOUT_MS = 8000;
const MIN_INTERVAL_MS = 8000; // respect anonymous rate limits
const MILES_PER_DEGREE_LAT = 69.0;
const METERS_TO_FEET = 3.28084;
const MPS_TO_KNOTS = 1.943844;

/**
 * OpenSky state-vector array layout (subset). See the OpenSky REST docs.
 * [0] icao24, [1] callsign, [3] time_position, [4] last_contact,
 * [5] longitude, [6] latitude, [7] baro_altitude(m), [9] velocity(m/s),
 * [10] true_track(deg).
 */
export type OpenSkyState = (number | string | boolean | null)[];

interface StatesResponse {
  time?: number;
  states?: OpenSkyState[] | null;
}

/** Map one OpenSky state vector to a ProviderAircraft (undefined if no position). */
export function mapOpenSkyState(
  state: OpenSkyState,
  nowSeconds: number,
): ProviderAircraft | undefined {
  const icao24 = typeof state[0] === "string" ? state[0] : undefined;
  const longitude = typeof state[5] === "number" ? state[5] : undefined;
  const latitude = typeof state[6] === "number" ? state[6] : undefined;
  if (!icao24 || longitude === undefined || latitude === undefined) return undefined;

  const callsignRaw = typeof state[1] === "string" ? state[1].trim() : "";
  const baroAlt = typeof state[7] === "number" ? state[7] : undefined;
  const velocity = typeof state[9] === "number" ? state[9] : undefined;
  const track = typeof state[10] === "number" ? state[10] : undefined;
  const timePos = typeof state[3] === "number" ? state[3] : undefined;
  const lastContact = typeof state[4] === "number" ? state[4] : undefined;

  const reference = timePos ?? lastContact;
  const age = reference !== undefined ? Math.max(0, nowSeconds - reference) : 0;

  return {
    icaoHex: icao24.trim().toUpperCase(),
    callsign: callsignRaw.length > 0 ? callsignRaw : undefined,
    latitude,
    longitude,
    altitudeFeet: baroAlt !== undefined ? Math.round(baroAlt * METERS_TO_FEET) : undefined,
    groundSpeedKnots: velocity !== undefined ? velocity * MPS_TO_KNOTS : undefined,
    trackDegrees: track,
    positionAgeSeconds: age,
  };
}

export class OpenSkyProvider implements AircraftProvider {
  readonly name = "opensky";
  lastHttpStatus: number | undefined;

  private lastFetchMs = 0;
  private cached: ProviderAircraft[] = [];

  async fetchAircraft(
    latitude: number,
    longitude: number,
    radiusMiles: number,
  ): Promise<ProviderAircraft[]> {
    // Serve cached results between calls to respect anonymous rate limits.
    if (Date.now() - this.lastFetchMs < MIN_INTERVAL_MS) {
      return this.cached;
    }

    const marginMiles = radiusMiles * 1.1;
    const dLat = marginMiles / MILES_PER_DEGREE_LAT;
    const dLon = marginMiles / (MILES_PER_DEGREE_LAT * Math.cos(toRadians(latitude)));
    const params = new URLSearchParams({
      lamin: String(latitude - dLat),
      lamax: String(latitude + dLat),
      lomin: String(longitude - dLon),
      lomax: String(longitude + dLon),
    });

    const res = await fetch(`${BASE}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.lastHttpStatus = res.status;
    this.lastFetchMs = Date.now();
    if (!res.ok) {
      throw new Error(`opensky HTTP ${res.status}`);
    }

    const body = (await res.json()) as StatesResponse;
    const nowSeconds = body.time ?? Math.floor(Date.now() / 1000);
    const states = Array.isArray(body.states) ? body.states : [];
    const mapped: ProviderAircraft[] = [];
    for (const state of states) {
      const aircraft = mapOpenSkyState(state, nowSeconds);
      if (aircraft) mapped.push(aircraft);
    }
    this.cached = mapped;
    log.debug("fetched aircraft", { received: mapped.length });
    return mapped;
  }
}
