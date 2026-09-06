import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveAircraftInsights,
  pickPrimaryInsight,
  insightPriority,
  insightSurface,
  type Insight,
} from "./insights.ts";
import type { Aircraft } from "./aircraft.ts";
import type { FlightIntelligence } from "./operations.ts";

const NOW = Date.parse("2026-09-06T12:00:00Z");

function aircraft(over: Partial<Aircraft> = {}): Aircraft {
  return {
    id: "A1",
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

function fi(over: Partial<FlightIntelligence> = {}): FlightIntelligence {
  return {
    available: true,
    routeConfidence: "high",
    flightState: "en-route",
    oooi: {},
    sources: ["airframes", "adsbdb", "ADS-B"],
    ...over,
  };
}

describe("deriveAircraftInsights", () => {
  it("produces no insights without evidence", () => {
    const out = deriveAircraftInsights({ aircraft: aircraft(), nowMs: NOW });
    assert.equal(out.length, 0);
  });

  it("surfaces a possible route change from operational evidence", () => {
    const flight = fi({
      possibleRouteChange: {
        previousDestination: "Edinburgh",
        newDestination: "Glasgow",
        confidence: "likely",
      },
    });
    const out = deriveAircraftInsights({ aircraft: aircraft(), flight, nowMs: NOW });
    const diversion = out.find((i) => i.type === "possible.diversion");
    assert.ok(diversion, "expected a possible.diversion insight");
    assert.equal(diversion!.confidence, "high"); // "likely" -> high
    assert.equal(diversion!.surface, "main");
    assert.ok(diversion!.lines.some((l) => l.includes("Glasgow")));
    assert.ok(diversion!.why.length >= 2, "every insight must carry evidence (§92)");
  });

  it("flags recently airborne within the 12-minute window", () => {
    const off = new Date(NOW - 8 * 60_000).toISOString();
    const flight = fi({ flightState: "airborne", origin: "Bristol", oooi: { off } });
    const out = deriveAircraftInsights({ aircraft: aircraft({ onGround: false }), flight, nowMs: NOW });
    const airborne = out.find((i) => i.type === "recently.airborne");
    assert.ok(airborne);
    assert.ok(airborne!.lines.some((l) => l.includes("8 minutes ago")));
    assert.ok(airborne!.lines.some((l) => l.includes("Bristol")));
  });

  it("does not flag recently airborne once outside the window", () => {
    const off = new Date(NOW - 40 * 60_000).toISOString();
    const flight = fi({ flightState: "en-route", oooi: { off } });
    const out = deriveAircraftInsights({ aircraft: aircraft({ onGround: false }), flight, nowMs: NOW });
    assert.equal(out.find((i) => i.type === "recently.airborne"), undefined);
  });

  it("requires a sustained low-altitude descent for likely landing", () => {
    const descending = aircraft({ onGround: false, verticalRateFpm: -1200, altitudeFeet: 3500 });
    // Not long enough yet.
    const brief = deriveAircraftInsights({ aircraft: descending, descentForMs: 60_000, nowMs: NOW });
    assert.equal(brief.find((i) => i.type === "likely.landing"), undefined);
    // Sustained -> insight appears.
    const sustained = deriveAircraftInsights({
      aircraft: descending,
      descentForMs: 5 * 60_000,
      nowMs: NOW,
    });
    const landing = sustained.find((i) => i.type === "likely.landing");
    assert.ok(landing);
    assert.ok(landing!.why.some((w) => w.toLowerCase().includes("descending for")));
  });

  it("does not claim likely landing for a high-altitude descent", () => {
    const cruiseDescent = aircraft({ onGround: false, verticalRateFpm: -1000, altitudeFeet: 34000 });
    const out = deriveAircraftInsights({ aircraft: cruiseDescent, descentForMs: 6 * 60_000, nowMs: NOW });
    assert.equal(out.find((i) => i.type === "likely.landing"), undefined);
  });

  it("marks a landed flight as details-only", () => {
    const flight = fi({ flightState: "landed", destination: "Edinburgh", oooi: { on: new Date(NOW).toISOString() } });
    const out = deriveAircraftInsights({ aircraft: aircraft({ onGround: true }), flight, nowMs: NOW });
    const landed = out.find((i) => i.type === "flight.landed");
    assert.ok(landed);
    assert.equal(landed!.surface, "details");
  });
});

describe("pickPrimaryInsight", () => {
  it("returns undefined when nothing is main-screen eligible", () => {
    const flight = fi({ flightState: "landed", destination: "Edinburgh" });
    const insights = deriveAircraftInsights({ aircraft: aircraft({ onGround: true }), flight, nowMs: NOW });
    assert.equal(pickPrimaryInsight(insights), undefined);
  });

  it("prefers higher priority for the single main slot (§91)", () => {
    const diversion: Insight = {
      id: "x:possible.diversion",
      type: "possible.diversion",
      subjectKind: "aircraft",
      subjectId: "x",
      subjectLabel: "X",
      surface: "main",
      priority: insightPriority("possible.diversion"),
      confidence: "high",
      title: "POSSIBLE ROUTE CHANGE",
      lines: [],
      why: [],
      evidence: [],
      createdAt: new Date(NOW).toISOString(),
      updatedAt: new Date(NOW).toISOString(),
    };
    const airborne: Insight = {
      ...diversion,
      id: "x:recently.airborne",
      type: "recently.airborne",
      priority: insightPriority("recently.airborne"),
      title: "RECENTLY AIRBORNE",
    };
    const primary = pickPrimaryInsight([airborne, diversion]);
    assert.equal(primary?.type, "possible.diversion");
  });
});

describe("priority/surface tables", () => {
  it("keeps priority and surface consistent with the spec bands", () => {
    assert.ok(insightPriority("possible.diversion") > insightPriority("likely.landing"));
    assert.equal(insightSurface("flight.confirmed"), "details");
    assert.equal(insightSurface("possible.diversion"), "main");
  });
});
