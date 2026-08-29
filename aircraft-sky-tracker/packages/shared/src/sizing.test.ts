import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDisplayScale, automaticScale, isCompactDisplay } from "./sizing.ts";

const DESKTOP = { width: 1920, height: 1080 };

test("manual display-scale profiles are ordered compact < standard < large", () => {
  const base = { viewingDistance: "normal", ...DESKTOP } as const;
  const compact = resolveDisplayScale({ displayScale: "compact", ...base });
  const standard = resolveDisplayScale({ displayScale: "standard", ...base });
  const large = resolveDisplayScale({ displayScale: "large", ...base });
  assert.ok(compact < standard, `${compact} < ${standard}`);
  assert.ok(standard < large, `${standard} < ${large}`);
  assert.equal(standard, 1, "standard/normal is the 1.0 reference");
});

test("viewing distance scales up as the viewer moves away", () => {
  const base = { displayScale: "standard", ...DESKTOP } as const;
  const close = resolveDisplayScale({ viewingDistance: "close", ...base });
  const normal = resolveDisplayScale({ viewingDistance: "normal", ...base });
  const room = resolveDisplayScale({ viewingDistance: "across-room", ...base });
  assert.ok(close < normal && normal < room, `${close} < ${normal} < ${room}`);
});

test("automatic scale grows with screen size and stays clamped", () => {
  const phone = automaticScale(360, 780);
  const tv = automaticScale(3840, 2160);
  assert.ok(phone < 1, `phone ${phone} < 1`);
  assert.ok(tv > 1, `tv ${tv} > 1`);
  // Clamped to sane bounds.
  assert.ok(automaticScale(100, 100) >= 0.7);
  assert.ok(automaticScale(10000, 10000) <= 1.6);
  // Degenerate dimensions fall back to 1.
  assert.equal(automaticScale(0, 0), 1);
});

test("automatic on a phone with far viewing still stays within overall bounds", () => {
  const s = resolveDisplayScale({
    displayScale: "automatic",
    viewingDistance: "across-room",
    width: 360,
    height: 780,
  });
  assert.ok(s >= 0.6 && s <= 2.2, `overall ${s} within [0.6, 2.2]`);
});

test("isCompactDisplay: narrow screens and small scales shorten labels", () => {
  assert.equal(isCompactDisplay(360, 1), true);
  assert.equal(isCompactDisplay(1920, 0.8), true);
  assert.equal(isCompactDisplay(1920, 1.1), false);
});
