import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, writeFileSync } from "node:fs";
import { OrbitalElementCache } from "./orbitalCache.js";
import { parseTle } from "./orbitalProvider.js";
import { observe, observerFrom } from "./sgp4Service.js";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900`;

function tempFile(): string {
  return join(tmpdir(), `ast-orbital-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test("cache round-trips elements and rebuilds a usable satrec", () => {
  const path = tempFile();
  try {
    const cache = new OrbitalElementCache(path);
    const original = parseTle(ISS_TLE, "station");
    assert.equal(original.length, 1);

    cache.save(original, Date.parse("2024-08-27T12:00:00Z"));
    const loaded = cache.load();
    assert.ok(loaded);
    assert.equal(loaded!.elements.length, 1);
    assert.equal(loaded!.fetchedAt, Date.parse("2024-08-27T12:00:00Z"));

    const el = loaded!.elements[0]!;
    assert.equal(el.catalogNumber, "25544");
    assert.equal(el.category, "station");
    assert.equal(el.intlDesignator, "1998-067A");
    // The rebuilt satrec must still propagate to a real look angle.
    const obs = observe(el.satrec, observerFrom(51.59, -1.79), new Date("2024-08-27T21:00:00Z"));
    assert.ok(obs && Number.isFinite(obs.elevationDeg) && obs.altitudeKm > 300 && obs.altitudeKm < 500);
  } finally {
    rmSync(path, { force: true });
  }
});

test("load returns undefined when no cache file exists", () => {
  const cache = new OrbitalElementCache(tempFile());
  assert.equal(cache.load(), undefined);
});

test("load returns undefined for a corrupt cache file", () => {
  const path = tempFile();
  try {
    const cache = new OrbitalElementCache(path);
    writeFileSync(path, "{ not json", "utf8");
    assert.equal(cache.load(), undefined);
  } finally {
    rmSync(path, { force: true });
  }
});
