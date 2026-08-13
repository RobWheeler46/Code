/** Route (destination) cache with expiry (FRD §20, §37). */

import type { DatabaseSync } from "node:sqlite";
import type { RouteConfidence } from "@ast/shared";
import { getDatabase } from "./db.js";

export interface CachedRoute {
  callsign: string;
  originIcao?: string;
  originIata?: string;
  originName?: string;
  destinationIcao?: string;
  destinationIata?: string;
  destinationName?: string;
  destinationDisplayName?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  airline?: string;
  confidence: RouteConfidence;
  updatedAt: string;
  expiresAt: string;
  source: string;
}

interface RouteRow {
  callsign: string;
  origin_icao: string | null;
  origin_iata: string | null;
  origin_name: string | null;
  destination_icao: string | null;
  destination_iata: string | null;
  destination_name: string | null;
  destination_display_name: string | null;
  destination_latitude: number | null;
  destination_longitude: number | null;
  airline: string | null;
  confidence: string;
  updated_at: string;
  expires_at: string;
  source: string;
}

function opt<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

function rowToRoute(row: RouteRow): CachedRoute {
  return {
    callsign: row.callsign,
    originIcao: opt(row.origin_icao),
    originIata: opt(row.origin_iata),
    originName: opt(row.origin_name),
    destinationIcao: opt(row.destination_icao),
    destinationIata: opt(row.destination_iata),
    destinationName: opt(row.destination_name),
    destinationDisplayName: opt(row.destination_display_name),
    destinationLatitude: opt(row.destination_latitude),
    destinationLongitude: opt(row.destination_longitude),
    airline: opt(row.airline),
    confidence: row.confidence as RouteConfidence,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    source: row.source,
  };
}

export class RouteCacheRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  /** Returns a cached route only if it has not expired. */
  get(callsign: string, now: Date = new Date()): CachedRoute | undefined {
    const row = this.db
      .prepare("SELECT * FROM route_cache WHERE callsign = ?")
      .get(callsign) as RouteRow | undefined;
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= now.getTime()) return undefined;
    return rowToRoute(row);
  }

  put(route: CachedRoute): void {
    this.db
      .prepare(
        `INSERT INTO route_cache (
          callsign, origin_icao, origin_iata, origin_name,
          destination_icao, destination_iata, destination_name,
          destination_display_name, destination_latitude, destination_longitude,
          airline, confidence, updated_at, expires_at, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(callsign) DO UPDATE SET
          origin_icao = excluded.origin_icao,
          origin_iata = excluded.origin_iata,
          origin_name = excluded.origin_name,
          destination_icao = excluded.destination_icao,
          destination_iata = excluded.destination_iata,
          destination_name = excluded.destination_name,
          destination_display_name = excluded.destination_display_name,
          destination_latitude = excluded.destination_latitude,
          destination_longitude = excluded.destination_longitude,
          airline = excluded.airline,
          confidence = excluded.confidence,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          source = excluded.source`,
      )
      .run(
        route.callsign,
        route.originIcao ?? null,
        route.originIata ?? null,
        route.originName ?? null,
        route.destinationIcao ?? null,
        route.destinationIata ?? null,
        route.destinationName ?? null,
        route.destinationDisplayName ?? null,
        route.destinationLatitude ?? null,
        route.destinationLongitude ?? null,
        route.airline ?? null,
        route.confidence,
        route.updatedAt,
        route.expiresAt,
        route.source,
      );
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM route_cache")
      .get() as { n: number };
    return row.n;
  }
}
