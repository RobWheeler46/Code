/**
 * Tests for the pure aviation-context logic (FRD v4.0 §35-47) and the curated
 * providers. In the server package because the shared aviation module imports geo
 * helpers by value.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  pointInRegion,
  airspaceForPoint,
  estimateContrail,
  nearestStation,
  type AirspaceRegion,
} from "@ast/shared";
import { StaticUkAirspaceProvider } from "./airspaceProvider.js";
import { CuratedModProvider } from "./modProvider.js";
import { UK_METAR_STATIONS } from "./aviationWeatherProvider.js";

const brize: AirspaceRegion = {
  id: "EGVN-MATZ",
  name: "Brize Norton MATZ",
  type: "MATZ",
  lower: { feet: 0, label: "SFC" },
  upper: { feet: 3300, label: "3,300 ft" },
  geometry: { kind: "circle", lat: 51.758, lon: -1.578, radiusNm: 5 },
  source: "curated",
};

const box: AirspaceRegion = {
  id: "BOX",
  name: "Test box",
  type: "danger",
  lower: { feet: 0, label: "SFC" },
  upper: { feet: 10000, label: "10,000 ft" },
  geometry: { kind: "polygon", points: [[51, -2], [51, -1], [52, -1], [52, -2]] },
  source: "curated",
};

describe("airspace geometry", () => {
  it("detects a point inside and outside a circular region", () => {
    assert.equal(pointInRegion(51.758, -1.578, brize), true); // centre
    assert.equal(pointInRegion(51.6, -1.79, brize), false); // ~12 nm away
  });

  it("detects a point inside and outside a polygon region", () => {
    assert.equal(pointInRegion(51.5, -1.5, box), true);
    assert.equal(pointInRegion(50.5, -1.5, box), false);
  });

  it("reports vertical match only when altitude is inside the band", () => {
    const low = airspaceForPoint(51.758, -1.578, 2000, [brize]);
    assert.equal(low.length, 1);
    assert.equal(low[0]!.verticalMatch, true);
    const high = airspaceForPoint(51.758, -1.578, 10000, [brize]);
    assert.equal(high[0]!.verticalMatch, false); // horizontally in, vertically above
    const unknown = airspaceForPoint(51.758, -1.578, undefined, [brize]);
    assert.equal(unknown[0]!.verticalMatch, undefined);
  });
});

describe("contrail estimate", () => {
  it("is unlikely below the contrail altitude regardless of conditions", () => {
    assert.equal(estimateContrail(20000, -50, 90).likelihood, "unlikely");
  });
  it("is likely when cold and humid at cruise", () => {
    assert.equal(estimateContrail(36000, -45, 70).likelihood, "likely");
  });
  it("is possible when cold but only moderately humid", () => {
    assert.equal(estimateContrail(36000, -45, 50).likelihood, "possible");
  });
  it("is unlikely when too warm", () => {
    assert.equal(estimateContrail(36000, -30, 90).likelihood, "unlikely");
  });
  it("is unknown without upper-air data or altitude", () => {
    assert.equal(estimateContrail(36000, undefined, undefined).likelihood, "unknown");
    assert.equal(estimateContrail(undefined, -45, 70).likelihood, "unknown");
  });
  it("always frames the result as an estimate", () => {
    assert.match(estimateContrail(36000, -45, 70).note.toLowerCase(), /estimate/);
  });
});

describe("nearest station", () => {
  it("picks the closest UK station to the observer", () => {
    // Near Swindon; Fairford (EGVA) is the closest curated station.
    const near = nearestStation(51.6, -1.79, UK_METAR_STATIONS);
    assert.ok(near);
    assert.equal(near!.station.icao, "EGVA");
  });
});

describe("curated airspace provider", () => {
  it("provides the curated UK region set", () => {
    const regions = new StaticUkAirspaceProvider().regions();
    assert.ok(regions.length >= 5);
    assert.ok(regions.every((r) => r.source === "curated"));
    assert.ok(regions.some((r) => r.type === "danger"));
  });
});

describe("military context (§37-38)", () => {
  const regions = new StaticUkAirspaceProvider().regions();
  const mod = new CuratedModProvider();

  it("returns an elevated context on a weekday daytime near military airspace", () => {
    const weekdayNoon = new Date("2026-09-07T12:00:00Z"); // Monday
    const ctx = mod.context(51.6, -1.79, regions, weekdayNoon);
    assert.ok(ctx);
    assert.equal(ctx!.level, "elevated");
    assert.match(ctx!.note, /military/i);
    // Context only - must not assert an aircraft is participating.
    assert.doesNotMatch(ctx!.note, /participating|exercise x/i);
  });

  it("returns only a possible context outside working hours", () => {
    const sundayNight = new Date("2026-09-06T23:00:00Z"); // Sunday
    const ctx = mod.context(51.6, -1.79, regions, sundayNight);
    assert.equal(ctx!.level, "possible");
  });

  it("returns nothing far from any military airspace", () => {
    // Mid-North-Sea, far from the curated regions.
    assert.equal(mod.context(56.0, 2.0, regions, new Date("2026-09-07T12:00:00Z")), undefined);
  });
});
