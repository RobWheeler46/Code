/**
 * Internal, provider-agnostic aircraft model (FRD §30-31).
 *
 * The frontend has NO knowledge of the external aircraft provider (FRD §102).
 * It only ever receives NORMALISED aircraft in this shape.
 */

export type RouteConfidence = "high" | "medium" | "low";

/** Destination / route information for a flight (FRD §31). */
export interface Destination {
  airportName?: string;
  displayName?: string;
  iata?: string;
  icao?: string;
  latitude?: number;
  longitude?: number;
  confidence: RouteConfidence;
}

/** A fully normalised aircraft ready for display (FRD §30). */
export interface Aircraft {
  id: string;
  icaoHex: string;
  registration?: string;
  callsign?: string;
  latitude: number;
  longitude: number;
  altitudeFeet?: number;
  groundSpeedKnots?: number;
  trackDegrees?: number;
  distanceMiles: number;
  bearingFromCentre: number;
  aircraftTypeCode?: string;
  aircraftCategory?: string;
  destination?: Destination;
  positionAgeSeconds: number;
  lastUpdated: string;
  source: string;
}

/**
 * Raw aircraft returned by an AircraftProvider before normalisation.
 * Fields are optional because different providers expose different data.
 */
export interface ProviderAircraft {
  icaoHex: string;
  registration?: string;
  aircraftTypeCode?: string;
  callsign?: string;
  latitude?: number;
  longitude?: number;
  altitudeFeet?: number;
  groundSpeedKnots?: number;
  trackDegrees?: number;
  positionAgeSeconds?: number;
  providerFlags?: unknown;
}
