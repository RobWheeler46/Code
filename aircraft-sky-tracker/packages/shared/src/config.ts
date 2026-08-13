/** Application configuration model (FRD §32-33). */

export type AircraftSource = "internet" | "local" | "hybrid";
export type DisplayMode = "minimal" | "informative";

export interface AppConfig {
  postcode: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  aircraftSource: AircraftSource;
  displayMode: DisplayMode;
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
};

/** Configuration fields a client is permitted to update (FRD §39). */
export type ConfigUpdate = Partial<
  Pick<
    AppConfig,
    | "postcode"
    | "radiusMiles"
    | "aircraftSource"
    | "displayMode"
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
  >
>;
