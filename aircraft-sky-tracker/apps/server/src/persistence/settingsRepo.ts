/** Settings persistence - one active configuration row (FRD §34, §32-33). */

import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_CONFIG, type AppConfig } from "@ast/shared";
import { getDatabase } from "./db.js";

interface SettingsRow {
  postcode: string;
  latitude: number;
  longitude: number;
  radius_miles: number;
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
    aircraftSource: row.aircraft_source as AppConfig["aircraftSource"],
    displayMode: row.display_mode as AppConfig["displayMode"],
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
          id, postcode, latitude, longitude, radius_miles, aircraft_source,
          display_mode, show_registration, show_destination, show_flight_number,
          show_altitude, show_distance, show_centre_marker, show_range_ring,
          show_header, show_trails, show_destination_arcs,
          highlight_interesting, watchlist, interpolation,
          created_at, updated_at
        ) VALUES (
          1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      )
      .run(
        defaults.postcode,
        defaults.latitude,
        defaults.longitude,
        defaults.radiusMiles,
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
          aircraft_source = ?, display_mode = ?, show_registration = ?,
          show_destination = ?, show_flight_number = ?, show_altitude = ?,
          show_distance = ?, show_centre_marker = ?, show_range_ring = ?,
          show_header = ?, show_trails = ?, show_destination_arcs = ?,
          highlight_interesting = ?, watchlist = ?,
          interpolation = ?, updated_at = ?
        WHERE id = 1`,
      )
      .run(
        config.postcode,
        config.latitude,
        config.longitude,
        config.radiusMiles,
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
        Number(config.interpolationEnabled),
        now,
      );
    return this.get();
  }
}
