/**
 * Satellite model (FRD v3.2 §36-84).
 *
 * Satellites are an independent layer from aircraft (FRD §36, §65): their
 * position comes from orbital elements propagated with SGP4 and expressed as
 * observer azimuth/elevation for the configured postcode - NOT the 10-mile
 * aircraft radius. The frontend never sees the orbital-data provider.
 */

export type SatelliteCategory = "station" | "bright" | "starlink" | "other";

export type SatelliteMode =
  | "interesting-visible"
  | "bright"
  | "stations"
  | "starlink"
  | "all";

/** A satellite currently above the observer's horizon (FRD §80). */
export interface Satellite {
  catalogNumber: string;
  name: string;
  category: SatelliteCategory;
  /** Sub-satellite ground point. */
  latitude: number;
  longitude: number;
  orbitalAltitudeKm: number;
  azimuthDegrees: number;
  elevationDegrees: number;
  rangeKm: number;
  velocityKmPerSecond: number;
  /** Sunlit (not in Earth's shadow). */
  illuminated: boolean;
  /** Likely visible by eye now (illuminated, above min elevation, sky dark). */
  potentiallyVisible: boolean;
  /** Apparent movement across the sky, e.g. "SW → NE". */
  direction?: string;
  dataTimestamp: string;
  elementEpoch?: string;
}

export const DEFAULT_SATELLITE_MIN_ELEVATION_DEG = 15;

/**
 * An upcoming (or in-progress) overhead pass of a satellite (FRD v3.2 §59-60).
 * A pass is only "meaningful" if its maximum elevation exceeds the configured
 * minimum elevation (§60). Times are ISO-8601 UTC.
 */
export interface SatellitePass {
  catalogNumber: string;
  name: string;
  category: SatelliteCategory;
  /** Rise: satellite crosses the minimum elevation on the way up. */
  riseTime: string;
  /** Time of maximum elevation ("best view"). */
  maxTime: string;
  /** Set: satellite drops back below the minimum elevation. */
  setTime: string;
  maxElevationDegrees: number;
  riseAzimuthDegrees: number;
  setAzimuthDegrees: number;
  /** Compass path across the sky, e.g. "SW → NE". */
  direction: string;
  durationSeconds: number;
  /** Any part of the pass is likely naked-eye visible (sunlit + dark sky). */
  potentiallyVisible: boolean;
  /** True once riseTime is in the past but setTime is still ahead (in progress). */
  inProgress: boolean;
}

/** Default look-ahead window for pass prediction (FRD §59). */
export const DEFAULT_SATELLITE_PASS_WINDOW_HOURS = 24;
