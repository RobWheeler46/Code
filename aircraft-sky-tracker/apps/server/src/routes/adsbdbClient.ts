/**
 * adsbdb client (FRD §15-16, §21).
 *
 * Callsign -> flight route: GET https://api.adsbdb.com/v0/callsign/{CALLSIGN}
 * ICAO hex -> aircraft:     GET https://api.adsbdb.com/v0/aircraft/{ICAO_HEX}
 */

import { createLogger } from "../logging/logger.js";

const log = createLogger("route.adsbdb");
const BASE = "https://api.adsbdb.com/v0";
const REQUEST_TIMEOUT_MS = 6000;

export interface AdsbdbAirport {
  icao_code?: string;
  iata_code?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}

export interface AdsbdbRoute {
  airlineName?: string;
  origin?: AdsbdbAirport;
  destination?: AdsbdbAirport;
}

export interface AdsbdbAircraftMeta {
  registration?: string;
  type?: string;
  manufacturer?: string;
  icaoTypeCode?: string;
  modeS?: string;
  operator?: string;
  registeredCountry?: string;
}

interface CallsignResponse {
  response?: {
    flightroute?: {
      airline?: { name?: string };
      origin?: RawAirport;
      destination?: RawAirport;
    };
  };
}

interface RawAirport {
  icao_code?: string;
  iata_code?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
}

interface AircraftResponse {
  response?:
    | {
        aircraft?: {
          registration?: string;
          type?: string;
          manufacturer?: string;
          icao_type?: string;
          registered_owner?: string;
          registered_owner_country_name?: string;
        };
      }
    | string;
}

/** "unknown callsign" is a normal, non-error outcome from adsbdb. */
export const UNKNOWN = Symbol("adsbdb-unknown");
export type Unknown = typeof UNKNOWN;

function mapAirport(a: RawAirport | undefined): AdsbdbAirport | undefined {
  if (!a) return undefined;
  return {
    icao_code: a.icao_code,
    iata_code: a.iata_code,
    name: a.name,
    latitude: typeof a.latitude === "number" ? a.latitude : undefined,
    longitude: typeof a.longitude === "number" ? a.longitude : undefined,
  };
}

export class AdsbdbClient {
  lastHttpStatus: number | undefined;

  /** Look up a flight route by callsign. Returns UNKNOWN on 404/no route. */
  async lookupRoute(callsign: string): Promise<AdsbdbRoute | Unknown> {
    const url = `${BASE}/callsign/${encodeURIComponent(callsign)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.lastHttpStatus = res.status;
    if (res.status === 404) return UNKNOWN;
    if (res.status === 429) throw new Error("adsbdb rate limited (HTTP 429)");
    if (!res.ok) throw new Error(`adsbdb callsign HTTP ${res.status}`);

    const body = (await res.json()) as CallsignResponse;
    const route = body.response?.flightroute;
    if (!route) return UNKNOWN;
    log.debug("route resolved", { callsign });
    return {
      airlineName: route.airline?.name,
      origin: mapAirport(route.origin),
      destination: mapAirport(route.destination),
    };
  }

  /**
   * Combined aircraft + callsign lookup (FRD §23):
   *   GET /v0/aircraft/{ICAO}?callsign={CALLSIGN}
   * Correlates the route with the specific aircraft, enabling the identity gate.
   */
  async lookupCombined(
    icaoHex: string,
    callsign: string,
  ): Promise<{ aircraft?: AdsbdbAircraftMeta; route?: AdsbdbRoute } | Unknown> {
    const url = `${BASE}/aircraft/${encodeURIComponent(icaoHex)}?callsign=${encodeURIComponent(callsign)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.lastHttpStatus = res.status;
    if (res.status === 404) return UNKNOWN;
    if (res.status === 429) throw new Error("adsbdb rate limited (HTTP 429)");
    if (!res.ok) throw new Error(`adsbdb combined HTTP ${res.status}`);

    const body = (await res.json()) as {
      response?: {
        aircraft?: {
          registration?: string;
          type?: string;
          manufacturer?: string;
          icao_type?: string;
          mode_s?: string;
          registered_owner?: string;
          registered_owner_country_name?: string;
        };
        flightroute?: {
          airline?: { name?: string };
          origin?: RawAirport;
          destination?: RawAirport;
        };
      };
    };
    const r = body.response;
    if (!r) return UNKNOWN;
    const ac = r.aircraft;
    const fr = r.flightroute;
    return {
      aircraft: ac
        ? {
            registration: ac.registration,
            type: ac.type,
            manufacturer: ac.manufacturer,
            icaoTypeCode: ac.icao_type,
            modeS: ac.mode_s,
            operator: ac.registered_owner,
            registeredCountry: ac.registered_owner_country_name,
          }
        : undefined,
      route: fr
        ? {
            airlineName: fr.airline?.name,
            origin: mapAirport(fr.origin),
            destination: mapAirport(fr.destination),
          }
        : undefined,
    };
  }

  /** Fallback aircraft metadata lookup by ICAO hex (FRD §21). */
  async lookupAircraft(icaoHex: string): Promise<AdsbdbAircraftMeta | Unknown> {
    const url = `${BASE}/aircraft/${encodeURIComponent(icaoHex)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    this.lastHttpStatus = res.status;
    if (res.status === 404) return UNKNOWN;
    if (res.status === 429) throw new Error("adsbdb rate limited (HTTP 429)");
    if (!res.ok) throw new Error(`adsbdb aircraft HTTP ${res.status}`);

    const body = (await res.json()) as AircraftResponse;
    if (!body.response || typeof body.response === "string") return UNKNOWN;
    const ac = body.response.aircraft;
    if (!ac) return UNKNOWN;
    return {
      registration: ac.registration,
      type: ac.type,
      manufacturer: ac.manufacturer,
      icaoTypeCode: ac.icao_type,
      operator: ac.registered_owner,
      registeredCountry: ac.registered_owner_country_name,
    };
  }
}
