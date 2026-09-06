/**
 * Tests for the pure Look Now prediction engine (FRD v4.0 §16-18). In the server
 * package because it imports geo helpers by value from @ast/shared.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  predictClosestApproach,
  assessPredictionConfidence,
  type ApproachInput,
} from "@ast/shared";

const OBS = { latitude: 51.5, longitude: -1.8 };
const MILES_PER_DEGREE = (3958.7613 * Math.PI) / 180;

/** Place an aircraft at an east/north offset (miles) from the observer. */
function at(eastMiles: number, northMiles: number, over: Partial<ApproachInput> = {}): ApproachInput {
  return {
    latitude: OBS.latitude + northMiles / MILES_PER_DEGREE,
    longitude: OBS.longitude + eastMiles / (MILES_PER_DEGREE * Math.cos((OBS.latitude * Math.PI) / 180)),
    groundSpeedKnots: 300,
    ...over,
  };
}

describe("predictClosestApproach", () => {
  it("projects an aircraft passing to the north as it tracks west", () => {
    // 20 mi east, 5 mi north, flying due west (270) -> closest point at 5 mi north.
    const a = at(20, 5, { trackDegrees: 270, altitudeFeet: 4000, verticalRateFpm: 0 });
    const r = predictClosestApproach(OBS, a);
    assert.ok(r, "expected a prediction");
    // 300 kt = 345.2 mph; 20 mi / 345.2 = 0.05793 h = ~209 s.
    assert.ok(Math.abs(r!.timeToClosestSeconds - 209) < 6, `time was ${r!.timeToClosestSeconds}`);
    assert.ok(Math.abs(r!.horizontalDistanceMiles - 5) < 0.3, `horiz ${r!.horizontalDistanceMiles}`);
    assert.equal(r!.lookCompass, "North");
    assert.equal(r!.altitudeFeet, 4000);
    assert.ok(r!.elevationDeg > 5 && r!.elevationDeg < 15);
  });

  it("returns undefined for an aircraft moving away", () => {
    // Same spot but heading due east -> receding.
    const a = at(20, 5, { trackDegrees: 90 });
    assert.equal(predictClosestApproach(OBS, a), undefined);
  });

  it("returns undefined without a usable ground speed / track", () => {
    assert.equal(predictClosestApproach(OBS, at(20, 5, { groundSpeedKnots: 0, trackDegrees: 270 })), undefined);
    assert.equal(predictClosestApproach(OBS, at(20, 5, { trackDegrees: undefined })), undefined);
  });

  it("projects a descending aircraft to a lower altitude at the closest point", () => {
    const a = at(20, 5, { trackDegrees: 270, altitudeFeet: 6000, verticalRateFpm: -1500 });
    const r = predictClosestApproach(OBS, a);
    assert.ok(r);
    // ~209 s = ~3.48 min of descent at 1500 fpm -> ~5200 ft lost -> ~800 ft.
    assert.ok(r!.altitudeFeet! < 1100 && r!.altitudeFeet! > 500, `alt ${r!.altitudeFeet}`);
  });
});

describe("assessPredictionConfidence", () => {
  const base = { trackSpreadDeg: 2, verticalRateFpm: 0, positionAgeSeconds: 2, timeToClosestSeconds: 120 };
  it("is high for a fresh, straight, near-term approach", () => {
    assert.equal(assessPredictionConfidence(base), "high");
  });
  it("drops to low when the aircraft is turning", () => {
    assert.equal(assessPredictionConfidence({ ...base, trackSpreadDeg: 30 }), "low");
  });
  it("drops to low when the position is stale", () => {
    assert.equal(assessPredictionConfidence({ ...base, positionAgeSeconds: 45 }), "low");
  });
  it("is medium for a long-horizon or rapidly climbing projection", () => {
    assert.equal(assessPredictionConfidence({ ...base, timeToClosestSeconds: 8 * 60 }), "medium");
    assert.equal(assessPredictionConfidence({ ...base, verticalRateFpm: 2500 }), "medium");
  });
});
