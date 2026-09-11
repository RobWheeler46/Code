/**
 * ACARS/VDL2 message providers (FRD v3.9). Airframes is the Tier-1 source; because
 * its realtime/REST access is a developing, credential-gated arrangement the live
 * path is env-gated and inert, and the spec requires a simulation provider so the
 * whole feature can be built and tested without live Airframes (§Simulation).
 *
 * A provider returns the NEW messages since the last poll. Each carries the
 * identity it asserts so the service can correlate it to the live aircraft and
 * reject conflicting identities (§Aircraft Correlation).
 */

import type { AcarsMessage, AcarsCategory, AcarsMedium } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("acars");

export interface AcarsTracked {
  icaoHex: string;
  callsign?: string;
  registration?: string;
}

/** A message straight from the provider, before correlation/policy is applied. */
export interface ProviderMessage extends AcarsMessage {
  /** Identity the provider asserts for this message (for correlation, §Correlation). */
  assertedRegistration?: string;
  assertedCallsign?: string;
}

export interface AcarsMessageProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** New messages since the previous poll for the given tracked aircraft. */
  poll(tracked: AcarsTracked[], nowMs: number): ProviderMessage[];
}

interface SimState {
  firstSeenMs: number;
  lastEmitMs: number;
  counter: number;
}

/** One message template in the simulation rotation. */
interface Template {
  medium: AcarsMedium;
  label: string;
  category: AcarsCategory;
  summary: string;
  lines?: string[];
  /** A plausible raw payload (only ever exposed where policy permits, §Legal). */
  raw: string;
}

const TEMPLATES: Template[] = [
  {
    medium: "VDL2",
    label: "H1",
    category: "position",
    summary: "Position report",
    lines: ["Altitude FL350", "Track 118"],
    raw: "/POSN 51.6N/001.8W,FL350,118,M079",
  },
  {
    medium: "VDL2",
    label: "H1",
    category: "flight_management",
    summary: "Flight management",
    lines: ["Route / flight data decoded"],
    raw: "FMC WPT SEQ / PROGRESS",
  },
  {
    medium: "VDL2",
    label: "SA",
    category: "weather",
    summary: "Weather information",
    lines: ["Wind 250/38", "OAT -54C"],
    raw: "WX METAR REQ/RESP",
  },
  {
    medium: "VDL2",
    label: "RA",
    category: "route",
    summary: "Route / flight plan",
    lines: ["Cruise FL350"],
    raw: "RTE CLX FPLAN UPLINK",
  },
  {
    medium: "ACARS",
    label: "5Z",
    category: "eta",
    summary: "ETA update",
    lines: ["Estimated arrival 21:34"],
    raw: "ETA 2134Z",
  },
  {
    medium: "ACARS",
    label: "QA",
    category: "oooi",
    summary: "Airborne / OFF",
    lines: ["OOOI OFF reported"],
    raw: "OOOI OFF 2029Z",
  },
];

const FIRST_MESSAGE_DELAY_MS = 5_000;
const EMIT_INTERVAL_MS = 18_000;

/**
 * Deterministic simulation of correlated datalink activity (§Simulation). Streams
 * a rotating set of decoded messages per aircraft over time, and periodically
 * injects the two negative cases the spec requires: an unmatched message and a
 * message whose asserted identity conflicts with the aircraft.
 */
export class SimulationAcarsProvider implements AcarsMessageProvider {
  readonly name = "simulation";
  readonly enabled = true;
  private readonly state = new Map<string, SimState>();

  poll(tracked: AcarsTracked[], nowMs: number): ProviderMessage[] {
    const present = new Set(tracked.map((t) => t.icaoHex));
    for (const hex of [...this.state.keys()]) if (!present.has(hex)) this.state.delete(hex);

    const out: ProviderMessage[] = [];
    for (const t of tracked) {
      // Only aircraft in the air produce meaningful datalink chatter here; the
      // service already restricts which aircraft are eligible.
      let s = this.state.get(t.icaoHex);
      if (!s) {
        s = { firstSeenMs: nowMs, lastEmitMs: 0, counter: 0 };
        this.state.set(t.icaoHex, s);
      }
      const sinceFirst = nowMs - s.firstSeenMs;
      const sinceEmit = s.lastEmitMs === 0 ? sinceFirst : nowMs - s.lastEmitMs;
      const due = s.lastEmitMs === 0 ? sinceFirst >= FIRST_MESSAGE_DELAY_MS : sinceEmit >= EMIT_INTERVAL_MS;
      if (!due) continue;
      s.lastEmitMs = nowMs;
      const n = s.counter++;
      out.push(this.build(t, n, nowMs));
    }
    return out;
  }

  private build(t: AcarsTracked, n: number, nowMs: number): ProviderMessage {
    const iso = new Date(nowMs).toISOString();
    const base = {
      id: `${t.icaoHex}-${n}-${nowMs}`,
      aircraftId: t.icaoHex,
      timestamp: iso,
      source: "simulation",
      receivingStation: "Airframes feeder network",
    };

    // Every 7th message is unmatched (no correlating aircraft in view, §Simulation).
    if (n > 0 && n % 7 === 5) {
      return {
        ...base,
        id: `UNMATCHED-${n}-${nowMs}`,
        aircraftId: "UNKNWN",
        medium: "HFDL",
        label: "10",
        category: "other",
        decoded: { summary: "Unmatched message" },
        rawTextAvailable: false,
        raw: "UNCORRELATED",
        correlationConfidence: "low",
      };
    }
    // Every 11th message asserts a conflicting registration (§Simulation) - the
    // service must not show it against this aircraft.
    if (n > 0 && n % 11 === 9) {
      return {
        ...base,
        medium: "VDL2",
        label: "H1",
        category: "position",
        decoded: { summary: "Position report" },
        rawTextAvailable: false,
        raw: "CONFLICT",
        correlationConfidence: "high",
        assertedRegistration: "X-WRONG",
      };
    }

    const tpl = TEMPLATES[n % TEMPLATES.length] as Template;
    return {
      ...base,
      medium: tpl.medium,
      label: tpl.label,
      category: tpl.category,
      decoded: { summary: tpl.summary, lines: tpl.lines },
      rawTextAvailable: false, // set by the service where policy permits
      raw: tpl.raw,
      correlationConfidence: t.registration ? "confirmed" : t.callsign ? "high" : "medium",
      assertedRegistration: t.registration,
      assertedCallsign: t.callsign,
    };
  }
}

/**
 * Airframes ACARS provider (§REST Fallback / §Live Updates). Env-gated and inert
 * until confirmed realtime/REST access; the architecture, policy and simulation
 * exercise the feature meanwhile.
 */
export class AirframesAcarsProvider implements AcarsMessageProvider {
  readonly name = "airframes";
  readonly enabled: boolean;

  constructor(enabledFlag: boolean, apiKey: string | undefined) {
    this.enabled = enabledFlag && typeof apiKey === "string" && apiKey.length > 0;
  }

  poll(_tracked: AcarsTracked[], _nowMs: number): ProviderMessage[] {
    if (this.enabled) {
      log.debug("airframes ACARS poll skipped (live mapping pending API access)");
    }
    return [];
  }
}
