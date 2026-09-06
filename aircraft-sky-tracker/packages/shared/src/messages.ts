/** WebSocket message contract between server and browser (FRD §45-46). */

import type { Aircraft } from "./aircraft.js";
import type { AppConfig } from "./config.js";
import type { Satellite, SatellitePass } from "./satellite.js";
import type { Insight } from "./insights.js";
import type { LookNowPrediction } from "./prediction.js";

export type SourceStatus =
  | "connected"
  | "reconnecting"
  | "disconnected";

/** Full aircraft snapshot broadcast ~once per live-data cycle (FRD §45). */
export interface AircraftSnapshotMessage {
  type: "aircraft.snapshot";
  timestamp: number;
  aircraft: Aircraft[];
}

/** Sent when configuration changes so all clients stay in sync. */
export interface ConfigUpdatedMessage {
  type: "config.updated";
  config: AppConfig;
}

/** Live-data source health changes (FRD §46, §68). */
export interface SourceStatusMessage {
  type: "source.status";
  status: SourceStatus;
}

/** Non-fatal error surfaced to the client. */
export interface ErrorStatusMessage {
  type: "error.status";
  message: string;
}

/** An interesting aircraft has entered the tracking area (FRD v3.0 §52, §74). */
export interface AircraftInterestingEnterMessage {
  type: "aircraft.interesting.enter";
  aircraft: Aircraft;
}

/** Full satellite snapshot (FRD v3.2 §82-83). Logically separate from aircraft. */
export interface SatelliteSnapshotMessage {
  type: "satellite.snapshot";
  timestamp: number;
  satellites: Satellite[];
}

/** An upcoming satellite pass is within the advance-warning window (FRD §61-62). */
export interface SatelliteAlertMessage {
  type: "satellite.alert";
  pass: SatellitePass;
  /** Whole minutes until the pass rises (0 = rising now / in progress). */
  minutesUntil: number;
  timestamp: number;
}

/**
 * Current set of active Sky Insights (FRD v3.8 §63, §103-104). Broadcast whenever
 * the engine adds, refreshes or expires an insight; the client picks the single
 * main-screen one with `pickPrimaryInsight` and lists the rest in details.
 */
export interface InsightsSnapshotMessage {
  type: "insights.snapshot";
  timestamp: number;
  insights: Insight[];
}

/**
 * Sky Insight lifecycle deltas (FRD v3.8 §104). Broadcast as the engine adds,
 * refreshes or expires an insight. The full `insights.snapshot` is still sent on
 * connect for state sync; these deltas keep already-connected clients in step
 * without resending the whole set each cycle.
 */
export interface InsightCreatedMessage {
  type: "insight.created";
  insight: Insight;
  timestamp: number;
}
export interface InsightUpdatedMessage {
  type: "insight.updated";
  insight: Insight;
  timestamp: number;
}
export interface InsightExpiredMessage {
  type: "insight.expired";
  id: string;
  subjectId: string;
  timestamp: number;
}

/** A route/destination decision changed for an aircraft (FRD v3.8 §59, §104). */
export interface RouteUpdatedMessage {
  type: "route.updated";
  aircraftId: string;
  previousDestination: string;
  /** Empty when a divergence is detected but the new destination is unknown. */
  newDestination: string;
  confidence: "possible" | "likely" | "confirmed";
  timestamp: number;
}

/**
 * Current Look Now predictions (FRD v4.0 §16-19): approaching aircraft that are
 * likely to enter the sky shortly, most imminent first. Broadcast when the set
 * changes and sent on connect for state sync.
 */
export interface LookNowMessage {
  type: "looknow.update";
  timestamp: number;
  predictions: LookNowPrediction[];
}

export type ServerMessage =
  | AircraftSnapshotMessage
  | ConfigUpdatedMessage
  | SourceStatusMessage
  | ErrorStatusMessage
  | AircraftInterestingEnterMessage
  | SatelliteSnapshotMessage
  | SatelliteAlertMessage
  | InsightsSnapshotMessage
  | InsightCreatedMessage
  | InsightUpdatedMessage
  | InsightExpiredMessage
  | RouteUpdatedMessage
  | LookNowMessage;

export const WS_PATH = "/ws";
