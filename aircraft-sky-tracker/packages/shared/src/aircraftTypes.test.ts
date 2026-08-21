import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aircraftCategoryFromType,
  aircraftSilhouetteFromType,
  isFighterType,
  isMilitaryType,
} from "./aircraftTypes.ts";

test("silhouette: most-specific-first for heavy/special types", () => {
  assert.equal(aircraftSilhouetteFromType("A388"), "a380");
  assert.equal(aircraftSilhouetteFromType("B744"), "b747");
  assert.equal(aircraftSilhouetteFromType("A400"), "a400m");
  assert.equal(aircraftSilhouetteFromType("C17"), "c17");
});

test("silhouette: fighters", () => {
  assert.equal(aircraftSilhouetteFromType("EUFI"), "fighter");
  assert.equal(aircraftSilhouetteFromType("F35"), "fighter");
  assert.equal(aircraftSilhouetteFromType("TYPH"), "fighter");
});

test("silhouette: narrowbody families", () => {
  assert.equal(aircraftSilhouetteFromType("A320"), "a320");
  assert.equal(aircraftSilhouetteFromType("A21N"), "a320");
  assert.equal(aircraftSilhouetteFromType("B738"), "b737");
  assert.equal(aircraftSilhouetteFromType("B38M"), "b737");
});

test("silhouette: props, helis, light, bizjet, military, generic", () => {
  assert.equal(aircraftSilhouetteFromType("DH8D"), "turboprop");
  assert.equal(aircraftSilhouetteFromType("EC35"), "helicopter");
  assert.equal(aircraftSilhouetteFromType("C172"), "light");
  assert.equal(aircraftSilhouetteFromType("GLF5"), "bizjet");
  assert.equal(aircraftSilhouetteFromType("K35R"), "military");
  assert.equal(aircraftSilhouetteFromType("A359"), "generic");
  assert.equal(aircraftSilhouetteFromType(undefined), "generic");
});

test("silhouette: ignores case and punctuation", () => {
  assert.equal(aircraftSilhouetteFromType("a388"), "a380");
  assert.equal(aircraftSilhouetteFromType(" dh8-d "), "turboprop");
});

test("category is derived from silhouette", () => {
  assert.equal(aircraftCategoryFromType("A320"), "jet");
  assert.equal(aircraftCategoryFromType("B744"), "jet");
  assert.equal(aircraftCategoryFromType("EC35"), "helicopter");
  assert.equal(aircraftCategoryFromType("DH8D"), "turboprop");
  assert.equal(aircraftCategoryFromType("A400"), "turboprop");
  assert.equal(aircraftCategoryFromType("C172"), "piston");
  assert.equal(aircraftCategoryFromType("A359"), "unknown");
  assert.equal(aircraftCategoryFromType(undefined), "unknown");
});

test("military and fighter helpers", () => {
  assert.ok(isFighterType("F35"));
  assert.ok(!isFighterType("A320"));
  assert.ok(isMilitaryType("C130"));
  assert.ok(isMilitaryType("C17"));
  assert.ok(isMilitaryType("EUFI"));
  assert.ok(!isMilitaryType("B738"));
});
