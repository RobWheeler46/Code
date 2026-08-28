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
