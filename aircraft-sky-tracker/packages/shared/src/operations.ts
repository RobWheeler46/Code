/**
 * Operational flight intelligence (FRD v3.8 §21, §35-44, §53). This is the
 * "what flight is it operating and what stage is it in" layer that sits on top
 * of ADS-B positional truth: OOOI flight events, flight state, ETA, route
 * corroboration and possible route changes. Positional truth (lat/lon/alt) is
 * never derived from here (§17, §124).
 */

import type { RouteConfidence } from "./aircraft.js";

/** OOOI event: OUT (gate), OFF (takeoff), ON (landing), IN (gate). */
export type OooiEventType = "out" | "off" | "on" | "in";

/** ISO timestamps for the current flight's OOOI events (§35). */
export interface OooiTimes {
  out?: string;
  off?: string;
  on?: string;
  in?: string;
}

/** Derived flight stage (§37). */
export type FlightState =
  | "at-gate"
  | "departed-gate"
  | "airborne"
  | "en-route"
  | "landed"
  | "arrived"
  | "unknown";

export type EtaSource = "provider" | "calculated";
export interface Eta {
  time: string;
  source: EtaSource;
}

/** Possible-diversion confidence (§44). */
export type DiversionConfidence = "possible" | "likely" | "confirmed";
export interface PossibleRouteChange {
  previousDestination: string;
  newDestination: string;
  confidence: DiversionConfidence;
}

/** The operational picture for one aircraft (the /flight-intelligence shape). */
export interface FlightIntelligence {
  /** True when any operational enrichment is available (§108 degrade path). */
  available: boolean;
  callsign?: string;
  airline?: string;
  origin?: string;
  destination?: string;
  routeConfidence: RouteConfidence;
  flightState: FlightState;
  oooi: OooiTimes;
  eta?: Eta;
  possibleRouteChange?: PossibleRouteChange;
  /** Providers that contributed evidence, e.g. ["airframes","adsbdb","ADS-B"]. */
  sources: string[];
}

/**
 * Derive the flight stage from OOOI evidence and live ADS-B airborne status
 * (§37). Later events dominate: IN > ON > OFF > OUT; ADS-B fills the gaps.
 */
export function deriveFlightState(oooi: OooiTimes, airborne: boolean): FlightState {
  if (oooi.in) return "arrived";
  if (oooi.on) return "landed";
  if (oooi.off) return airborne ? "en-route" : "airborne";
  if (oooi.out) return "departed-gate";
  return airborne ? "airborne" : "unknown";
}

/** Human-readable flight state (§36 - the user need not know "OOOI"). */
export function flightStateLabel(state: FlightState): string {
  switch (state) {
    case "at-gate":
      return "At gate";
    case "departed-gate":
      return "Departed gate";
    case "airborne":
      return "Airborne";
    case "en-route":
      return "En route";
    case "landed":
      return "Landed";
    case "arrived":
      return "Arrived at gate";
    default:
      return "Unknown";
  }
}

/** OOOI rows translated for the details panel (§36). */
export function oooiRows(oooi: OooiTimes): { label: string; time: string | undefined }[] {
  return [
    { label: "Departed gate", time: oooi.out },
    { label: "Airborne", time: oooi.off },
    { label: "Landed", time: oooi.on },
    { label: "At gate", time: oooi.in },
  ];
}
