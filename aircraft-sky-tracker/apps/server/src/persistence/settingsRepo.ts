/** Settings persistence - one active configuration row (FRD §34, §32-33). */

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_CONFIG, type AppConfig } from "@ast/shared";
import { getDatabase } from "./db.js";

interface SettingsRow {
  postcode: string;
  latitude: number;
  longitude: number;
  radius_miles: number;
  location_source: string;
  location_confidence: string;
  location_accuracy_radius_km: number | null;
  location_name: string | null;
  aircraft_source: string;
  display_mode: string;
  show_registration: number;
  show_destination: number;
  show_flight_number: number;
  show_altitude: number;
  show_distance: number;
  show_centre_marker: number;
  show_range_ring: number;
  show_header: number;
  show_trails: number;
  show_destination_arcs: number;
  highlight_interesting: number;
  watchlist: string;
  low_altitude_threshold: number;
  hide_ground_aircraft: number;
  history_enabled: number;
  history_retention_days: number;
  in_app_alerts: number;
  browser_notifications: number;
  show_sky_insights: number;
  prediction_radius_miles: number;
  show_look_now: number;
  show_satellites: number;
  satellite_min_elevation: number;
  satellite_show_stations: number;
  satellite_show_bright: number;
  satellite_show_starlink: number;
  view_mode: string;
  viewing_distance: string;
  display_scale: string;
  satellite_alerts_enabled: number;
  satellite_alert_lead_minutes: number;
  satellite_alert_visible_only: number;
  interpolation: number;
}

function bool(v: number): boolean {
  return v !== 0;
}

function rowToConfig(row: SettingsRow): AppConfig {
  return {
    postcode: row.postcode,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMiles: row.radius_miles,
    predictionRadiusMiles: row.prediction_radius_miles ?? 40,
    locationSource: (row.location_source as AppConfig["locationSource"]) ?? "default",
    locationConfidence: (row.location_confidence as AppConfig["locationConfidence"]) ?? "good",
    locationAccuracyRadiusKm: row.location_accuracy_radius_km ?? undefined,
    locationName: row.location_name ?? undefined,
    aircraftSource: row.aircraft_source as AppConfig["aircraftSource"],
    displayMode: row.display_mode as AppConfig["displayMode"],
    viewMode: (row.view_mode as AppConfig["viewMode"]) ?? "ceiling",
    viewingDistance: (row.viewing_distance as AppConfig["viewingDistance"]) ?? "normal",
    displayScale: (row.display_scale as AppConfig["displayScale"]) ?? "automatic",
    satelliteAlertsEnabled: bool(row.satellite_alerts_enabled),
    satelliteAlertLeadMinutes: row.satellite_alert_lead_minutes ?? 10,
    satelliteAlertVisibleOnly: bool(row.satellite_alert_visible_only),
    showRegistration: bool(row.show_registration),
    showDestination: bool(row.show_destination),
    showFlightNumber: bool(row.show_flight_number),
    showAltitude: bool(row.show_altitude),
    showDistance: bool(row.show_distance),
    showCentreMarker: bool(row.show_centre_marker),
    showRangeRing: bool(row.show_range_ring),
    showHeader: bool(row.show_header),
    showTrails: bool(row.show_trails),
    showDestinationArcs: bool(row.show_destination_arcs),
    interpolationEnabled: bool(row.interpolation),
    highlightInteresting: bool(row.highlight_interesting),
    watchlist: row.watchlist ?? "",
    lowAltitudeThresholdFeet: row.low_altitude_threshold,
    hideGroundAircraft: bool(row.hide_ground_aircraft),
    historyEnabled: bool(row.history_enabled),
    historyRetentionDays: row.history_retention_days,
    inAppAlerts: bool(row.in_app_alerts),
    browserNotifications: bool(row.browser_notifications),
    showSkyInsights: bool(row.show_sky_insights),
    showLookNow: bool(row.show_look_now),
    showSatellites: bool(row.show_satellites),
    satelliteMinElevationDeg: row.satellite_min_elevation,
    satelliteShowStations: bool(row.satellite_show_stations),
    satelliteShowBright: bool(row.satellite_show_bright),
    satelliteShowStarlink: bool(row.satellite_show_starlink),
  };
}

export class SettingsRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  /** Ensure a settings row exists, seeded from defaults (FRD §84). */
  ensureSeeded(defaults: AppConfig = DEFAULT_CONFIG): AppConfig {
    const existing = this.tryGet();
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (
          id, postcode, latitude, longitude, radius_miles, prediction_radius_miles,
          location_source, location_confidence, location_accuracy_radius_km, location_name,
          aircraft_source,
          display_mode, show_registration, show_destination, show_flight_number,
          show_altitude, show_distance, show_centre_marker, show_range_ring,
          show_header, show_trails, show_destination_arcs,
          highlight_interesting, watchlist, low_altitude_threshold, hide_ground_aircraft,
          history_enabled, history_retention_days, in_app_alerts,
          browser_notifications, show_sky_insights, show_look_now, show_satellites, satellite_min_elevation,
          satellite_show_stations, satellite_show_bright, satellite_show_starlink,
          view_mode, viewing_distance, display_scale,
          satellite_alerts_enabled, satellite_alert_lead_minutes, satellite_alert_visible_only,
          interpolation, created_at, updated_at
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      )
      .run(
        defaults.postcode,
        defaults.latitude,
        defaults.longitude,
        defaults.radiusMiles,
        defaults.predictionRadiusMiles,
        defaults.locationSource,
        defaults.locationConfidence,
        defaults.locationAccuracyRadiusKm ?? null,
        defaults.locationName ?? null,
        defaults.aircraftSource,
        defaults.displayMode,
        Number(defaults.showRegistration),
        Number(defaults.showDestination),
        Number(defaults.showFlightNumber),
        Number(defaults.showAltitude),
        Number(defaults.showDistance),
        Number(defaults.showCentreMarker),
        Number(defaults.showRangeRing),
        Number(defaults.showHeader),
        Number(defaults.showTrails),
        Number(defaults.showDestinationArcs),
        Number(defaults.highlightInteresting),
        defaults.watchlist,
        defaults.lowAltitudeThresholdFeet,
        Number(defaults.hideGroundAircraft),
        Number(defaults.historyEnabled),
        defaults.historyRetentionDays,
        Number(defaults.inAppAlerts),
        Number(defaults.browserNotifications),
        Number(defaults.showSkyInsights),
        Number(defaults.showLookNow),
        Number(defaults.showSatellites),
        defaults.satelliteMinElevationDeg,
        Number(defaults.satelliteShowStations),
        Number(defaults.satelliteShowBright),
        Number(defaults.satelliteShowStarlink),
        defaults.viewMode,
        defaults.viewingDistance,
        defaults.displayScale,
        Number(defaults.satelliteAlertsEnabled),
        defaults.satelliteAlertLeadMinutes,
        Number(defaults.satelliteAlertVisibleOnly),
        Number(defaults.interpolationEnabled),
        now,
        now,
      );
    return this.get();
  }

  private tryGet(): AppConfig | undefined {
    const row = this.db
      .prepare("SELECT * FROM settings WHERE id = 1")
      .get() as SettingsRow | undefined;
    return row ? rowToConfig(row) : undefined;
  }

  get(): AppConfig {
    const config = this.tryGet();
    if (!config) throw new Error("settings row missing; call ensureSeeded first");
    return config;
  }

  /** Persist a full configuration object. */
  save(config: AppConfig): AppConfig {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE settings SET
          postcode = ?, latitude = ?, longitude = ?, radius_miles = ?,
          prediction_radius_miles = ?,
          location_source = ?, location_confidence = ?,
          location_accuracy_radius_km = ?, location_name = ?,
          aircraft_source = ?, display_mode = ?, show_registration = ?,
          show_destination = ?, show_flight_number = ?, show_altitude = ?,
          show_distance = ?, show_centre_marker = ?, show_range_ring = ?,
          show_header = ?, show_trails = ?, show_destination_arcs = ?,
          highlight_interesting = ?, watchlist = ?,
          low_altitude_threshold = ?, hide_ground_aircraft = ?, history_enabled = ?,
          history_retention_days = ?, in_app_alerts = ?,
          browser_notifications = ?, show_sky_insights = ?, show_look_now = ?, show_satellites = ?,
          satellite_min_elevation = ?, satellite_show_stations = ?,
          satellite_show_bright = ?, satellite_show_starlink = ?,
          view_mode = ?, viewing_distance = ?, display_scale = ?,
          satellite_alerts_enabled = ?, satellite_alert_lead_minutes = ?,
          satellite_alert_visible_only = ?,
          interpolation = ?, updated_at = ?
        WHERE id = 1`,
      )
      .run(
        config.postcode,
        config.latitude,
        config.longitude,
        config.radiusMiles,
        config.predictionRadiusMiles,
        config.locationSource,
        config.locationConfidence,
        config.locationAccuracyRadiusKm ?? null,
        config.locationName ?? null,
        config.aircraftSource,
        config.displayMode,
        Number(config.showRegistration),
        Number(config.showDestination),
        Number(config.showFlightNumber),
        Number(config.showAltitude),
        Number(config.showDistance),
        Number(config.showCentreMarker),
        Number(config.showRangeRing),
        Number(config.showHeader),
        Number(config.showTrails),
        Number(config.showDestinationArcs),
        Number(config.highlightInteresting),
        config.watchlist,
        config.lowAltitudeThresholdFeet,
        Number(config.hideGroundAircraft),
        Number(config.historyEnabled),
        config.historyRetentionDays,
        Number(config.inAppAlerts),
        Number(config.browserNotifications),
        Number(config.showSkyInsights),
        Number(config.showLookNow),
        Number(config.showSatellites),
        config.satelliteMinElevationDeg,
        Number(config.satelliteShowStations),
        Number(config.satelliteShowBright),
        Number(config.satelliteShowStarlink),
        config.viewMode,
        config.viewingDistance,
        config.displayScale,
        Number(config.satelliteAlertsEnabled),
        config.satelliteAlertLeadMinutes,
        Number(config.satelliteAlertVisibleOnly),
        Number(config.interpolationEnabled),
        now,
      );
    return this.get();
  }
}
