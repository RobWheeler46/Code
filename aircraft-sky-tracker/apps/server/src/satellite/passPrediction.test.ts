import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTle } from "./orbitalProvider.js";
import { observerFrom } from "./sgp4Service.js";
import { predictPasses } from "./passPrediction.js";

// ISS element set; epoch is day 240.5 of 2024 = 2024-08-27T12:00Z. Predictions
// stay accurate within a day or so of epoch.
const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900`;

const EPOCH = new Date("2024-08-27T12:00:00Z");
const SWINDON = observerFrom(51.59, -1.79);

function issSatrec() {
  const els = parseTle(ISS_TLE, "station");
  assert.equal(els.length, 1);
  return els[0]!.satrec;
}

test("predictPasses finds well-formed ISS passes within the window", () => {
  const passes = predictPasses(issSatrec(), SWINDON, {
    start: EPOCH,
    windowMs: 24 * 60 * 60 * 1000,
    minElevationDeg: 15,
  });
  assert.ok(passes.length >= 1, `expected at least one pass, got ${passes.length}`);
  const windowEnd = EPOCH.getTime() + 24 * 60 * 60 * 1000;
  for (const p of passes) {
    // rise < max < set, all inside the window.
    assert.ok(p.riseTime.getTime() <= p.maxTime.getTime(), "rise before max");
    assert.ok(p.maxTime.getTime() <= p.setTime.getTime(), "max before set");
    assert.ok(p.riseTime.getTime() >= EPOCH.getTime() - 1000, "rise within window start");
    assert.ok(p.setTime.getTime() <= windowEnd + 1000, "set within window end");
    // A meaningful pass clears the minimum elevation (FRD §60).
    assert.ok(p.maxElevationDeg >= 15, `peak ${p.maxElevationDeg} >= 15`);
    assert.ok(p.maxElevationDeg <= 90.01, `peak ${p.maxElevationDeg} <= 90`);
    // Azimuths are compass bearings.
    assert.ok(p.riseAzimuthDeg >= 0 && p.riseAzimuthDeg < 360);
    assert.ok(p.setAzimuthDeg >= 0 && p.setAzimuthDeg < 360);
    // ISS passes are minutes long, never hours.
    const durationMin = (p.setTime.getTime() - p.riseTime.getTime()) / 60000;
    assert.ok(durationMin > 0 && durationMin < 15, `duration ${durationMin} min`);
  }
});

test("predictPasses respects the minimum-elevation threshold (FRD §60)", () => {
  const satrec = issSatrec();
  const opts = { start: EPOCH, windowMs: 24 * 60 * 60 * 1000 } as const;
  const low = predictPasses(satrec, SWINDON, { ...opts, minElevationDeg: 10 });
  const high = predictPasses(satrec, SWINDON, { ...opts, minElevationDeg: 60 });
  // A higher threshold cannot admit more passes.
  assert.ok(high.length <= low.length);
  // Every high-threshold pass genuinely clears 60 degrees.
  for (const p of high) assert.ok(p.maxElevationDeg >= 60, `peak ${p.maxElevationDeg} >= 60`);
});

test("predictPasses honours maxPasses", () => {
  const passes = predictPasses(issSatrec(), SWINDON, {
    start: EPOCH,
    windowMs: 24 * 60 * 60 * 1000,
    minElevationDeg: 10,
    maxPasses: 1,
  });
  assert.ok(passes.length <= 1);
});
