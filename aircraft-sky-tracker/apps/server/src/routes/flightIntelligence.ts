/**
 * Flight-intelligence provider abstraction (FRD v3.0 §24-27, §69).
 *
 * Route/identity evidence is gathered from one or more providers behind a common
 * interface, then scored by the confidence engine. adsbdb is the default source;
 * Airframes is an optional second source (ACARS/VDL2-derived active-flight
 * evidence) that plugs in without changing the engine or the frontend. Airframes
 * access requires a server-side API key and is disabled unless configured; the
 * application must function without it (FRD §26, §80).
 */

import { AdsbdbClient, UNKNOWN, type AdsbdbRoute, type AdsbdbAircraftMeta } from "./adsbdbClient.js";
import type { RouteEvidence, TrackedIdentity } from "./confidenceEngine.js";
import { deriveDisplayName } from "./airportNames.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("flight-intel");

export interface FlightIntelligenceProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Best-effort: return route evidence, or undefined if none / on error. */
  lookup(tracked: TrackedIdentity): Promise<RouteEvidence | undefined>;
}

/** adsbdb route/aircraft correlation via the combined query (FRD §22-23). */
export class AdsbdbFlightProvider implements FlightIntelligenceProvider {
  readonly name = "adsbdb";
  readonly enabled = true;

  constructor(private readonly client: AdsbdbClient) {}

  async lookup(tracked: TrackedIdentity): Promise<RouteEvidence | undefined> {
    if (!tracked.callsign) return undefined;

    // Prefer the combined query for identity correlation (FRD §23). It 404s when
    // the aircraft is not in adsbdb's registry, so fall back to the callsign-only
    // route - which still belongs to this aircraft via the ADS-B hex<->callsign
    // binding (ADS-B is authoritative for identity, FRD §11).
    let route: AdsbdbRoute | undefined;
    let aircraft: AdsbdbAircraftMeta | undefined;
    try {
      const combined = await this.client.lookupCombined(tracked.icaoHex, tracked.callsign);
      if (combined !== UNKNOWN && combined.route?.destination) {
        route = combined.route;
        aircraft = combined.aircraft;
      }
    } catch {
      /* fall through to callsign-only */
    }
    if (!route) {
      const byCallsign = await this.client.lookupRoute(tracked.callsign);
      if (byCallsign === UNKNOWN || !byCallsign.destination) return undefined;
      route = byCallsign;
    }

    const dest = route.destination;
    if (!dest) return undefined;
    const origin = route.origin;
    return {
      source: "adsbdb",
      aircraftIcaoHex: aircraft?.modeS ?? tracked.icaoHex,
      aircraftRegistration: aircraft?.registration,
      callsign: tracked.callsign,
      destinationName: deriveDisplayName({
        icao: dest.icao_code,
        iata: dest.iata_code,
        name: dest.name,
      }),
      destinationIata: dest.iata_code,
      destinationIcao: dest.icao_code,
      destinationLatitude: dest.latitude,
      destinationLongitude: dest.longitude,
      originName: origin
        ? deriveDisplayName({ icao: origin.icao_code, iata: origin.iata_code, name: origin.name })
        : undefined,
      originIata: origin?.iata_code,
      originIcao: origin?.icao_code,
      airline: route.airlineName,
    };
  }
}

/** Airframes provider (FRD §24-26). Disabled unless an API key is configured. */
export class AirframesFlightProvider implements FlightIntelligenceProvider {
  readonly name = "airframes";
  readonly enabled: boolean;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly baseUrl: string,
  ) {
    this.enabled = typeof apiKey === "string" && apiKey.length > 0;
  }

  async lookup(_tracked: TrackedIdentity): Promise<RouteEvidence | undefined> {
    // Extension point: when enabled, query Airframes' active-flight/route data
    // (REST or real-time stream) and return evidence with hasActiveFlight/OOOI
    // + evidenceAgeMinutes so the engine can reach Confirmed and detect
    // conflicts. Kept inert until a key is configured so the app never depends
    // on it (FRD §26, §80). Credentials stay server-side (FRD §82).
    return undefined;
  }
}

/** Gathers evidence from all enabled providers (FRD §69 CompositeProvider). */
export class CompositeFlightIntelligence {
  constructor(private readonly providers: FlightIntelligenceProvider[]) {}

  activeSources(): string[] {
    return this.providers.filter((p) => p.enabled).map((p) => p.name);
  }

  async gather(tracked: TrackedIdentity): Promise<RouteEvidence[]> {
    const enabled = this.providers.filter((p) => p.enabled);
    const results = await Promise.all(
      enabled.map((p) =>
        p.lookup(tracked).catch((err: unknown) => {
          log.warn("provider lookup failed", { provider: p.name, error: String(err) });
          return undefined;
        }),
      ),
    );
    return results.filter((e): e is RouteEvidence => e !== undefined);
  }
}
