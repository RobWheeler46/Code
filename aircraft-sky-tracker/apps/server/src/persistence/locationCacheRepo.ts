/** Postcode -> coordinate cache (FRD §35). */

import type { DatabaseSync } from "node:sqlite";
import { getDatabase } from "./db.js";

export interface CachedLocation {
  postcode: string;
  latitude: number;
  longitude: number;
  resolvedAt: string;
  provider: string;
}

interface LocationRow {
  postcode: string;
  latitude: number;
  longitude: number;
  resolved_at: string;
  provider: string;
}

export class LocationCacheRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  get(postcode: string): CachedLocation | undefined {
    const row = this.db
      .prepare("SELECT * FROM location_cache WHERE postcode = ?")
      .get(normalise(postcode)) as LocationRow | undefined;
    if (!row) return undefined;
    return {
      postcode: row.postcode,
      latitude: row.latitude,
      longitude: row.longitude,
      resolvedAt: row.resolved_at,
      provider: row.provider,
    };
  }

  put(
    postcode: string,
    latitude: number,
    longitude: number,
    provider: string,
  ): void {
    this.db
      .prepare(
        `INSERT INTO location_cache (postcode, latitude, longitude, resolved_at, provider)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(postcode) DO UPDATE SET
           latitude = excluded.latitude,
           longitude = excluded.longitude,
           resolved_at = excluded.resolved_at,
           provider = excluded.provider`,
      )
      .run(
        normalise(postcode),
        latitude,
        longitude,
        new Date().toISOString(),
        provider,
      );
  }
}

/** Canonical cache key: uppercase, single-spaced. */
function normalise(postcode: string): string {
  return postcode.trim().toUpperCase().replace(/\s+/g, " ");
}
