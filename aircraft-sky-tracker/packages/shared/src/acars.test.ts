import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acarsCategoryLabel,
  isDefaultVisibleCategory,
  rawDisplayAllowed,
  isDisplayableCorrelation,
} from "./acars.ts";

test("acarsCategoryLabel maps decoded categories to human labels", () => {
  assert.equal(acarsCategoryLabel("oooi"), "OOOI / flight state");
  assert.equal(acarsCategoryLabel("position"), "Position");
  assert.equal(acarsCategoryLabel("other"), "Other");
});

test("isDefaultVisibleCategory hides technical/operational/other from the standard view", () => {
  assert.equal(isDefaultVisibleCategory("position"), true);
  assert.equal(isDefaultVisibleCategory("weather"), true);
  assert.equal(isDefaultVisibleCategory("technical"), false);
  assert.equal(isDefaultVisibleCategory("operational"), false);
  assert.equal(isDefaultVisibleCategory("other"), false);
});

test("rawDisplayAllowed: user preference can never override deployment policy (§Legal)", () => {
  // Deployment forbids raw -> never allowed, whatever the user chose.
  assert.equal(rawDisplayAllowed(false, "full"), false);
  assert.equal(rawDisplayAllowed(false, "decoded"), false);
  // Deployment allows raw -> only when the user chose "full".
  assert.equal(rawDisplayAllowed(true, "decoded"), false);
  assert.equal(rawDisplayAllowed(true, "off"), false);
  assert.equal(rawDisplayAllowed(true, "full"), true);
});

test("isDisplayableCorrelation requires a strong correlation", () => {
  assert.equal(isDisplayableCorrelation("confirmed"), true);
  assert.equal(isDisplayableCorrelation("high"), true);
  assert.equal(isDisplayableCorrelation("medium"), false);
  assert.equal(isDisplayableCorrelation("low"), false);
});
