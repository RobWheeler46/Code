/**
 * Sky Insights Engine (FRD v3.8 §63, §103-104). The stateful half of the
 * insights layer: on each aircraft snapshot it gathers the evidence for every
 * live object, runs the pure `deriveAircraftInsights` derivation, then owns the
 * lifecycle - creating, refreshing and expiring insights and broadcasting the
 * current set when it changes.
 *
 * Design notes:
 *   - Behaviour insights (likely landing) need history the raw snapshot lacks,
 *     so the engine tracks a per-aircraft descent streak across snapshots.
 *   - Operational enrichment (OOOI / state / ETA / diversion) is throttled per
 *     aircraft and bounded to the nearest few, so a future live Airframes path
 *     cannot fan out into one request per aircraft per second (§26 rate limits).
 *   - An insight is dropped as soon as its supporting evidence no longer holds,
 *     so the set always reflects the current sky (with expiresAt as a safety net).
 */

import type { Aircraft, FlightIntelligence, Insight } from "@ast/shared";
import { deriveAircraftInsights, pickPrimaryInsight } from "@ast/shared";

export interface InsightsEngineOptions {
  now?: () => number;
  /** How long an aircraft's operational enrichment is cached (ms). */
  enrichTtlMs?: number;
  /** Maximum aircraft to enrich per snapshot (nearest first). */
  maxEnrich?: number;
}

interface DescentState {
  sinceMs: number;
}

interface EnrichCache {
  atMs: number;
  flight?: FlightIntelligence;
}

/** Descent rate (ft/min) below which an aircraft counts as descending. */
const DESCENT_FPM = -400;

export class InsightsEngine {
  private readonly active = new Map<string, Insight>();
  private readonly descent = new Map<string, DescentState>();
  private readonly enrichCache = new Map<string, EnrichCache>();
  private readonly now: () => number;
  private readonly enrichTtlMs: number;
  private readonly maxEnrich: number;

  constructor(
    private readonly enrich: (a: Aircraft) => Promise<FlightIntelligence | undefined>,
    private readonly onChange: (insights: Insight[]) => void,
    opts: InsightsEngineOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.enrichTtlMs = opts.enrichTtlMs ?? 20_000;
    this.maxEnrich = opts.maxEnrich ?? 30;
  }

  /** All currently-active insights (main + details), newest state. */
  list(): Insight[] {
    return [...this.active.values()];
  }

  /** Active insights for one aircraft, for the details drawer (§92, §103). */
  forAircraft(icaoHex: string): Insight[] {
    const hex = icaoHex.toUpperCase();
    return this.list().filter((i) => i.subjectId.toUpperCase() === hex);
  }

  /** The single most useful main-screen insight, or undefined (§91). */
  primary(): Insight | undefined {
    return pickPrimaryInsight(this.list());
  }

  /**
   * Process a fresh aircraft snapshot: update streaks, gather evidence, derive
   * insights and reconcile lifecycle. Broadcasts only when the set changes.
   */
  async onSnapshot(aircraft: Aircraft[], nowMs: number = this.now()): Promise<void> {
    const present = new Set(aircraft.map((a) => a.icaoHex));

    // 1. Descent streaks (cheap, every aircraft).
    for (const a of aircraft) this.updateDescent(a, nowMs);
    for (const hex of [...this.descent.keys()]) {
      if (!present.has(hex)) this.descent.delete(hex);
    }

    // 2. Operational enrichment - throttled and bounded to the nearest aircraft.
    const nearest = [...aircraft]
      .sort((x, y) => x.distanceMiles - y.distanceMiles)
      .slice(0, this.maxEnrich);
    const flights = new Map<string, FlightIntelligence | undefined>();
    await Promise.all(
      nearest.map(async (a) => {
        flights.set(a.icaoHex, await this.enrichThrottled(a, nowMs));
      }),
    );
    for (const hex of [...this.enrichCache.keys()]) {
      if (!present.has(hex)) this.enrichCache.delete(hex);
    }

    // 3. Derive candidate insights from current evidence.
    const candidates: Insight[] = [];
    for (const a of aircraft) {
      const ds = this.descent.get(a.icaoHex);
      const descentForMs = ds ? nowMs - ds.sinceMs : 0;
      candidates.push(
        ...deriveAircraftInsights({
          aircraft: a,
          flight: flights.get(a.icaoHex),
          descentForMs,
          nowMs,
        }),
      );
    }

    // 4. Reconcile against the active set.
    if (this.reconcile(candidates, present, nowMs)) {
      this.onChange(this.list());
    }
  }

  private updateDescent(a: Aircraft, nowMs: number): void {
    const vr = a.verticalRateFpm ?? 0;
    if (a.onGround !== true && vr < DESCENT_FPM) {
      if (!this.descent.has(a.icaoHex)) this.descent.set(a.icaoHex, { sinceMs: nowMs });
    } else {
      this.descent.delete(a.icaoHex);
    }
  }

  private async enrichThrottled(
    a: Aircraft,
    nowMs: number,
  ): Promise<FlightIntelligence | undefined> {
    const cached = this.enrichCache.get(a.icaoHex);
    if (cached && nowMs - cached.atMs < this.enrichTtlMs) return cached.flight;
    const flight = await this.enrich(a);
    this.enrichCache.set(a.icaoHex, { atMs: nowMs, flight });
    return flight;
  }

  /** Upsert candidates and drop insights whose evidence no longer holds. */
  private reconcile(candidates: Insight[], present: Set<string>, nowMs: number): boolean {
    let changed = false;
    const candidateKeys = new Set(candidates.map((c) => c.id));

    for (const c of candidates) {
      const existing = this.active.get(c.id);
      if (!existing) {
        this.active.set(c.id, c);
        changed = true;
        continue;
      }
      // Preserve the original creation time; refresh evidence and TTL.
      const merged: Insight = { ...c, createdAt: existing.createdAt };
      this.active.set(c.id, merged);
      if (!sameInsight(existing, merged)) changed = true;
    }

    for (const [key, ins] of [...this.active.entries()]) {
      const gone = !present.has(ins.subjectId);
      const stale = ins.expiresAt ? Date.parse(ins.expiresAt) <= nowMs : false;
      const unsupported = !candidateKeys.has(key);
      if (gone || stale || unsupported) {
        this.active.delete(key);
        changed = true;
      }
    }

    return changed;
  }
}

/** True when two insights are materially the same (ignoring timestamps/TTL). */
function sameInsight(a: Insight, b: Insight): boolean {
  return (
    a.type === b.type &&
    a.confidence === b.confidence &&
    a.title === b.title &&
    a.lines.join("|") === b.lines.join("|") &&
    a.why.join("|") === b.why.join("|")
  );
}
