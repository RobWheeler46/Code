/**
 * Push alerts for interesting aircraft (FRD Phase 3).
 *
 * When an interesting aircraft enters the tracked area, sends a push via ntfy
 * (https://ntfy.sh) to a user-chosen topic - no account required; the user
 * subscribes to the topic in the ntfy app. Disabled unless NOTIFY_NTFY_TOPIC is
 * set. Each aircraft alerts at most once per re-alert window so a plane loitering
 * overhead does not spam. Runs only for the global tracked location, not for
 * per-viewer URL overrides.
 */

import type { Aircraft } from "@ast/shared";
import { compassDirection } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("alerts");
const REALERT_MS = 30 * 60 * 1000; // don't re-alert the same aircraft within 30 min
const REQUEST_TIMEOUT_MS = 6000;

export interface AlertConfig {
  topic: string | undefined;
  server: string;
}

export class AlertService {
  private readonly topic: string | undefined;
  private readonly server: string;
  private readonly alerted = new Map<string, number>();

  lastAlert: string | undefined;
  lastAlertAt: string | undefined;

  constructor(config: AlertConfig) {
    this.topic = config.topic;
    this.server = config.server.replace(/\/+$/, "");
  }

  get enabled(): boolean {
    return typeof this.topic === "string" && this.topic.length > 0;
  }

  /** Inspect a snapshot and push alerts for newly-arrived interesting aircraft. */
  process(aircraft: Aircraft[], now: number = Date.now()): void {
    if (!this.enabled) return;
    this.prune(now);
    for (const a of aircraft) {
      if (!a.interest) continue;
      const last = this.alerted.get(a.icaoHex);
      if (last !== undefined && now - last < REALERT_MS) continue;
      this.alerted.set(a.icaoHex, now);
      void this.send(a);
    }
  }

  private prune(now: number): void {
    for (const [hex, ts] of this.alerted) {
      if (now - ts >= REALERT_MS) this.alerted.delete(hex);
    }
  }

  private async send(a: Aircraft): Promise<void> {
    const identifier = a.registration ?? a.callsign ?? a.icaoHex;
    const direction = compassDirection(a.bearingFromCentre);
    const dest = a.destination?.displayName;
    const parts = [
      `${a.distanceMiles.toFixed(1)} mi ${direction}`,
      a.altitudeFeet !== undefined ? `${a.altitudeFeet.toLocaleString()} ft` : undefined,
      dest ? `to ${dest}` : undefined,
    ].filter((p): p is string => typeof p === "string");
    const title = `${a.interest?.label ?? "Interesting"}: ${identifier}`;
    const body = parts.join(" · ");
    const tag = a.interest?.reasons.includes("Helicopter") ? "helicopter" : "airplane";

    try {
      const res = await fetch(`${this.server}/${encodeURIComponent(this.topic as string)}`, {
        method: "POST",
        body,
        headers: {
          Title: title,
          Tags: tag,
          Priority: "default",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        log.warn("push failed", { status: res.status });
        return;
      }
      this.lastAlert = `${title} — ${body}`;
      this.lastAlertAt = new Date().toISOString();
      log.info("interesting aircraft alerted", { aircraft: identifier, reasons: a.interest?.reasons });
    } catch (err) {
      log.warn("push error", { error: String(err) });
    }
  }
}
