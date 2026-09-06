import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InsightsEngine } from "./insightsEngine.js";
import type { Aircraft, FlightIntelligence, Insight } from "@ast/shared";

const NOW = Date.parse("2026-09-06T12:00:00Z");

function aircraft(over: Partial<Aircraft> = {}): Aircraft {
  return {
    id: over.icaoHex ?? "4008B3",
    icaoHex: "4008B3",
    callsign: "BAW123",
    latitude: 51.6,
    longitude: -1.8,
    distanceMiles: 4,
    bearingFromCentre: 90,
    positionAgeSeconds: 1,
    lastUpdated: new Date(NOW).toISOString(),
    source: "adsbfi",
    ...over,
  };
}

function diversionFlight(): FlightIntelligence {
  return {
    available: true,
    routeConfidence: "high",
    flightState: "en-route",
    oooi: {},
    sources: ["airframes", "adsbdb", "ADS-B"],
    possibleRouteChange: {
      previousDestination: "Edinburgh",
      newDestination: "Glasgow",
      confidence: "likely",
    },
  };
}

function makeEngine(
  enrich: (a: Aircraft) => Promise<FlightIntelligence | undefined>,
): { engine: InsightsEngine; changes: Insight[][] } {
  const changes: Insight[][] = [];
  const engine = new InsightsEngine(enrich, (i) => changes.push(i), {
    now: () => NOW,
    enrichTtlMs: 0, // always re-enrich in tests
  });
  return { engine, changes };
}

describe("InsightsEngine", () => {
  it("creates an insight and broadcasts once", async () => {
    const { engine, changes } = makeEngine(async () => diversionFlight());
    await engine.onSnapshot([aircraft()], NOW);
    assert.equal(changes.length, 1, "expected one broadcast on creation");
    const primary = engine.primary();
    assert.equal(primary?.type, "possible.diversion");
    assert.equal(engine.forAircraft("4008B3").length, 1);
  });

  it("does not re-broadcast when nothing changes", async () => {
    const { engine, changes } = makeEngine(async () => diversionFlight());
    await engine.onSnapshot([aircraft()], NOW);
    await engine.onSnapshot([aircraft()], NOW + 1100);
    assert.equal(changes.length, 1, "steady state must not spam broadcasts");
  });

  it("expires an insight when the aircraft leaves the area", async () => {
    const { engine, changes } = makeEngine(async () => diversionFlight());
    await engine.onSnapshot([aircraft()], NOW);
    await engine.onSnapshot([], NOW + 1100);
    assert.equal(engine.list().length, 0);
    assert.equal(engine.primary(), undefined);
    assert.equal(changes.length, 2, "creation + expiry");
  });

  it("drops an insight once its evidence no longer holds", async () => {
    let divert = true;
    const { engine } = makeEngine(async () => (divert ? diversionFlight() : undefined));
    await engine.onSnapshot([aircraft()], NOW);
    assert.equal(engine.list().length, 1);
    divert = false;
    await engine.onSnapshot([aircraft()], NOW + 1100);
    assert.equal(engine.list().length, 0, "evidence gone -> insight gone");
  });

  it("tracks a descent streak across snapshots into a likely-landing insight", async () => {
    const { engine } = makeEngine(async () => undefined); // no operational evidence
    const descending = aircraft({ verticalRateFpm: -1200, altitudeFeet: 3500, onGround: false });
    // First seen descending: streak = 0, no insight yet.
    await engine.onSnapshot([descending], NOW);
    assert.equal(engine.forAircraft("4008B3").length, 0);
    // Five minutes of continuous descent -> insight appears.
    await engine.onSnapshot([descending], NOW + 5 * 60_000);
    const insights = engine.forAircraft("4008B3");
    assert.equal(insights.length, 1);
    assert.equal(insights[0]!.type, "likely.landing");
  });

  it("resets the descent streak if the aircraft stops descending", async () => {
    const { engine } = makeEngine(async () => undefined);
    const descending = aircraft({ verticalRateFpm: -1200, altitudeFeet: 3500, onGround: false });
    const level = aircraft({ verticalRateFpm: 0, altitudeFeet: 3500, onGround: false });
    await engine.onSnapshot([descending], NOW);
    await engine.onSnapshot([level], NOW + 3 * 60_000); // streak reset
    await engine.onSnapshot([descending], NOW + 4 * 60_000); // streak restarts
    // Only 0ms into the new streak -> no likely-landing yet.
    assert.equal(engine.forAircraft("4008B3").length, 0);
  });

  it("bounds enrichment to the nearest aircraft", async () => {
    const enriched: string[] = [];
    const { engine } = new (class {
      e = new InsightsEngine(
        async (a: Aircraft) => {
          enriched.push(a.icaoHex);
          return undefined;
        },
        () => {},
        { now: () => NOW, enrichTtlMs: 0, maxEnrich: 2 },
      );
      get engine() {
        return this.e;
      }
    })();
    const fleet: Aircraft[] = [
      aircraft({ icaoHex: "AAAAAA", distanceMiles: 9 }),
      aircraft({ icaoHex: "BBBBBB", distanceMiles: 1 }),
      aircraft({ icaoHex: "CCCCCC", distanceMiles: 3 }),
    ];
    await engine.onSnapshot(fleet, NOW);
    assert.equal(enriched.length, 2, "only the nearest two are enriched");
    assert.deepEqual(enriched.sort(), ["BBBBBB", "CCCCCC"]);
  });
});
