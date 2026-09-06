/** Application configuration model (FRD §32-33). */

import type { LocationSource, LocationConfidence } from "./location.js";

export type AircraftSource = "internet" | "local" | "hybrid";
export type DisplayMode = "minimal" | "informative";
/**
 * Overall display layout. "true-sky" (FRD v4.0 §8-11) places aircraft AND
 * satellites by their real azimuth/elevation - where you physically look, zenith
 * at centre; "ceiling" is the earlier simplified ground projection for a
 * projector; "screen" adds a schematic geographic backdrop (range rings +
 * compass rose + cardinal labels) for a desk monitor; "map" plots aircraft on a
 * real slippy map with satellites in a small observer-sky inset.
 */
export type ViewMode = "true-sky" | "ceiling" | "screen" | "map";
/** How far the viewer sits from the display (FRD v3.2 §12); scales sizes. */
export type ViewingDistance = "close" | "normal" | "across-room";
/** Overall element-size profile (FRD v3.2 §13). "automatic" adapts to the screen. */
export type DisplayScale = "automatic" | "compact" | "standard" | "large";

export interface AppConfig {
  postcode: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  /**
   * Prediction radius (miles) for the Look Now engine (FRD v4.0 §15). Aircraft
   * between the display radius and this are tracked but NOT displayed, so their
   * approach can be predicted without cluttering the sky.
   */
  predictionRadiusMiles: number;
  /** How the current location was obtained (FRD v3.6 §8, §17). */
  locationSource: LocationSource;
  /** Trustworthiness of the observer centre (FRD v3.6 §8). */
  locationConfidence: LocationConfidence;
  /** Provider accuracy radius (km) for IP locations, where known (§5). */
  locationAccuracyRadiusKm?: number;
  /** Human area label, e.g. "Swindon, Wiltshire" (§3, §25). */
  locationName?: string;
  aircraftSource: AircraftSource;
  displayMode: DisplayMode;
  /** Ceiling (pure sky) vs screen (schematic backdrop) vs map (real tiles). */
  viewMode: ViewMode;
  /** Viewer distance from the display; scales element sizes (FRD §12). */
  viewingDistance: ViewingDistance;
  /** Element-size profile; "automatic" adapts to the screen (FRD §13). */
  displayScale: DisplayScale;
  showRegistration: boolean;
  showDestination: boolean;
  showFlightNumber: boolean;
  showAltitude: boolean;
  showDistance: boolean;
  showCentreMarker: boolean;
  showRangeRing: boolean;
  showHeader: boolean;
  showTrails: boolean;
  showDestinationArcs: boolean;
  interpolationEnabled: boolean;
  /** Highlight interesting aircraft on the display (FRD Phase 3). */
  highlightInteresting: boolean;
  /** Comma/space separated registrations or type codes to always flag. */
  watchlist: string;
  /** Altitude (ft) below which an aircraft is "low" (FRD v3.0 §50). */
  lowAltitudeThresholdFeet: number;
  /** Hide aircraft that are on the ground (taxiing / parked), showing only airborne. */
  hideGroundAircraft: boolean;
  /** Record aircraft pass history (FRD v3.0 §56). */
  historyEnabled: boolean;
  /** Days to retain history passes (FRD v3.0 §62). */
  historyRetentionDays: number;
  /** Show an on-screen banner when an interesting aircraft enters (FRD §54). */
  inAppAlerts: boolean;
  /** Fire a browser/OS notification on interesting entry, permission-based (FRD §54). */
  browserNotifications: boolean;
  /** Show the satellite layer (FRD v3.2 §36, §73). */
  showSatellites: boolean;
  /** Minimum elevation (deg) for a satellite to be displayed (FRD §43-44). */
  satelliteMinElevationDeg: number;
  /** Include space stations (ISS, Tiangong) in the satellite layer (FRD §49). */
  satelliteShowStations: boolean;
  /** Include curated bright satellites (FRD §50). */
  satelliteShowBright: boolean;
  /** Include bright Starlink passes (FRD §51). */
  satelliteShowStarlink: boolean;
  /** Show the single main-screen Sky Insight banner (FRD v3.8 §91). */
  showSkyInsights: boolean;
  /** Show the Look Now approaching-aircraft banner (FRD v4.0 §16-19). */
  showLookNow: boolean;
  /** Alert ahead of an upcoming satellite pass (FRD §61-62). */
  satelliteAlertsEnabled: boolean;
  /** Advance-warning lead time in minutes for a satellite pass alert (FRD §62). */
  satelliteAlertLeadMinutes: number;
  /** Only alert for potentially naked-eye-visible passes (tames noise). */
  satelliteAlertVisibleOnly: boolean;
}

export const DEFAULT_POSTCODE = "SN25 4TP";
export const DEFAULT_RADIUS_MILES = 10;

/**
 * Default configuration (FRD §33). Coordinates are 0/0 placeholders and MUST be
 * resolved from the postcode service at runtime (FRD §40) - never hard-coded.
 */
export const DEFAULT_CONFIG: AppConfig = {
  postcode: DEFAULT_POSTCODE,
  latitude: 0,
  longitude: 0,
  radiusMiles: DEFAULT_RADIUS_MILES,
  predictionRadiusMiles: 40,
  locationSource: "default",
  locationConfidence: "good",
  aircraftSource: "internet",
  displayMode: "minimal",
  viewMode: "ceiling",
  viewingDistance: "normal",
  displayScale: "automatic",
  showRegistration: true,
  showDestination: true,
  showFlightNumber: false,
  showAltitude: false,
  showDistance: false,
  showCentreMarker: false,
  showRangeRing: false,
  showHeader: false,
  showTrails: false,
  showDestinationArcs: false,
  interpolationEnabled: true,
  highlightInteresting: true,
  watchlist: "",
  lowAltitudeThresholdFeet: 3000,
  hideGroundAircraft: false,
  historyEnabled: true,
  historyRetentionDays: 31,
  inAppAlerts: true,
  browserNotifications: false,
  showSkyInsights: true,
  showLookNow: true,
  showSatellites: true,
  satelliteMinElevationDeg: 15,
  satelliteShowStations: true,
  satelliteShowBright: true,
  satelliteShowStarlink: false,
  satelliteAlertsEnabled: false,
  satelliteAlertLeadMinutes: 10,
  satelliteAlertVisibleOnly: true,
};

/** Configuration fields a client is permitted to update (FRD §39). */
export type ConfigUpdate = Partial<
  Pick<
    AppConfig,
    | "postcode"
    | "radiusMiles"
    | "predictionRadiusMiles"
    | "aircraftSource"
    | "displayMode"
    | "viewMode"
    | "viewingDistance"
    | "displayScale"
    | "showRegistration"
    | "showDestination"
    | "showFlightNumber"
    | "showAltitude"
    | "showDistance"
    | "showCentreMarker"
    | "showRangeRing"
    | "showHeader"
    | "showTrails"
    | "showDestinationArcs"
    | "interpolationEnabled"
    | "highlightInteresting"
    | "watchlist"
    | "lowAltitudeThresholdFeet"
    | "hideGroundAircraft"
    | "historyEnabled"
    | "historyRetentionDays"
    | "inAppAlerts"
    | "browserNotifications"
    | "showSkyInsights"
    | "showLookNow"
    | "showSatellites"
    | "satelliteMinElevationDeg"
    | "satelliteShowStations"
    | "satelliteShowBright"
    | "satelliteShowStarlink"
    | "satelliteAlertsEnabled"
    | "satelliteAlertLeadMinutes"
    | "satelliteAlertVisibleOnly"
  >
>;
