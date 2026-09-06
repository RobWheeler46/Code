/**
 * Sky Insights (FRD v3.8 §55-63, §90-92, §103). The Sky Insights Engine turns
 * the evidence attached to a live object (position, operational flight data,
 * route decision) into short, validated, prioritised statements for the user.
 *
 * Two rules from the spec shape this module:
 *   - Every insight carries CONFIDENCE and its own EVIDENCE ("Why?", §92); a
 *     low-confidence inference is never stated as fact (§121).
 *   - The main display shows at most ONE prominent contextual insight at a time
 *     (§91); everything else stays available in the details drawer / API.
 *
 * This file is pure: `deriveAircraftInsights` maps current evidence to candidate
 * insights, and `pickPrimaryInsight` chooses the single main-screen one. The
 * server InsightsEngine owns lifecycle (create/update/expire) and broadcasting.
 */

import type { Aircraft } from "./aircraft.js";
import type { FlightIntelligence } from "./operations.js";

/**
 * The insight kinds this release supports. A deliberate subset of §55 - only
 * the ones we have real evidence for today (operational + route + behaviour).
 * The remaining §55 types (weather / airport / rarity) arrive with their data
 * sources in later releases.
 */
export type InsightType =
  | "possible.diversion"
  | "likely.landing"
  | "recently.airborne"
  | "flight.landed"
  | "flight.confirmed";

export type InsightSubjectKind = "aircraft" | "satellite";

/** Factual confidence, separate from display priority (§90). */
export type InsightConfidence = "confirmed" | "high" | "medium" | "low";

/** Where an insight is allowed to appear. Main-screen space is scarce (§91). */
export type InsightSurface = "main" | "details";

/** One evidence item behind an insight - a "Why?" bullet with provenance (§60, §92). */
export interface InsightEvidence {
  /** Human source label, e.g. "Airframes", "adsbdb", "ADS-B", "Sky Tracker". */
  source: string;
  /** Plain-language bullet shown under "Why?". */
  detail: string;
  observedAt?: string;
  confidence?: InsightConfidence;
}

/** A validated, scored insight ready for the API, drawer or main display. */
export interface Insight {
  /** Stable key: `${subjectId}:${type}` - lets the engine track lifecycle. */
  id: string;
  type: InsightType;
  subjectKind: InsightSubjectKind;
  /** icaoHex for aircraft, catalogue number for satellites. */
  subjectId: string;
  /** Callsign / registration / hex - what the user sees. */
  subjectLabel: string;
  surface: InsightSurface;
  /** Display priority (§90); higher wins for the single main-screen slot. */
  priority: number;
  confidence: InsightConfidence;
  /** Short heading, e.g. "POSSIBLE ROUTE CHANGE". */
  title: string;
  /** The display block lines under the title. */
  lines: string[];
  /** "Why?" evidence bullets, flattened for convenience (§92). */
  why: string[];
  evidence: InsightEvidence[];
  createdAt: string;
  updatedAt: string;
  /** When this insight should be considered stale, ISO (safety net). */
  expiresAt?: string;
}

/** Default display priority per type, following the §90 suggested scale. */
export function insightPriority(type: InsightType): number {
  switch (type) {
    case "possible.diversion":
      return 80; // an unusual operational event - notable on the main screen
    case "likely.landing":
      return 62; // behaviour explanation (§90: 60 band)
    case "recently.airborne":
      return 58; // behaviour / context
    case "flight.landed":
      return 50; // context, usually details (§58)
    case "flight.confirmed":
      return 45; // context, belongs in details (§56)
    default:
      return 40;
  }
}

/** Where each type is allowed to surface (§56/§58 say some are details-only). */
export function insightSurface(type: InsightType): InsightSurface {
  switch (type) {
    case "possible.diversion":
    case "likely.landing":
    case "recently.airborne":
      return "main";
    case "flight.landed":
    case "flight.confirmed":
      return "details";
    default:
      return "details";
  }
}

/** How long an insight stays valid without fresh confirmation (ms). */
export function insightTtlMs(type: InsightType): number {
  switch (type) {
    case "possible.diversion":
      return 5 * 60_000;
    case "likely.landing":
      return 2 * 60_000;
    case "recently.airborne":
      return 12 * 60_000;
    case "flight.landed":
      return 10 * 60_000;
    case "flight.confirmed":
      return 5 * 60_000;
    default:
      return 5 * 60_000;
  }
}

const CONFIDENCE_RANK: Record<InsightConfidence, number> = {
  confirmed: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function confidenceRank(c: InsightConfidence): number {
  return CONFIDENCE_RANK[c];
}

/**
 * Choose the single most useful main-screen insight (§91). Ranked by priority,
 * then confidence, then recency. Details-only insights never take the slot.
 */
export function pickPrimaryInsight(insights: Insight[]): Insight | undefined {
  const eligible = insights.filter((i) => i.surface === "main");
  if (eligible.length === 0) return undefined;
  return [...eligible].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    const cr = confidenceRank(b.confidence) - confidenceRank(a.confidence);
    if (cr !== 0) return cr;
    return b.updatedAt.localeCompare(a.updatedAt);
  })[0];
}

/** Inputs the engine feeds the pure derivation for one aircraft. */
export interface AircraftInsightInput {
  aircraft: Aircraft;
  /** Operational enrichment (OOOI / state / ETA / diversion), if available. */
  flight?: FlightIntelligence;
  /** How long the aircraft has been descending continuously, ms (0 = not). */
  descentForMs?: number;
  nowMs: number;
}

function subjectLabel(a: Aircraft): string {
  return a.callsign?.trim() || a.registration || a.icaoHex;
}

function minutesAgo(iso: string, nowMs: number): number {
  return Math.round((nowMs - Date.parse(iso)) / 60_000);
}

/**
 * Derive candidate insights for one aircraft from its current evidence (§56-59,
 * §92). Pure and deterministic; the engine stamps lifecycle and reconciles.
 */
export function deriveAircraftInsights(input: AircraftInsightInput): Insight[] {
  const { aircraft, flight, descentForMs = 0, nowMs } = input;
  const iso = new Date(nowMs).toISOString();
  const label = subjectLabel(aircraft);
  const out: Insight[] = [];

  const make = (
    type: InsightType,
    confidence: InsightConfidence,
    title: string,
    lines: string[],
    evidence: InsightEvidence[],
  ): Insight => ({
    id: `${aircraft.icaoHex}:${type}`,
    type,
    subjectKind: "aircraft",
    subjectId: aircraft.icaoHex,
    subjectLabel: label,
    surface: insightSurface(type),
    priority: insightPriority(type),
    confidence,
    title,
    lines,
    why: evidence.map((e) => e.detail),
    evidence,
    createdAt: iso,
    updatedAt: iso,
    expiresAt: new Date(nowMs + insightTtlMs(type)).toISOString(),
  });

  // --- Possible route change / diversion (§43, §59, §62) ---
  const prc = flight?.possibleRouteChange;
  if (prc) {
    const confidence: InsightConfidence =
      prc.confidence === "confirmed" ? "confirmed" : prc.confidence === "likely" ? "high" : "medium";
    out.push(
      make(
        "possible.diversion",
        confidence,
        "POSSIBLE ROUTE CHANGE",
        [label, `${prc.previousDestination} → ${prc.newDestination}`],
        [
          { source: "adsbdb", detail: `Filed destination ${prc.previousDestination}` },
          { source: "Airframes", detail: `Evidence now points to ${prc.newDestination}` },
          { source: "Sky Tracker", detail: `Assessed confidence: ${prc.confidence}` },
        ],
      ),
    );
  }

  // --- Recently airborne (§57): a fresh OFF event on the current flight ---
  const off = flight?.oooi?.off;
  const airborne = aircraft.onGround !== true;
  if (off && airborne) {
    const mins = minutesAgo(off, nowMs);
    if (mins >= 0 && mins <= 12) {
      const origin = flight?.origin;
      out.push(
        make(
          "recently.airborne",
          origin ? "high" : "medium",
          "RECENTLY AIRBORNE",
          [label, origin ? `Departed ${origin}` : "Just departed", `${mins} minute${mins === 1 ? "" : "s"} ago`],
          [
            { source: "Airframes", detail: `Airborne ${mins} minute${mins === 1 ? "" : "s"} ago`, observedAt: off },
            ...(origin ? [{ source: "Airframes", detail: `Origin ${origin}` }] : []),
            { source: "ADS-B", detail: "Currently airborne and tracked" },
          ],
        ),
      );
    }
  }

  // --- Likely landing (§92): a sustained low-altitude descent ---
  const vr = aircraft.verticalRateFpm ?? 0;
  const alt = aircraft.altitudeFeet;
  if (
    airborne &&
    vr < -400 &&
    descentForMs >= 4 * 60_000 &&
    typeof alt === "number" &&
    alt < 8000
  ) {
    const descMins = Math.round(descentForMs / 60_000);
    const strong = descentForMs >= 6 * 60_000 && alt < 5000;
    const dest = flight?.destination ?? aircraft.destination?.displayName;
    out.push(
      make(
        "likely.landing",
        strong ? "high" : "medium",
        "LIKELY LANDING",
        [label, ...(dest ? [`Approaching ${dest}`] : []), `${alt.toLocaleString()} ft and descending`],
        [
          { source: "ADS-B", detail: `Descending for ${descMins} minute${descMins === 1 ? "" : "s"}` },
          { source: "ADS-B", detail: `Descent rate about ${Math.abs(Math.round(vr))} ft/min` },
          { source: "ADS-B", detail: `Altitude ${alt.toLocaleString()} ft` },
          ...(dest ? [{ source: "adsbdb", detail: `Bound for ${dest}` }] : []),
        ],
      ),
    );
  }

  // --- Landed (§58): recent ON evidence, valid flight identity ---
  if (flight && (flight.flightState === "landed" || flight.flightState === "arrived")) {
    const dest = flight.destination ?? aircraft.destination?.displayName;
    out.push(
      make(
        "flight.landed",
        "high",
        "LANDED",
        [label, ...(dest ? [dest] : [])],
        [
          { source: "Airframes", detail: "Landing (ON) event received", observedAt: flight.oooi?.on },
          ...(dest ? [{ source: "adsbdb", detail: `Destination ${dest}` }] : []),
        ],
      ),
    );
  }

  // --- Flight confirmed (§56): aircraft + flight + route identity all agree ---
  if (
    flight &&
    flight.available &&
    flight.routeConfidence === "confirmed" &&
    flight.origin &&
    flight.destination
  ) {
    out.push(
      make(
        "flight.confirmed",
        "confirmed",
        "FLIGHT CONFIRMED",
        [label, ...(flight.callsign ? [flight.callsign] : []), `${flight.origin} → ${flight.destination}`],
        [
          { source: "ADS-B", detail: "Aircraft identity from Mode S / ADS-B" },
          { source: "Airframes", detail: "Flight identity corroborated" },
          {
            source: "Sky Tracker",
            detail: `Route confidence: confirmed (${flight.sources.join(", ")})`,
          },
        ],
      ),
    );
  }

  return out;
}
