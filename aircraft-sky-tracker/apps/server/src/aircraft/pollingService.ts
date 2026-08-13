/**
 * AircraftPollingService (FRD §11, §29, §69-70).
 *
 * Polls the aircraft provider on an interval (default 1100ms - close to the
 * provider's 1 req/sec limit) and passes results to the state service. Handles
 * provider errors with exponential backoff and reports source health.
 */

import type { ProviderAircraft } from "@ast/shared";
import type { SourceStatus } from "@ast/shared";
import type { AircraftProvider } from "../providers/types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("polling");

/** Backoff schedule after consecutive failures (FRD §69). */
function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 1) return 0; // 1st failure: next normal cycle
  if (consecutiveFailures === 2) return 5_000;
  if (consecutiveFailures === 3) return 10_000;
  if (consecutiveFailures <= 5) return 30_000;
  return 60_000; // maximum
}

export interface Centre {
  latitude: number;
  longitude: number;
  radiusMiles: number;
}

export interface PollResultMeta {
  durationMs: number;
  received: number;
}

export interface PollingCallbacks {
  onResult(aircraft: ProviderAircraft[], meta: PollResultMeta): void;
  onStatusChange(status: SourceStatus): void;
  onError(message: string): void;
}

export class AircraftPollingService {
  private provider: AircraftProvider;
  private readonly intervalMs: number;
  private readonly callbacks: PollingCallbacks;

  private centre: Centre | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private consecutiveFailures = 0;
  private status: SourceStatus = "disconnected";

  // Diagnostics (FRD §43, §67).
  lastPollDurationMs = 0;
  lastSuccessfulPoll: string | undefined;
  lastPollAtMs = 0;

  constructor(
    provider: AircraftProvider,
    intervalMs: number,
    callbacks: PollingCallbacks,
  ) {
    this.provider = provider;
    this.intervalMs = intervalMs;
    this.callbacks = callbacks;
  }

  getStatus(): SourceStatus {
    return this.status;
  }

  getProviderName(): string {
    return this.provider.name;
  }

  setProvider(provider: AircraftProvider): void {
    this.provider = provider;
  }

  /** Set (or update) the tracking centre; safe to call while running. */
  setCentre(centre: Centre): void {
    this.centre = centre;
  }

  start(): void {
    if (this.running) return;
    if (!this.centre) {
      log.warn("cannot start polling without a resolved centre (FRD §85)");
      return;
    }
    this.running = true;
    log.info("aircraft polling started", {
      provider: this.provider.name,
      intervalMs: this.intervalMs,
    });
    this.scheduleNext(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.setStatus("disconnected");
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.pollOnce(), delayMs);
  }

  private async pollOnce(): Promise<void> {
    if (!this.running || !this.centre) return;
    const centre = this.centre;
    const startedAt = Date.now();
    try {
      const aircraft = await this.provider.fetchAircraft(
        centre.latitude,
        centre.longitude,
        centre.radiusMiles,
      );
      const durationMs = Date.now() - startedAt;
      this.lastPollDurationMs = durationMs;
      this.lastPollAtMs = Date.now();
      this.lastSuccessfulPoll = new Date().toISOString();
      this.consecutiveFailures = 0;
      this.setStatus("connected");
      this.callbacks.onResult(aircraft, { durationMs, received: aircraft.length });
      this.scheduleNext(this.intervalMs);
    } catch (err) {
      this.consecutiveFailures++;
      const wait = Math.max(backoffMs(this.consecutiveFailures), this.intervalMs);
      this.setStatus("reconnecting");
      this.callbacks.onError(String(err));
      log.warn("aircraft poll failed", {
        provider: this.provider.name,
        consecutiveFailures: this.consecutiveFailures,
        retryInMs: wait,
        error: String(err),
      });
      this.scheduleNext(wait);
    }
  }

  private setStatus(status: SourceStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange(status);
  }
}
