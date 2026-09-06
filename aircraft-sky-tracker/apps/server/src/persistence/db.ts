/** SQLite persistence via Node's built-in node:sqlite (FRD §34). */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "../config/env.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("persistence");

let database: DatabaseSync | undefined;

/** Open (once) and migrate the SQLite database. */
export function openDatabase(): DatabaseSync {
  if (database) return database;

  const path = resolve(process.cwd(), env.databasePath);
  mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);

  database = db;
  log.info("database opened", { path });
  return db;
}

export function getDatabase(): DatabaseSync {
  if (!database) return openDatabase();
  return database;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = undefined;
  }
}

/** Open a standalone, migrated in-memory database (used by tests). */
export function createInMemoryDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db);
  return db;
}

/** Create the MVP tables (FRD §34-37). Idempotent. */
function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id                 INTEGER PRIMARY KEY CHECK (id = 1),
      postcode           TEXT    NOT NULL,
      latitude           REAL    NOT NULL,
      longitude          REAL    NOT NULL,
      radius_miles       REAL    NOT NULL,
      aircraft_source    TEXT    NOT NULL,
      display_mode       TEXT    NOT NULL,
      show_registration  INTEGER NOT NULL,
      show_destination   INTEGER NOT NULL,
      show_flight_number INTEGER NOT NULL,
      show_altitude      INTEGER NOT NULL,
      show_distance      INTEGER NOT NULL,
      show_centre_marker INTEGER NOT NULL,
      show_range_ring    INTEGER NOT NULL,
      show_header         INTEGER NOT NULL,
      show_trails         INTEGER NOT NULL,
      show_destination_arcs INTEGER NOT NULL DEFAULT 0,
      highlight_interesting INTEGER NOT NULL DEFAULT 1,
      watchlist           TEXT    NOT NULL DEFAULT '',
      low_altitude_threshold INTEGER NOT NULL DEFAULT 3000,
      history_enabled     INTEGER NOT NULL DEFAULT 1,
      history_retention_days INTEGER NOT NULL DEFAULT 31,
      in_app_alerts       INTEGER NOT NULL DEFAULT 1,
      browser_notifications INTEGER NOT NULL DEFAULT 0,
      show_satellites     INTEGER NOT NULL DEFAULT 1,
      satellite_min_elevation INTEGER NOT NULL DEFAULT 10,
      satellite_show_stations INTEGER NOT NULL DEFAULT 1,
      satellite_show_bright INTEGER NOT NULL DEFAULT 1,
      satellite_show_starlink INTEGER NOT NULL DEFAULT 0,
      interpolation       INTEGER NOT NULL,
      created_at          TEXT    NOT NULL,
      updated_at          TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS location_cache (
      postcode    TEXT PRIMARY KEY,
      latitude    REAL NOT NULL,
      longitude   REAL NOT NULL,
      resolved_at TEXT NOT NULL,
      provider    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aircraft_cache (
      icao_hex      TEXT PRIMARY KEY,
      registration  TEXT,
      aircraft_type TEXT,
      manufacturer  TEXT,
      model         TEXT,
      operator      TEXT,
      registered_country TEXT,
      updated_at    TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      source        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS route_cache (
      callsign                 TEXT PRIMARY KEY,
      origin_icao              TEXT,
      origin_iata              TEXT,
      origin_name              TEXT,
      destination_icao         TEXT,
      destination_iata         TEXT,
      destination_name         TEXT,
      destination_display_name TEXT,
      destination_latitude     REAL,
      destination_longitude    REAL,
      airline                  TEXT,
      confidence               TEXT NOT NULL,
      sources                  TEXT,
      updated_at               TEXT NOT NULL,
      expires_at               TEXT NOT NULL,
      source                   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS history_passes (
      pass_id                    TEXT PRIMARY KEY,
      icao_hex                   TEXT NOT NULL,
      registration               TEXT,
      callsign                   TEXT,
      aircraft_type              TEXT,
      aircraft_description       TEXT,
      first_seen                 TEXT NOT NULL,
      last_seen                  TEXT NOT NULL,
      origin                     TEXT,
      destination                TEXT,
      route_confidence           TEXT,
      closest_approach_miles     REAL NOT NULL,
      minimum_altitude_feet      INTEGER,
      maximum_altitude_feet      INTEGER,
      maximum_ground_speed_knots INTEGER,
      interesting                INTEGER NOT NULL,
      interesting_reasons        TEXT NOT NULL,
      created_date               TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_created_date
      ON history_passes(created_date);

    CREATE TABLE IF NOT EXISTS account_users (
      id          TEXT PRIMARY KEY,
      email       TEXT,
      name        TEXT,
      picture     TEXT,
      created_at  TEXT NOT NULL,
      last_seen   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_locations (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
      label              TEXT NOT NULL,
      latitude           REAL NOT NULL,
      longitude          REAL NOT NULL,
      is_home            INTEGER NOT NULL DEFAULT 0,
      accuracy_radius_km REAL,
      created_at         TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES account_users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_saved_locations_user
      ON saved_locations(user_id);
  `);

  // Additive migrations for databases created by earlier versions.
  ensureColumn(db, "settings", "show_destination_arcs", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "settings", "highlight_interesting", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "watchlist", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "settings", "low_altitude_threshold", "INTEGER NOT NULL DEFAULT 3000");
  ensureColumn(db, "settings", "hide_ground_aircraft", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "settings", "location_source", "TEXT NOT NULL DEFAULT 'default'");
  ensureColumn(db, "settings", "location_confidence", "TEXT NOT NULL DEFAULT 'good'");
  ensureColumn(db, "settings", "location_accuracy_radius_km", "REAL");
  ensureColumn(db, "settings", "location_name", "TEXT");
  ensureColumn(db, "settings", "history_enabled", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "history_retention_days", "INTEGER NOT NULL DEFAULT 31");
  ensureColumn(db, "settings", "in_app_alerts", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "browser_notifications", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "aircraft_cache", "operator", "TEXT");
  ensureColumn(db, "aircraft_cache", "registered_country", "TEXT");
  ensureColumn(db, "route_cache", "sources", "TEXT");
  ensureColumn(db, "settings", "show_satellites", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "satellite_min_elevation", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn(db, "settings", "satellite_show_stations", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "satellite_show_bright", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "satellite_show_starlink", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "settings", "view_mode", "TEXT NOT NULL DEFAULT 'ceiling'");
  ensureColumn(db, "settings", "viewing_distance", "TEXT NOT NULL DEFAULT 'normal'");
  ensureColumn(db, "settings", "display_scale", "TEXT NOT NULL DEFAULT 'automatic'");
  ensureColumn(db, "settings", "satellite_alerts_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "settings", "satellite_alert_lead_minutes", "INTEGER NOT NULL DEFAULT 10");
  ensureColumn(db, "settings", "satellite_alert_visible_only", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "show_sky_insights", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "prediction_radius_miles", "INTEGER NOT NULL DEFAULT 40");
  ensureColumn(db, "settings", "show_look_now", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "settings", "show_aviation_context", "INTEGER NOT NULL DEFAULT 1");

  runValueMigrations(db);
}

/**
 * One-time value migrations, gated by SQLite's PRAGMA user_version so each runs
 * exactly once (unlike the idempotent additive column migrations above). A
 * customised setting is preserved - only values still on a superseded default
 * are moved.
 */
function runValueMigrations(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  const version = row?.user_version ?? 0;

  // v1: lower the satellite minimum-elevation default from 15° to 10° so more of
  // the sky is shown by default. Only touches installs still on the old default.
  if (version < 1) {
    db.exec("UPDATE settings SET satellite_min_elevation = 10 WHERE satellite_min_elevation = 15");
    db.exec("PRAGMA user_version = 1");
  }
}

/** Add a column to an existing table if it is not already present. */
function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
