/**
 * Look Now service (FRD v4.0 §16-19). Runs the prediction engine over every
 * tracked aircraft (including the prediction band that is not displayed) and
 * surfaces those likely to enter the sky shortly, most imminent first, each with
 * a confidence rating. Broadcasts the set when it changes.
 *
 * It keeps a short per-aircraft track history so the confidence model can tell a
 * straight inbound run from a turning one (§18).
 */

import type { Aircraft, LookNowPrediction } from "@ast/shared";
import { predictClosestApproach, assessPredictionConfidence } from "@ast/shared";

export interface LookNowObserver {
  latitude: number;
  longitude: number;
}

export interface LookNowOptions {
  now?: () => number;
  /** Only surface approaches closer than this in time (seconds). */
  horizonSeconds?: number;
  /** How many recent track samples inform the turning check. */
  trackHistory?: number;
}

interface TrackSample {
  t: number;
  track: number;
}

const HISTORY_WINDOW_MS = 10 * 60_000;

function angularDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180);
}

export class LookNowService {
  private readonly trackHist = new Map<string, TrackSample[]>();
  private predictions: LookNowPrediction[] = [];
  private lastKey = "";
  private readonly now: () => number;
  private readonly horizonSeconds: number;
  private readonly trackHistory: number;

  constructor(
    private readonly onChange: (predictions: LookNowPrediction[]) => void,
    opts: LookNowOptions = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.horizonSeconds = opts.horizonSeconds ?? 12 * 60;
    this.trackHistory = opts.trackHistory ?? 8;
  }

  list(): LookNowPrediction[] {
    return this.predictions;
  }

  primary(): LookNowPrediction | undefined {
    return this.predictions[0];
  }

  /** Recompute from the full tracked set; broadcasts if the result changed. */
  onSnapshot(
    all: Aircraft[],
    observer: LookNowObserver,
    displayRadiusMiles: number,
    nowMs: number = this.now(),
  ): void {
    const present = new Set(all.map((a) => a.icaoHex));
    const out: LookNowPrediction[] = [];

    for (const a of all) {
      // Maintain the track trail for the turning check (all airborne aircraft).
      if (a.trackDegrees !== undefined && a.onGround !== true) {
        const hist = this.trackHist.get(a.icaoHex) ?? [];
        hist.push({ t: nowMs, track: a.trackDegrees });
        const trimmed = hist.filter((s) => nowMs - s.t <= HISTORY_WINDOW_MS);
        if (trimmed.length > this.trackHistory) trimmed.splice(0, trimmed.length - this.trackHistory);
        this.trackHist.set(a.icaoHex, trimmed);
      }

      if (a.onGround === true) continue;
      // Already in the sky -> not an "approaching" prediction (§16).
      if (a.withinDisplayRadius !== false) continue;

      const approach = predictClosestApproach(observer, a, nowMs);
      if (!approach) continue;
      // Must be likely to enter the sky, and soon (§16).
      if (approach.horizontalDistanceMiles > displayRadiusMiles) continue;
      if (approach.timeToClosestSeconds > this.horizonSeconds) continue;

      const spread = this.trackSpread(a.icaoHex, a.trackDegrees);
      const confidence = assessPredictionConfidence({
        trackSpreadDeg: spread,
        verticalRateFpm: a.verticalRateFpm,
        positionAgeSeconds: a.positionAgeSeconds,
        timeToClosestSeconds: approach.timeToClosestSeconds,
      });

      out.push({
        icaoHex: a.icaoHex,
        label: a.callsign?.trim() || a.registration || a.icaoHex,
        tag: a.interest?.label,
        currentDistanceMiles: a.distanceMiles,
        approach,
        confidence,
      });
    }

    for (const hex of [...this.trackHist.keys()]) {
      if (!present.has(hex)) this.trackHist.delete(hex);
    }

    out.sort((x, y) => x.approach.timeToClosestSeconds - y.approach.timeToClosestSeconds);
    this.predictions = out;

    const key = out
      .map(
        (p) =>
          `${p.icaoHex}:${Math.round(p.approach.timeToClosestSeconds / 15)}:${p.approach.lookCompass}:${p.confidence}`,
      )
      .join("|");
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.onChange(out);
    }
  }

  private trackSpread(icaoHex: string, current?: number): number {
    if (current === undefined) return 0;
    const hist = this.trackHist.get(icaoHex);
    if (!hist || hist.length === 0) return 0;
    return Math.max(0, ...hist.map((s) => angularDiff(s.track, current)));
  }
}
