/**
 * Route confidence engine (FRD v3.0 §28-40).
 *
 * Pure scoring logic: assess whether route evidence actually relates to the
 * tracked aircraft (the identity gate), score the evidence 0-100, and classify
 * it. A numerical route score never overrides a hard aircraft-identity conflict
 * (FRD §32). Route evidence is supplementary and never moves an aircraft icon
 * (FRD §11) - it only decides what destination (if any) to show.
 */

import type { RouteConfidence } from "@ast/shared";
import { bearingDegrees } from "@ast/shared";

export type IdentityState = "confirmed" | "strong" | "weak" | "rejected";

export interface TrackedIdentity {
  icaoHex: string;
  registration?: string;
  callsign?: string;
  trackDegrees?: number;
  latitude?: number;
  longitude?: number;
}

/** One piece of route evidence from a flight-intelligence source. */
export interface RouteEvidence {
  source: string;
  /** Identity the source associates with the route, for conflict detection. */
  aircraftIcaoHex?: string;
  aircraftRegistration?: string;
  callsign?: string;
  destinationName?: string;
  destinationIata?: string;
  destinationIcao?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  originName?: string;
  originIata?: string;
  originIcao?: string;
  airline?: string;
  hasActiveFlight?: boolean;
  hasOooi?: boolean;
  evidenceAgeMinutes?: number;
  clearlyPreviousFlight?: boolean;
}

export interface RouteDecision {
  classification: RouteConfidence;
  identity: IdentityState;
  score: number;
  conflict: boolean;
  sources: string[];
  destination?: {
    name: string;
    iata?: string;
    icao?: string;
    latitude?: number;
    longitude?: number;
  };
  origin?: { name?: string; iata?: string; icao?: string };
  airline?: string;
}

function normId(v: string | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hasDestination(ev: RouteEvidence): boolean {
  return Boolean(ev.destinationName || ev.destinationIcao || ev.destinationIata);
}

function destKey(ev: RouteEvidence): string {
  return normId(ev.destinationIcao || ev.destinationIata || ev.destinationName);
}

function angularDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/** Assess whether one piece of evidence relates to the tracked aircraft (§28-32). */
export function assessIdentity(tracked: TrackedIdentity, ev: RouteEvidence): IdentityState {
  const icaoExact =
    Boolean(ev.aircraftIcaoHex) && normId(ev.aircraftIcaoHex) === normId(tracked.icaoHex);
  const regExact =
    Boolean(ev.aircraftRegistration) &&
    Boolean(tracked.registration) &&
    normId(ev.aircraftRegistration) === normId(tracked.registration);
  const callsignExact =
    Boolean(ev.callsign) &&
    Boolean(tracked.callsign) &&
    normId(ev.callsign) === normId(tracked.callsign);

  // Hard conflicts reject the evidence outright (§32, §34).
  if (ev.aircraftIcaoHex && !icaoExact) return "rejected";
  if (ev.aircraftRegistration && tracked.registration && !regExact) return "rejected";
  if (ev.clearlyPreviousFlight) return "rejected";

  if (icaoExact || (regExact && callsignExact)) return "confirmed"; // §29
  if (regExact || (callsignExact && ev.hasActiveFlight)) return "strong"; // §30
  if (callsignExact) return "weak"; // §31
  return "weak";
}

const IDENTITY_RANK: Record<IdentityState, number> = {
  rejected: 0,
  weak: 1,
  strong: 2,
  confirmed: 3,
};

/** Recency adjustment based on the freshest supporting evidence (§34). */
function recencyScore(ageMinutes: number | undefined): number {
  if (ageMinutes === undefined) return 0;
  if (ageMinutes <= 30) return 10;
  if (ageMinutes <= 120) return 5;
  if (ageMinutes <= 360) return 0;
  return -20;
}

/** Geographic plausibility: aircraft track vs bearing to destination (§40). */
function plausibilityScore(
  tracked: TrackedIdentity,
  dest: { latitude?: number; longitude?: number },
): number {
  if (
    tracked.trackDegrees === undefined ||
    tracked.latitude === undefined ||
    tracked.longitude === undefined ||
    dest.latitude === undefined ||
    dest.longitude === undefined
  ) {
    return 0;
  }
  const bearing = bearingDegrees(tracked.latitude, tracked.longitude, dest.latitude, dest.longitude);
  const diff = angularDiff(tracked.trackDegrees, bearing);
  if (diff <= 90) return 5;
  if (diff <= 135) return 0;
  return -10;
}

/** Classify a score into a route confidence band (FRD §35). */
export function classify(
  score: number,
  identity: IdentityState,
  agreeingSources: number,
  conflict: boolean,
  routePresent: boolean,
): RouteConfidence {
  if (!routePresent || identity === "rejected") return "unknown";
  if (conflict) return "low"; // material conflict (§35, §37)
  if (score >= 85 && agreeingSources >= 2) return "confirmed";
  if (score >= 75) return "high";
  if (score >= 60) return "medium";
  return "low";
}

/**
 * Decide the route for a tracked aircraft from a set of evidence (FRD §28-40).
 */
export function decideRoute(
  tracked: TrackedIdentity,
  evidences: RouteEvidence[],
): RouteDecision {
  const assessed = evidences.map((ev) => ({ ev, id: assessIdentity(tracked, ev) }));
  const accepted = assessed.filter((a) => a.id !== "rejected");
  const anyRejected = assessed.some((a) => a.id === "rejected");
  const withDest = accepted.filter((a) => hasDestination(a.ev));
  const sources = [...new Set(accepted.map((a) => a.ev.source))];

  if (withDest.length === 0) {
    return {
      classification: "unknown",
      identity: anyRejected && accepted.length === 0 ? "rejected" : (bestIdentity(accepted) ?? "weak"),
      score: 0,
      conflict: false,
      sources,
    };
  }

  const identity = bestIdentity(withDest) ?? "weak";

  // Group supporting evidence by destination; a destination agreed by two or
  // more distinct sources is stronger (§33 provider agreement, §35 Confirmed).
  const byDest = new Map<string, typeof withDest>();
  for (const item of withDest) {
    const key = destKey(item.ev);
    const list = byDest.get(key) ?? [];
    list.push(item);
    byDest.set(key, list);
  }
  const primaryKey = [...byDest.entries()].sort(
    (a, b) => distinctSources(b[1]) - distinctSources(a[1]),
  )[0]?.[0] as string;
  const primary = byDest.get(primaryKey) as typeof withDest;
  const agreeingSources = distinctSources(primary);

  // Conflict: two or more distinct sources report different destinations (§37).
  const conflict = new Set(accepted.map((a) => a.ev.source)).size >= 2 && byDest.size >= 2;

  const primaryEv = primary[0]?.ev as RouteEvidence;

  // Identity contribution, capped at 40 (§33).
  let identityPts = 0;
  if (withDest.some((a) => a.ev.aircraftIcaoHex && normId(a.ev.aircraftIcaoHex) === normId(tracked.icaoHex))) {
    identityPts += 25;
  }
  if (
    tracked.registration &&
    withDest.some((a) => a.ev.aircraftRegistration && normId(a.ev.aircraftRegistration) === normId(tracked.registration))
  ) {
    identityPts += 20;
  }
  if (
    tracked.callsign &&
    withDest.some((a) => a.ev.callsign && normId(a.ev.callsign) === normId(tracked.callsign))
  ) {
    identityPts += 20;
  }
  identityPts = Math.min(identityPts, 40);

  let score = identityPts;
  score += 25; // explicit destination present
  if (primary.some((a) => a.ev.originName || a.ev.originIcao || a.ev.originIata)) score += 10;
  if (accepted.some((a) => a.ev.hasActiveFlight)) score += 10;
  if (accepted.some((a) => a.ev.hasOooi)) score += 5;
  if (agreeingSources >= 2) score += 10;
  score += plausibilityScore(tracked, {
    latitude: primaryEv.destinationLatitude,
    longitude: primaryEv.destinationLongitude,
  });
  const freshest = Math.min(
    ...primary.map((a) => a.ev.evidenceAgeMinutes ?? Number.POSITIVE_INFINITY),
  );
  score += recencyScore(Number.isFinite(freshest) ? freshest : undefined);
  score = Math.max(0, Math.min(100, score));

  const classification = classify(score, identity, agreeingSources, conflict, true);

  return {
    classification,
    identity,
    score,
    conflict,
    sources,
    destination: {
      name: primaryEv.destinationName ?? primaryEv.destinationIcao ?? primaryEv.destinationIata ?? "",
      iata: primaryEv.destinationIata,
      icao: primaryEv.destinationIcao,
      latitude: primaryEv.destinationLatitude,
      longitude: primaryEv.destinationLongitude,
    },
    origin: {
      name: primaryEv.originName,
      iata: primaryEv.originIata,
      icao: primaryEv.originIcao,
    },
    airline: primaryEv.airline,
  };
}

function distinctSources(list: { ev: RouteEvidence }[]): number {
  return new Set(list.map((a) => a.ev.source)).size;
}

function bestIdentity(list: { id: IdentityState }[]): IdentityState | undefined {
  let best: IdentityState | undefined;
  for (const item of list) {
    if (item.id === "rejected") continue;
    if (!best || IDENTITY_RANK[item.id] > IDENTITY_RANK[best]) best = item.id;
  }
  return best;
}
