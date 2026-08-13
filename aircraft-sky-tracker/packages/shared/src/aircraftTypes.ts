/**
 * Aircraft type classification for type-aware silhouettes (FRD Phase 1.1).
 *
 * Maps an ICAO aircraft type code (e.g. "A320", "EC35", "C172") to a broad
 * visual category. Unknown/unmatched codes fall back to "unknown", which the
 * renderer draws with the generic jet outline - so classification only ever
 * improves the picture, never breaks it.
 */

export type AircraftCategory =
  | "jet"
  | "turboprop"
  | "piston"
  | "helicopter"
  | "unknown";

/** Common helicopter type codes (UK-relevant subset). */
const HELICOPTERS = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "EC75", "H135", "H145",
  "H160", "H175", "A109", "A119", "A139", "A169", "A189", "B06", "B06T",
  "B407", "B412", "B429", "B430", "B505", "R22", "R44", "R66", "S76", "S92",
  "S61", "H500", "H60", "EH10", "AW09", "AW139", "AW169", "AW189", "GAZL",
  "LYNX", "PUMA", "MI8", "MI17", "AS50", "AS55", "AS65", "AS32", "AS3B",
  "CH47", "EXPL", "EN28", "R66T", "B47G", "H269", "H47",
]);

/** Common turboprop type codes. */
const TURBOPROPS = new Set([
  "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT45", "AT72", "AT75", "AT76",
  "B190", "B350", "B300", "BE20", "BE9L", "C208", "C212", "C408", "PC12",
  "PC6T", "TBM7", "TBM8", "TBM9", "TBM", "SF34", "SB20", "SW4", "SW3",
  "E110", "E120", "D228", "D328", "AN12", "AN26", "AN32", "C130", "A400",
  "L410", "JS31", "JS32", "JS41", "F27", "AT8T", "PAY1", "PAY2", "PAY3",
  "P180", "C441", "DHC6", "CVLT", "EPIC", "M600", "PC21",
]);

/** Common piston / light aircraft type codes. */
const PISTON = new Set([
  "C150", "C152", "C162", "C172", "C177", "C182", "C185", "C206", "C210",
  "C310", "C337", "C42", "P28A", "P28B", "P28R", "P28T", "PA18", "PA22",
  "PA24", "PA28", "PA32", "PA34", "PA38", "PA44", "PA46", "SR20", "SR22",
  "DA40", "DA42", "DA20", "DA62", "DV20", "BE33", "BE35", "BE36", "BE58",
  "BE55", "BE76", "RV6", "RV7", "RV8", "RV9", "RV10", "RV12", "RV14",
  "EV97", "G115", "GROB", "AA5", "AA1", "M20P", "M20T", "COL4", "COL3",
  "TAMP", "GLAS", "VANS", "SF25", "DR40", "DR30", "TB20", "TB10", "TB9",
  "TB21", "RALL", "JAB", "P28", "AC11", "AC12", "S22T", "COZY", "KITF",
  "EUROSTAR", "EV9", "F150", "F172", "CH70", "SLG2", "WT9", "AT3", "PA25",
]);

const NORMALISE_RE = /[^A-Z0-9]/g;

/** Classify an ICAO type code into a broad category (FRD Phase 1.1). */
export function aircraftCategoryFromType(typeCode?: string): AircraftCategory {
  if (!typeCode) return "unknown";
  const code = typeCode.toUpperCase().replace(NORMALISE_RE, "");
  if (code.length === 0) return "unknown";

  if (HELICOPTERS.has(code)) return "helicopter";
  if (TURBOPROPS.has(code)) return "turboprop";
  if (PISTON.has(code)) return "piston";

  // Heuristics for families not enumerated above.
  if (/^(EC|AS|AW|MI)\d/.test(code) || code.startsWith("R22") || code.startsWith("R44")) {
    return "helicopter";
  }
  if (/^RV\d/.test(code) || /^PA\d/.test(code) || /^C1[0-8]\d$/.test(code)) {
    return "piston";
  }
  if (/^AT\d/.test(code) || /^DH8/.test(code)) return "turboprop";

  return "unknown";
}
