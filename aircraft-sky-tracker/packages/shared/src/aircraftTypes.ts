/**
 * Aircraft type classification (FRD v3.0 §20).
 *
 * Two derived values from an ICAO type code (e.g. "A320", "B744", "EC35"):
 *   - a fine-grained SILHOUETTE used to pick the display outline, classified
 *     most-specific-first (FRD §20);
 *   - a broad CATEGORY used by interesting-aircraft rules (helicopter / low).
 *
 * Unknown/unmatched codes fall back to "generic", so classification only ever
 * improves the picture, never breaks it.
 */

export type AircraftCategory =
  | "jet"
  | "turboprop"
  | "piston"
  | "helicopter"
  | "unknown";

export type AircraftSilhouette =
  | "a320"
  | "b737"
  | "a380"
  | "b747"
  | "bizjet"
  | "turboprop"
  | "helicopter"
  | "light"
  | "a400m"
  | "c17"
  | "fighter"
  | "military"
  | "generic";

const B747_TYPES = new Set([
  "B741", "B742", "B743", "B744", "B748", "B74S", "B74R", "B74D", "BLCF",
]);

const A320_FAMILY = new Set([
  "A318", "A319", "A320", "A321", "A19N", "A20N", "A21N", "A32", "A32M",
]);

const B737_FAMILY = new Set([
  "B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739",
  "B37M", "B38M", "B39M", "B3XM", "E737", "P8",
]);

/** Fast jets / fighters. */
const FIGHTER_TYPES = new Set([
  "F16", "F15", "F18", "F22", "F35", "F14", "F5", "F4", "EUFI", "TYPH",
  "RAFL", "GRIP", "TOR", "GR4", "HAR", "HAWK", "A10", "EA18", "F117", "T38",
  "M2000", "MIR2", "MRF1", "J39", "SU25", "SU27", "SU30", "SU35", "MG29",
  "MG31", "PC9", "PC21", "T6",
]);

/** Additional types that mark a military aircraft (for interest, FRD §49). */
const MILITARY_MARKER_TYPES = new Set([
  "C130", "C30J", "C17", "A400", "K35R", "KC135", "KC10", "C5M", "C5",
  "E3TF", "E3CF", "E3", "E6", "P3", "C295", "C27J", "CH47", "H47", "MERL",
  "A124", "A225", "C160", "VC10", "NIM", "R135", "E8", "U2", "RC135",
]);

const BIZJET_TYPES = new Set([
  "C25A", "C25B", "C25C", "C500", "C510", "C525", "C526", "C550", "C560",
  "C56X", "C650", "C680", "C68A", "C700", "C750", "CL30", "CL35", "CL60",
  "CL64", "GLF4", "GLF5", "GLF6", "GLEX", "G280", "GA5C", "GA6C", "GA7C",
  "E50P", "E55P", "E545", "E550", "LJ31", "LJ35", "LJ45", "LJ60", "LJ75",
  "H25B", "HA4T", "PC24", "BE40", "FA50", "FA7X", "FA8X", "F900", "F2TH",
  "PRM1", "SF50", "E135", "E145",
]);

/** Common helicopter type codes (UK-relevant subset). */
const HELICOPTERS = new Set([
  "EC20", "EC25", "EC30", "EC35", "EC45", "EC55", "EC75", "H135", "H145",
  "H160", "H175", "A109", "A119", "A139", "A169", "A189", "B06", "B06T",
  "B407", "B412", "B429", "B430", "B505", "R22", "R44", "R66", "S76", "S92",
  "S61", "H500", "H60", "EH10", "AW09", "AW139", "AW169", "AW189", "GAZL",
  "LYNX", "PUMA", "MI8", "MI17", "AS50", "AS55", "AS65", "AS32", "AS3B",
  "EXPL", "EN28", "R66T", "B47G", "H269", "H269C", "WASP",
]);

/** Common turboprop type codes. */
const TURBOPROPS = new Set([
  "DH8A", "DH8B", "DH8C", "DH8D", "AT43", "AT45", "AT72", "AT75", "AT76",
  "B190", "B350", "B300", "BE20", "BE9L", "C208", "C212", "C408", "PC12",
  "PC6T", "TBM7", "TBM8", "TBM9", "TBM", "SF34", "SB20", "SW4", "SW3",
  "E110", "E120", "D228", "D328", "AN12", "AN26", "AN32", "L410", "JS31",
  "JS32", "JS41", "F27", "AT8T", "PAY1", "PAY2", "PAY3", "P180", "C441",
  "DHC6", "CVLT", "EPIC", "M600",
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
  "TB21", "RALL", "JAB", "AC11", "AC12", "S22T", "COZY", "KITF", "EV9",
  "F150", "F172", "CH70", "SLG2", "WT9", "AT3", "PA25", "SPIT", "HURI",
]);

const NORMALISE_RE = /[^A-Z0-9]/g;

function norm(typeCode: string): string {
  return typeCode.toUpperCase().replace(NORMALISE_RE, "");
}

function isHelicopter(code: string): boolean {
  return (
    HELICOPTERS.has(code) ||
    /^(EC|AS|AW|MI)\d/.test(code) ||
    code.startsWith("R22") ||
    code.startsWith("R44")
  );
}

function isPiston(code: string): boolean {
  return (
    PISTON.has(code) ||
    /^RV\d/.test(code) ||
    /^PA\d/.test(code) ||
    /^C1[0-8]\d$/.test(code)
  );
}

function isTurboprop(code: string): boolean {
  return TURBOPROPS.has(code) || /^AT\d/.test(code) || /^DH8/.test(code);
}

/** Classify an ICAO type code into a display silhouette (FRD §20). */
export function aircraftSilhouetteFromType(typeCode?: string): AircraftSilhouette {
  if (!typeCode) return "generic";
  const code = norm(typeCode);
  if (code.length === 0) return "generic";

  // Most specific first (FRD §20).
  if (code === "A388") return "a380";
  if (B747_TYPES.has(code)) return "b747";
  if (code === "A400") return "a400m";
  if (code === "C17") return "c17";
  if (FIGHTER_TYPES.has(code)) return "fighter";
  if (A320_FAMILY.has(code)) return "a320";
  if (B737_FAMILY.has(code)) return "b737";
  if (isHelicopter(code)) return "helicopter";
  if (isTurboprop(code)) return "turboprop";
  if (isPiston(code)) return "light";
  if (BIZJET_TYPES.has(code)) return "bizjet";
  if (MILITARY_MARKER_TYPES.has(code)) return "military";
  return "generic";
}

/** Broad category derived from a silhouette (used by interesting-aircraft rules). */
export function categoryFromSilhouette(sil: AircraftSilhouette): AircraftCategory {
  switch (sil) {
    case "helicopter":
      return "helicopter";
    case "light":
      return "piston";
    case "turboprop":
    case "a400m":
      return "turboprop";
    case "generic":
      return "unknown";
    default:
      return "jet";
  }
}

/** Broad category for a type code (FRD Phase 1.1 / v3.0 §49-50). */
export function aircraftCategoryFromType(typeCode?: string): AircraftCategory {
  return categoryFromSilhouette(aircraftSilhouetteFromType(typeCode));
}

/** Whether a type code denotes a fighter / fast jet (FRD §49). */
export function isFighterType(typeCode?: string): boolean {
  return typeCode ? FIGHTER_TYPES.has(norm(typeCode)) : false;
}

/** Whether a type code denotes a military aircraft (FRD §49). */
export function isMilitaryType(typeCode?: string): boolean {
  if (!typeCode) return false;
  const code = norm(typeCode);
  return (
    FIGHTER_TYPES.has(code) ||
    MILITARY_MARKER_TYPES.has(code) ||
    code === "C17" ||
    code === "A400"
  );
}
