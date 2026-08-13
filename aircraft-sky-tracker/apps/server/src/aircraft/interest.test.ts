import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateInterest, parseWatchlist } from "./interest.js";

test("ordinary airliner is not interesting", () => {
  const r = evaluateInterest(
    { icaoHex: "ABC123", aircraftTypeCode: "A320", aircraftCategory: "unknown", altitudeFeet: 30000 },
    [],
  );
  assert.equal(r, undefined);
});

test("military flag is detected", () => {
  const r = evaluateInterest({ icaoHex: "43C000", providerFlags: 1 }, []);
  assert.ok(r);
  assert.equal(r.label, "Military");
  assert.deepEqual(r.reasons, ["Military"]);
});

test("DB 'interesting' flag maps to Notable (when not military)", () => {
  const r = evaluateInterest({ icaoHex: "X", providerFlags: 2 }, []);
  assert.equal(r?.label, "Notable");
});

test("heavy/notable types are flagged with a friendly label", () => {
  assert.equal(evaluateInterest({ icaoHex: "X", aircraftTypeCode: "A388" }, [])?.label, "A380");
  assert.equal(evaluateInterest({ icaoHex: "X", aircraftTypeCode: "B744" }, [])?.label, "747");
});

test("helicopters are flagged", () => {
  const r = evaluateInterest(
    { icaoHex: "X", aircraftCategory: "helicopter", altitudeFeet: 800 },
    [],
  );
  assert.ok(r?.reasons.includes("Helicopter"));
  // Helicopters are not also flagged "Low".
  assert.ok(!r?.reasons.includes("Low"));
});

test("low fixed-wing aircraft are flagged", () => {
  const r = evaluateInterest(
    { icaoHex: "X", aircraftCategory: "piston", altitudeFeet: 700 },
    [],
  );
  assert.ok(r?.reasons.includes("Low"));
});

test("aircraft on the ground (0 ft) are not 'Low'", () => {
  const r = evaluateInterest({ icaoHex: "X", altitudeFeet: 0 }, []);
  assert.equal(r, undefined);
});

test("watchlist matches registration or type, ignoring punctuation/case", () => {
  const wl = parseWatchlist("g-euua, spit, LX-N90");
  assert.ok(evaluateInterest({ icaoHex: "X", registration: "G-EUUA" }, wl)?.reasons.includes("Watchlist"));
  assert.ok(evaluateInterest({ icaoHex: "X", aircraftTypeCode: "SPIT" }, wl)?.reasons.includes("Watchlist"));
  assert.equal(evaluateInterest({ icaoHex: "X", registration: "G-ZZZZ" }, wl), undefined);
});

test("multiple reasons combine; label is the first", () => {
  const r = evaluateInterest(
    { icaoHex: "X", providerFlags: 1, aircraftTypeCode: "A388", altitudeFeet: 500 },
    [],
  );
  assert.equal(r?.label, "Military");
  assert.ok(r?.reasons.includes("A380"));
  assert.ok(r?.reasons.includes("Low"));
});

test("parseWatchlist splits, normalises and dedupes", () => {
  assert.deepEqual(parseWatchlist(" G-EUUA  a388,,g-euua "), ["GEUUA", "A388"]);
  assert.deepEqual(parseWatchlist(""), []);
  assert.deepEqual(parseWatchlist(undefined), []);
});
