/**
 * Simulated satellites for offline UI testing (FRD v3.2 §84). Includes the ISS,
 * a bright satellite, a Starlink, one below the elevation threshold, and one
 * above the horizon but not currently visible.
 */

import { type Satellite, compassDirection } from "@ast/shared";

interface SimSpec {
  catalogNumber: string;
  name: string;
  category: Satellite["category"];
  altitudeKm: number;
  /** Elevation baseline + oscillation, and azimuth drift, over time. */
  elBase: number;
  elAmp: number;
  azRateDegPerSec: number;
  azOffset: number;
  illuminated: boolean;
}

const SIM: SimSpec[] = [
  { catalogNumber: "25544", name: "ISS", category: "station", altitudeKm: 419, elBase: 55, elAmp: 25, azRateDegPerSec: 1.2, azOffset: 210, illuminated: true },
  { catalogNumber: "20580", name: "HST", category: "bright", altitudeKm: 540, elBase: 35, elAmp: 15, azRateDegPerSec: 0.9, azOffset: 60, illuminated: true },
  { catalogNumber: "44238", name: "STARLINK-1007", category: "starlink", altitudeKm: 550, elBase: 28, elAmp: 10, azRateDegPerSec: 1.6, azOffset: 300, illuminated: true },
  { catalogNumber: "48274", name: "COSMOS 2251", category: "bright", altitudeKm: 780, elBase: 9, elAmp: 4, azRateDegPerSec: 0.5, azOffset: 140, illuminated: true },
  { catalogNumber: "25338", name: "NOAA 15", category: "bright", altitudeKm: 810, elBase: 42, elAmp: 8, azRateDegPerSec: 0.7, azOffset: 20, illuminated: false },
];

function azEl(spec: SimSpec, tSec: number): { az: number; el: number } {
  return {
    az: ((spec.azOffset + spec.azRateDegPerSec * tSec) % 360 + 360) % 360,
    el: spec.elBase + spec.elAmp * Math.sin(tSec / 90 + spec.azOffset),
  };
}

/** Generate the current simulated satellite set (all, pre-filter). */
export function simulationSatellites(now: number, darkSky: boolean): Satellite[] {
  const tSec = now / 1000;
  const iso = new Date(now).toISOString();
  return SIM.map((spec) => {
    const cur = azEl(spec, tSec);
    const next = azEl(spec, tSec + 20);
    const potentiallyVisible = cur.el >= 15 && spec.illuminated && darkSky;
    return {
      catalogNumber: spec.catalogNumber,
      name: spec.name,
      category: spec.category,
      latitude: 51 + Math.sin(tSec / 120) * 5,
      longitude: -2 + Math.cos(tSec / 120) * 8,
      orbitalAltitudeKm: spec.altitudeKm,
      azimuthDegrees: cur.az,
      elevationDegrees: cur.el,
      rangeKm: Math.round(spec.altitudeKm / Math.max(0.1, Math.sin((cur.el * Math.PI) / 180))),
      velocityKmPerSecond: 7.66,
      illuminated: spec.illuminated,
      potentiallyVisible,
      direction: compassDirection(skyBearing(cur, next)),
      dataTimestamp: iso,
    };
  });
}

/** Bearing of apparent motion across the sky (north-up screen). */
export function skyBearing(a: { az: number; el: number }, b: { az: number; el: number }): number {
  const toXy = (p: { az: number; el: number }) => {
    const r = 90 - p.el;
    const rad = (p.az * Math.PI) / 180;
    return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
  };
  const p = toXy(a);
  const q = toXy(b);
  return (Math.atan2(q.x - p.x, -(q.y - p.y)) * 180) / Math.PI;
}
