import { test } from "node:test";
import assert from "node:assert/strict";
import { LocationService } from "./locationService.js";
import { LocationCacheRepo } from "../persistence/locationCacheRepo.js";
import { createInMemoryDatabase } from "../persistence/db.js";

function service(): LocationService {
  return new LocationService(new LocationCacheRepo(createInMemoryDatabase()));
}

test("normalises postcode casing and spacing", () => {
  const svc = service();
  assert.equal(svc.normalise("sn254tp"), "SN254TP");
  assert.equal(svc.normalise("  sn25  4tp "), "SN25 4TP");
});

test("accepts valid-looking UK postcodes", () => {
  const svc = service();
  assert.ok(svc.looksLikePostcode("SN25 4TP"));
  assert.ok(svc.looksLikePostcode("EC1A 1BB"));
  assert.ok(svc.looksLikePostcode("sn254tp"));
});

test("rejects clearly invalid postcodes", () => {
  const svc = service();
  assert.equal(svc.looksLikePostcode("NOT A POSTCODE"), false);
  assert.equal(svc.looksLikePostcode("12345"), false);
  assert.equal(svc.looksLikePostcode(""), false);
});

test("invalid postcode resolves as invalid without a network call", async () => {
  const svc = service();
  const result = await svc.validateAndResolve("not-a-postcode");
  assert.equal(result.valid, false);
});

test("cached coordinates are returned by getCached", () => {
  const cache = new LocationCacheRepo(createInMemoryDatabase());
  cache.put("SN25 4TP", 51.6, -1.78, "postcodes.io");
  const svc = new LocationService(cache);
  const got = svc.getCached("sn25 4tp");
  assert.ok(got);
  assert.equal(got.latitude, 51.6);
  assert.equal(got.origin, "cache");
});
