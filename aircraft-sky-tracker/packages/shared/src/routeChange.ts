/**
 * History-based route-change detection (FRD v3.8 §43-44, §59). Turns a short
 * per-aircraft history of positions and resolved-destination decisions into a
 * route-change assessment, so a diversion is backed by real trajectory evidence
 * rather than a single provider field.
 *
 * Three ways a change is recognised, per §43-44:
 *   - decision:    the resolved destination airport changed from a previously
 *                  well-established one to a different established one (§59);
 *   - operational: a provider (Airframes) reports a changed destination, which
 *                  the geometry can corroborate to lift confidence (§44 "likely
 *                  = strong operational evidence plus geographic movement");
 *   - divergence:  the aircraft is sustainedly tracking AWAY from its filed
 *                  destination (geometry only -> capped at "possible", §44).
 *
 * Pure and deterministic; the engine owns the history buffer and calls this.
 */

import type { RouteConfidence } from "./aircraft.js";
import type { DiversionConfidence, PossibleRouteChange } from "./operations.js";
import { haversineDistanceMiles, bearingDegrees } from "./geo.js";

/** One observation of an aircraft: where it was and what route we believed. */
export interface RouteChangeSample {
  t: number;
  lat: number;
  lon: number;
  track?: number;
  /** Resolved destination airport identity + coords, when known. */
  destIcao?: string;
  destName?: string;
  destLat?: number;
  destLon?: number;
  destConfidence: RouteConfidence;
  /** Route-decision sources, e.g. ["adsbdb"] / ["airframes","adsbdb"]. */
  sources: string[];
}

export type RouteChangeKind = "decision" | "operational" | "divergence";

export interface RouteChangeAssessment {
  previousDestination: string;
  /** Empty when geometry alone cannot name the new destination. */
  newDestination: string;
  confidence: DiversionConfidence;
  kind: RouteChangeKind;
  evidence: string[];
}

export interface RouteChangeInput {
  current: RouteChangeSample;
  /** Older samples, oldest-first, excluding `current`. */
  history: RouteChangeSample[];
  /** A provider-reported change (Airframes), if any. */
  operational?: PossibleRouteChange;
  nowMs: number;
}

const WINDOW_MS = 15 * 60_000;
const MIN_ESTABLISHED = 3;
const MIN_SPAN_MS = 120_000;
const DIVERGE_DEG = 60;
const STRONG_DIVERGE_DEG = 90;
const TURN_SPREAD_DEG = 45;
const SUSTAINED_MS = 3 * 60_000;
const STRONG_SUSTAINED_MS = 5 * 60_000;
const MIN_DISTANCE_INCREASE_MILES = 3;

/** Smallest angle between two bearings, 0..180. */
function angularDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

interface Established {
  icao: string;
  name: string;
  lat?: number;
  lon?: number;
}

/** The dominant, well-established destination across the given samples. */
function establishedDest(samples: RouteChangeSample[]): Established | undefined {
  const byIcao = new Map<string, RouteChangeSample[]>();
  for (const s of samples) {
    if (!s.destIcao) continue;
    const list = byIcao.get(s.destIcao) ?? [];
    list.push(s);
    byIcao.set(s.destIcao, list);
  }
  let best: Established | undefined;
  let bestCount = 0;
  for (const [icao, list] of byIcao) {
    const span = list[list.length - 1]!.t - list[0]!.t;
    if (list.length >= MIN_ESTABLISHED && span >= MIN_SPAN_MS && list.length > bestCount) {
      bestCount = list.length;
      const withCoords = list.find((s) => s.destLat !== undefined && s.destLon !== undefined);
      best = {
        icao,
        name: list[list.length - 1]!.destName ?? icao,
        lat: withCoords?.destLat,
        lon: withCoords?.destLon,
      };
    }
  }
  return best;
}

/** Net change in distance-to-point across the positioned samples (miles). */
function distanceTrendMiles(
  samples: RouteChangeSample[],
  lat: number,
  lon: number,
): number | undefined {
  const positioned = samples.filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  if (positioned.length < 2) return undefined;
  const first = positioned[0]!;
  const last = positioned[positioned.length - 1]!;
  return (
    haversineDistanceMiles(last.lat, last.lon, lat, lon) -
    haversineDistanceMiles(first.lat, first.lon, lat, lon)
  );
}

/** Distinct route-decision sources across the samples. */
function distinctSources(samples: RouteChangeSample[]): Set<string> {
  const set = new Set<string>();
  for (const s of samples) for (const src of s.sources) set.add(src);
  return set;
}

function confidenceToDiversion(operational?: PossibleRouteChange): DiversionConfidence | undefined {
  return operational?.confidence;
}

/**
 * Assess whether an aircraft's route has changed, backed by its recent history.
 * Returns the single strongest assessment, or undefined when nothing fires.
 */
export function assessRouteChange(input: RouteChangeInput): RouteChangeAssessment | undefined {
  const { current, operational, nowMs } = input;
  const window = [...input.history, current].filter((s) => nowMs - s.t <= WINDOW_MS);
  const prior = window.filter((s) => s.t < current.t);

  // --- Operational report, optionally corroborated by geometry (§44) ---
  if (operational) {
    let confidence = confidenceToDiversion(operational)!;
    const evidence = [
      `Filed destination ${operational.previousDestination}`,
      `Provider evidence now points to ${operational.newDestination}`,
    ];
    const priorDest = establishedDest(prior);
    if (
      priorDest?.lat !== undefined &&
      priorDest.lon !== undefined &&
      priorDest.name.toLowerCase() === operational.previousDestination.toLowerCase()
    ) {
      const trend = distanceTrendMiles(window, priorDest.lat, priorDest.lon);
      if (trend !== undefined && trend > MIN_DISTANCE_INCREASE_MILES) {
        // Geographic movement supports the change -> lift "possible" to "likely".
        if (confidence === "possible") confidence = "likely";
        evidence.push(`Moving away from ${priorDest.name} (${Math.round(trend)} mi further)`);
      }
    }
    return {
      previousDestination: operational.previousDestination,
      newDestination: operational.newDestination,
      confidence,
      kind: "operational",
      evidence,
    };
  }

  // --- Decision change: the resolved destination airport changed (§59) ---
  const priorDest = establishedDest(prior);
  if (
    priorDest &&
    current.destIcao &&
    current.destIcao !== priorDest.icao &&
    current.destConfidence !== "unknown" &&
    current.destConfidence !== "low"
  ) {
    const currentName = current.destName ?? current.destIcao;
    const sources = distinctSources(window.filter((s) => s.destIcao === current.destIcao));
    let confidence: DiversionConfidence = "possible";
    const evidence = [
      `Destination was ${priorDest.name}`,
      `Now assessed as ${currentName}`,
    ];
    // Geographic movement toward the new destination raises confidence (§44).
    let geoSupports = false;
    if (current.destLat !== undefined && current.destLon !== undefined) {
      const trend = distanceTrendMiles(window, current.destLat, current.destLon);
      if (trend !== undefined && trend < -MIN_DISTANCE_INCREASE_MILES) {
        geoSupports = true;
        evidence.push(`Now closing on ${currentName} (${Math.round(-trend)} mi nearer)`);
      }
    }
    if (sources.size >= 2 || current.destConfidence === "confirmed") {
      confidence = "confirmed";
      evidence.push(`Corroborated by ${[...sources].join(", ") || "the route engine"}`);
    } else if (geoSupports || current.destConfidence === "high") {
      confidence = "likely";
    }
    return {
      previousDestination: priorDest.name,
      newDestination: currentName,
      confidence,
      kind: "decision",
      evidence,
    };
  }

  // --- Geometric divergence: sustainedly tracking away from filed dest (§43) ---
  const filed = establishedDest(window);
  if (
    filed?.lat !== undefined &&
    filed.lon !== undefined &&
    current.track !== undefined &&
    Number.isFinite(current.lat)
  ) {
    const positioned = window.filter((s) => s.track !== undefined);
    const span = positioned.length
      ? current.t - positioned[0]!.t
      : 0;
    // Skip while manoeuvring: a wide track spread means turning, not diverting (§44).
    const spread = Math.max(
      0,
      ...positioned.map((s) => angularDiff(s.track!, current.track!)),
    );
    const bearingToDest = bearingDegrees(current.lat, current.lon, filed.lat, filed.lon);
    const deviation = angularDiff(current.track, bearingToDest);
    const trend = distanceTrendMiles(window, filed.lat, filed.lon);
    if (
      spread <= TURN_SPREAD_DEG &&
      deviation >= DIVERGE_DEG &&
      trend !== undefined &&
      trend > MIN_DISTANCE_INCREASE_MILES &&
      span >= SUSTAINED_MS
    ) {
      const strong =
        deviation >= STRONG_DIVERGE_DEG && span >= STRONG_SUSTAINED_MS;
      return {
        previousDestination: filed.name,
        newDestination: "",
        // Geometry alone is capped at "possible" (§44 needs corroboration).
        confidence: "possible",
        kind: "divergence",
        evidence: [
          `Tracking away from ${filed.name}`,
          `Heading ${Math.round(current.track)}°, bearing to ${filed.name} ${Math.round(bearingToDest)}°`,
          `Diverging for ${Math.round(span / 60_000)} min (${Math.round(trend)} mi further)`,
          ...(strong ? ["Sustained large deviation"] : []),
        ],
      };
    }
  }

  return undefined;
}
