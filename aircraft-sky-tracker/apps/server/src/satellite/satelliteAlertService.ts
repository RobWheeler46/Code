/**
 * Satellite pass alerts (FRD v3.2 §61-62). Watches the upcoming-pass predictions
 * and fires one advance-warning alert per pass when it comes within the
 * configured lead time - "ISS visible in 10 minutes". Each alert drives an
 * in-app / WebSocket banner (via onAlert) and, when a ntfy topic is configured,
 * a phone push. In-app alerting works regardless of push configuration.
 *
 * Only passes of enabled satellite groups are considered, and (by default) only
 * potentially naked-eye-visible passes, which keeps a busy sky from flooding the
 * viewer. Dedupe is by catalogue number + rise time, pruned once the pass ends.
 */

import type { SatellitePass, SatelliteCategory } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("satellite.alerts");
const TICK_MS = 30_000;
const REQUEST_TIMEOUT_MS = 6000;

export interface SatelliteAlertConfigView {
  enabled: boolean;
  leadMinutes: number;
  visibleOnly: boolean;
  showStations: boolean;
  showBright: boolean;
  showStarlink: boolean;
}

export interface SatelliteAlertPush {
  topic: string | undefined;
  server: string;
}

export class SatelliteAlertService {
  private readonly server: string;
  /** `catalogNumber|riseTime` already alerted, mapped to the pass set time (ms). */
  private readonly alerted = new Map<string, number>();
  private timer: NodeJS.Timeout | undefined;

  lastAlert: string | undefined;
  lastAlertAt: string | undefined;

  constructor(
    private readonly getConfig: () => SatelliteAlertConfigView,
    private readonly getPasses: () => SatellitePass[],
    private readonly push: SatelliteAlertPush,
    private readonly onAlert: (pass: SatellitePass, minutesUntil: number) => void,
  ) {
    this.server = push.server.replace(/\/+$/, "");
  }

  start(): void {
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.timer.unref();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Whether phone push (ntfy) is configured; in-app alerts work regardless. */
  get pushEnabled(): boolean {
    return typeof this.push.topic === "string" && this.push.topic.length > 0;
  }

  private groupEnabled(category: SatelliteCategory, cfg: SatelliteAlertConfigView): boolean {
    if (category === "station") return cfg.showStations;
    if (category === "starlink") return cfg.showStarlink;
    return cfg.showBright;
  }

  private tick(): void {
    const cfg = this.getConfig();
    const now = Date.now();

    // Forget passes that have finished so a later (distinct) pass can alert.
    for (const [key, setMs] of this.alerted) {
      if (setMs < now) this.alerted.delete(key);
    }

    if (!cfg.enabled) return;
    const leadMs = Math.max(1, cfg.leadMinutes) * 60_000;

    for (const pass of this.getPasses()) {
      if (cfg.visibleOnly && !pass.potentiallyVisible) continue;
      if (!this.groupEnabled(pass.category, cfg)) continue;

      const riseMs = new Date(pass.riseTime).getTime();
      const setMs = new Date(pass.setTime).getTime();
      if (setMs <= now) continue; // already over
      if (riseMs - now > leadMs) continue; // not yet within the lead window

      const key = `${pass.catalogNumber}|${pass.riseTime}`;
      if (this.alerted.has(key)) continue;
      this.alerted.set(key, setMs);

      const minutesUntil = Math.max(0, Math.round((riseMs - now) / 60_000));
      this.record(pass, minutesUntil);
      this.onAlert(pass, minutesUntil);
      if (this.pushEnabled) void this.sendPush(pass, minutesUntil);
    }
  }

  private headline(pass: SatellitePass, minutesUntil: number): string {
    return minutesUntil <= 0
      ? `${pass.name} visible now`
      : `${pass.name} visible in ${minutesUntil} minute${minutesUntil === 1 ? "" : "s"}`;
  }

  private body(pass: SatellitePass): string {
    return [
      `best ${localTime(pass.maxTime)}`,
      `max ${pass.maxElevationDegrees}°`,
      pass.direction,
      pass.potentiallyVisible ? "potentially visible" : undefined,
    ]
      .filter((s): s is string => typeof s === "string")
      .join(" · ");
  }

  private record(pass: SatellitePass, minutesUntil: number): void {
    this.lastAlert = `${this.headline(pass, minutesUntil)} — ${this.body(pass)}`;
    this.lastAlertAt = new Date().toISOString();
    log.info("satellite pass alert", {
      satellite: pass.name,
      minutesUntil,
      maxElevation: pass.maxElevationDegrees,
      visible: pass.potentiallyVisible,
    });
  }

  private async sendPush(pass: SatellitePass, minutesUntil: number): Promise<void> {
    try {
      const res = await fetch(`${this.server}/${encodeURIComponent(this.push.topic as string)}`, {
        method: "POST",
        body: this.body(pass),
        headers: { Title: this.headline(pass, minutesUntil), Tags: "satellite", Priority: "default" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) log.warn("satellite push failed", { status: res.status });
    } catch (err) {
      log.warn("satellite push error", { error: String(err) });
    }
  }
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}
