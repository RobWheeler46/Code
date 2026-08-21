/** Aircraft pass history model (FRD v3.0 §56-63). */

import type { RouteConfidence } from "./aircraft.js";

/**
 * A single "pass" - one continuous period an aircraft spent within the tracking
 * radius. History records passes, not raw ADS-B positions (FRD §56), which keeps
 * storage small while retaining the meaningful summary of each visit.
 */
export interface HistoryPass {
  passId: string;
  icaoHex: string;
  registration?: string;
  callsign?: string;
  aircraftType?: string;
  aircraftDescription?: string;
  /** ISO timestamps. */
  firstSeen: string;
  lastSeen: string;
  origin?: string;
  destination?: string;
  routeConfidence?: RouteConfidence;
  closestApproachMiles: number;
  minimumAltitudeFeet?: number;
  maximumAltitudeFeet?: number;
  maximumGroundSpeedKnots?: number;
  interesting: boolean;
  interestingReasons: string[];
  /** Local (UK) calendar date the pass belongs to, YYYY-MM-DD (FRD §61). */
  createdDate: string;
}

/** Summary of a retained history date, for the date selector (FRD §61). */
export interface HistoryDate {
  date: string;
  passes: number;
}
