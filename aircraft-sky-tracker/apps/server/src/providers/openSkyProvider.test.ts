import { test } from "node:test";
import assert from "node:assert/strict";
import { mapOpenSkyState, type OpenSkyState } from "./openSkyProvider.js";

// icao24, callsign, country, time_position, last_contact, lon, lat,
// baro_alt(m), on_ground, velocity(m/s), true_track, ...
function sampleState(overrides: Partial<Record<number, unknown>> = {}): OpenSkyState {
  const base: OpenSkyState = [
    "abc123", "BAW123  ", "United Kingdom", 1700, 1701, -1.7, 51.6, 3048,
    false, 154.3, 270, 0, null, 3200, "7000", false, 0,
  ];
  for (const [k, v] of Object.entries(overrides)) {
    base[Number(k)] = v as OpenSkyState[number];
  }
  return base;
}

test("maps a complete OpenSky state vector", () => {
  const a = mapOpenSkyState(sampleState(), 1705);
  assert.ok(a);
  assert.equal(a.icaoHex, "ABC123");
  assert.equal(a.callsign, "BAW123");
  assert.equal(a.latitude, 51.6);
  assert.equal(a.longitude, -1.7);
  assert.equal(a.trackDegrees, 270);
  assert.equal(a.positionAgeSeconds, 5); // 1705 - time_position(1700)
});

test("converts altitude (m -> ft) and speed (m/s -> kt)", () => {
  const a = mapOpenSkyState(sampleState(), 1705);
  assert.ok(a);
  assert.equal(a.altitudeFeet, 10000); // 3048 m
  assert.ok(Math.abs((a.groundSpeedKnots ?? 0) - 300) < 0.5); // 154.3 m/s
});

test("returns undefined when position is missing", () => {
  assert.equal(mapOpenSkyState(sampleState({ 5: null }), 1705), undefined);
  assert.equal(mapOpenSkyState(sampleState({ 6: null }), 1705), undefined);
});

test("blank callsign becomes undefined", () => {
  const a = mapOpenSkyState(sampleState({ 1: "        " }), 1705);
  assert.equal(a?.callsign, undefined);
});

test("falls back to last_contact when time_position is null", () => {
  const a = mapOpenSkyState(sampleState({ 3: null, 4: 1690 }), 1705);
  assert.equal(a?.positionAgeSeconds, 15);
});
