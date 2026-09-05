/**
 * Operational flight intelligence providers (FRD v3.8 §20-26, §106). Structured
 * ACARS/VDL2-derived evidence - OOOI events, flight state, ETA, route corroboration
 * and possible route changes - that enriches, but never moves, the ADS-B icon
 * (§17). Airframes is the Tier-1 source; because its access is a developing,
 * credential-gated arrangement (§26) the live path is env-gated and the spec makes
 * everything testable via a simulation provider (§106).
 */

import type { OooiTimes, Eta, PossibleRouteChange, RouteConfidence } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("operational");

export interface OperationalTracked {
  icaoHex: string;
  callsign?: string;
  registration?: string;
  airborne: boolean;
}

/** Operational evidence for one aircraft (before merge with the route decision). */
export interface OperationalEvidence {
  airline?: string;
  origin?: string;
  destination?: string;
  oooi: OooiTimes;
  eta?: Eta;
  possibleRouteChange?: PossibleRouteChange;
  /** The provider's own route-confidence hint (§34). */
  routeConfidenceHint?: RouteConfidence;
  sources: string[];
}

export interface OperationalProvider {
  readonly name: string;
  readonly enabled: boolean;
  lookup(tracked: OperationalTracked): Promise<OperationalEvidence | undefined>;
}

function minutesAgo(min: number): string {
  return new Date(Date.now() - min * 60_000).toISOString();
}
function minutesAhead(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

/**
 * Deterministic simulation of the §106 operational scenarios, keyed off the
 * callsign so a given aircraft always shows the same story. Lets the whole
 * operational-intelligence pipeline be exercised without an Airframes credential.
 */
export class SimulationOperationalProvider implements OperationalProvider {
  readonly name = "simulation";
  readonly enabled = true;

  async lookup(tracked: OperationalTracked): Promise<OperationalEvidence | undefined> {
    if (!tracked.callsign) return undefined;
    const key = tracked.callsign;
    const scenario = hash(key) % 5;
    switch (scenario) {
      case 0: // Confirmed: Airframes + adsbdb agree.
        return {
          airline: "British Airways",
          origin: "Bristol",
          destination: "Edinburgh",
          oooi: { out: minutesAgo(96), off: minutesAgo(84) },
          eta: { time: minutesAhead(28), source: "provider" },
          routeConfidenceHint: "confirmed",
          sources: ["airframes", "adsbdb"],
        };
      case 1: // Airframes-only strong route.
        return {
          airline: "easyJet",
          origin: "Bristol",
          destination: "Glasgow",
          oooi: { out: minutesAgo(52), off: minutesAgo(40) },
          eta: { time: minutesAhead(35), source: "provider" },
          routeConfidenceHint: "high",
          sources: ["airframes"],
        };
      case 2: // Possible diversion: destination changed mid-flight.
        return {
          airline: "British Airways",
          origin: "London Heathrow",
          destination: "Glasgow",
          oooi: { out: minutesAgo(70), off: minutesAgo(58) },
          possibleRouteChange: {
            previousDestination: "Edinburgh",
            newDestination: "Glasgow",
            confidence: "likely",
          },
          routeConfidenceHint: "high",
          sources: ["airframes"],
        };
      case 3: // Stale ACARS: an old completed flight is excluded (§38-39).
        return undefined;
      default: // OOOI sequence, recently departed.
        return {
          airline: "Ryanair",
          origin: "Bristol",
          destination: "Dublin",
          oooi: { out: minutesAgo(18), off: minutesAgo(6) },
          eta: { time: minutesAhead(45), source: "provider" },
          routeConfidenceHint: "medium",
          sources: ["airframes"],
        };
    }
  }
}

/**
 * Airframes REST provider (FRD §21-26). Env-gated and disabled unless
 * AIRFRAMES_ENABLED and an API key are set; credentials stay server-side (§24).
 * The live REST mapping awaits confirmed API access (§26 - access/pricing is
 * still developing), so when enabled it currently returns no evidence rather
 * than guessing an endpoint shape; the architecture, config and health surface
 * are in place for that wiring.
 */
export class AirframesOperationalProvider implements OperationalProvider {
  readonly name = "airframes";
  readonly enabled: boolean;

  constructor(
    enabledFlag: boolean,
    private readonly mode: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
  ) {
    this.enabled = enabledFlag && typeof apiKey === "string" && apiKey.length > 0;
  }

  async lookup(_tracked: OperationalTracked): Promise<OperationalEvidence | undefined> {
    if (!this.enabled) return undefined;
    log.debug("airframes REST lookup skipped (live mapping pending API access)", {
      mode: this.mode,
      baseUrl: this.baseUrl,
    });
    return undefined;
  }
}

/** Selects the active operational provider and gathers evidence (§20 Composite). */
export class OperationalIntelligenceService {
  constructor(private readonly provider: OperationalProvider) {}

  get sourceName(): string {
    return this.provider.enabled ? this.provider.name : "none";
  }

  async lookup(tracked: OperationalTracked): Promise<OperationalEvidence | undefined> {
    if (!this.provider.enabled) return undefined;
    try {
      return await this.provider.lookup(tracked);
    } catch (err) {
      log.warn("operational lookup failed", { error: String(err) });
      return undefined;
    }
  }
}

/** Small stable string hash for deterministic simulation scenarios. */
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
