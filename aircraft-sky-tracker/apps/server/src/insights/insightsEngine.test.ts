import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InsightsEngine, type InsightStreamEvent } from "./insightsEngine.js";
import type { Aircraft, FlightIntelligence } from "@ast/shared";

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

interface Harness {
  engine: InsightsEngine;
  /** All events, flattened across emit calls. */
  events: InsightStreamEvent[];
  /** Number of emit() invocations (each = one reconcile that produced deltas). */
  emitCalls: number;
}

function makeEngine(
  enrich: (a: Aircraft) => Promise<FlightIntelligence | undefined>,
  opts: { maxEnrich?: number } = {},
): Harness {
  const h: Harness = { events: [], emitCalls: 0, engine: undefined as unknown as InsightsEngine };
  h.engine = new InsightsEngine(
    enrich,
    (batch) => {
      h.emitCalls += 1;
      h.events.push(...batch);
    },
    { now: () => NOW, enrichTtlMs: 0, ...opts },
  );
  return h;
}

const created = (h: Harness) => h.events.filter((e) => e.kind === "created");
const expired = (h: Harness) => h.events.filter((e) => e.kind === "expired");
const routeUpdated = (h: Harness) => h.events.filter((e) => e.kind === "route-updated");

describe("InsightsEngine lifecycle events", () => {
  it("emits created + route-updated when a diversion first appears", async () => {
    const h = makeEngine(async () => diversionFlight());
    await h.engine.onSnapshot([aircraft()], NOW);
    assert.equal(h.emitCalls, 1, "one emit on creation");
    const c = created(h);
    assert.equal(c.length, 1);
    assert.equal(c[0]!.kind === "created" && c[0]!.insight.type, "possible.diversion");
    assert.equal(routeUpdated(h).length, 1, "route.updated emitted for the change");
    assert.equal(h.engine.primary()?.type, "possible.diversion");
  });

  it("does not emit when nothing changes", async () => {
    const h = makeEngine(async () => diversionFlight());
    await h.engine.onSnapshot([aircraft()], NOW);
    await h.engine.onSnapshot([aircraft()], NOW + 1100);
    assert.equal(h.emitCalls, 1, "steady state produces no further deltas");
  });

  it("emits expired when the aircraft leaves the area", async () => {
    const h = makeEngine(async () => diversionFlight());
    await h.engine.onSnapshot([aircraft()], NOW);
    await h.engine.onSnapshot([], NOW + 1100);
    assert.equal(h.engine.list().length, 0);
    assert.equal(expired(h).length, 1, "expiry delta emitted");
  });

  it("drops an insight once its evidence no longer holds", async () => {
    let divert = true;
    const h = makeEngine(async () => (divert ? diversionFlight() : undefined));
    await h.engine.onSnapshot([aircraft()], NOW);
    assert.equal(h.engine.list().length, 1);
    divert = false;
    await h.engine.onSnapshot([aircraft()], NOW + 1100);
    assert.equal(h.engine.list().length, 0, "evidence gone -> insight gone");
    assert.equal(expired(h).length, 1);
  });
});

describe("InsightsEngine behaviour + enrichment", () => {
  it("tracks a descent streak across snapshots into a likely-landing insight", async () => {
    const h = makeEngine(async () => undefined);
    const descending = aircraft({ verticalRateFpm: -1200, altitudeFeet: 3500, onGround: false });
    await h.engine.onSnapshot([descending], NOW);
    assert.equal(h.engine.forAircraft("4008B3").length, 0);
    await h.engine.onSnapshot([descending], NOW + 5 * 60_000);
    const insights = h.engine.forAircraft("4008B3");
    assert.equal(insights.length, 1);
    assert.equal(insights[0]!.type, "likely.landing");
  });

  it("resets the descent streak if the aircraft stops descending", async () => {
    const h = makeEngine(async () => undefined);
    const descending = aircraft({ verticalRateFpm: -1200, altitudeFeet: 3500, onGround: false });
    const level = aircraft({ verticalRateFpm: 0, altitudeFeet: 3500, onGround: false });
    await h.engine.onSnapshot([descending], NOW);
    await h.engine.onSnapshot([level], NOW + 3 * 60_000);
    await h.engine.onSnapshot([descending], NOW + 4 * 60_000);
    assert.equal(h.engine.forAircraft("4008B3").length, 0);
  });

  it("bounds enrichment to the nearest aircraft", async () => {
    const enriched: string[] = [];
    const h = makeEngine(async (a: Aircraft) => {
      enriched.push(a.icaoHex);
      return undefined;
    }, { maxEnrich: 2 });
    const fleet: Aircraft[] = [
      aircraft({ icaoHex: "AAAAAA", distanceMiles: 9 }),
      aircraft({ icaoHex: "BBBBBB", distanceMiles: 1 }),
      aircraft({ icaoHex: "CCCCCC", distanceMiles: 3 }),
    ];
    await h.engine.onSnapshot(fleet, NOW);
    assert.equal(enriched.length, 2, "only the nearest two are enriched");
    assert.deepEqual(enriched.sort(), ["BBBBBB", "CCCCCC"]);
  });
});

describe("InsightsEngine route-change detection", () => {
  it("raises a ROUTE UPDATED insight when the destination decision changes", async () => {
    const h = makeEngine(async () => undefined);
    const withDest = (icao: string, name: string, lat: number, lon: number, t: number): Aircraft =>
      aircraft({
        latitude: 51.6,
        longitude: -1.8,
        trackDegrees: 350,
        destination: {
          icao,
          displayName: name,
          latitude: lat,
          longitude: lon,
          confidence: "high",
          sources: ["adsbdb"],
        },
      });
    // Establish Edinburgh over several minutes...
    for (let m = 8; m >= 1; m--) {
      await h.engine.onSnapshot([withDest("EGPH", "Edinburgh", 55.95, -3.37, m)], NOW - m * 60_000);
    }
    // ...then the decision flips to Glasgow.
    await h.engine.onSnapshot([withDest("EGPF", "Glasgow", 55.87, -4.43, 0)], NOW);
    const routeInsight = h.engine.forAircraft("4008B3").find((i) => i.type === "route.changed");
    assert.ok(routeInsight, "expected a ROUTE UPDATED insight");
    assert.ok(routeInsight!.lines.some((l) => l.includes("Glasgow")));
    assert.ok(routeUpdated(h).some((e) => e.kind === "route-updated" && e.newDestination === "Glasgow"));
  });
});
