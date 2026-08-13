/**
 * Local airport display-name table (FRD §18) and destination-name derivation
 * (FRD §17). Optional: route display still works without a table entry.
 */

/** ICAO -> concise display name. Extend freely; not required for correctness. */
export const AIRPORT_DISPLAY_NAMES: Record<string, string> = {
  EGLL: "Heathrow",
  EGKK: "Gatwick",
  EGCC: "Manchester",
  EGPH: "Edinburgh",
  EGGD: "Bristol",
  EGPF: "Glasgow",
  EGAC: "Belfast City",
  EGAA: "Belfast",
  EGNX: "East Midlands",
  EGBB: "Birmingham",
  EGSS: "Stansted",
  EGGW: "Luton",
  EGHH: "Bournemouth",
  EGFF: "Cardiff",
  EGNT: "Newcastle",
  EGPD: "Aberdeen",
  EGPE: "Inverness",
  EIDW: "Dublin",
  LEAL: "Alicante",
  LEPA: "Palma",
  LEMG: "Malaga",
  LPFR: "Faro",
  EHAM: "Amsterdam",
  LFPG: "Paris CDG",
  EDDF: "Frankfurt",
  LEBL: "Barcelona",
  LEMD: "Madrid",
  GCTS: "Tenerife",
};

export interface AirportRef {
  icao?: string;
  iata?: string;
  name?: string;
}

/**
 * Derive a concise destination display name using the precedence in FRD §17:
 *   1. Friendly display name (from the table)
 *   2. Recognisable airport name (provider "name", trimmed of "Airport")
 *   3. Airport code (IATA, then ICAO)
 * The compass-heading and "nothing" fallbacks (items 4-5) are applied by the
 * display when there is no route at all.
 */
export function deriveDisplayName(ref: AirportRef): string | undefined {
  if (ref.icao) {
    const friendly = AIRPORT_DISPLAY_NAMES[ref.icao.toUpperCase()];
    if (friendly) return friendly;
  }
  if (ref.name && ref.name.trim().length > 0) {
    return tidyAirportName(ref.name);
  }
  if (ref.iata && ref.iata.trim().length > 0) return ref.iata.trim().toUpperCase();
  if (ref.icao && ref.icao.trim().length > 0) return ref.icao.trim().toUpperCase();
  return undefined;
}

/** "Edinburgh Airport" -> "Edinburgh"; leaves genuinely descriptive names. */
function tidyAirportName(name: string): string {
  const trimmed = name.trim();
  const withoutSuffix = trimmed.replace(/\s+(International\s+)?Airport$/i, "").trim();
  return withoutSuffix.length > 0 ? withoutSuffix : trimmed;
}
