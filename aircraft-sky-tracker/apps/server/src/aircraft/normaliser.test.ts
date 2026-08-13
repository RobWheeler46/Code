import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderAircraft } from "@ast/shared";
import { normaliseAircraft } from "./normaliser.js";

function base(): ProviderAircraft {
  return {
    icaoHex: "4008B3",
    registration: "G-EUUA",
    aircraftTypeCode: "A320",
    callsign: "BAW1462",
    latitude: 51.6,
    longitude: -1.7,
    altitudeFeet: 13250,
    groundSpeedKnots: 312,
    trackDegrees: 318,
    positionAgeSeconds: 2,
  };
}

test("normalises a complete aircraft", () => {
  const n = normaliseAircraft(base(), "airplanes.live");
  assert.ok(n);
  assert.equal(n.icaoHex, "4008B3");
  assert.equal(n.registration, "G-EUUA");
  assert.equal(n.callsign, "BAW1462");
  assert.equal(n.source, "airplanes.live");
});

test("trims whitespace from callsign", () => {
  const n = normaliseAircraft({ ...base(), callsign: "  BAW1462 " }, "s");
  assert.equal(n?.callsign, "BAW1462");
});

test("missing registration is allowed (undefined)", () => {
  const n = normaliseAircraft({ ...base(), registration: undefined }, "s");
  assert.ok(n);
  assert.equal(n.registration, undefined);
});

test("empty callsign becomes undefined", () => {
  const n = normaliseAircraft({ ...base(), callsign: "   " }, "s");
  assert.equal(n?.callsign, undefined);
});

test("missing altitude and track are allowed", () => {
  const n = normaliseAircraft(
    { ...base(), altitudeFeet: undefined, trackDegrees: undefined },
    "s",
  );
  assert.ok(n);
  assert.equal(n.altitudeFeet, undefined);
  assert.equal(n.trackDegrees, undefined);
});

test("missing position is not displayable", () => {
  assert.equal(normaliseAircraft({ ...base(), latitude: undefined }, "s"), undefined);
  assert.equal(normaliseAircraft({ ...base(), longitude: undefined }, "s"), undefined);
});

test("stale position beyond 30s is not displayable", () => {
  assert.equal(normaliseAircraft({ ...base(), positionAgeSeconds: 31 }, "s"), undefined);
  assert.ok(normaliseAircraft({ ...base(), positionAgeSeconds: 15 }, "s"));
});
