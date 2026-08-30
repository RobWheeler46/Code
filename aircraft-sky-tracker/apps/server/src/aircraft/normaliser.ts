/**
 * AircraftNormaliser (FRD §12-13, §29).
 *
 * Converts provider-specific fields to the internal model and applies position
 * eligibility. Aircraft with no current geographic position, or a position that
 * is too old, are not displayable (FRD §13).
 */

import type { ProviderAircraft, TechnicalAdsb } from "@ast/shared";

/** Max position age, in seconds, for an aircraft to be displayable (FRD §54). */
export const MAX_POSITION_AGE_SECONDS = 30;

export interface NormalisedAircraft {
  id: string;
  icaoHex: string;
  registration?: string;
  callsign?: string;
  latitude: number;
  longitude: number;
  altitudeFeet?: number;
  groundSpeedKnots?: number;
  trackDegrees?: number;
  onGround?: boolean;
  aircraftTypeCode?: string;
  /** Provider dbFlags (military / interesting bits), when numeric. */
  providerFlags?: number;
  verticalRateFpm?: number;
  squawk?: string;
  emergency?: string;
  technical?: TechnicalAdsb;
  positionAgeSeconds: number;
  source: string;
}

/**
 * Normalise a provider aircraft. Returns undefined when the aircraft is not
 * eligible for display (missing position, or stale beyond the freshness policy).
 */
export function normaliseAircraft(
  raw: ProviderAircraft,
  source: string,
): NormalisedAircraft | undefined {
  if (typeof raw.latitude !== "number" || typeof raw.longitude !== "number") {
    return undefined; // No current geographic position (FRD §13).
  }
  const age = typeof raw.positionAgeSeconds === "number" ? raw.positionAgeSeconds : 0;
  if (age > MAX_POSITION_AGE_SECONDS) {
    return undefined;
  }

  const callsign =
    typeof raw.callsign === "string" && raw.callsign.trim().length > 0
      ? raw.callsign.trim()
      : undefined;

  return {
    id: raw.icaoHex,
    icaoHex: raw.icaoHex,
    registration: raw.registration?.trim() || undefined,
    callsign,
    latitude: raw.latitude,
    longitude: raw.longitude,
    altitudeFeet: raw.altitudeFeet,
    groundSpeedKnots: raw.groundSpeedKnots,
    trackDegrees: raw.trackDegrees,
    onGround: raw.onGround === true ? true : undefined,
    aircraftTypeCode: raw.aircraftTypeCode?.trim() || undefined,
    providerFlags: typeof raw.providerFlags === "number" ? raw.providerFlags : undefined,
    verticalRateFpm: raw.verticalRateFpm,
    squawk: raw.squawk,
    emergency: raw.emergency,
    technical: raw.technical,
    positionAgeSeconds: age,
    source,
  };
}
