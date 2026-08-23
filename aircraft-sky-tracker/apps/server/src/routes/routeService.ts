/**
 * RouteService (FRD §15-21, §29, §70).
 *
 * Responsibilities: callsign -> destination lookup, route caching, destination
 * naming, route confidence, plus fallback aircraft-metadata enrichment. Route
 * data is supplementary and must never be treated as authoritative position
 * data (FRD §19); low-confidence destinations are not shown.
 *
 * Lookups are cheap for callers: getDestination() returns the current best
 * cached answer synchronously and schedules a background refresh when needed
 * (new callsign, changed callsign, or expired cache - FRD §20).
 */

import type { Destination, RouteConfidence, AircraftMeta } from "@ast/shared";
import { RouteCacheRepo, type CachedRoute } from "../persistence/routeCacheRepo.js";
import { AircraftCacheRepo } from "../persistence/aircraftCacheRepo.js";
import { AdsbdbClient, UNKNOWN } from "./adsbdbClient.js";
import {
  CompositeFlightIntelligence,
  AdsbdbFlightProvider,
  AirframesFlightProvider,
} from "./flightIntelligence.js";
import { decideRoute, type RouteDecision, type TrackedIdentity } from "./confidenceEngine.js";
import { MinIntervalGate } from "../util/rateLimiter.js";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("route");

// Route-cache TTL by classification (FRD §79).
const TTL_MS: Record<RouteConfidence, number> = {
  confirmed: 6 * 60 * 60 * 1000,
  high: 4 * 60 * 60 * 1000,
  medium: 2 * 60 * 60 * 1000,
  low: 30 * 60 * 1000,
  unknown: 15 * 60 * 1000,
};
const ADSBDB_MIN_INTERVAL_MS = 250; // be gentle with adsbdb's rolling limits
/** Keep showing a resolved destination briefly through a dropout (FRD §39). */
const DISPLAY_GRACE_MS = 20_000;

/** Offline destinations for the simulation provider's callsigns (FRD §91). */
const SIMULATION_ROUTES: Record<string, { icao: string; name: string }> = {
  BAW1462: { icao: "EGPH", name: "Edinburgh" },
  EZY812: { icao: "EGGD", name: "Bristol" },
  RYR4TG: { icao: "EIDW", name: "Dublin" },
  KLM43F: { icao: "EHAM", name: "Amsterdam" },
  TOM7YT: { icao: "LPFR", name: "Faro" },
  EZY23UI: { icao: "EGAA", name: "Belfast" },
  UAE7: { icao: "OMDB", name: "Dubai" },
  BAW9: { icao: "KJFK", name: "New York" },
};

/** Everything the route decision needs about the tracked aircraft (FRD §28). */
export interface AircraftContext extends TrackedIdentity {}

interface DisplayedRoute {
  destination: Destination;
  callsign: string;
  lastGoodAt: number;
}

export class RouteService {
  private readonly routes: RouteCacheRepo;
  private readonly aircraftMeta: AircraftCacheRepo;
  private readonly client: AdsbdbClient;
  private readonly intelligence: CompositeFlightIntelligence;
  private readonly gate = new MinIntervalGate(ADSBDB_MIN_INTERVAL_MS);
  private readonly inflightRoutes = new Set<string>();
  private readonly inflightMeta = new Set<string>();
  /** Per-aircraft displayed route, for hysteresis / dropout grace (FRD §39). */
  private readonly displayed = new Map<string, DisplayedRoute>();
  private lastLookupCallsign: string | undefined;

  constructor(
    routes: RouteCacheRepo = new RouteCacheRepo(),
    aircraftMeta: AircraftCacheRepo = new AircraftCacheRepo(),
    client: AdsbdbClient = new AdsbdbClient(),
    intelligence: CompositeFlightIntelligence = new CompositeFlightIntelligence([
      new AdsbdbFlightProvider(client),
      new AirframesFlightProvider(env.airframesApiKey, env.airframesUrl),
    ]),
  ) {
    this.routes = routes;
    this.aircraftMeta = aircraftMeta;
    this.client = client;
    this.intelligence = intelligence;
  }

  activeSources(): string[] {
    return this.intelligence.activeSources();
  }

  confidenceBreakdown(): Record<RouteConfidence, number> {
    return this.routes.confidenceCounts();
  }

  get lastCallsign(): string | undefined {
    return this.lastLookupCallsign;
  }

  get lastHttpStatus(): number | undefined {
    return this.client.lastHttpStatus;
  }

  cacheEntryCount(): number {
    return this.routes.count();
  }

  /**
   * Current best destination for an aircraft (display-ready), or undefined when
   * the route confidence is Low/Unknown (FRD §36) - the display then shows a
   * physical heading instead. Schedules a background lookup when the cache has
   * nothing fresh, and applies dropout hysteresis so a resolved destination does
   * not flicker (FRD §39).
   */
  getDestination(context: AircraftContext): Destination | undefined {
    const callsign = context.callsign;
    if (!callsign) {
      this.displayed.delete(context.icaoHex);
      return undefined;
    }

    const cached = this.routes.get(callsign);
    if (!cached) {
      this.scheduleRouteLookup(context);
      return this.grace(context);
    }

    const dest = this.decisionToDestination(cached);
    if (dest) {
      this.displayed.set(context.icaoHex, {
        destination: dest,
        callsign,
        lastGoodAt: Date.now(),
      });
      return dest;
    }
    return this.grace(context);
  }

  /** Show the last resolved destination briefly through a dropout (FRD §39). */
  private grace(context: AircraftContext): Destination | undefined {
    const g = this.displayed.get(context.icaoHex);
    if (g && g.callsign === context.callsign && Date.now() - g.lastGoodAt < DISPLAY_GRACE_MS) {
      return g.destination;
    }
    this.displayed.delete(context.icaoHex);
    return undefined;
  }

  /** Cached route -> displayable destination (Confirmed/High/Medium only, §36). */
  private decisionToDestination(cached: CachedRoute): Destination | undefined {
    if (cached.confidence === "low" || cached.confidence === "unknown") return undefined;
    if (!cached.destinationDisplayName) return undefined;
    return {
      airportName: cached.destinationName,
      displayName: cached.destinationDisplayName,
      iata: cached.destinationIata,
      icao: cached.destinationIcao,
      latitude: cached.destinationLatitude,
      longitude: cached.destinationLongitude,
      confidence: cached.confidence,
      originName: cached.originName,
      originIata: cached.originIata,
      originIcao: cached.originIcao,
      airline: cached.airline,
      sources: cached.sources,
    };
  }

  private scheduleRouteLookup(context: AircraftContext): void {
    const callsign = context.callsign;
    if (!callsign || this.inflightRoutes.has(callsign)) return;
    this.inflightRoutes.add(callsign);

    // Simulation routes resolve instantly and offline (fresh, confirmed-identity).
    const sim = SIMULATION_ROUTES[callsign];
    if (sim) {
      const decision = decideRoute(context, [
        {
          source: "simulation",
          aircraftIcaoHex: context.icaoHex,
          callsign,
          destinationName: sim.name,
          destinationIcao: sim.icao,
          evidenceAgeMinutes: 0,
        },
      ]);
      this.storeDecision(callsign, decision);
      this.inflightRoutes.delete(callsign);
      return;
    }

    void this.gate
      .run(async () => {
        this.lastLookupCallsign = callsign;
        const evidences = await this.intelligence.gather(context);
        if (evidences.length === 0) {
          this.storeNegative(callsign);
          return;
        }
        this.storeDecision(callsign, decideRoute(context, evidences));
      })
      .catch((err: unknown) => {
        log.warn("route lookup failed", { callsign, error: String(err) });
      })
      .finally(() => {
        this.inflightRoutes.delete(callsign);
      });
  }

  private storeDecision(callsign: string, decision: RouteDecision): void {
    if (!decision.destination) {
      this.storeNegative(callsign);
      return;
    }
    const now = new Date();
    this.routes.put({
      callsign,
      originIcao: decision.origin?.icao,
      originIata: decision.origin?.iata,
      originName: decision.origin?.name,
      destinationIcao: decision.destination.icao,
      destinationIata: decision.destination.iata,
      destinationName: decision.destination.name,
      destinationDisplayName: decision.destination.name,
      destinationLatitude: decision.destination.latitude,
      destinationLongitude: decision.destination.longitude,
      airline: decision.airline,
      confidence: decision.classification,
      sources: decision.sources,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS[decision.classification]).toISOString(),
      source: decision.sources.join("+") || "adsbdb",
    });
  }

  /** Negative cache for callsigns with no credible route (FRD §70). */
  private storeNegative(callsign: string): void {
    const now = new Date();
    this.routes.put({
      callsign,
      confidence: "unknown",
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + TTL_MS.unknown).toISOString(),
      source: "adsbdb",
    });
  }

  /**
   * Fallback aircraft-metadata enrichment (FRD §21). Only needed when the live
   * provider did not supply registration/type. Returns a cached registration if
   * one is available, and schedules a background lookup otherwise.
   */
  getRegistration(icaoHex: string): { registration?: string; aircraftTypeCode?: string } | undefined {
    const cached = this.aircraftMeta.get(icaoHex);
    if (cached) {
      return { registration: cached.registration, aircraftTypeCode: cached.aircraftType };
    }
    this.scheduleMetaLookup(icaoHex);
    return undefined;
  }

  /**
   * Full aircraft-registry metadata for the detail drawer (FRD §45). Awaits an
   * adsbdb lookup on a cache miss (this is an on-demand detail request, not the
   * hot poll path).
   */
  async getAircraftMeta(icaoHex: string): Promise<AircraftMeta> {
    const cached = this.aircraftMeta.get(icaoHex);
    if (cached) {
      return {
        manufacturer: cached.manufacturer,
        model: cached.model,
        typeDescription: cached.aircraftType,
        operator: cached.operator,
        registeredCountry: cached.registeredCountry,
      };
    }
    try {
      const result = await this.gate.run(() => this.client.lookupAircraft(icaoHex));
      if (result === UNKNOWN) {
        this.aircraftMeta.put({ icaoHex, source: "adsbdb" });
        return {};
      }
      this.aircraftMeta.put({
        icaoHex,
        registration: result.registration,
        aircraftType: result.icaoTypeCode ?? result.type,
        manufacturer: result.manufacturer,
        model: result.type,
        operator: result.operator,
        registeredCountry: result.registeredCountry,
        source: "adsbdb",
      });
      return {
        manufacturer: result.manufacturer,
        model: result.type,
        typeDescription: result.icaoTypeCode ?? result.type,
        operator: result.operator,
        registeredCountry: result.registeredCountry,
      };
    } catch (err) {
      log.warn("aircraft meta lookup failed", { icaoHex, error: String(err) });
      return {};
    }
  }

  private scheduleMetaLookup(icaoHex: string): void {
    if (this.inflightMeta.has(icaoHex)) return;
    this.inflightMeta.add(icaoHex);
    void this.gate
      .run(async () => {
        const result = await this.client.lookupAircraft(icaoHex);
        if (result === UNKNOWN) {
          this.aircraftMeta.put({ icaoHex, source: "adsbdb" });
          return;
        }
        this.aircraftMeta.put({
          icaoHex,
          registration: result.registration,
          aircraftType: result.icaoTypeCode ?? result.type,
          manufacturer: result.manufacturer,
          model: result.type,
          operator: result.operator,
          registeredCountry: result.registeredCountry,
          source: "adsbdb",
        });
      })
      .catch((err: unknown) => {
        log.warn("aircraft metadata lookup failed", { icaoHex, error: String(err) });
      })
      .finally(() => {
        this.inflightMeta.delete(icaoHex);
      });
  }
}
