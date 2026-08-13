/**
 * Failover aircraft provider (FRD §22).
 *
 * Wraps an ordered list of providers. It uses the highest-priority provider
 * that is currently healthy; when one throws it is put in a short cooldown and
 * the next provider is tried, so a single source going down (e.g. airplanes.live
 * starting to return 403) cannot take the display offline. When a failed
 * provider's cooldown expires it is retried first again, so the system
 * automatically recovers to its preferred source.
 *
 * An empty result is a success (no traffic overhead), not a failure - failover
 * only happens on an actual error.
 */

import type { ProviderAircraft } from "@ast/shared";
import type { AircraftProvider } from "./types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("provider.failover");
const DEFAULT_COOLDOWN_MS = 30_000;

export interface FailoverOptions {
  cooldownMs?: number;
  /** Injectable clock for testing. */
  now?: () => number;
}

export class FailoverProvider implements AircraftProvider {
  private readonly providers: AircraftProvider[];
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly cooldownUntil: number[];
  private activeIndex = -1;

  constructor(providers: AircraftProvider[], options: FailoverOptions = {}) {
    if (providers.length === 0) {
      throw new Error("FailoverProvider requires at least one provider");
    }
    this.providers = providers;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
    this.cooldownUntil = providers.map(() => 0);
  }

  /** Reports the currently active provider so diagnostics show the real source. */
  get name(): string {
    const active = this.providers[this.activeIndex];
    return active ? active.name : "failover";
  }

  async fetchAircraft(
    latitude: number,
    longitude: number,
    radiusMiles: number,
  ): Promise<ProviderAircraft[]> {
    const now = this.now();
    let firstError: unknown;

    for (let i = 0; i < this.providers.length; i++) {
      if (now < (this.cooldownUntil[i] ?? 0)) continue; // still cooling down
      const provider = this.providers[i] as AircraftProvider;
      try {
        const result = await provider.fetchAircraft(latitude, longitude, radiusMiles);
        this.cooldownUntil[i] = 0;
        if (this.activeIndex !== i) {
          log.info("aircraft source selected", {
            provider: provider.name,
            failover: i > 0,
          });
          this.activeIndex = i;
        }
        return result;
      } catch (err) {
        this.cooldownUntil[i] = now + this.cooldownMs;
        firstError = firstError ?? err;
        log.warn("provider failed; failing over", {
          provider: provider.name,
          cooldownMs: this.cooldownMs,
          error: String(err),
        });
      }
    }

    // Everything is either failing or cooling down.
    this.activeIndex = -1;
    throw firstError ?? new Error("all aircraft providers are cooling down");
  }
}
