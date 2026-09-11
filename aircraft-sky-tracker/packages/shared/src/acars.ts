/**
 * Live ACARS / VDL2 datalink messages (FRD v3.9 - Live Datalink & Aircraft
 * Communications). Structured, decoded datalink messages correlated to the live
 * aircraft, shown in the details panel. This is enrichment on top of ADS-B
 * positional truth and operational intelligence - never a source of position.
 *
 * Policy is central to this feature and enforced server-side:
 *   - display is OFF by default (§Live ACARS Message Display);
 *   - the default when enabled is DECODED ONLY;
 *   - the original raw payload is exposed only where BOTH the deployment permits
 *     it (ALLOW_RAW_ACARS_DISPLAY) AND the user chose "full" - a user preference
 *     can never override the deployment restriction (§Legal / Deployment Control).
 */

/** Datalink medium the message arrived on. */
export type AcarsMedium = "VDL2" | "ACARS" | "HFDL" | "SATCOM";

/** Decoded, human-understandable category (§Message Categories). */
export type AcarsCategory =
  | "position"
  | "flight_management"
  | "oooi"
  | "weather"
  | "route"
  | "eta"
  | "operational"
  | "technical"
  | "other";

/** Strength of the aircraft correlation (§Aircraft Correlation). */
export type MessageCorrelationConfidence = "confirmed" | "high" | "medium" | "low";

/** Message-display policy value (§Sensitive Message Handling). */
export type AcarsDisplayMode = "off" | "decoded" | "full";

export interface AcarsDecoded {
  /** One-line human summary, e.g. "Position report". */
  summary: string;
  /** Extra decoded detail lines, e.g. ["Altitude FL350", "Track 118"]. */
  lines?: string[];
}

/** A normalised datalink message ready for display (§API normalised response). */
export interface AcarsMessage {
  id: string;
  aircraftId: string; // ICAO hex
  timestamp: string; // ISO
  medium: AcarsMedium;
  /** Raw ACARS label code, e.g. "H1", "SA" (shown alongside the decoded category). */
  label?: string;
  category: AcarsCategory;
  decoded: AcarsDecoded;
  /** True only when a raw payload exists AND policy permits exposing it. */
  rawTextAvailable: boolean;
  /** The original payload - present only where policy allows full display. */
  raw?: string;
  source: string; // "airframes" | "simulation"
  correlationConfidence: MessageCorrelationConfidence;
  /** Optional provenance: the receiving station/network (§Message Source). */
  receivingStation?: string;
}

/** Datalink activity summary for the details panel (§Message Count). */
export interface DatalinkSummary {
  active: boolean;
  lastMessageAt?: string;
  messagesThisPass: number;
}

/** Categories shown in the standard user-facing view (§Default Filtering). */
export const DEFAULT_VISIBLE_CATEGORIES: readonly AcarsCategory[] = [
  "position",
  "route",
  "oooi",
  "eta",
  "weather",
  "flight_management",
];

/** Whether a category belongs in the standard (non-technical) view. */
export function isDefaultVisibleCategory(category: AcarsCategory): boolean {
  return DEFAULT_VISIBLE_CATEGORIES.includes(category);
}

/** Human label for a decoded category (§Message Categories). */
export function acarsCategoryLabel(category: AcarsCategory): string {
  switch (category) {
    case "position":
      return "Position";
    case "flight_management":
      return "Flight management";
    case "oooi":
      return "OOOI / flight state";
    case "weather":
      return "Weather";
    case "route":
      return "Route / flight plan";
    case "eta":
      return "ETA update";
    case "operational":
      return "Operational";
    case "technical":
      return "Technical";
    default:
      return "Other";
  }
}

/**
 * The effective raw-payload permission (§Legal / Deployment Control). Raw text is
 * available only where the deployment allows it AND the user chose "full". The
 * user preference can never widen what the deployment permits.
 */
export function rawDisplayAllowed(
  deploymentAllowsRaw: boolean,
  mode: AcarsDisplayMode,
): boolean {
  return deploymentAllowsRaw && mode === "full";
}

/** A correlation strong enough to display a message against an aircraft (§Correlation). */
export function isDisplayableCorrelation(c: MessageCorrelationConfidence): boolean {
  return c === "confirmed" || c === "high";
}
