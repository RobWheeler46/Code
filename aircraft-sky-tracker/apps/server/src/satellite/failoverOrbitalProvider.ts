/**
 * Failover orbital-data provider (FRD §77). Tries a primary source (CelesTrak)
 * and falls back to a secondary (Space-Track) when the primary throws or returns
 * nothing, so a single-source outage cannot leave the satellite layer empty.
 * Mirrors the aircraft FailoverProvider. `name` reports the source that last
 * supplied data, for diagnostics.
 */

import type { OrbitalDataProvider, OrbitalElement } from "./orbitalProvider.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("orbital.failover");

export class FailoverOrbitalProvider implements OrbitalDataProvider {
  private active: string;

  constructor(
    private readonly primary: OrbitalDataProvider,
    private readonly secondary?: OrbitalDataProvider,
  ) {
    this.active = primary.name;
  }

  /** The source that most recently supplied elements (for diagnostics). */
  get name(): string {
    return this.active;
  }

  async fetchElements(includeStarlink: boolean): Promise<OrbitalElement[]> {
    try {
      const els = await this.primary.fetchElements(includeStarlink);
      if (els.length > 0) {
        this.active = this.primary.name;
        return els;
      }
      log.warn("primary returned no elements; trying secondary", { primary: this.primary.name });
    } catch (err) {
      log.warn("primary failed; trying secondary", {
        primary: this.primary.name,
        error: String(err),
      });
    }

    if (!this.secondary) return [];
    const els = await this.secondary.fetchElements(includeStarlink);
    if (els.length > 0) {
      this.active = this.secondary.name;
      log.info("serving orbital elements from secondary source", {
        secondary: this.secondary.name,
        loaded: els.length,
      });
    }
    return els;
  }
}
