/**
 * Geographic helpers (FRD §14, §48-51, §73).
 *
 * The display is a geographic projection, NOT a map (FRD §27). These pure
 * functions are shared by the backend (distance/radius filtering) and the
 * frontend (screen projection), and are covered by unit tests (FRD §90).
 */

export const EARTH_RADIUS_MILES = 3958.7613;

/** 1 nautical mile in statute miles. */
export const STATUTE_MILES_PER_NM = 1.150779448;

/** Extra source margin so boundary aircraft are not lost (FRD §10). */
export const RADIUS_QUERY_MARGIN = 1.05;

export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Convert a user-facing statute-mile radius into the provider's nautical miles. */
export function statuteMilesToNauticalMiles(miles: number): number {
  return miles / STATUTE_MILES_PER_NM;
}

export function nauticalMilesToStatuteMiles(nm: number): number {
  return nm * STATUTE_MILES_PER_NM;
}

/**
 * Provider query radius (nautical miles) for a given user radius (statute miles).
 * Requests a slightly larger area than the exact local filter (FRD §10).
 */
export function providerQueryRadiusNm(radiusMiles: number): number {
  return statuteMilesToNauticalMiles(radiusMiles) * RADIUS_QUERY_MARGIN;
}

/**
 * Great-circle distance in statute miles between two coordinates using the
 * Haversine formula (FRD §14).
 */
export function haversineDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

/**
 * Initial bearing in degrees (0-360, 0 = North, 90 = East) from point 1 to
 * point 2 (FRD §48).
 */
export function bearingDegrees(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

export interface EastNorth {
  /** Miles east of centre (positive = east). */
  east: number;
  /** Miles north of centre (positive = north). */
  north: number;
}

/**
 * Convert a distance + bearing (from centre) into east/north miles (FRD §48):
 *   east  = distance x sin(bearing)
 *   north = distance x cos(bearing)
 */
export function distanceBearingToEastNorth(
  distanceMiles: number,
  bearingFromCentreDegrees: number,
): EastNorth {
  const b = toRadians(bearingFromCentreDegrees);
  return {
    east: distanceMiles * Math.sin(b),
    north: distanceMiles * Math.cos(b),
  };
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Renderer scale: full circular tracking region fits on screen without
 * geographic distortion (FRD §49). Pixels per mile.
 */
export function projectionScale(
  viewportWidth: number,
  viewportHeight: number,
  radiusMiles: number,
): number {
  return Math.min(viewportWidth, viewportHeight) / (2 * radiusMiles);
}

/**
 * Project an east/north offset (miles) to screen coordinates. North = top,
 * East = right (FRD §50). Centre of the projection is the centre of the
 * viewport.
 */
export function projectToScreen(
  eastNorth: EastNorth,
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
): ScreenPoint {
  return {
    x: viewportWidth / 2 + eastNorth.east * scale,
    y: viewportHeight / 2 - eastNorth.north * scale,
  };
}

const COMPASS_POINTS = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
] as const;

export type CompassPoint = (typeof COMPASS_POINTS)[number];

/** Convert a track/heading in degrees to an 8-point compass label (FRD §73). */
export function compassDirection(trackDegrees: number): CompassPoint {
  const normalised = ((trackDegrees % 360) + 360) % 360;
  const index = Math.round(normalised / 45) % 8;
  return COMPASS_POINTS[index] as CompassPoint;
}
