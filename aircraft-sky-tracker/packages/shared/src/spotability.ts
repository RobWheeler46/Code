/**
 * Spotability (FRD v4.0 §20-24): "how likely am I to actually see this object?"
 * A qualitative score, not false precision. Pure; the server feeds it elevation,
 * slant range, weather and sun position (all already available elsewhere).
 */

export type SpotabilityRating = "excellent" | "good" | "possible" | "poor" | "obscured" | "unknown";

export interface Spotability {
  rating: SpotabilityRating;
  /** Short reason lines for the details panel (§23). */
  reasons: string[];
}

export interface AircraftSpotabilityInput {
  /** Aircraft elevation above the observer horizon, degrees. */
  elevationDeg: number;
  slantRangeMiles: number;
  altitudeFeet?: number;
  /** METAR flight category as a surface-clarity proxy (visibility + ceiling). */
  flightCategory?: "VFR" | "MVFR" | "IFR" | "LIFR" | "UNKNOWN";
  /** Lowest broken/overcast cloud base, feet, if any (for the "layer between" test). */
  cloudBaseFeet?: number;
  /** Sun elevation at the observer, degrees (daylight/twilight/night). */
  sunElevationDeg: number;
}

/**
 * Low-precision solar elevation (degrees) at a location/time. Good to ~0.5°,
 * which is plenty to tell day / twilight / night apart. Standard NOAA-style
 * approximation (no ephemeris dependency).
 */
export function solarElevationDeg(lat: number, lon: number, date: Date): number {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0; // days since J2000
  const g = (357.529 + 0.98560028 * n) % 360; // mean anomaly
  const q = (280.459 + 0.98564736 * n) % 360; // mean longitude
  const L = (q + 1.915 * Math.sin(g * rad) + 0.02 * Math.sin(2 * g * rad)) % 360; // ecliptic lon
  const e = 23.439 - 0.00000036 * n; // obliquity
  const decl = Math.asin(Math.sin(e * rad) * Math.sin(L * rad)) / rad;
  // Equation of time (minutes) -> true solar time.
  const eqt =
    4 *
    (q -
      0.0057183 -
      (Math.atan2(Math.cos(e * rad) * Math.sin(L * rad), Math.cos(L * rad)) / rad)) %
    1440;
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMin = (utcMin + eqt + 4 * lon) % 1440;
  const ha = trueSolarMin / 4 - 180; // hour angle, degrees
  const el =
    Math.asin(
      Math.sin(lat * rad) * Math.sin(decl * rad) +
        Math.cos(lat * rad) * Math.cos(decl * rad) * Math.cos(ha * rad),
    ) / rad;
  return el;
}

/** Assess how easily an aircraft can be seen (§21). Qualitative, honest. */
export function assessAircraftSpotability(input: AircraftSpotabilityInput): Spotability {
  const { elevationDeg, slantRangeMiles, altitudeFeet, flightCategory, cloudBaseFeet, sunElevationDeg } =
    input;
  const reasons: string[] = [`Elevation ${Math.round(elevationDeg)}°`, `Slant range ${slantRangeMiles.toFixed(1)} mi`];

  const day = sunElevationDeg > 0 ? "Yes" : sunElevationDeg > -6 ? "Twilight" : "No";
  reasons.push(`Daylight: ${day}`);

  // Cloud layer between observer and aircraft -> probably obscured (§23).
  if (cloudBaseFeet !== undefined && altitudeFeet !== undefined && altitudeFeet > cloudBaseFeet + 200) {
    reasons.push(`Cloud layer ${cloudBaseFeet.toLocaleString()} ft, aircraft above`);
    return { rating: "obscured", reasons };
  }

  if (elevationDeg < 5) {
    reasons.push("Very low on the horizon");
    return { rating: "poor", reasons };
  }

  // Surface clarity proxy from the METAR flight category.
  const clear = flightCategory === "VFR";
  const partly = flightCategory === "MVFR";
  const poor = flightCategory === "IFR" || flightCategory === "LIFR";
  reasons.push(cloudBaseFeet !== undefined ? "Clear below aircraft" : flightCategory ? `Conditions ${flightCategory}` : "Cloud unknown");

  if (poor) return { rating: "poor", reasons };
  if (partly) return { rating: "possible", reasons };
  if (clear) {
    // Best when reasonably high, close, and in daylight/twilight.
    const excellent = elevationDeg >= 30 && slantRangeMiles <= 15 && sunElevationDeg > -6;
    return { rating: excellent ? "excellent" : "good", reasons };
  }
  return { rating: "unknown", reasons };
}
