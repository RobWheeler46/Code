/** Aircraft pass history persistence (FRD v3.0 §56-63, §78). */

import type { DatabaseSync } from "node:sqlite";
import type { HistoryPass, HistoryDate, RouteConfidence } from "@ast/shared";
import { getDatabase } from "./db.js";

interface HistoryRow {
  pass_id: string;
  icao_hex: string;
  registration: string | null;
  callsign: string | null;
  aircraft_type: string | null;
  aircraft_description: string | null;
  first_seen: string;
  last_seen: string;
  origin: string | null;
  destination: string | null;
  route_confidence: string | null;
  closest_approach_miles: number;
  minimum_altitude_feet: number | null;
  maximum_altitude_feet: number | null;
  maximum_ground_speed_knots: number | null;
  interesting: number;
  interesting_reasons: string;
  created_date: string;
}

function opt<T>(v: T | null): T | undefined {
  return v === null ? undefined : v;
}

function rowToPass(row: HistoryRow): HistoryPass {
  let reasons: string[] = [];
  try {
    reasons = JSON.parse(row.interesting_reasons) as string[];
  } catch {
    reasons = [];
  }
  return {
    passId: row.pass_id,
    icaoHex: row.icao_hex,
    registration: opt(row.registration),
    callsign: opt(row.callsign),
    aircraftType: opt(row.aircraft_type),
    aircraftDescription: opt(row.aircraft_description),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    origin: opt(row.origin),
    destination: opt(row.destination),
    routeConfidence: opt(row.route_confidence) as RouteConfidence | undefined,
    closestApproachMiles: row.closest_approach_miles,
    minimumAltitudeFeet: opt(row.minimum_altitude_feet),
    maximumAltitudeFeet: opt(row.maximum_altitude_feet),
    maximumGroundSpeedKnots: opt(row.maximum_ground_speed_knots),
    interesting: row.interesting !== 0,
    interestingReasons: reasons,
    createdDate: row.created_date,
  };
}

export class HistoryRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync = getDatabase()) {
    this.db = db;
  }

  upsert(pass: HistoryPass): void {
    this.db
      .prepare(
        `INSERT INTO history_passes (
          pass_id, icao_hex, registration, callsign, aircraft_type,
          aircraft_description, first_seen, last_seen, origin, destination,
          route_confidence, closest_approach_miles, minimum_altitude_feet,
          maximum_altitude_feet, maximum_ground_speed_knots, interesting,
          interesting_reasons, created_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(pass_id) DO UPDATE SET
          registration = excluded.registration,
          callsign = excluded.callsign,
          aircraft_type = excluded.aircraft_type,
          aircraft_description = excluded.aircraft_description,
          last_seen = excluded.last_seen,
          origin = excluded.origin,
          destination = excluded.destination,
          route_confidence = excluded.route_confidence,
          closest_approach_miles = excluded.closest_approach_miles,
          minimum_altitude_feet = excluded.minimum_altitude_feet,
          maximum_altitude_feet = excluded.maximum_altitude_feet,
          maximum_ground_speed_knots = excluded.maximum_ground_speed_knots,
          interesting = excluded.interesting,
          interesting_reasons = excluded.interesting_reasons`,
      )
      .run(
        pass.passId,
        pass.icaoHex,
        pass.registration ?? null,
        pass.callsign ?? null,
        pass.aircraftType ?? null,
        pass.aircraftDescription ?? null,
        pass.firstSeen,
        pass.lastSeen,
        pass.origin ?? null,
        pass.destination ?? null,
        pass.routeConfidence ?? null,
        pass.closestApproachMiles,
        pass.minimumAltitudeFeet ?? null,
        pass.maximumAltitudeFeet ?? null,
        pass.maximumGroundSpeedKnots ?? null,
        Number(pass.interesting),
        JSON.stringify(pass.interestingReasons),
        pass.createdDate,
      );
  }

  listByDate(date: string): HistoryPass[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM history_passes WHERE created_date = ? ORDER BY last_seen DESC",
      )
      .all(date) as unknown as HistoryRow[];
    return rows.map(rowToPass);
  }

  listDates(): HistoryDate[] {
    const rows = this.db
      .prepare(
        `SELECT created_date AS date, COUNT(*) AS passes
         FROM history_passes GROUP BY created_date ORDER BY created_date DESC`,
      )
      .all() as unknown as { date: string; passes: number }[];
    return rows.map((r) => ({ date: r.date, passes: r.passes }));
  }

  countByDate(date: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM history_passes WHERE created_date = ?")
      .get(date) as { n: number };
    return row.n;
  }

  countInterestingByDate(date: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM history_passes WHERE created_date = ? AND interesting = 1",
      )
      .get(date) as { n: number };
    return row.n;
  }

  deleteByDate(date: string): number {
    const info = this.db
      .prepare("DELETE FROM history_passes WHERE created_date = ?")
      .run(date);
    return Number(info.changes);
  }

  /** Delete passes whose created_date is before the retention cutoff. */
  deleteExpired(cutoffDate: string): number {
    const info = this.db
      .prepare("DELETE FROM history_passes WHERE created_date < ?")
      .run(cutoffDate);
    return Number(info.changes);
  }
}
