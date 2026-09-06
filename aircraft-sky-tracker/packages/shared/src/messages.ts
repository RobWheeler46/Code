/** WebSocket message contract between server and browser (FRD §45-46). */

import type { Aircraft } from "./aircraft.js";
import type { AppConfig } from "./config.js";
import type { Satellite, SatellitePass } from "./satellite.js";
import type { Insight } from "./insights.js";

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

export type ServerMessage =
  | AircraftSnapshotMessage
  | ConfigUpdatedMessage
  | SourceStatusMessage
  | ErrorStatusMessage
  | AircraftInterestingEnterMessage
  | SatelliteSnapshotMessage
  | SatelliteAlertMessage
  | InsightsSnapshotMessage;

export const WS_PATH = "/ws";
