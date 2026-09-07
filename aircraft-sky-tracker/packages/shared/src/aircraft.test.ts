import { test } from "node:test";
import assert from "node:assert/strict";
import { verticalTrend, VERTICAL_TREND_THRESHOLD_FPM } from "./aircraft.ts";

test("verticalTrend classifies climb / descent / level", () => {
  assert.equal(verticalTrend(1200), "climbing");
  assert.equal(verticalTrend(-1200), "descending");
  assert.equal(verticalTrend(0), "level");
  // Small rates are treated as level (noise / minor corrections).
  assert.equal(verticalTrend(100), "level");
  assert.equal(verticalTrend(-100), "level");
});

test("verticalTrend treats the threshold as inclusive", () => {
  assert.equal(verticalTrend(VERTICAL_TREND_THRESHOLD_FPM), "climbing");
  assert.equal(verticalTrend(-VERTICAL_TREND_THRESHOLD_FPM), "descending");
  assert.equal(verticalTrend(VERTICAL_TREND_THRESHOLD_FPM - 1), "level");
});

test("verticalTrend treats unknown / non-finite as level", () => {
  assert.equal(verticalTrend(undefined), "level");
  assert.equal(verticalTrend(NaN), "level");
});

test("verticalTrend honours a custom threshold", () => {
  assert.equal(verticalTrend(400, 500), "level");
  assert.equal(verticalTrend(600, 500), "climbing");
});
