/**
 * Adaptive display sizing (FRD v3.2 §12-13, §71-72). Turns the display-scale and
 * viewing-distance settings plus the available canvas dimensions into a single
 * multiplier that the renderer and overlays apply to icons, markers, fonts and
 * touch targets - so the display reads well from a phone to a room-across TV.
 * Pure and deterministic, so it can be unit-tested.
 */

import type { DisplayScale, ViewingDistance } from "./config.js";

export interface DisplaySizingInput {
  displayScale: DisplayScale;
  viewingDistance: ViewingDistance;
  /** Available canvas size in CSS pixels. */
  width: number;
  height: number;
}

const VIEWING_DISTANCE_FACTOR: Record<ViewingDistance, number> = {
  close: 0.82,
  normal: 1,
  "across-room": 1.28,
};

const MANUAL_SCALE_FACTOR: Record<Exclude<DisplayScale, "automatic">, number> = {
  compact: 0.82,
  standard: 1,
  large: 1.3,
};

/** Reference small-dimension (CSS px) that maps to a 1.0 automatic scale. */
const REFERENCE_MIN_DIMENSION = 850;
const AUTO_MIN = 0.7;
const AUTO_MAX = 1.6;
const OVERALL_MIN = 0.6;
const OVERALL_MAX = 2.2;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** The automatic profile: scale with the smaller screen dimension. */
export function automaticScale(width: number, height: number): number {
  const minDim = Math.min(width, height);
  if (!Number.isFinite(minDim) || minDim <= 0) return 1;
  return clamp(minDim / REFERENCE_MIN_DIMENSION, AUTO_MIN, AUTO_MAX);
}

/** Resolve the overall size multiplier for the current settings + viewport. */
export function resolveDisplayScale(input: DisplaySizingInput): number {
  const base =
    input.displayScale === "automatic"
      ? automaticScale(input.width, input.height)
      : MANUAL_SCALE_FACTOR[input.displayScale];
  return clamp(base * VIEWING_DISTANCE_FACTOR[input.viewingDistance], OVERALL_MIN, OVERALL_MAX);
}

/** Compact displays shorten satellite labels (FRD §72), e.g. "ISS (ZARYA)" -> "ISS". */
export function isCompactDisplay(width: number, scale: number): boolean {
  return width < 520 || scale < 0.9;
}
