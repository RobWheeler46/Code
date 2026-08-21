/**
 * HistoryService (FRD v3.0 §56-63).
 *
 * Records a "pass" per aircraft - one continuous visit within the tracking
 * radius - rather than every raw position (FRD §56). Active passes are kept in
 * memory and their rolling stats (closest approach, min/max altitude, max speed,
 * best-confidence destination, interesting reasons) are updated each snapshot.
 * A pass is closed and finalised when the aircraft leaves. Writes are debounced
 * to limit Raspberry Pi flash wear (FRD §78).
 */

import type { Aircraft, HistoryPass, HistoryDate } from "@ast/shared";
import { HistoryRepo } from "../persistence/historyRepo.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("history");

/** Local (UK) calendar date, YYYY-MM-DD (FRD §61). */
export function londonDate(now: number): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
}

function confidenceRank(c: string | undefined): number {
  switch (c) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

export class HistoryService {
  private readonly repo: HistoryRepo;
  private readonly dateFn: (now: number) => string;
  private readonly active = new Map<string, HistoryPass>();
  private readonly dirty = new Set<string>();

  private enabled = true;
  private retentionDays = 31;

  constructor(repo: HistoryRepo = new HistoryRepo(), dateFn = londonDate) {
    this.repo = repo;
    this.dateFn = dateFn;
  }

  configure(enabled: boolean, retentionDays: number): void {
    this.enabled = enabled;
    this.retentionDays = retentionDays;
  }

  /** Update active passes from the current displayed aircraft (global only). */
  ingest(aircraft: Aircraft[], now: number = Date.now()): void {
    if (!this.enabled) {
      // Close any open passes if history was turned off.
      if (this.active.size > 0) {
        for (const pass of this.active.values()) this.repo.upsert(pass);
        this.active.clear();
        this.dirty.clear();
      }
      return;
    }

    const seen = new Set<string>();
    for (const a of aircraft) {
      seen.add(a.icaoHex);
      const existing = this.active.get(a.icaoHex);
      if (!existing) {
        this.active.set(a.icaoHex, this.newPass(a, now));
      } else {
        this.updatePass(existing, a, now);
      }
      this.dirty.add(a.icaoHex);
    }

    // Close passes for aircraft that have left the radius (FRD §57).
    for (const [hex, pass] of this.active) {
      if (seen.has(hex)) continue;
      this.repo.upsert(pass);
      this.active.delete(hex);
      this.dirty.delete(hex);
    }
  }

  private newPass(a: Aircraft, now: number): HistoryPass {
    const iso = new Date(now).toISOString();
    return {
      passId: `${a.icaoHex}-${now}`,
      icaoHex: a.icaoHex,
      registration: a.registration,
      callsign: a.callsign,
      aircraftType: a.aircraftTypeCode,
      firstSeen: iso,
      lastSeen: iso,
      destination: a.destination?.displayName,
      routeConfidence: a.destination?.confidence,
      closestApproachMiles: a.distanceMiles,
      minimumAltitudeFeet: a.altitudeFeet,
      maximumAltitudeFeet: a.altitudeFeet,
      maximumGroundSpeedKnots:
        a.groundSpeedKnots !== undefined ? Math.round(a.groundSpeedKnots) : undefined,
      interesting: a.interest !== undefined,
      interestingReasons: a.interest?.reasons ?? [],
      createdDate: this.dateFn(now),
    };
  }

  private updatePass(pass: HistoryPass, a: Aircraft, now: number): void {
    pass.lastSeen = new Date(now).toISOString();
    if (a.distanceMiles < pass.closestApproachMiles) {
      pass.closestApproachMiles = a.distanceMiles;
    }
    if (a.altitudeFeet !== undefined) {
      pass.minimumAltitudeFeet =
        pass.minimumAltitudeFeet === undefined
          ? a.altitudeFeet
          : Math.min(pass.minimumAltitudeFeet, a.altitudeFeet);
      pass.maximumAltitudeFeet =
        pass.maximumAltitudeFeet === undefined
          ? a.altitudeFeet
          : Math.max(pass.maximumAltitudeFeet, a.altitudeFeet);
    }
    if (a.groundSpeedKnots !== undefined) {
      const gs = Math.round(a.groundSpeedKnots);
      pass.maximumGroundSpeedKnots =
        pass.maximumGroundSpeedKnots === undefined
          ? gs
          : Math.max(pass.maximumGroundSpeedKnots, gs);
    }
    if (!pass.registration && a.registration) pass.registration = a.registration;
    if (!pass.callsign && a.callsign) pass.callsign = a.callsign;
    if (!pass.aircraftType && a.aircraftTypeCode) pass.aircraftType = a.aircraftTypeCode;

    // Update destination if confidence improves (FRD §59).
    if (a.destination?.displayName) {
      const better =
        confidenceRank(a.destination.confidence) > confidenceRank(pass.routeConfidence);
      if (!pass.destination || better) {
        pass.destination = a.destination.displayName;
        pass.routeConfidence = a.destination.confidence;
      }
    }
    if (a.interest) {
      pass.interesting = true;
      pass.interestingReasons = [
        ...new Set([...pass.interestingReasons, ...a.interest.reasons]),
      ];
    }
  }

  /** Persist all dirty active passes (debounced/periodic, FRD §78). */
  flush(): void {
    if (this.dirty.size === 0) return;
    for (const hex of this.dirty) {
      const pass = this.active.get(hex);
      if (pass) this.repo.upsert(pass);
    }
    this.dirty.clear();
  }

  /** Remove passes older than the retention window (FRD §62). */
  pruneExpired(now: number = Date.now()): number {
    const cutoff = new Date(now - this.retentionDays * 24 * 60 * 60 * 1000);
    const removed = this.repo.deleteExpired(this.dateFn(cutoff.getTime()));
    if (removed > 0) log.info("pruned expired history", { removed });
    return removed;
  }

  listByDate(date: string): HistoryPass[] {
    this.flush(); // include in-progress passes
    return this.repo.listByDate(date);
  }

  listDates(): HistoryDate[] {
    this.flush();
    return this.repo.listDates();
  }

  deleteByDate(date: string): number {
    // Also drop any active pass for that date so it is not re-flushed.
    for (const [hex, pass] of this.active) {
      if (pass.createdDate === date) {
        this.active.delete(hex);
        this.dirty.delete(hex);
      }
    }
    return this.repo.deleteByDate(date);
  }

  passesToday(now: number = Date.now()): number {
    this.flush();
    return this.repo.countByDate(this.dateFn(now));
  }

  interestingToday(now: number = Date.now()): number {
    this.flush();
    return this.repo.countInterestingByDate(this.dateFn(now));
  }

  todayDate(now: number = Date.now()): string {
    return this.dateFn(now);
  }
}
