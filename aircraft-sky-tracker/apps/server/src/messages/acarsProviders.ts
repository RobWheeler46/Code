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
  /** Optional background lifecycle (the live provider fetches on a timer). */
  start?(): void;
  stop?(): void;
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

// --- Live Airframes integration (§REST Fallback / §Live Updates) --------------

/** The subset of the Airframes /v1/messages record we consume. */
export interface AirframesRaw {
  id: number | string;
  sourceType?: string;
  source?: string;
  label?: string | null;
  text?: string | null;
  timestamp?: string;
  airframe?: { tail?: string | null; icao?: string | null } | null;
  flight?:
    | string
    | {
        flight?: string | null;
        flightIcao?: string | null;
        flightIata?: string | null;
        latitude?: number | null;
        longitude?: number | null;
        altitude?: number | null;
        departingAirport?: string | null;
        destinationAirport?: string | null;
      }
    | null;
  flightNumber?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  altitude?: number | null;
  departingAirport?: string | null;
  destinationAirport?: string | null;
}

function mediumFrom(raw: AirframesRaw): AcarsMedium {
  const s = (raw.sourceType || raw.source || "").toLowerCase();
  if (s.includes("vdl")) return "VDL2";
  if (s.includes("hfdl")) return "HFDL";
  if (s.includes("satcom") || s.includes("iridium") || s.includes("inmarsat") || s.includes("aero")) {
    return "SATCOM";
  }
  return "ACARS";
}

/** Collapse control characters/whitespace in decoded ACARS text. */
function cleanText(text: string): string {
  return text.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

function positionOf(raw: AirframesRaw): { lat?: number; lon?: number; alt?: number } {
  const f = typeof raw.flight === "object" && raw.flight ? raw.flight : undefined;
  const lat = raw.latitude ?? f?.latitude ?? undefined;
  const lon = raw.longitude ?? f?.longitude ?? undefined;
  const alt = raw.altitude ?? f?.altitude ?? undefined;
  return {
    lat: typeof lat === "number" ? lat : undefined,
    lon: typeof lon === "number" ? lon : undefined,
    alt: typeof alt === "number" ? alt : undefined,
  };
}

function routeOf(raw: AirframesRaw): { dep?: string; dest?: string } {
  const f = typeof raw.flight === "object" && raw.flight ? raw.flight : undefined;
  return {
    dep: raw.departingAirport ?? f?.departingAirport ?? undefined,
    dest: raw.destinationAirport ?? f?.destinationAirport ?? undefined,
  };
}

/** Best-effort category from content (§Message Categories); labels are unreliable. */
export function categoriseAirframes(raw: AirframesRaw): AcarsCategory | undefined {
  const text = (raw.text ?? "").toUpperCase();
  const clean = cleanText(raw.text ?? "");
  const pos = positionOf(raw);
  const route = routeOf(raw);
  const hasContent = clean.length > 0 || pos.lat !== undefined || route.dep || route.dest;
  if (!hasContent) return undefined; // bare link frame - nothing to show

  if (/\bMETAR\b|\bTAF\b|\bATIS\b|\bWX\b|\bQNH\b|VISIBILITY|\bWIND\b|\bRWY\b.*\bILS\b/.test(text)) {
    return "weather";
  }
  if (/\bOOOI\b|OUT\/OFF|OFF\/ON|\bAIRBORNE\b|TAKEOFF|\bLANDED\b|\bLANDING\b|\bDOORS\b/.test(text)) {
    return "oooi";
  }
  if (/\bETA\b|ESTIMAT/.test(text)) return "eta";
  if (pos.lat !== undefined && pos.lon !== undefined) return "position";
  if (text.startsWith("POS") || /\bPOSN?\b/.test(text)) return "position";
  if (route.dep || route.dest || /\bRTE\b|FPLAN|FLIGHT PLAN|\bROUTE\b|CLEARED|\bWPT\b/.test(text)) {
    return "route";
  }
  if (/\bFMC\b|PROGRESS|\bPERF\b|\bFUEL\b/.test(text)) return "flight_management";
  return clean.length > 0 ? "operational" : undefined;
}

function summarise(raw: AirframesRaw, category: AcarsCategory): { summary: string; lines: string[] } {
  const clean = cleanText(raw.text ?? "");
  const snippet = clean.length > 90 ? `${clean.slice(0, 90)}…` : clean;
  const pos = positionOf(raw);
  const lines: string[] = [];
  if (pos.lat !== undefined && pos.lon !== undefined) {
    lines.push(`${pos.lat.toFixed(3)}, ${pos.lon.toFixed(3)}${pos.alt !== undefined ? ` · ${pos.alt.toLocaleString()} ft` : ""}`);
  }
  const route = routeOf(raw);
  if (route.dep || route.dest) lines.push(`${route.dep ?? "?"} → ${route.dest ?? "?"}`);
  if (snippet) lines.push(snippet);

  const summaryByCat: Record<AcarsCategory, string> = {
    position: "Position report",
    weather: "Weather / ATIS",
    oooi: "OOOI / flight state",
    eta: "ETA update",
    route: "Route / flight plan",
    flight_management: "Flight management",
    operational: snippet || "Operational message",
    technical: "Technical",
    other: "Message",
  };
  return { summary: summaryByCat[category], lines: lines.slice(0, 3) };
}

/**
 * Map one Airframes record to a provider message correlated to `queriedHex` (the
 * aircraft we asked about). Returns undefined for bare frames with no content.
 * Correlation is by the ICAO-filtered query; registration is asserted (reliable)
 * but callsign is not (ICAO/IATA format differences would cause false conflicts).
 */
export function mapAirframesMessage(raw: AirframesRaw, queriedHex: string): ProviderMessage | undefined {
  const category = categoriseAirframes(raw);
  if (!category) return undefined;
  const { summary, lines } = summarise(raw, category);
  const tail = raw.airframe?.tail ?? undefined;
  return {
    id: `af-${raw.id}`,
    aircraftId: queriedHex.toUpperCase(),
    timestamp: raw.timestamp ?? new Date().toISOString(),
    medium: mediumFrom(raw),
    label: raw.label ?? undefined,
    category,
    decoded: { summary, lines: lines.length ? lines : undefined },
    rawTextAvailable: false, // set by the service where policy permits
    raw: raw.text ?? undefined,
    correlationConfidence: "confirmed", // ICAO-filtered query = strong correlation
    source: "airframes",
    receivingStation: "Airframes feeder network",
    assertedRegistration: tail ?? undefined,
    // Callsign intentionally not asserted (format mismatch would falsely conflict).
  };
}

const AF_BASE = "https://api.airframes.io/v1/messages";
const AF_TIMEOUT_MS = 8000;
const AF_TICK_MS = 2000; // one aircraft fetched per tick -> <= 30 req/min (limit 60)
const AF_PER_HEX_COOLDOWN_MS = 25_000;
const AF_TRACKED_STALE_MS = 15_000; // stop fetching if the app stopped polling us
const AF_SEEN_CAP = 2000;

/**
 * Live Airframes ACARS provider. Airframes exposes a keyless public
 * `/v1/messages` endpoint (60 req/min) that supports `?icao=` filtering, so this
 * round-robins the tracked aircraft on a background timer - one fetch per tick,
 * per-aircraft cooldown - staying well within the rate limit and never blocking
 * the poll loop. Only messages with decodable content are surfaced (§Default
 * Filtering); the display policy (raw gating) is applied later by the service.
 */
export class AirframesAcarsProvider implements AcarsMessageProvider {
  readonly name = "airframes";
  readonly enabled: boolean;

  private tracked: AcarsTracked[] = [];
  private lastTrackedAtMs = 0;
  private readonly perHex = new Map<string, { lastFetchMs: number; lastTs?: string }>();
  private readonly seen = new Set<string>();
  private readonly queue: ProviderMessage[] = [];
  private cursor = 0;
  private rateLimitedUntilMs = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    enabledFlag: boolean,
    private readonly apiKey: string | undefined,
  ) {
    this.enabled = enabledFlag;
  }

  start(): void {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => void this.tick().catch(() => undefined), AF_TICK_MS);
    this.timer.unref();
    log.info("airframes live ACARS provider started", { keyless: !this.apiKey });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  poll(tracked: AcarsTracked[], nowMs: number): ProviderMessage[] {
    this.tracked = tracked;
    this.lastTrackedAtMs = nowMs;
    if (this.queue.length === 0) return [];
    return this.queue.splice(0, this.queue.length);
  }

  /** One background step: fetch the next due aircraft's recent messages. */
  private async tick(): Promise<void> {
    const now = Date.now();
    if (!this.enabled) return;
    if (now - this.lastTrackedAtMs > AF_TRACKED_STALE_MS) return; // app not displaying ACARS
    if (now < this.rateLimitedUntilMs) return;
    const hex = this.nextDueHex(now);
    if (!hex) return;
    this.perHex.set(hex, { ...this.perHex.get(hex), lastFetchMs: now });
    await this.fetchHex(hex);
  }

  private nextDueHex(now: number): string | undefined {
    const hexes = this.tracked.map((t) => t.icaoHex.toUpperCase());
    for (let i = 0; i < hexes.length; i++) {
      const hex = hexes[(this.cursor + i) % hexes.length] as string;
      const state = this.perHex.get(hex);
      if (!state || now - state.lastFetchMs >= AF_PER_HEX_COOLDOWN_MS) {
        this.cursor = (this.cursor + i + 1) % hexes.length;
        return hex;
      }
    }
    return undefined;
  }

  private async fetchHex(hex: string): Promise<void> {
    const state = this.perHex.get(hex);
    const params = new URLSearchParams({ icao: hex, limit: "15" });
    if (state?.lastTs) params.set("since", state.lastTs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${AF_BASE}?${params.toString()}`, {
        headers,
        signal: AbortSignal.timeout(AF_TIMEOUT_MS),
      });
    } catch {
      return; // network hiccup; try again next cooldown
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after")) || 60;
      this.rateLimitedUntilMs = Date.now() + retry * 1000;
      return;
    }
    if (!res.ok) return;

    let list: AirframesRaw[];
    try {
      list = (await res.json()) as AirframesRaw[];
    } catch {
      return;
    }
    if (!Array.isArray(list)) return;

    let newestTs = state?.lastTs;
    for (const raw of list) {
      const id = `af-${raw.id}`;
      if (this.seen.has(id)) continue;
      const mapped = mapAirframesMessage(raw, hex);
      if (mapped) {
        this.seen.add(id);
        this.queue.push(mapped);
      }
      if (raw.timestamp && (!newestTs || raw.timestamp > newestTs)) newestTs = raw.timestamp;
    }
    this.perHex.set(hex, { lastFetchMs: Date.now(), lastTs: newestTs });
    if (this.seen.size > AF_SEEN_CAP) {
      // Trim the dedupe set so it can't grow unbounded.
      for (const v of [...this.seen].slice(0, this.seen.size - AF_SEEN_CAP)) this.seen.delete(v);
    }
  }
}
