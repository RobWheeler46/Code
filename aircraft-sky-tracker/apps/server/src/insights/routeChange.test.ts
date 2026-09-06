/**
 * Tests for the pure history-based route-change detector (FRD v3.8 §43-44, §59).
 * Lives in the server package because it imports geo helpers by value from
 * @ast/shared, which the server's compile-then-run test setup resolves cleanly
 * (the shared package's strip-types runner does not remap transitive .js imports).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessRouteChange, type RouteChangeSample } from "@ast/shared";

const NOW = Date.parse("2026-09-06T12:00:00Z");
const MIN = 60_000;

const EDI = { icao: "EGPH", name: "Edinburgh", lat: 55.95, lon: -3.37 };
const GLA = { icao: "EGPF", name: "Glasgow", lat: 55.87, lon: -4.43 };
const observerNear = { lat: 51.6, lon: -1.8 };

function sample(over: Partial<RouteChangeSample> & { t: number }): RouteChangeSample {
  return {
    lat: observerNear.lat,
    lon: observerNear.lon,
    destConfidence: "high",
    sources: ["adsbdb"],
    ...over,
  };
}

function establishedTrail(dest: typeof EDI, agoMin: number, everyMin = 1): RouteChangeSample[] {
  const out: RouteChangeSample[] = [];
  for (let m = agoMin; m >= everyMin; m -= everyMin) {
    out.push(
      sample({
        t: NOW - m * MIN,
        destIcao: dest.icao,
        destName: dest.name,
        destLat: dest.lat,
        destLon: dest.lon,
      }),
    );
  }
  return out;
}

describe("assessRouteChange", () => {
  it("returns undefined with no history and no operational report", () => {
    const current = sample({ t: NOW, destIcao: EDI.icao, destName: EDI.name });
    assert.equal(assessRouteChange({ current, history: [], nowMs: NOW }), undefined);
  });

  it("detects a decision change when the destination airport changes (§59)", () => {
    const history = establishedTrail(EDI, 8);
    const current = sample({
      t: NOW,
      destIcao: GLA.icao,
      destName: GLA.name,
      destLat: GLA.lat,
      destLon: GLA.lon,
      destConfidence: "high",
    });
    const a = assessRouteChange({ current, history, nowMs: NOW });
    assert.ok(a, "expected a route change");
    assert.equal(a!.kind, "decision");
    assert.equal(a!.previousDestination, "Edinburgh");
    assert.equal(a!.newDestination, "Glasgow");
    assert.ok(a!.evidence.length >= 2, "must carry evidence");
  });

  it("raises a decision change to confirmed when two sources agree", () => {
    const history = establishedTrail(EDI, 8);
    const current = sample({
      t: NOW,
      destIcao: GLA.icao,
      destName: GLA.name,
      destLat: GLA.lat,
      destLon: GLA.lon,
      destConfidence: "high",
      sources: ["airframes", "adsbdb"],
    });
    const a = assessRouteChange({ current, history, nowMs: NOW });
    assert.equal(a!.confidence, "confirmed");
  });

  it("does not flag a decision change from a not-yet-established prior", () => {
    const history = [sample({ t: NOW - MIN, destIcao: EDI.icao, destName: EDI.name })];
    const current = sample({ t: NOW, destIcao: GLA.icao, destName: GLA.name });
    assert.equal(assessRouteChange({ current, history, nowMs: NOW }), undefined);
  });

  it("corroborates an operational report with geographic movement (§44 likely)", () => {
    const history = [
      sample({ t: NOW - 6 * MIN, lat: 52.2, lon: -1.8, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon }),
      sample({ t: NOW - 4 * MIN, lat: 51.8, lon: -1.8, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon }),
      sample({ t: NOW - 2 * MIN, lat: 51.4, lon: -1.8, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon }),
    ];
    const current = sample({ t: NOW, lat: 51.0, lon: -1.8, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon });
    const a = assessRouteChange({
      current,
      history,
      operational: { previousDestination: "Edinburgh", newDestination: "Glasgow", confidence: "possible" },
      nowMs: NOW,
    });
    assert.ok(a);
    assert.equal(a!.kind, "operational");
    assert.equal(a!.confidence, "likely");
    assert.ok(a!.evidence.some((e) => e.toLowerCase().includes("away")));
  });

  it("keeps operational confidence when geometry does not corroborate", () => {
    const history = establishedTrail(EDI, 6);
    const current = sample({ t: NOW, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon });
    const a = assessRouteChange({
      current,
      history,
      operational: { previousDestination: "Edinburgh", newDestination: "Glasgow", confidence: "possible" },
      nowMs: NOW,
    });
    assert.equal(a!.confidence, "possible");
  });

  it("flags a geometric divergence when tracking sustainedly away from the filed dest (§43)", () => {
    const mk = (m: number, lat: number): RouteChangeSample =>
      sample({
        t: NOW - m * MIN,
        lat,
        lon: -1.8,
        track: 180,
        destIcao: EDI.icao,
        destName: EDI.name,
        destLat: EDI.lat,
        destLon: EDI.lon,
      });
    const history = [mk(5, 52.2), mk(4, 52.0), mk(3, 51.8), mk(2, 51.6), mk(1, 51.4)];
    const current = mk(0, 51.2);
    const a = assessRouteChange({ current, history, nowMs: NOW });
    assert.ok(a, "expected a divergence");
    assert.equal(a!.kind, "divergence");
    assert.equal(a!.confidence, "possible");
    assert.equal(a!.newDestination, "");
    assert.ok(a!.evidence.some((e) => e.includes("Tracking away")));
  });

  it("does not flag divergence while manoeuvring (wide track spread)", () => {
    const mk = (m: number, lat: number, track: number): RouteChangeSample =>
      sample({ t: NOW - m * MIN, lat, lon: -1.8, track, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon });
    const history = [mk(5, 52.2, 10), mk(4, 52.0, 300), mk(3, 51.8, 120), mk(2, 51.6, 250), mk(1, 51.4, 40)];
    const current = mk(0, 51.2, 180);
    assert.equal(assessRouteChange({ current, history, nowMs: NOW }), undefined);
  });

  it("does not flag divergence for a short-lived deviation", () => {
    const mk = (m: number, lat: number): RouteChangeSample =>
      sample({ t: NOW - m * MIN, lat, lon: -1.8, track: 180, destIcao: EDI.icao, destName: EDI.name, destLat: EDI.lat, destLon: EDI.lon });
    const history = [mk(1, 51.5)];
    const current = mk(0, 51.4);
    assert.equal(assessRouteChange({ current, history, nowMs: NOW }), undefined);
  });
});
