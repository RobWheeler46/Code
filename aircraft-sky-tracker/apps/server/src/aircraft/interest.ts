/**
 * Interesting-aircraft detection (FRD Phase 3).
 *
 * Flags aircraft that are worth a second look: military or DB-flagged special
 * aircraft (from the provider's dbFlags), notable heavy types (A380, 747,
 * Antonov), helicopters, unusually low aircraft, and anything on the user's
 * watchlist. Detection never changes an aircraft's position or visibility - it
 * only adds an optional `interest` marker used for highlighting and alerts.
 */

import type { AircraftInterest, AircraftCategory } from "@ast/shared";
import { isFighterType, isMilitaryType } from "@ast/shared";

/** Default altitude below which a fixed-wing aircraft is "low" (FRD v3.0 §50). */
export const DEFAULT_LOW_ALTITUDE_FEET = 3000;

/** dbFlags bit flags used by the re-api providers (airplanes.live / adsb.fi). */
const FLAG_MILITARY = 1;
const FLAG_INTERESTING = 2;

/** Notable heavy / unusual types -> friendly label. */
const NOTABLE_TYPES: Record<string, string> = {
  A388: "A380",
  B741: "747",
  B742: "747",
  B743: "747",
  B744: "747",
  B748: "747",
  B74S: "747",
  B74R: "747",
  A124: "An-124",
  A225: "An-225",
  BLCF: "Dreamlifter",
  A337: "BelugaXL",
  BELU: "Beluga",
};

export interface InterestInput {
  icaoHex: string;
  registration?: string;
  callsign?: string;
  aircraftTypeCode?: string;
  aircraftCategory?: AircraftCategory;
  altitudeFeet?: number;
  providerFlags?: number;
}

/** Normalise an identifier/type token for watchlist comparison. */
function norm(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Parse a comma/space separated watchlist into normalised tokens. */
export function parseWatchlist(watchlist: string | undefined): string[] {
  if (!watchlist) return [];
  const seen = new Set<string>();
  for (const token of watchlist.split(/[\s,]+/)) {
    const t = norm(token);
    if (t.length > 0) seen.add(t);
  }
  return [...seen];
}

/**
 * Evaluate an aircraft against the interesting-aircraft rules. Returns undefined
 * when nothing matches. `watchlist` is the pre-parsed token list.
 */
export function evaluateInterest(
  input: InterestInput,
  watchlist: string[],
  lowAltitudeFeet: number = DEFAULT_LOW_ALTITUDE_FEET,
): AircraftInterest | undefined {
  const reasons: string[] = [];
  const flags = typeof input.providerFlags === "number" ? input.providerFlags : 0;

  const militaryByFlag = (flags & FLAG_MILITARY) !== 0;
  if (militaryByFlag) reasons.push("Military");
  else if (flags & FLAG_INTERESTING) reasons.push("Notable");

  // Type-based military / fighter detection (FRD v3.0 §49).
  if (isFighterType(input.aircraftTypeCode)) {
    reasons.push("Fighter");
  } else if (!militaryByFlag && isMilitaryType(input.aircraftTypeCode)) {
    reasons.push("Military");
  }

  const typeCode = input.aircraftTypeCode ? norm(input.aircraftTypeCode) : "";
  const notable = NOTABLE_TYPES[typeCode];
  if (notable) reasons.push(notable);

  if (input.aircraftCategory === "helicopter") reasons.push("Helicopter");

  if (
    input.altitudeFeet !== undefined &&
    input.altitudeFeet > 0 &&
    input.altitudeFeet <= lowAltitudeFeet &&
    input.aircraftCategory !== "helicopter"
  ) {
    reasons.push("Low");
  }

  if (watchlist.length > 0 && matchesWatchlist(input, watchlist)) {
    reasons.push("Watchlist");
  }

  if (reasons.length === 0) return undefined;
  return { label: reasons[0] as string, reasons };
}

function matchesWatchlist(input: InterestInput, watchlist: string[]): boolean {
  const candidates = [
    input.registration,
    input.aircraftTypeCode,
    input.icaoHex,
    input.callsign,
  ]
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(norm);
  return candidates.some((c) => watchlist.includes(c));
}
