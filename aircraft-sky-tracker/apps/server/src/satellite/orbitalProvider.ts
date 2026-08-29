/**
 * Orbital-data provider abstraction (FRD v3.2 §38-40).
 *
 * CelesTrak is the default source. The FRD prefers OMM JSON for six-digit
 * catalogue support (§39); this implementation fetches CelesTrak's curated
 * GROUPs (stations, visual/bright, starlink) - which cover the default
 * "Interesting & Visible" set - and parses them via satellite.js. The provider
 * interface allows the orbital-data source (and format) to change without
 * touching the satellite engine or the frontend.
 */

import * as satellite from "satellite.js";
import type { SatelliteCategory } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("orbital.celestrak");
const BASE = "https://celestrak.org/NORAD/elements/gp.php";
const REQUEST_TIMEOUT_MS = 15000;

export interface OrbitalElement {
  catalogNumber: string;
  name: string;
  category: SatelliteCategory;
  satrec: satellite.SatRec;
  /** International designator from TLE line 1, e.g. "1998-067A". */
  intlDesignator?: string;
}

export interface OrbitalDataProvider {
  readonly name: string;
  fetchElements(includeStarlink: boolean): Promise<OrbitalElement[]>;
}

interface GroupSpec {
  group: string;
  category: SatelliteCategory;
}

export class CelesTrakProvider implements OrbitalDataProvider {
  readonly name = "CelesTrak";

  async fetchElements(includeStarlink: boolean): Promise<OrbitalElement[]> {
    const specs: GroupSpec[] = [
      { group: "stations", category: "station" },
      { group: "visual", category: "bright" },
    ];
    if (includeStarlink) specs.push({ group: "starlink", category: "starlink" });

    const byCatalog = new Map<string, OrbitalElement>();
    for (const spec of specs) {
      try {
        const elements = await this.fetchGroup(spec);
        for (const el of elements) {
          // Prefer the more specific category (station > bright > starlink).
          if (!byCatalog.has(el.catalogNumber)) byCatalog.set(el.catalogNumber, el);
        }
      } catch (err) {
        log.warn("group fetch failed", { group: spec.group, error: String(err) });
      }
    }
    return [...byCatalog.values()];
  }

  private async fetchGroup(spec: GroupSpec): Promise<OrbitalElement[]> {
    const url = `${BASE}?GROUP=${encodeURIComponent(spec.group)}&FORMAT=tle`;
    const res = await fetch(url, {
      headers: { Accept: "text/plain" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`CelesTrak HTTP ${res.status}`);
    const text = await res.text();
    return parseTle(text, spec.category);
  }
}

/** Expand a TLE international designator "98067A" into "1998-067A". */
function formatIntlDesignator(raw: string): string | undefined {
  const m = /^(\d{2})(\d{3})([A-Z]{1,3})$/.exec(raw);
  if (!m) return undefined;
  const yy = Number(m[1]);
  const year = yy < 57 ? 2000 + yy : 1900 + yy; // space age began 1957
  return `${year}-${m[2]}${m[3]}`;
}

/** Parse 3-line TLE text (name + two element lines) into records. */
export function parseTle(text: string, category: SatelliteCategory): OrbitalElement[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
  const out: OrbitalElement[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!name || !l1 || !l2 || !l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    try {
      const satrec = satellite.twoline2satrec(l1, l2);
      const catalogNumber = l1.slice(2, 7).trim();
      out.push({
        catalogNumber,
        name: name.trim(),
        category,
        satrec,
        intlDesignator: formatIntlDesignator(l1.slice(9, 17).trim()),
      });
    } catch {
      /* skip malformed element set */
    }
  }
  return out;
}
