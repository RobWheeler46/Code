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
      updated_at               TEXT NOT NULL,
      expires_at               TEXT NOT NULL,
      source                   TEXT NOT NULL
    );
  `);

  // Additive migrations for databases created by earlier versions.
  ensureColumn(db, "settings", "show_destination_arcs", "INTEGER NOT NULL DEFAULT 0");
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
