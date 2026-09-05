import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveFlightState, flightStateLabel, oooiRows } from "./operations.ts";

test("deriveFlightState: OOOI events dominate, ADS-B fills the gaps", () => {
  assert.equal(deriveFlightState({}, false), "unknown");
  assert.equal(deriveFlightState({}, true), "airborne");
  assert.equal(deriveFlightState({ out: "t" }, false), "departed-gate");
  assert.equal(deriveFlightState({ out: "t", off: "t" }, true), "en-route");
  assert.equal(deriveFlightState({ out: "t", off: "t" }, false), "airborne");
  assert.equal(deriveFlightState({ out: "t", off: "t", on: "t" }, false), "landed");
  assert.equal(deriveFlightState({ out: "t", off: "t", on: "t", in: "t" }, false), "arrived");
});

test("flightStateLabel is human-readable (no OOOI jargon)", () => {
  assert.equal(flightStateLabel("en-route"), "En route");
  assert.equal(flightStateLabel("arrived"), "Arrived at gate");
  assert.equal(flightStateLabel("unknown"), "Unknown");
});

test("oooiRows maps events to readable labels in order", () => {
  const rows = oooiRows({ out: "18:32", off: "18:44" });
  assert.deepEqual(
    rows.map((r) => r.label),
    ["Departed gate", "Airborne", "Landed", "At gate"],
  );
  assert.equal(rows[0]?.time, "18:32");
  assert.equal(rows[2]?.time, undefined);
});
