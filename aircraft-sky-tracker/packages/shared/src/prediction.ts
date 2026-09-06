/**
 * Look Now prediction engine (FRD v4.0 §16-19). Answers "what is likely to enter
 * my sky shortly?" by projecting each approaching aircraft's closest point of
 * approach (CPA) to the observer from its current position, ground track, ground
 * speed and vertical rate, then rating how much to trust that projection (§18).
 *
 * Pure and deterministic. Distances involved (<= a ~40 mi prediction radius) are
 * small enough for a flat local-plane (equirectangular) model around the observer.
 */

import { EARTH_RADIUS_MILES, toRadians, toDegrees, compassDirection } from "./geo.js";

/** Miles per degree of latitude (also longitude after cos-scaling). */
const MILES_PER_DEGREE = (EARTH_RADIUS_MILES * Math.PI) / 180;
/** 1 knot in miles per hour. */
const KNOTS_TO_MPH = 1.150779448;

export type PredictionConfidence = "high" | "medium" | "low";

export interface ApproachObserver {
  latitude: number;
  longitude: number;
}

export interface ApproachInput {
  latitude: number;
  longitude: number;
  altitudeFeet?: number;
  groundSpeedKnots?: number;
  trackDegrees?: number;
  verticalRateFpm?: number;
}

export interface ClosestApproach {
  /** Seconds until the closest point (>= 0). */
  timeToClosestSeconds: number;
  /** Predicted horizontal (ground) distance at closest point, miles. */
  horizontalDistanceMiles: number;
  /** Predicted straight-line (slant) range at closest point, miles. */
  slantRangeMiles: number;
  /** Predicted elevation angle above the horizon at closest point, degrees. */
  elevationDeg: number;
  /** Predicted altitude at closest point, feet (when altitude is known). */
  altitudeFeet?: number;
  /** Bearing from the observer to the closest point - where to look, degrees. */
  lookBearingDeg: number;
  /** Compass label for `lookBearingDeg`, e.g. "West". */
  lookCompass: string;
}

/** Local east/north offset (miles) of a point from the observer. */
function eastNorthMiles(observer: ApproachObserver, lat: number, lon: number): {
  east: number;
  north: number;
} {
  const east = (lon - observer.longitude) * MILES_PER_DEGREE * Math.cos(toRadians(observer.latitude));
  const north = (lat - observer.latitude) * MILES_PER_DEGREE;
  return { east, north };
}

const COMPASS_LONG: Record<string, string> = {
  N: "North",
  NE: "North-east",
  E: "East",
  SE: "South-east",
  S: "South",
  SW: "South-west",
  W: "West",
  NW: "North-west",
};

/**
 * Project the closest point of approach of an aircraft to the observer (§17).
 * Returns undefined when the aircraft lacks the motion needed to project, is
 * stationary, or is already moving away (its closest point is in the past).
 */
export function predictClosestApproach(
  observer: ApproachObserver,
  aircraft: ApproachInput,
  _nowMs?: number,
): ClosestApproach | undefined {
  const { groundSpeedKnots, trackDegrees } = aircraft;
  if (
    groundSpeedKnots === undefined ||
    trackDegrees === undefined ||
    groundSpeedKnots <= 0
  ) {
    return undefined;
  }

  const p = eastNorthMiles(observer, aircraft.latitude, aircraft.longitude);
  const speedMph = groundSpeedKnots * KNOTS_TO_MPH;
  const trackRad = toRadians(trackDegrees);
  // Velocity components (miles per hour): track 0 = North, 90 = East.
  const vEast = speedMph * Math.sin(trackRad);
  const vNorth = speedMph * Math.cos(trackRad);

  const vv = vEast * vEast + vNorth * vNorth;
  if (vv === 0) return undefined;
  const pv = p.east * vEast + p.north * vNorth;
  // Time (hours) to the closest point; negative => already receding.
  const tHours = -pv / vv;
  if (tHours <= 0) return undefined;

  const cEast = p.east + vEast * tHours;
  const cNorth = p.north + vNorth * tHours;
  const horizontal = Math.hypot(cEast, cNorth);

  let altitudeFeet: number | undefined;
  if (aircraft.altitudeFeet !== undefined) {
    const drift = (aircraft.verticalRateFpm ?? 0) * (tHours * 60);
    altitudeFeet = Math.max(0, Math.round(aircraft.altitudeFeet + drift));
  }
  const altMiles = (altitudeFeet ?? 0) / 5280;
  const slant = Math.hypot(horizontal, altMiles);
  const elevation = toDegrees(Math.atan2(altMiles, horizontal));
  const lookBearing = (toDegrees(Math.atan2(cEast, cNorth)) + 360) % 360;
  const compass = compassDirection(lookBearing);

  return {
    timeToClosestSeconds: Math.round(tHours * 3600),
    horizontalDistanceMiles: Math.round(horizontal * 100) / 100,
    slantRangeMiles: Math.round(slant * 100) / 100,
    elevationDeg: Math.round(elevation),
    altitudeFeet,
    lookBearingDeg: Math.round(lookBearing),
    lookCompass: COMPASS_LONG[compass] ?? compass,
  };
}

export interface ConfidenceInput {
  /** Spread of recent ground-track values, degrees (0 = dead straight). */
  trackSpreadDeg: number;
  verticalRateFpm?: number;
  positionAgeSeconds: number;
  /** How far ahead the projection reaches, seconds (further = less certain). */
  timeToClosestSeconds: number;
}

/**
 * Rate how much to trust a projection (§18). Confidence falls when the aircraft
 * is turning, climbing/descending hard, its position is stale, or the projection
 * reaches a long way ahead. Alerts must never imply certainty (§18).
 */
export function assessPredictionConfidence(input: ConfidenceInput): PredictionConfidence {
  const { trackSpreadDeg, verticalRateFpm = 0, positionAgeSeconds, timeToClosestSeconds } = input;
  // Stale position is the hardest limiter.
  if (positionAgeSeconds > 30) return "low";
  // Sustained turning => the projected path is unreliable.
  if (trackSpreadDeg > 25) return "low";
  if (timeToClosestSeconds > 12 * 60) return "low";

  let medium = false;
  if (positionAgeSeconds > 15) medium = true;
  if (trackSpreadDeg > 12) medium = true;
  if (Math.abs(verticalRateFpm) > 2000) medium = true;
  if (timeToClosestSeconds > 7 * 60) medium = true;

  return medium ? "medium" : "high";
}

/** A full Look Now prediction for one aircraft (engine output, §16-17). */
export interface LookNowPrediction {
  icaoHex: string;
  label: string;
  /** Short type/interest tag for the alert headline, e.g. "Military", "A380". */
  tag?: string;
  currentDistanceMiles: number;
  approach: ClosestApproach;
  confidence: PredictionConfidence;
}
