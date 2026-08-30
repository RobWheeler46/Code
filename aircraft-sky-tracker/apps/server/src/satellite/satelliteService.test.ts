import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SatelliteService, type SatelliteConfigView } from "./satelliteService.js";
import type { OrbitalDataProvider, OrbitalElement } from "./orbitalProvider.js";
import { parseTle } from "./orbitalProvider.js";
import { OrbitalElementCache } from "./orbitalCache.js";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900`;

const CFG: SatelliteConfigView = {
  showSatellites: true,
  minElevationDeg: 15,
  showStations: true,
  showBright: true,
  showStarlink: false,
  latitude: 51.59,
  longitude: -1.79,
};

test("retries loading orbital elements after an initial fetch failure", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const el = parseTle(ISS_TLE, "station")[0]!;
    let calls = 0;
    const provider: OrbitalDataProvider = {
      name: "fake",
      async fetchElements(): Promise<OrbitalElement[]> {
        calls += 1;
        if (calls === 1) throw new Error("CelesTrak unreachable");
        return [el];
      },
    };
    const svc = new SatelliteService(provider, () => CFG, () => {}, false);

    await svc.start();
    // First fetch failed, so nothing is loaded yet and a retry is pending.
    assert.equal(svc.getElements().length, 0);
    assert.equal(svc.diagnostics().status, "disconnected");

    // Fire the 30s retry; the second fetch succeeds.
    mock.timers.tick(30_000);
    await new Promise((r) => setImmediate(r));

    assert.equal(svc.getElements().length, 1);
    assert.equal(svc.diagnostics().status, "connected");
    assert.equal(calls, 2);
    svc.stop();
  } finally {
    mock.timers.reset();
  }
});

test("serves last-good cached elements when CelesTrak is unreachable", async () => {
  const path = join(tmpdir(), `ast-svc-cache-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  try {
    // Pre-seed the cache as if a previous run had fetched successfully.
    const cache = new OrbitalElementCache(path);
    cache.save(parseTle(ISS_TLE, "station"), Date.now() - 3_600_000);

    const provider: OrbitalDataProvider = {
      name: "fake",
      async fetchElements(): Promise<OrbitalElement[]> {
        throw new Error("CelesTrak unreachable");
      },
    };
    const svc = new SatelliteService(provider, () => CFG, () => {}, false, cache);
    await svc.start();

    // Even though the live fetch failed, the sky is populated from the cache,
    // and the source is reported as degraded (data present, source unconfirmed).
    assert.equal(svc.getElements().length, 1);
    assert.equal(svc.diagnostics().status, "degraded");
    svc.stop();
  } finally {
    rmSync(path, { force: true });
  }
});

test("no retry is scheduled once elements are loaded", async () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  try {
    const el = parseTle(ISS_TLE, "station")[0]!;
    let calls = 0;
    const provider: OrbitalDataProvider = {
      name: "fake",
      async fetchElements(): Promise<OrbitalElement[]> {
        calls += 1;
        return [el];
      },
    };
    const svc = new SatelliteService(provider, () => CFG, () => {}, false);
    await svc.start();
    assert.equal(svc.getElements().length, 1);

    // Advancing well past the retry window must not trigger extra fetches
    // (only the 8-hour refresh cadence remains).
    mock.timers.tick(5 * 60_000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls, 1);
    svc.stop();
  } finally {
    mock.timers.reset();
  }
});
