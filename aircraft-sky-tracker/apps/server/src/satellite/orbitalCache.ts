/**
 * Persistent last-good orbital-element cache (FRD §55, §77). CelesTrak is a
 * single free source; when it is unreachable - especially across a restart -
 * the satellite layer would otherwise be empty. Every successful fetch is saved
 * to the data volume as raw TLE lines, and reloaded at startup so the sky stays
 * populated from the most recent good data until a fresh fetch succeeds. TLEs
 * remain usable for SGP4 for several days, which covers any realistic outage.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SatelliteCategory } from "@ast/shared";
import { elementFromLines, type OrbitalElement } from "./orbitalProvider.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("orbital.cache");

interface CachedRecord {
  name: string;
  category: SatelliteCategory;
  line1: string;
  line2: string;
}

interface CacheFile {
  fetchedAt: string;
  elements: CachedRecord[];
}

export interface CachedElements {
  fetchedAt: number;
  elements: OrbitalElement[];
}

export class OrbitalElementCache {
  constructor(private readonly filePath: string) {}

  /** Persist the current element set as raw TLE lines. Never throws. */
  save(elements: OrbitalElement[], fetchedAt: number = Date.now()): void {
    try {
      const payload: CacheFile = {
        fetchedAt: new Date(fetchedAt).toISOString(),
        elements: elements.map((e) => ({
          name: e.name,
          category: e.category,
          line1: e.line1,
          line2: e.line2,
        })),
      };
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(payload), "utf8");
      log.debug("orbital elements cached", { count: elements.length });
    } catch (err) {
      log.warn("failed to persist orbital cache", { error: String(err) });
    }
  }

  /** Load the last-good element set, or undefined if none / unreadable. */
  load(): CachedElements | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return undefined; // no cache yet
    }
    try {
      const parsed = JSON.parse(raw) as CacheFile;
      if (!Array.isArray(parsed.elements)) return undefined;
      const elements: OrbitalElement[] = [];
      for (const r of parsed.elements) {
        const el = elementFromLines(r.name, r.line1, r.line2, r.category);
        if (el) elements.push(el);
      }
      if (elements.length === 0) return undefined;
      const fetchedAt = Date.parse(parsed.fetchedAt);
      return { fetchedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now(), elements };
    } catch (err) {
      log.warn("failed to read orbital cache", { error: String(err) });
      return undefined;
    }
  }
}
