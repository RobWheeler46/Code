import { test } from "node:test";
import assert from "node:assert/strict";
import {
  haversineDistanceMiles,
  bearingDegrees,
  distanceBearingToEastNorth,
  projectionScale,
  projectToScreen,
  compassDirection,
  statuteMilesToNauticalMiles,
  providerQueryRadiusNm,
} from "./geo.ts";

test("haversine: identical points are zero distance", () => {
  assert.equal(haversineDistanceMiles(51.6, -1.7, 51.6, -1.7), 0);
});

test("haversine: one degree of latitude is ~69 miles", () => {
  const d = haversineDistanceMiles(51, 0, 52, 0);
  assert.ok(Math.abs(d - 69.09) < 0.5, `expected ~69.09, got ${d}`);
});

test("haversine: known SN25-ish separation is symmetric", () => {
  const a = haversineDistanceMiles(51.6, -1.78, 51.65, -1.7);
  const b = haversineDistanceMiles(51.65, -1.7, 51.6, -1.78);
  assert.ok(Math.abs(a - b) < 1e-9);
});

test("bearing: due north is 0 degrees", () => {
  const b = bearingDegrees(51, 0, 52, 0);
  assert.ok(Math.abs(b - 0) < 0.5 || Math.abs(b - 360) < 0.5, `got ${b}`);
});

test("bearing: due east is ~90 degrees", () => {
  const b = bearingDegrees(51, 0, 51, 1);
  assert.ok(Math.abs(b - 90) < 0.5, `got ${b}`);
});

test("bearing: due south is 180 degrees", () => {
  const b = bearingDegrees(52, 0, 51, 0);
  assert.ok(Math.abs(b - 180) < 0.5, `got ${b}`);
});

test("east/north: north bearing maps to +north, ~0 east", () => {
  const en = distanceBearingToEastNorth(10, 0);
  assert.ok(Math.abs(en.east) < 1e-9);
  assert.ok(Math.abs(en.north - 10) < 1e-9);
});

test("east/north: east bearing maps to +east, ~0 north", () => {
  const en = distanceBearingToEastNorth(10, 90);
  assert.ok(Math.abs(en.east - 10) < 1e-9);
  assert.ok(Math.abs(en.north) < 1e-9);
});

test("projection scale: radius fits to half the smaller viewport dimension", () => {
  const scale = projectionScale(1920, 1080, 10);
  // smaller dimension 1080 / (2*10) = 54 px per mile
  assert.equal(scale, 54);
});

test("projectToScreen: centre maps to viewport centre", () => {
  const scale = projectionScale(1000, 1000, 10);
  const p = projectToScreen({ east: 0, north: 0 }, 1000, 1000, scale);
  assert.deepEqual(p, { x: 500, y: 500 });
});

test("projectToScreen: north is up (smaller y)", () => {
  const scale = projectionScale(1000, 1000, 10);
  const p = projectToScreen({ east: 0, north: 10 }, 1000, 1000, scale);
  assert.equal(p.x, 500);
  assert.ok(p.y < 500, `north should be above centre, got y=${p.y}`);
});

test("projectToScreen: east is right (larger x)", () => {
  const scale = projectionScale(1000, 1000, 10);
  const p = projectToScreen({ east: 10, north: 0 }, 1000, 1000, scale);
  assert.ok(p.x > 500, `east should be right of centre, got x=${p.x}`);
  assert.equal(p.y, 500);
});

test("compass: cardinal and intercardinal points", () => {
  assert.equal(compassDirection(0), "N");
  assert.equal(compassDirection(45), "NE");
  assert.equal(compassDirection(90), "E");
  assert.equal(compassDirection(135), "SE");
  assert.equal(compassDirection(180), "S");
  assert.equal(compassDirection(225), "SW");
  assert.equal(compassDirection(270), "W");
  assert.equal(compassDirection(315), "NW");
});

test("compass: rounds to nearest and wraps 360 -> N", () => {
  assert.equal(compassDirection(359), "N");
  assert.equal(compassDirection(22), "N");
  assert.equal(compassDirection(23), "NE");
  assert.equal(compassDirection(-45), "NW");
});

test("radius conversion: 10 statute miles ~= 8.69 nautical miles", () => {
  const nm = statuteMilesToNauticalMiles(10);
  assert.ok(Math.abs(nm - 8.69) < 0.02, `got ${nm}`);
});

test("provider query radius adds ~5% margin (~9.13 nm)", () => {
  const nm = providerQueryRadiusNm(10);
  assert.ok(Math.abs(nm - 9.13) < 0.05, `got ${nm}`);
});
