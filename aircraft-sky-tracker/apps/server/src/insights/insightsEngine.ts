/**
 * Sky Insights Engine (FRD v3.8 §63, §103-104). The stateful half of the
 * insights layer: on each aircraft snapshot it gathers the evidence for every
 * live object, runs the pure derivation, then owns the lifecycle - creating,
 * refreshing and expiring insights and emitting the deltas.
 *
 * Design notes:
 *   - Behaviour insights (likely landing) need history the raw snapshot lacks,
 *     so the engine tracks a per-aircraft descent streak across snapshots.
 *   - Route-change detection (§43-44, §59) is history-based: the engine keeps a
 *     bounded per-aircraft trail of positions and resolved-destination decisions
 *     and feeds it to `assessRouteChange`, so a diversion is backed by real
 *     trajectory evidence rather than a single provider field.
 *   - Operational enrichment is throttled per aircraft and bounded to the nearest
 *     few, so a future live Airframes path can't fan out (§26 rate limits).
 *   - Lifecycle deltas (created / updated / expired) plus route.updated events are
 *     emitted for reactive consumers (§104); the full snapshot is sent on connect.
 */

import type {
  Aircraft,
  FlightIntelligence,
  Insight,
  RouteChangeSample,
  RouteChangeAssessment,
} from "@ast/shared";
import { deriveAircraftInsights, pickPrimaryInsight, assessRouteChange } from "@ast/shared";

/** A lifecycle delta the engine emits for one reconcile pass (§104). */
export type InsightStreamEvent =
  | { kind: "created"; insight: Insight }
  | { kind: "updated"; insight: Insight }
  | { kind: "expired"; id: string; subjectId: string }
  | {
      kind: "route-updated";
      aircraftId: string;
      previousDestination: string;
      newDestination: string;
      confidence: "possible" | "likely" | "confirmed";
    };

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
/** How long a position/decision trail is retained per aircraft (ms). */
const HISTORY_WINDOW_MS = 20 * 60_000;
/** Hard cap on samples per aircraft (belt-and-braces against fast pollers). */
const HISTORY_MAX = 80;

export class InsightsEngine {
  private readonly active = new Map<string, Insight>();
  private readonly descent = new Map<string, DescentState>();
  private readonly enrichCache = new Map<string, EnrichCache>();
  private readonly history = new Map<string, RouteChangeSample[]>();
  private readonly lastRouteKey = new Map<string, string>();
  private readonly now: () => number;
  private readonly enrichTtlMs: number;
  private readonly maxEnrich: number;

  constructor(
    private readonly enrich: (a: Aircraft) => Promise<FlightIntelligence | undefined>,
    private readonly emit: (events: InsightStreamEvent[]) => void,
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
   * Process a fresh aircraft snapshot: update streaks + trails, gather evidence,
   * derive insights and reconcile lifecycle. Emits deltas only when they occur.
   */
  async onSnapshot(aircraft: Aircraft[], nowMs: number = this.now()): Promise<void> {
    const present = new Set(aircraft.map((a) => a.icaoHex));

    // 1. Descent streaks (cheap, every aircraft).
    for (const a of aircraft) this.updateDescent(a, nowMs);

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

    // 3. Route-change assessment + insight derivation from current evidence.
    const events: InsightStreamEvent[] = [];
    const candidates: Insight[] = [];
    for (const a of aircraft) {
      const flight = flights.get(a.icaoHex);
      const routeChange = this.assessRoute(a, flight, nowMs, events);
      const ds = this.descent.get(a.icaoHex);
      const descentForMs = ds ? nowMs - ds.sinceMs : 0;
      candidates.push(
        ...deriveAircraftInsights({ aircraft: a, flight, routeChange, descentForMs, nowMs }),
      );
    }

    // 4. Reconcile against the active set, collecting created/updated/expired.
    this.reconcile(candidates, present, nowMs, events);

    // 5. Prune per-aircraft state for aircraft no longer present.
    for (const map of [this.descent, this.enrichCache, this.history, this.lastRouteKey]) {
      for (const hex of [...map.keys()]) if (!present.has(hex)) map.delete(hex);
    }

    if (events.length > 0) this.emit(events);
  }

  private updateDescent(a: Aircraft, nowMs: number): void {
    const vr = a.verticalRateFpm ?? 0;
    if (a.onGround !== true && vr < DESCENT_FPM) {
      if (!this.descent.has(a.icaoHex)) this.descent.set(a.icaoHex, { sinceMs: nowMs });
    } else {
      this.descent.delete(a.icaoHex);
    }
  }

  /** Build the current sample, assess a route change against the trail, then
   *  append the sample and emit a route.updated event on a fresh/changed result. */
  private assessRoute(
    a: Aircraft,
    flight: FlightIntelligence | undefined,
    nowMs: number,
    events: InsightStreamEvent[],
  ): RouteChangeAssessment | undefined {
    const d = a.destination;
    const current: RouteChangeSample = {
      t: nowMs,
      lat: a.latitude,
      lon: a.longitude,
      track: a.trackDegrees,
      destIcao: d?.icao,
      destName: d?.displayName ?? d?.airportName,
      destLat: d?.latitude,
      destLon: d?.longitude,
      destConfidence: d?.confidence ?? "unknown",
      sources: d?.sources ?? [],
    };
    const trail = this.history.get(a.icaoHex) ?? [];
    const assessment = assessRouteChange({
      current,
      history: trail,
      operational: flight?.possibleRouteChange,
      nowMs,
    });

    // Append to the trail (bounded by window and count).
    const next = [...trail, current].filter((s) => nowMs - s.t <= HISTORY_WINDOW_MS);
    if (next.length > HISTORY_MAX) next.splice(0, next.length - HISTORY_MAX);
    this.history.set(a.icaoHex, next);

    // Emit route.updated when a change first appears or its destination shifts.
    if (assessment) {
      const key = `${assessment.kind}:${assessment.previousDestination}->${assessment.newDestination}:${assessment.confidence}`;
      if (this.lastRouteKey.get(a.icaoHex) !== key) {
        this.lastRouteKey.set(a.icaoHex, key);
        events.push({
          kind: "route-updated",
          aircraftId: a.icaoHex,
          previousDestination: assessment.previousDestination,
          newDestination: assessment.newDestination,
          confidence: assessment.confidence,
        });
      }
    } else {
      this.lastRouteKey.delete(a.icaoHex);
    }
    return assessment;
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
  private reconcile(
    candidates: Insight[],
    present: Set<string>,
    nowMs: number,
    events: InsightStreamEvent[],
  ): void {
    const candidateKeys = new Set(candidates.map((c) => c.id));

    for (const c of candidates) {
      const existing = this.active.get(c.id);
      if (!existing) {
        this.active.set(c.id, c);
        events.push({ kind: "created", insight: c });
        continue;
      }
      // Preserve the original creation time; refresh evidence and TTL.
      const merged: Insight = { ...c, createdAt: existing.createdAt };
      this.active.set(c.id, merged);
      if (!sameInsight(existing, merged)) events.push({ kind: "updated", insight: merged });
    }

    for (const [key, ins] of [...this.active.entries()]) {
      const gone = !present.has(ins.subjectId);
      const stale = ins.expiresAt ? Date.parse(ins.expiresAt) <= nowMs : false;
      const unsupported = !candidateKeys.has(key);
      if (gone || stale || unsupported) {
        this.active.delete(key);
        events.push({ kind: "expired", id: ins.id, subjectId: ins.subjectId });
      }
    }
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
