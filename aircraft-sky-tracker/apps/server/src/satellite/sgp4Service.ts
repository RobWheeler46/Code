/**
 * SGP4 propagation for an observer (FRD v3.2 §41). Wraps satellite.js to turn a
 * satellite record + observer coordinates + time into look angles, sub-satellite
 * point, altitude and velocity. Pure computation - no network.
 */

import * as satellite from "satellite.js";
import type { SatelliteOrbit } from "@ast/shared";
import { sunEci, EARTH_RADIUS_KM, type Vec3 } from "./astro.js";
import type { OrbitalElement } from "./orbitalProvider.js";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
/** Days between the Julian epoch and the Unix epoch (1970-01-01). */
const JD_UNIX_EPOCH = 2440587.5;

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

/**
 * Derive orbital characteristics from an element set (FRD §57-58 detail).
 * `no` is the mean motion in radians/minute; alta/altp are apogee/perigee
 * altitudes in Earth radii; jdsatepoch is the element-set epoch (Julian date).
 */
export function orbitFrom(el: OrbitalElement, now: Date): SatelliteOrbit {
  const rec = el.satrec;
  const periodMinutes = rec.no > 0 ? (2 * Math.PI) / rec.no : 0;
  const epochMs = (rec.jdsatepoch - JD_UNIX_EPOCH) * 86_400_000;
  return {
    periodMinutes,
    inclinationDegrees: rec.inclo * RAD2DEG,
    apogeeKm: rec.alta * EARTH_RADIUS_KM,
    perigeeKm: rec.altp * EARTH_RADIUS_KM,
    eccentricity: rec.ecco,
    intlDesignator: el.intlDesignator,
    elementEpoch: new Date(epochMs).toISOString(),
    elementAgeHours: (now.getTime() - epochMs) / 3_600_000,
  };
}

/** The Sun's elevation (deg) at the observer - used for darkness (FRD §46). */
export function sunElevationDeg(observer: ObserverGd, date: Date): number {
  const gmst = satellite.gstime(date);
  const ecf = satellite.eciToEcf(sunEci(date), gmst);
  return satellite.ecfToLookAngles(observer, ecf).elevation * RAD2DEG;
}
