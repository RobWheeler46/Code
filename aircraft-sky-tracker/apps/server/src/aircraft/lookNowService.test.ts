import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LookNowService } from "./lookNowService.js";
import type { Aircraft, LookNowPrediction } from "@ast/shared";

const OBS = { latitude: 51.5, longitude: -1.8 };
const MILES_PER_DEGREE = (3958.7613 * Math.PI) / 180;
const NOW = Date.parse("2026-09-06T12:00:00Z");

function at(
  eastMiles: number,
  northMiles: number,
  over: Partial<Aircraft> = {},
): Aircraft {
  const distance = Math.hypot(eastMiles, northMiles);
  return {
    id: over.icaoHex ?? "ABC123",
    icaoHex: over.icaoHex ?? "ABC123",
    callsign: "TEST1",
    latitude: OBS.latitude + northMiles / MILES_PER_DEGREE,
    longitude:
      OBS.longitude + eastMiles / (MILES_PER_DEGREE * Math.cos((OBS.latitude * Math.PI) / 180)),
    altitudeFeet: 5000,
    groundSpeedKnots: 300,
    trackDegrees: 270,
    distanceMiles: Math.round(distance * 100) / 100,
    withinDisplayRadius: false,
    bearingFromCentre: 90,
    positionAgeSeconds: 1,
    lastUpdated: new Date(NOW).toISOString(),
    source: "sim",
    ...over,
  };
}

function makeService() {
  const batches: LookNowPrediction[][] = [];
  const svc = new LookNowService((p) => batches.push(p), { now: () => NOW });
  return { svc, batches };
}

describe("LookNowService", () => {
  it("surfaces and broadcasts an approaching prediction-band aircraft", () => {
    const { svc, batches } = makeService();
    // 20 mi east, 5 mi north, heading west -> will pass ~5 mi north within display (10 mi).
    svc.onSnapshot([at(20, 5)], OBS, 10, NOW);
    assert.equal(svc.list().length, 1);
    assert.equal(svc.primary()?.label, "TEST1");
    assert.equal(batches.length, 1, "broadcast once on first appearance");
    assert.ok(svc.primary()!.approach.timeToClosestSeconds > 0);
  });

  it("ignores aircraft already within the display radius", () => {
    const { svc } = makeService();
    svc.onSnapshot([at(3, 1, { withinDisplayRadius: true })], OBS, 10, NOW);
    assert.equal(svc.list().length, 0);
  });

  it("ignores aircraft on the ground", () => {
    const { svc } = makeService();
    svc.onSnapshot([at(20, 5, { onGround: true })], OBS, 10, NOW);
    assert.equal(svc.list().length, 0);
  });

  it("ignores an aircraft whose closest approach stays outside the sky", () => {
    const { svc } = makeService();
    // 20 mi east, 30 mi north, heading west -> passes 30 mi north, never enters 10 mi.
    svc.onSnapshot([at(20, 30)], OBS, 10, NOW);
    assert.equal(svc.list().length, 0);
  });

  it("does not re-broadcast an unchanged prediction", () => {
    const { svc, batches } = makeService();
    svc.onSnapshot([at(20, 5)], OBS, 10, NOW);
    svc.onSnapshot([at(20, 5)], OBS, 10, NOW);
    assert.equal(batches.length, 1, "steady state does not re-broadcast");
  });

  it("broadcasts an empty set when the aircraft leaves", () => {
    const { svc, batches } = makeService();
    svc.onSnapshot([at(20, 5)], OBS, 10, NOW);
    svc.onSnapshot([], OBS, 10, NOW);
    assert.equal(svc.list().length, 0);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches[1], []);
  });
});
