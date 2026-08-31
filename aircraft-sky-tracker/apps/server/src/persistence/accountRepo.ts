/**
 * Account persistence (FRD v3.6 §26): signed-in users and their saved locations.
 * Separate from the single global settings row - each Google account keeps its
 * own list of named locations, one of which may be Home.
 */

import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { SavedLocation } from "@ast/shared";
import { getDatabase } from "./db.js";

export interface GoogleProfile {
  id: string; // Google "sub"
  email?: string;
  name?: string;
  picture?: string;
}

interface SavedRow {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  is_home: number;
  accuracy_radius_km: number | null;
}

export class AccountRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  /** Create or refresh a user record from a Google profile. */
  upsertUser(profile: GoogleProfile): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO account_users (id, email, name, picture, created_at, last_seen)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           email = excluded.email, name = excluded.name,
           picture = excluded.picture, last_seen = excluded.last_seen`,
      )
      .run(profile.id, profile.email ?? null, profile.name ?? null, profile.picture ?? null, now, now);
  }

  getUser(id: string): { email?: string; name?: string; picture?: string } | undefined {
    const row = this.db
      .prepare(`SELECT email, name, picture FROM account_users WHERE id = ?`)
      .get(id) as unknown as { email: string | null; name: string | null; picture: string | null } | undefined;
    if (!row) return undefined;
    return {
      email: row.email ?? undefined,
      name: row.name ?? undefined,
      picture: row.picture ?? undefined,
    };
  }

  listLocations(userId: string): SavedLocation[] {
    const rows = this.db
      .prepare(
        `SELECT id, label, latitude, longitude, is_home, accuracy_radius_km
         FROM saved_locations WHERE user_id = ?
         ORDER BY is_home DESC, label ASC`,
      )
      .all(userId) as unknown as SavedRow[];
    return rows.map(toSavedLocation);
  }

  addLocation(
    userId: string,
    input: { label: string; latitude: number; longitude: number; isHome?: boolean; accuracyRadiusKm?: number },
  ): SavedLocation {
    const id = randomUUID();
    if (input.isHome) this.clearHome(userId);
    this.db
      .prepare(
        `INSERT INTO saved_locations
           (id, user_id, label, latitude, longitude, is_home, accuracy_radius_km, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        userId,
        input.label,
        input.latitude,
        input.longitude,
        input.isHome ? 1 : 0,
        input.accuracyRadiusKm ?? null,
        new Date().toISOString(),
      );
    return {
      id,
      label: input.label,
      latitude: input.latitude,
      longitude: input.longitude,
      isHome: Boolean(input.isHome),
      accuracyRadiusKm: input.accuracyRadiusKm,
    };
  }

  deleteLocation(userId: string, id: string): boolean {
    const res = this.db
      .prepare(`DELETE FROM saved_locations WHERE id = ? AND user_id = ?`)
      .run(id, userId);
    return Number(res.changes) > 0;
  }

  setHome(userId: string, id: string): boolean {
    const owned = this.db
      .prepare(`SELECT 1 FROM saved_locations WHERE id = ? AND user_id = ?`)
      .get(id, userId);
    if (!owned) return false;
    this.clearHome(userId);
    this.db.prepare(`UPDATE saved_locations SET is_home = 1 WHERE id = ?`).run(id);
    return true;
  }

  getLocation(userId: string, id: string): SavedLocation | undefined {
    const row = this.db
      .prepare(
        `SELECT id, label, latitude, longitude, is_home, accuracy_radius_km
         FROM saved_locations WHERE id = ? AND user_id = ?`,
      )
      .get(id, userId) as unknown as SavedRow | undefined;
    return row ? toSavedLocation(row) : undefined;
  }

  private clearHome(userId: string): void {
    this.db.prepare(`UPDATE saved_locations SET is_home = 0 WHERE user_id = ?`).run(userId);
  }
}

function toSavedLocation(row: SavedRow): SavedLocation {
  return {
    id: row.id,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    isHome: row.is_home === 1,
    accuracyRadiusKm: row.accuracy_radius_km ?? undefined,
  };
}
