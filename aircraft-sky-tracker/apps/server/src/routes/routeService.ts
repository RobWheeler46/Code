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

import type { Destination, RouteConfidence } from "@ast/shared";
import { bearingDegrees } from "@ast/shared";
import { RouteCacheRepo, type CachedRoute } from "../persistence/routeCacheRepo.js";
import { AircraftCacheRepo } from "../persistence/aircraftCacheRepo.js";
import { AdsbdbClient, UNKNOWN } from "./adsbdbClient.js";
import { deriveDisplayName } from "./airportNames.js";
import { MinIntervalGate } from "../util/rateLimiter.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("route");

const SUCCESS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours (FRD §20)
const UNKNOWN_TTL_MS = 15 * 60 * 1000; // 15 minutes (FRD §20)
const ADSBDB_MIN_INTERVAL_MS = 250; // be gentle with adsbdb's rolling limits

/** Offline destinations for the simulation provider's callsigns (FRD §91). */
const SIMULATION_ROUTES: Record<string, { icao: string; name: string }> = {
  BAW1462: { icao: "EGPH", name: "Edinburgh" },
  EZY812: { icao: "EGGD", name: "Bristol" },
  RYR4TG: { icao: "EIDW", name: "Dublin" },
  KLM43F: { icao: "EHAM", name: "Amsterdam" },
  TOM7YT: { icao: "LPFR", name: "Faro" },
  EZY23UI: { icao: "EGAA", name: "Belfast" },
};

export interface AircraftContext {
  latitude: number;
  longitude: number;
  trackDegrees?: number;
}

export class RouteService {
  private readonly routes: RouteCacheRepo;
  private readonly aircraftMeta: AircraftCacheRepo;
  private readonly client: AdsbdbClient;
  private readonly gate = new MinIntervalGate(ADSBDB_MIN_INTERVAL_MS);
  private readonly inflightRoutes = new Set<string>();
  private readonly inflightMeta = new Set<string>();
  private lastLookupCallsign: string | undefined;

  constructor(
    routes: RouteCacheRepo = new RouteCacheRepo(),
    aircraftMeta: AircraftCacheRepo = new AircraftCacheRepo(),
    client: AdsbdbClient = new AdsbdbClient(),
  ) {
    this.routes = routes;
    this.aircraftMeta = aircraftMeta;
    this.client = client;
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
   * Current best destination for a callsign (display-ready). Returns undefined
   * when unknown or low-confidence, and schedules a background lookup if the
   * cache has nothing fresh.
   */
  getDestination(
    callsign: string | undefined,
    context: AircraftContext,
  ): Destination | undefined {
    if (!callsign) return undefined;

    const cached = this.routes.get(callsign);
    if (cached) {
      return this.toDisplayDestination(cached);
    }

    // Nothing fresh cached -> refresh in the background (FRD §20).
    this.scheduleRouteLookup(callsign, context);
    return undefined;
  }

  private toDisplayDestination(cached: CachedRoute): Destination | undefined {
    // Low-confidence destinations shall not be shown (FRD §19).
    if (cached.confidence === "low") return undefined;
    if (!cached.destinationDisplayName) return undefined;
    return {
      airportName: cached.destinationName,
      displayName: cached.destinationDisplayName,
      iata: cached.destinationIata,
      icao: cached.destinationIcao,
      latitude: cached.destinationLatitude,
      longitude: cached.destinationLongitude,
      confidence: cached.confidence,
    };
  }

  private scheduleRouteLookup(callsign: string, context: AircraftContext): void {
    if (this.inflightRoutes.has(callsign)) return;
    this.inflightRoutes.add(callsign);

    // Simulation routes resolve instantly and offline.
    const sim = SIMULATION_ROUTES[callsign];
    if (sim) {
      this.storeRoute(callsign, {
        destinationIcao: sim.icao,
        destinationDisplayName: sim.name,
        destinationName: sim.name,
        confidence: "high",
        source: "simulation",
      });
      this.inflightRoutes.delete(callsign);
      return;
    }

    void this.gate
      .run(async () => {
        this.lastLookupCallsign = callsign;
        const result = await this.client.lookupRoute(callsign);
        if (result === UNKNOWN) {
          this.storeNegative(callsign);
          return;
        }
        const dest = result.destination;
        const displayName = deriveDisplayName({
          icao: dest?.icao_code,
          iata: dest?.iata_code,
          name: dest?.name,
        });
        const confidence = this.assessConfidence(result, context);
        this.storeRoute(callsign, {
          originIcao: result.origin?.icao_code,
          originIata: result.origin?.iata_code,
          originName: result.origin?.name,
          destinationIcao: dest?.icao_code,
          destinationIata: dest?.iata_code,
          destinationName: dest?.name,
          destinationDisplayName: displayName,
          destinationLatitude: dest?.latitude,
          destinationLongitude: dest?.longitude,
          airline: result.airlineName,
          confidence,
          source: "adsbdb",
        });
      })
      .catch((err: unknown) => {
        log.warn("route lookup failed", { callsign, error: String(err) });
      })
      .finally(() => {
        this.inflightRoutes.delete(callsign);
      });
  }

  /**
   * Route confidence heuristic (FRD §19). "low" (implausible) is hidden.
   */
  private assessConfidence(
    route: { origin?: { icao_code?: string }; destination?: { icao_code?: string; latitude?: number; longitude?: number } },
    ctx: AircraftContext,
  ): RouteConfidence {
    const dest = route.destination;
    if (!dest) return "low";
    // Origin == destination is implausible for an observed en-route aircraft.
    if (
      route.origin?.icao_code &&
      dest.icao_code &&
      route.origin.icao_code === dest.icao_code
    ) {
      return "low";
    }
    // Without coordinates or track we cannot validate direction of travel.
    if (
      typeof dest.latitude !== "number" ||
      typeof dest.longitude !== "number" ||
      typeof ctx.trackDegrees !== "number"
    ) {
      return "medium";
    }
    const bearingToDest = bearingDegrees(
      ctx.latitude,
      ctx.longitude,
      dest.latitude,
      dest.longitude,
    );
    const diff = angularDifference(ctx.trackDegrees, bearingToDest);
    if (diff <= 60) return "high"; // heading towards the destination
    if (diff <= 120) return "medium";
    return "low"; // travelling away from the claimed destination -> implausible
  }

  private storeRoute(
    callsign: string,
    partial: Partial<CachedRoute> & { confidence: RouteConfidence; source: string },
  ): void {
    const now = new Date();
    this.routes.put({
      callsign,
      originIcao: partial.originIcao,
      originIata: partial.originIata,
      originName: partial.originName,
      destinationIcao: partial.destinationIcao,
      destinationIata: partial.destinationIata,
      destinationName: partial.destinationName,
      destinationDisplayName: partial.destinationDisplayName,
      destinationLatitude: partial.destinationLatitude,
      destinationLongitude: partial.destinationLongitude,
      airline: partial.airline,
      confidence: partial.confidence,
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SUCCESS_TTL_MS).toISOString(),
      source: partial.source,
    });
  }

  /** Negative cache for unknown callsigns (FRD §70). */
  private storeNegative(callsign: string): void {
    const now = new Date();
    this.routes.put({
      callsign,
      confidence: "low",
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + UNKNOWN_TTL_MS).toISOString(),
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

/** Smallest absolute angle (0-180) between two bearings. */
function angularDifference(a: number, b: number): number {
  const diff = Math.abs(((a - b + 540) % 360) - 180);
  return diff;
}
