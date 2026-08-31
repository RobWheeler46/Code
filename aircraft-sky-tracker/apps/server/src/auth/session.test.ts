import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken, verifySessionToken } from "./session.js";

test("a freshly signed session token verifies to its user id", () => {
  const token = createSessionToken("google-sub-123");
  assert.equal(verifySessionToken(token), "google-sub-123");
});

test("a tampered payload fails verification", () => {
  const token = createSessionToken("user-1");
  const dot = token.lastIndexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  // Flip the last payload character; the signature no longer matches.
  const tampered = `${payload.slice(0, -1)}${payload.slice(-1) === "A" ? "B" : "A"}.${sig}`;
  assert.equal(verifySessionToken(tampered), undefined);
});

test("a tampered signature fails verification", () => {
  const token = createSessionToken("user-1");
  const payload = token.slice(0, token.lastIndexOf("."));
  assert.equal(verifySessionToken(`${payload}.deadbeef`), undefined);
});

test("an expired token is rejected", () => {
  const past = Date.now() - 40 * 24 * 60 * 60 * 1000; // signed 40 days ago (>30d TTL)
  const token = createSessionToken("user-1", past);
  assert.equal(verifySessionToken(token), undefined);
});

test("garbage and empty tokens are rejected", () => {
  assert.equal(verifySessionToken(undefined), undefined);
  assert.equal(verifySessionToken(""), undefined);
  assert.equal(verifySessionToken("not-a-token"), undefined);
});
