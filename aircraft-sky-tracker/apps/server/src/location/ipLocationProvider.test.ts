import { test } from "node:test";
import assert from "node:assert/strict";
import { clientIp, cloudflareLocation } from "./ipLocationProvider.js";

test("clientIp: takes the first public hop from x-forwarded-for", () => {
  assert.equal(clientIp({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), "203.0.113.7");
});

test("clientIp: prefers cf-connecting-ip when present", () => {
  assert.equal(
    clientIp({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.7" }),
    "198.51.100.9",
  );
});

test("clientIp: private/loopback addresses are not treated as the client", () => {
  assert.equal(clientIp({ "x-forwarded-for": "127.0.0.1" }), undefined);
  assert.equal(clientIp({ "x-forwarded-for": "192.168.1.20" }), undefined);
  assert.equal(clientIp({ "x-forwarded-for": "10.1.2.3" }), undefined);
  assert.equal(clientIp({}), undefined);
});

test("cloudflareLocation: builds an approximate IP location from edge headers", () => {
  const loc = cloudflareLocation({
    "cf-iplatitude": "51.58",
    "cf-iplongitude": "-1.78",
    "cf-ipcity": "Swindon",
    "cf-region": "England",
  });
  assert.ok(loc);
  assert.equal(loc!.source, "ip");
  assert.equal(loc!.confidence, "approximate");
  assert.equal(loc!.displayName, "Swindon, England");
  assert.ok(Math.abs(loc!.latitude - 51.58) < 1e-6);
});

test("cloudflareLocation: undefined without coordinate headers", () => {
  assert.equal(cloudflareLocation({ "cf-ipcity": "Swindon" }), undefined);
});
