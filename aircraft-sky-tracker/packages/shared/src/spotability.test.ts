import { test } from "node:test";
import assert from "node:assert/strict";
import { solarElevationDeg, assessAircraftSpotability } from "./spotability.ts";

test("solarElevationDeg: sun is up at local noon, down at midnight", () => {
  // Swindon, summer. ~12:00 UTC (near solar noon) vs 00:00 UTC.
  const noon = solarElevationDeg(51.6, -1.8, new Date("2026-06-21T12:00:00Z"));
  const midnight = solarElevationDeg(51.6, -1.8, new Date("2026-06-21T00:00:00Z"));
  assert.ok(noon > 40, `noon elevation should be high, got ${noon}`);
  assert.ok(midnight < 0, `midnight elevation should be below horizon, got ${midnight}`);
});

test("assessAircraftSpotability: clear + high + daylight = excellent/good", () => {
  const s = assessAircraftSpotability({
    elevationDeg: 41,
    slantRangeMiles: 7.2,
    altitudeFeet: 9000,
    flightCategory: "VFR",
    sunElevationDeg: 30,
  });
  assert.equal(s.rating, "excellent");
});

test("assessAircraftSpotability: aircraft above a cloud ceiling is obscured", () => {
  const s = assessAircraftSpotability({
    elevationDeg: 30,
    slantRangeMiles: 8,
    altitudeFeet: 18000,
    flightCategory: "MVFR",
    cloudBaseFeet: 7000,
    sunElevationDeg: 20,
  });
  assert.equal(s.rating, "obscured");
});

test("assessAircraftSpotability: poor conditions read poor; low elevation reads poor", () => {
  assert.equal(
    assessAircraftSpotability({ elevationDeg: 25, slantRangeMiles: 9, flightCategory: "IFR", sunElevationDeg: 10 }).rating,
    "poor",
  );
  assert.equal(
    assessAircraftSpotability({ elevationDeg: 3, slantRangeMiles: 20, flightCategory: "VFR", sunElevationDeg: 10 }).rating,
    "poor",
  );
});
