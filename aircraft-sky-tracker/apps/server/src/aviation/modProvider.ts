/**
 * Military-context provider (FRD v4.0 §37-38). A stable free machine-readable MOD
 * exercise/low-flying API cannot be assumed, so this derives a modest, honest
 * context note from the curated airspace set: if the observer is near a military
 * danger area or MATZ, military training "may be elevated" - phrased as CONTEXT
 * ONLY (§37). It never asserts that a specific aircraft is on an exercise.
 *
 * The provider seam lets a future genuine MOD schedule source replace this.
 */

import { STATUTE_MILES_PER_NM, haversineDistanceMiles } from "@ast/shared";
import type { AirspaceRegion, MilitaryContext } from "@ast/shared";

/** Consider military airspace within this range as "nearby". */
const NEARBY_NM = 35;

export interface ModProvider {
  readonly source: string;
  context(
    observerLat: number,
    observerLon: number,
    regions: AirspaceRegion[],
    now: Date,
  ): MilitaryContext | undefined;
}

/** Context derived from proximity to curated military airspace. */
export class CuratedModProvider implements ModProvider {
  readonly source = "Curated MOD/danger-area context";

  context(
    observerLat: number,
    observerLon: number,
    regions: AirspaceRegion[],
    now: Date,
  ): MilitaryContext | undefined {
    const nearbyMiles = NEARBY_NM * STATUTE_MILES_PER_NM;
    const military = regions.filter(
      (r) => r.type === "danger" || r.type === "MATZ" || r.type === "restricted",
    );
    const near = military.filter((r) => {
      const g = r.geometry;
      if (g.kind !== "circle") return false;
      return haversineDistanceMiles(observerLat, observerLon, g.lat, g.lon) <= nearbyMiles + g.radiusNm * STATUTE_MILES_PER_NM;
    });
    if (near.length === 0) return undefined;

    // Weekday daytime is the usual low-flying/exercise window.
    const day = now.getUTCDay(); // 0 = Sun
    const hour = now.getUTCHours();
    const workingHours = day >= 1 && day <= 5 && hour >= 7 && hour < 19;
    const names = near.map((r) => r.name).slice(0, 3).join(", ");

    return {
      level: workingHours ? "elevated" : "possible",
      note: workingHours
        ? `Military training activity may be elevated today near ${names}.`
        : `Military training areas are nearby (${names}); activity may occur.`,
      source: this.source,
    };
  }
}
