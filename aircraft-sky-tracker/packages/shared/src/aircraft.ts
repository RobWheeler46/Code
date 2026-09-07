/**
 * Internal, provider-agnostic aircraft model (FRD §30-31).
 *
 * The frontend has NO knowledge of the external aircraft provider (FRD §102).
 * It only ever receives NORMALISED aircraft in this shape.
 */

/** Route classification (FRD v3.0 §35). */
export type RouteConfidence = "confirmed" | "high" | "medium" | "low" | "unknown";

/** Vertical movement of an aircraft, for display colouring. */
export type VerticalTrend = "climbing" | "descending" | "level";

/**
 * Vertical rate (ft/min) below which an aircraft counts as level. Small rates are
 * noise or minor corrections, so only a sustained climb/descent is coloured.
 */
export const VERTICAL_TREND_THRESHOLD_FPM = 300;

/** Classify an aircraft's vertical movement (unknown / small rate => level). */
export function verticalTrend(
  verticalRateFpm: number | undefined,
  thresholdFpm: number = VERTICAL_TREND_THRESHOLD_FPM,
): VerticalTrend {
  if (verticalRateFpm === undefined || !Number.isFinite(verticalRateFpm)) return "level";
  if (verticalRateFpm >= thresholdFpm) return "climbing";
  if (verticalRateFpm <= -thresholdFpm) return "descending";
  return "level";
}

/** Why an aircraft is flagged as interesting (FRD Phase 3). */
export interface AircraftInterest {
  /** Short primary label for display / alerts, e.g. "Military", "A380". */
  label: string;
  /** All matched reasons, e.g. ["Military", "Low"]. */
  reasons: string[];
}

/** Destination / route information for a flight (FRD §31, §44). */
export interface Destination {
  airportName?: string;
  displayName?: string;
  iata?: string;
  icao?: string;
  latitude?: number;
  longitude?: number;
  confidence: RouteConfidence;
  /** Origin + airline for the detail drawer (FRD §44). */
  originName?: string;
  originIata?: string;
  originIcao?: string;
  airline?: string;
  /** Which intelligence sources contributed, e.g. ["adsbdb"] (FRD §42). */
  sources?: string[];
}

/** Extended ADS-B fields shown in the detail drawer's technical section (FRD §46). */
export interface TechnicalAdsb {
  altitudeGeomFeet?: number;
  indicatedAirspeedKnots?: number;
  trueAirspeedKnots?: number;
  mach?: number;
  magHeadingDegrees?: number;
  trueHeadingDegrees?: number;
  navModes?: string[];
  selectedAltitudeMcpFeet?: number;
  selectedAltitudeFmsFeet?: number;
  selectedHeadingDegrees?: number;
  qnhHpa?: number;
  outsideAirTempC?: number;
  adsbVersion?: number;
  navIntegrityCategory?: number;
}

/** Aircraft-registry metadata (FRD §45), fetched on demand for the drawer. */
export interface AircraftMeta {
  manufacturer?: string;
  model?: string;
  typeDescription?: string;
  operator?: string;
  registeredCountry?: string;
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
  /** On the ground (ADS-B ground bit / alt_baro "ground"), not airborne. */
  onGround?: boolean;
  distanceMiles: number;
  /**
   * Within the display radius (shown on the sky) vs only within the wider
   * prediction radius (tracked for Look Now but not displayed) (FRD v4.0 §15).
   * Absent is treated as displayed for backward compatibility.
   */
  withinDisplayRadius?: boolean;
  bearingFromCentre: number;
  aircraftTypeCode?: string;
  aircraftCategory?: string;
  /** Display silhouette key (FRD v3.0 §20, §70). */
  silhouette?: string;
  destination?: Destination;
  /** Set when the aircraft matches an interesting-aircraft rule (FRD Phase 3). */
  interest?: AircraftInterest;
  /** Climb/descent rate, ft/min; positive = climbing (FRD §43). */
  verticalRateFpm?: number;
  squawk?: string;
  emergency?: string;
  /** Extended ADS-B fields for the detail drawer's technical section (FRD §46). */
  technical?: TechnicalAdsb;
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
  /** Provider indicates the aircraft is on the ground. */
  onGround?: boolean;
  positionAgeSeconds?: number;
  providerFlags?: unknown;
  /** Extended ADS-B fields, where the provider supplies them (FRD §10, §43, §46). */
  verticalRateFpm?: number;
  squawk?: string;
  emergency?: string;
  technical?: TechnicalAdsb;
}
