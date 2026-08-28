/**
 * SGP4 propagation for an observer (FRD v3.2 §41). Wraps satellite.js to turn a
 * satellite record + observer coordinates + time into look angles, sub-satellite
 * point, altitude and velocity. Pure computation - no network.
 */

import * as satellite from "satellite.js";
import { sunEci, type Vec3 } from "./astro.js";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export interface ObserverGd {
  /** Radians. */
  longitude: number;
  /** Radians. */
  latitude: number;
  /** Kilometres. */
  height: number;
}

export interface SatObservation {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  altitudeKm: number;
  subLat: number;
  subLon: number;
  velocityKmPerSec: number;
  eci: Vec3;
}

export function observerFrom(latDeg: number, lonDeg: number, heightKm = 0.05): ObserverGd {
  return {
    longitude: lonDeg * DEG2RAD,
    latitude: latDeg * DEG2RAD,
    height: heightKm,
  };
}

/** Observe a satellite record from a ground observer at `date`. */
export function observe(
  satrec: satellite.SatRec,
  observer: ObserverGd,
  date: Date,
): SatObservation | undefined {
  const pv = satellite.propagate(satrec, date);
  if (!pv) return undefined;
  const position = pv.position;
  const velocity = pv.velocity;
  if (!position || typeof position === "boolean" || !velocity || typeof velocity === "boolean") {
    return undefined;
  }
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(position, gmst);
  const look = satellite.ecfToLookAngles(observer, ecf);
  const geo = satellite.eciToGeodetic(position, gmst);
  return {
    azimuthDeg: (look.azimuth * RAD2DEG + 360) % 360,
    elevationDeg: look.elevation * RAD2DEG,
    rangeKm: look.rangeSat,
    altitudeKm: geo.height,
    subLat: satellite.degreesLat(geo.latitude),
    subLon: satellite.degreesLong(geo.longitude),
    velocityKmPerSec: Math.hypot(velocity.x, velocity.y, velocity.z),
    eci: { x: position.x, y: position.y, z: position.z },
  };
}

/** The Sun's elevation (deg) at the observer - used for darkness (FRD §46). */
export function sunElevationDeg(observer: ObserverGd, date: Date): number {
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(sunEci(date), gmst);
  return satellite.ecfToLookAngles(observer, ecf).elevation * RAD2DEG;
}
