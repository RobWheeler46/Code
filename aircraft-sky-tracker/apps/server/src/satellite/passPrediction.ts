/**
 * Satellite pass prediction (FRD v3.2 §59-60). Pure computation over a
 * satellite.js record: scan a look-ahead window for the intervals where the
 * satellite rises above the configured minimum elevation, and for each such
 * pass report rise / maximum / set times, the peak elevation, the rise and set
 * azimuths and whether it is likely naked-eye visible.
 *
 * A pass is only "meaningful" when its maximum elevation exceeds the minimum
 * elevation (§60); grazes that never clear the threshold are ignored.
 */

import type * as satellite from "satellite.js";
import { observe, sunElevationDeg, type ObserverGd } from "./sgp4Service.js";
import { isSunlit, sunEci } from "./astro.js";

const COARSE_STEP_MS = 30_000; // horizon-scan resolution
const DARK_SUN_ELEVATION_DEG = -4; // sky dark enough for a naked-eye pass (§46)
const REFINE_ITERATIONS = 18; // bisection/ternary depth (~sub-second)

export interface PredictedPass {
  riseTime: Date;
  maxTime: Date;
  setTime: Date;
  maxElevationDeg: number;
  riseAzimuthDeg: number;
  setAzimuthDeg: number;
  potentiallyVisible: boolean;
  /** The scan started with the satellite already above the minimum. */
  startedBeforeWindow: boolean;
}

export interface PredictPassesOptions {
  start: Date;
  windowMs: number;
  minElevationDeg: number;
  coarseStepMs?: number;
  darkSunElevationDeg?: number;
  /** Stop after this many passes (keeps long windows bounded). */
  maxPasses?: number;
}

/** Elevation (deg) of the satellite at `date`, or -90 if it cannot be propagated. */
function elevationAt(satrec: satellite.SatRec, observer: ObserverGd, date: Date): number {
  const obs = observe(satrec, observer, date);
  return obs ? obs.elevationDeg : -90;
}

/**
 * Bisect for the instant between `lo` and `hi` where elevation crosses
 * `target`. `rising` selects the direction of the crossing.
 */
function refineCrossing(
  satrec: satellite.SatRec,
  observer: ObserverGd,
  loMs: number,
  hiMs: number,
  target: number,
  rising: boolean,
): Date {
  let lo = loMs;
  let hi = hiMs;
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const el = elevationAt(satrec, observer, new Date(mid));
    const aboveTarget = el >= target;
    // Keep the half that still straddles the crossing.
    if (aboveTarget === rising) hi = mid;
    else lo = mid;
  }
  return new Date((lo + hi) / 2);
}

/** Ternary search for the peak-elevation instant in [loMs, hiMs]. */
function refinePeak(
  satrec: satellite.SatRec,
  observer: ObserverGd,
  loMs: number,
  hiMs: number,
): { time: Date; elevationDeg: number } {
  let lo = loMs;
  let hi = hiMs;
  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (elevationAt(satrec, observer, new Date(m1)) < elevationAt(satrec, observer, new Date(m2))) {
      lo = m1;
    } else {
      hi = m2;
    }
  }
  const time = new Date((lo + hi) / 2);
  return { time, elevationDeg: elevationAt(satrec, observer, time) };
}

function isVisibleAt(satrec: satellite.SatRec, observer: ObserverGd, date: Date, darkSun: number): boolean {
  if (sunElevationDeg(observer, date) >= darkSun) return false; // sky not dark
  const obs = observe(satrec, observer, date);
  return obs ? isSunlit(obs.eci, sunEci(date)) : false;
}

/**
 * Predict the meaningful passes of `satrec` for `observer` across the window.
 * Returns passes ordered by rise time.
 */
export function predictPasses(
  satrec: satellite.SatRec,
  observer: ObserverGd,
  options: PredictPassesOptions,
): PredictedPass[] {
  const step = options.coarseStepMs ?? COARSE_STEP_MS;
  const darkSun = options.darkSunElevationDeg ?? DARK_SUN_ELEVATION_DEG;
  const minEl = options.minElevationDeg;
  const startMs = options.start.getTime();
  const endMs = startMs + options.windowMs;
  const maxPasses = options.maxPasses ?? Infinity;
  const passes: PredictedPass[] = [];

  let prevMs = startMs;
  let prevEl = elevationAt(satrec, observer, options.start);

  // Are we already inside a pass when the window opens?
  let inPass = prevEl >= minEl;
  let riseMs = inPass ? startMs : 0;
  let startedBefore = inPass;

  const finish = (setMs: number) => {
    const peak = refinePeak(satrec, observer, Math.max(riseMs, startMs), setMs);
    const riseObs = observe(satrec, observer, new Date(riseMs));
    const setObs = observe(satrec, observer, new Date(setMs));
    passes.push({
      riseTime: new Date(riseMs),
      maxTime: peak.time,
      setTime: new Date(setMs),
      maxElevationDeg: peak.elevationDeg,
      riseAzimuthDeg: riseObs ? riseObs.azimuthDeg : 0,
      setAzimuthDeg: setObs ? setObs.azimuthDeg : 0,
      potentiallyVisible: isVisibleAt(satrec, observer, peak.time, darkSun),
      startedBeforeWindow: startedBefore,
    });
  };

  for (let t = startMs + step; t <= endMs && passes.length < maxPasses; t += step) {
    const el = elevationAt(satrec, observer, new Date(t));
    if (!inPass && prevEl < minEl && el >= minEl) {
      riseMs = refineCrossing(satrec, observer, prevMs, t, minEl, true).getTime();
      inPass = true;
      startedBefore = false;
    } else if (inPass && prevEl >= minEl && el < minEl) {
      finish(refineCrossing(satrec, observer, prevMs, t, minEl, false).getTime());
      inPass = false;
    }
    prevEl = el;
    prevMs = t;
  }

  // A pass still open at the window edge: report it, clamped to the window.
  if (inPass && passes.length < maxPasses) finish(endMs);

  return passes;
}
