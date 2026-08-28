/** Application configuration model (FRD §32-33). */

export type AircraftSource = "internet" | "local" | "hybrid";
export type DisplayMode = "minimal" | "informative";
/**
 * Overall display layout (FRD v3.2). "ceiling" is the pure look-up sky view for
 * a projector; "screen" adds a schematic geographic backdrop (range rings +
 * compass rose + cardinal labels) for a desk monitor; "map" plots aircraft on a
 * real slippy map (tiles fetched from the internet) with satellites shown in a
 * small observer-sky inset.
 */
export type ViewMode = "ceiling" | "screen" | "map";

export interface AppConfig {
  postcode: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  aircraftSource: AircraftSource;
  displayMode: DisplayMode;
  /** Ceiling (pure sky) vs screen (with a schematic geographic backdrop). */
  viewMode: ViewMode;
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
  aircraftSource: "internet",
  displayMode: "minimal",
  viewMode: "ceiling",
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
  historyEnabled: true,
  historyRetentionDays: 31,
  inAppAlerts: true,
  browserNotifications: false,
  showSatellites: true,
  satelliteMinElevationDeg: 15,
  satelliteShowStations: true,
  satelliteShowBright: true,
  satelliteShowStarlink: false,
};

/** Configuration fields a client is permitted to update (FRD §39). */
export type ConfigUpdate = Partial<
  Pick<
    AppConfig,
    | "postcode"
    | "radiusMiles"
    | "aircraftSource"
    | "displayMode"
    | "viewMode"
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
    | "historyEnabled"
    | "historyRetentionDays"
    | "inAppAlerts"
    | "browserNotifications"
    | "showSatellites"
    | "satelliteMinElevationDeg"
    | "satelliteShowStations"
    | "satelliteShowBright"
    | "satelliteShowStarlink"
  >
>;
