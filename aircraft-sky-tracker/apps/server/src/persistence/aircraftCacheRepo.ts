/** Aircraft metadata cache (registration/type) with ~30 day lifetime (FRD §36). */

import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./db.js";

export interface CachedAircraftMeta {
  icaoHex: string;
  registration?: string;
  aircraftType?: string;
  manufacturer?: string;
  model?: string;
  updatedAt: string;
  expiresAt: string;
  source: string;
}

interface AircraftRow {
  icao_hex: string;
  registration: string | null;
  aircraft_type: string | null;
  manufacturer: string | null;
  model: string | null;
  updated_at: string;
  expires_at: string;
  source: string;
}

export const AIRCRAFT_META_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AircraftCacheRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  get(icaoHex: string, now: Date = new Date()): CachedAircraftMeta | undefined {
    const row = this.db
      .prepare("SELECT * FROM aircraft_cache WHERE icao_hex = ?")
      .get(icaoHex) as AircraftRow | undefined;
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= now.getTime()) return undefined;
    return {
      icaoHex: row.icao_hex,
      registration: row.registration ?? undefined,
      aircraftType: row.aircraft_type ?? undefined,
      manufacturer: row.manufacturer ?? undefined,
      model: row.model ?? undefined,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      source: row.source,
    };
  }

  put(meta: Omit<CachedAircraftMeta, "updatedAt" | "expiresAt">): void {
    const now = new Date();
    const expires = new Date(now.getTime() + AIRCRAFT_META_TTL_MS);
    this.db
      .prepare(
        `INSERT INTO aircraft_cache (
          icao_hex, registration, aircraft_type, manufacturer, model,
          updated_at, expires_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(icao_hex) DO UPDATE SET
          registration = excluded.registration,
          aircraft_type = excluded.aircraft_type,
          manufacturer = excluded.manufacturer,
          model = excluded.model,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          source = excluded.source`,
      )
      .run(
        meta.icaoHex,
        meta.registration ?? null,
        meta.aircraftType ?? null,
        meta.manufacturer ?? null,
        meta.model ?? null,
        now.toISOString(),
        expires.toISOString(),
        meta.source,
      );
  }
}
