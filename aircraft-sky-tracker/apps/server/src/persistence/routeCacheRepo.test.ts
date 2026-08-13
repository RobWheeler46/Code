import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDatabase } from "./db.js";
import { RouteCacheRepo, type CachedRoute } from "./routeCacheRepo.js";

function route(overrides: Partial<CachedRoute> = {}): CachedRoute {
  const now = new Date();
  return {
    callsign: "BAW1462",
    destinationIcao: "EGPH",
    destinationDisplayName: "Edinburgh",
    confidence: "high",
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString(),
    source: "adsbdb",
    ...overrides,
  };
}

test("route cache hit returns a stored route", () => {
  const repo = new RouteCacheRepo(createInMemoryDatabase());
  repo.put(route());
  const got = repo.get("BAW1462");
  assert.ok(got);
  assert.equal(got.destinationDisplayName, "Edinburgh");
  assert.equal(got.confidence, "high");
});

test("expired route is not returned (cache expiry)", () => {
  const repo = new RouteCacheRepo(createInMemoryDatabase());
  const past = new Date(Date.now() - 1000).toISOString();
  repo.put(route({ expiresAt: past }));
  assert.equal(repo.get("BAW1462"), undefined);
});

test("negative cache entry (unknown route) is stored and counted", () => {
  const repo = new RouteCacheRepo(createInMemoryDatabase());
  repo.put(
    route({
      callsign: "ZZZ999",
      destinationIcao: undefined,
      destinationDisplayName: undefined,
      confidence: "low",
    }),
  );
  const got = repo.get("ZZZ999");
  assert.ok(got);
  assert.equal(got.confidence, "low");
  assert.equal(got.destinationDisplayName, undefined);
  assert.equal(repo.count(), 1);
});

test("put upserts an existing callsign", () => {
  const repo = new RouteCacheRepo(createInMemoryDatabase());
  repo.put(route());
  repo.put(route({ destinationDisplayName: "Glasgow", destinationIcao: "EGPF" }));
  assert.equal(repo.count(), 1);
  assert.equal(repo.get("BAW1462")?.destinationDisplayName, "Glasgow");
});
