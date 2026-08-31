import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyConfidence,
  locationTooApproximateForTrueSky,
  IP_APPROXIMATE_RADIUS_KM,
} from "./location.ts";

test("classifyConfidence: device is precise, postcode/manual/default are good", () => {
  assert.equal(classifyConfidence("device"), "precise");
  assert.equal(classifyConfidence("postcode"), "good");
  assert.equal(classifyConfidence("manual"), "good");
  assert.equal(classifyConfidence("default"), "good");
});

test("classifyConfidence: IP is approximate or coarse by accuracy radius", () => {
  assert.equal(classifyConfidence("ip", 25), "approximate");
  assert.equal(classifyConfidence("ip", IP_APPROXIMATE_RADIUS_KM), "approximate");
  assert.equal(classifyConfidence("ip", 120), "coarse");
  // Unknown radius defaults to approximate (city-level assumption).
  assert.equal(classifyConfidence("ip"), "approximate");
});

test("locationTooApproximateForTrueSky: only coarse/unknown warn", () => {
  assert.equal(locationTooApproximateForTrueSky("precise"), false);
  assert.equal(locationTooApproximateForTrueSky("good"), false);
  assert.equal(locationTooApproximateForTrueSky("approximate"), false);
  assert.equal(locationTooApproximateForTrueSky("coarse"), true);
  assert.equal(locationTooApproximateForTrueSky("unknown"), true);
});
