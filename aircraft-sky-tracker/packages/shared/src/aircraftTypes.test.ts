import { test } from "node:test";
import assert from "node:assert/strict";
import { aircraftCategoryFromType } from "./aircraftTypes.ts";

test("airliner and unknown codes are jet/unknown (generic outline)", () => {
  assert.equal(aircraftCategoryFromType("A320"), "unknown");
  assert.equal(aircraftCategoryFromType("B738"), "unknown");
  assert.equal(aircraftCategoryFromType(undefined), "unknown");
  assert.equal(aircraftCategoryFromType(""), "unknown");
});

test("helicopters are classified", () => {
  assert.equal(aircraftCategoryFromType("EC35"), "helicopter");
  assert.equal(aircraftCategoryFromType("R44"), "helicopter");
  assert.equal(aircraftCategoryFromType("AW139"), "helicopter");
  assert.equal(aircraftCategoryFromType("H145"), "helicopter");
});

test("turboprops are classified", () => {
  assert.equal(aircraftCategoryFromType("DH8D"), "turboprop");
  assert.equal(aircraftCategoryFromType("AT72"), "turboprop");
  assert.equal(aircraftCategoryFromType("PC12"), "turboprop");
  assert.equal(aircraftCategoryFromType("C208"), "turboprop");
});

test("light/piston aircraft are classified", () => {
  assert.equal(aircraftCategoryFromType("C172"), "piston");
  assert.equal(aircraftCategoryFromType("PA28"), "piston");
  assert.equal(aircraftCategoryFromType("SR22"), "piston");
  assert.equal(aircraftCategoryFromType("C42"), "piston");
});

test("classification ignores case and punctuation", () => {
  assert.equal(aircraftCategoryFromType("c172"), "piston");
  assert.equal(aircraftCategoryFromType(" ec35 "), "helicopter");
  assert.equal(aircraftCategoryFromType("dh8-d"), "turboprop");
});
