/**
 * Aviation context model (FRD v4.0 §35-38, §46-47 - Release 4.3). Adds the
 * "where and in what conditions" layer around a flight: nearby UK airspace,
 * nearest aviation weather (METAR/TAF), an experimental contrail estimate, and a
 * modest military-activity context note.
 *
 * Two spec rules shape this module:
 *   - Airspace/NOTAM data must not depend on fragile scraping (§36); the region
 *     data is a clearly-curated approximation behind a provider seam so a real
 *     NATS AIP dataset can replace it later.
 *   - Military context is CONTEXT ONLY (§37): it may say activity "may be
 *     elevated", never that a specific aircraft is participating in an exercise.
 *
 * This file is pure (geometry + estimates); the server providers fetch the data.
 */

import { haversineDistanceMiles, STATUTE_MILES_PER_NM } from "./geo.js";

// --- Airspace ---------------------------------------------------------------

export type AirspaceType =
  | "CTR" // control zone
  | "CTA" // control area
  | "TMA" // terminal manoeuvring area
  | "MATZ" // military aerodrome traffic zone
  | "ATZ" // aerodrome traffic zone
  | "danger"
  | "restricted"
  | "prohibited";

/** A vertical limit: ground, an altitude in feet, or a flight level. */
export interface VerticalLimit {
  /** Feet above mean sea level; 0 = surface. */
  feet: number;
  label: string; // e.g. "SFC", "3,300 ft", "FL195"
}

export type AirspaceGeometry =
  | { kind: "circle"; lat: number; lon: number; radiusNm: number }
  | { kind: "polygon"; points: [number, number][] };

export interface AirspaceRegion {
  id: string;
  name: string;
  type: AirspaceType;
  /** ICAO airspace class where relevant (A-G). */
  airspaceClass?: string;
  lower: VerticalLimit;
  upper: VerticalLimit;
  geometry: AirspaceGeometry;
  note?: string;
  /** Where the data came from, e.g. "curated" or "NATS AIP". */
  source: string;
}

export interface AirspaceMembership {
  region: AirspaceRegion;
  /**
   * True when the aircraft's altitude falls inside the region's vertical band.
   * When altitude is unknown this is undefined (horizontal match only).
   */
  verticalMatch?: boolean;
}

/** Ray-casting point-in-polygon (lat/lon treated as planar for small areas). */
function pointInPolygon(lat: number, lon: number, points: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lonI] = points[i]!;
    const [latJ, lonJ] = points[j]!;
    const intersect =
      lonI > lon !== lonJ > lon &&
      lat < ((latJ - latI) * (lon - lonI)) / (lonJ - lonI) + latI;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** True when a ground position lies within the region's horizontal footprint. */
export function pointInRegion(lat: number, lon: number, region: AirspaceRegion): boolean {
  const g = region.geometry;
  if (g.kind === "circle") {
    const radiusMiles = g.radiusNm * STATUTE_MILES_PER_NM;
    return haversineDistanceMiles(lat, lon, g.lat, g.lon) <= radiusMiles;
  }
  return pointInPolygon(lat, lon, g.points);
}

/** Whether an altitude (ft MSL) sits within a region's vertical band. */
export function withinVertical(altitudeFeet: number, region: AirspaceRegion): boolean {
  return altitudeFeet >= region.lower.feet && altitudeFeet <= region.upper.feet;
}

/** All regions containing a point, with a vertical-band check when altitude is known. */
export function airspaceForPoint(
  lat: number,
  lon: number,
  altitudeFeet: number | undefined,
  regions: AirspaceRegion[],
): AirspaceMembership[] {
  const out: AirspaceMembership[] = [];
  for (const region of regions) {
    if (!pointInRegion(lat, lon, region)) continue;
    out.push({
      region,
      verticalMatch: altitudeFeet === undefined ? undefined : withinVertical(altitudeFeet, region),
    });
  }
  return out;
}

// --- Aviation weather (METAR/TAF, §46) --------------------------------------

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";

export interface WeatherReport {
  stationIcao: string;
  stationName?: string;
  latitude: number;
  longitude: number;
  /** Distance from the observer to the reporting station, miles. */
  distanceMiles: number;
  observedAt?: string;
  temperatureC?: number;
  dewpointC?: number;
  windDirectionDeg?: number;
  windSpeedKt?: number;
  visibility?: string;
  cloudSummary?: string;
  flightCategory: FlightCategory;
  rawMetar?: string;
  rawTaf?: string;
}

/** Pick the nearest station to the observer from a set of candidates. */
export function nearestStation<T extends { latitude: number; longitude: number }>(
  observerLat: number,
  observerLon: number,
  stations: T[],
): { station: T; distanceMiles: number } | undefined {
  let best: { station: T; distanceMiles: number } | undefined;
  for (const s of stations) {
    const d = haversineDistanceMiles(observerLat, observerLon, s.latitude, s.longitude);
    if (!best || d < best.distanceMiles) best = { station: s, distanceMiles: d };
  }
  return best;
}

// --- Contrail estimate (experimental, §47) ----------------------------------

export type ContrailLikelihood = "likely" | "possible" | "unlikely" | "unknown";

export interface ContrailEstimate {
  likelihood: ContrailLikelihood;
  altitudeFeet?: number;
  ambientTempC?: number;
  relativeHumidity?: number;
  /** Always frames the result as an estimate (§47). */
  note: string;
}

/** Typical minimum altitude for persistent contrails (feet). */
const CONTRAIL_MIN_ALTITUDE_FT = 26000;

/**
 * Estimate contrail formation from altitude and upper-air conditions (§47). A
 * deliberately simplified heuristic (cold + humid at cruise), explicitly an
 * estimate - not the full Schmidt-Appleman criterion.
 */
export function estimateContrail(
  altitudeFeet: number | undefined,
  ambientTempC: number | undefined,
  relativeHumidity: number | undefined,
): ContrailEstimate {
  if (altitudeFeet === undefined) {
    return { likelihood: "unknown", note: "Altitude unknown - estimate unavailable." };
  }
  if (altitudeFeet < CONTRAIL_MIN_ALTITUDE_FT) {
    return {
      likelihood: "unlikely",
      altitudeFeet,
      note: "Below the altitude where persistent contrails usually form (estimate).",
    };
  }
  if (ambientTempC === undefined || relativeHumidity === undefined) {
    return {
      likelihood: "unknown",
      altitudeFeet,
      note: "Upper-air conditions unavailable - estimate unavailable.",
    };
  }
  let likelihood: ContrailLikelihood = "unlikely";
  if (ambientTempC <= -40 && relativeHumidity >= 60) likelihood = "likely";
  else if (ambientTempC <= -40 && relativeHumidity >= 40) likelihood = "possible";
  else if (ambientTempC <= -37 && relativeHumidity >= 70) likelihood = "possible";
  return {
    likelihood,
    altitudeFeet,
    ambientTempC,
    relativeHumidity,
    note: "Experimental estimate from altitude, temperature and humidity.",
  };
}

// --- Military context (§37-38) ----------------------------------------------

export type MilitaryActivityLevel = "normal" | "possible" | "elevated";

export interface MilitaryContext {
  level: MilitaryActivityLevel;
  /** Context-only wording; never asserts participation (§37). */
  note: string;
  source: string;
}

// --- Combined observer-level context ---------------------------------------

export interface AviationContext {
  generatedAt: string;
  weather?: WeatherReport;
  /** Airspace regions containing the observer's own position. */
  airspaceAtObserver: AirspaceRegion[];
  military?: MilitaryContext;
}

/** Per-aircraft aviation context for the details drawer. */
export interface AircraftAviationContext {
  airspace: AirspaceMembership[];
  contrail: ContrailEstimate;
}
