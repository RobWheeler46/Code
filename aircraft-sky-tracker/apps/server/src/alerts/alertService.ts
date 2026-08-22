/**
 * Interesting-aircraft entry alerts (FRD v3.0 §52-54).
 *
 * Detects when an interesting aircraft ENTERS the tracking area and fires one
 * alert per continuous presence (FRD §53): a second alert only happens after the
 * aircraft has left, an exit-debounce window has passed, and it genuinely
 * re-enters. Each entry drives an in-app / WebSocket alert (via the onEnter
 * callback) and, when a ntfy topic is configured, a phone push. Runs only for
 * the global tracked location, not per-viewer URL overrides.
 */

import type { Aircraft } from "@ast/shared";
import { compassDirection } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("alerts");
const EXIT_DEBOUNCE_MS = 2 * 60 * 1000; // must be gone this long before re-alerting
const REQUEST_TIMEOUT_MS = 6000;

export interface AlertConfig {
  topic: string | undefined;
  server: string;
}

export class AlertService {
  private readonly topic: string | undefined;
  private readonly server: string;
  /** icaoHex -> lastSeen (any aircraft physically present). */
  private readonly present = new Map<string, number>();
  /** icaoHex already alerted during their current presence. */
  private readonly alerted = new Set<string>();

  lastAlert: string | undefined;
  lastAlertAt: string | undefined;

  constructor(config: AlertConfig) {
    this.topic = config.topic;
    this.server = config.server.replace(/\/+$/, "");
  }

  /** Whether phone push (ntfy) is configured. In-app alerts work regardless. */
  get enabled(): boolean {
    return typeof this.topic === "string" && this.topic.length > 0;
  }

  /**
   * Process a snapshot and fire an entry alert for each newly-arrived
   * interesting aircraft. `onEnter` is called for in-app / WebSocket delivery.
   */
  onSnapshot(
    aircraft: Aircraft[],
    now: number,
    onEnter: (aircraft: Aircraft) => void,
  ): void {
    const seen = new Set<string>();

    for (const a of aircraft) {
      seen.add(a.icaoHex);
      this.present.set(a.icaoHex, now);
      if (a.interest && !this.alerted.has(a.icaoHex)) {
        this.alerted.add(a.icaoHex);
        this.record(a);
        onEnter(a);
        if (this.enabled) void this.push(a);
      }
    }

    // Forget aircraft that have been gone longer than the debounce window, so a
    // genuine re-entry alerts again (FRD §53).
    for (const [hex, ts] of this.present) {
      if (seen.has(hex)) continue;
      if (now - ts > EXIT_DEBOUNCE_MS) {
        this.present.delete(hex);
        this.alerted.delete(hex);
      }
    }
  }

  private describe(a: Aircraft): { title: string; body: string } {
    const identifier = a.registration ?? a.callsign ?? a.icaoHex;
    const direction = compassDirection(a.bearingFromCentre);
    const parts = [
      `${a.distanceMiles.toFixed(1)} mi ${direction}`,
      a.altitudeFeet !== undefined ? `${a.altitudeFeet.toLocaleString()} ft` : undefined,
      a.destination?.displayName ? `to ${a.destination.displayName}` : undefined,
    ].filter((p): p is string => typeof p === "string");
    return {
      title: `${a.interest?.label ?? "Interesting"}: ${identifier}`,
      body: parts.join(" · "),
    };
  }

  private record(a: Aircraft): void {
    const { title, body } = this.describe(a);
    this.lastAlert = `${title} — ${body}`;
    this.lastAlertAt = new Date().toISOString();
    log.info("interesting aircraft entered", {
      aircraft: a.registration ?? a.callsign ?? a.icaoHex,
      reasons: a.interest?.reasons,
    });
  }

  private async push(a: Aircraft): Promise<void> {
    const { title, body } = this.describe(a);
    const tag = a.interest?.reasons.includes("Helicopter") ? "helicopter" : "airplane";
    try {
      const res = await fetch(`${this.server}/${encodeURIComponent(this.topic as string)}`, {
        method: "POST",
        body,
        headers: { Title: title, Tags: tag, Priority: "default" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) log.warn("push failed", { status: res.status });
    } catch (err) {
      log.warn("push error", { error: String(err) });
    }
  }
}
