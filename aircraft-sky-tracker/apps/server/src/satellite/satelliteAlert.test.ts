import { test } from "node:test";
import assert from "node:assert/strict";
import type { SatellitePass, SatelliteCategory } from "@ast/shared";
import {
  SatelliteAlertService,
  type SatelliteAlertConfigView,
} from "./satelliteAlertService.js";

function makePass(over: Partial<SatellitePass> & { risesInMs: number }): SatellitePass {
  const now = Date.now();
  const rise = now + over.risesInMs;
  return {
    catalogNumber: over.catalogNumber ?? "25544",
    name: over.name ?? "ISS",
    category: over.category ?? "station",
    riseTime: new Date(rise).toISOString(),
    maxTime: new Date(rise + 3 * 60_000).toISOString(),
    setTime: new Date(rise + 6 * 60_000).toISOString(),
    maxElevationDegrees: over.maxElevationDegrees ?? 67,
    riseAzimuthDegrees: 225,
    setAzimuthDegrees: 45,
    direction: "SW → NE",
    durationSeconds: 360,
    potentiallyVisible: over.potentiallyVisible ?? true,
    inProgress: false,
  };
}

const CFG: SatelliteAlertConfigView = {
  enabled: true,
  leadMinutes: 10,
  visibleOnly: true,
  showStations: true,
  showBright: true,
  showStarlink: false,
};

function makeService(cfg: SatelliteAlertConfigView, passes: SatellitePass[]) {
  const fired: { name: string; minutesUntil: number }[] = [];
  const svc = new SatelliteAlertService(
    () => cfg,
    () => passes,
    { topic: undefined, server: "https://ntfy.sh" }, // push disabled -> no network
    (pass, minutesUntil) => fired.push({ name: pass.name, minutesUntil }),
  );
  const tick = () => (svc as unknown as { tick(): void }).tick();
  return { svc, fired, tick };
}

test("fires once for a visible pass inside the lead window, then dedupes", () => {
  const { fired, tick } = makeService(CFG, [makePass({ risesInMs: 5 * 60_000 })]);
  tick();
  tick(); // same pass, must not re-alert
  assert.equal(fired.length, 1);
  assert.equal(fired[0]?.name, "ISS");
  assert.ok(fired[0]!.minutesUntil >= 4 && fired[0]!.minutesUntil <= 5);
});

test("does not fire when alerts are disabled", () => {
  const { fired, tick } = makeService(
    { ...CFG, enabled: false },
    [makePass({ risesInMs: 3 * 60_000 })],
  );
  tick();
  assert.equal(fired.length, 0);
});

test("visible-only filters out non-visible passes", () => {
  const { fired, tick } = makeService(CFG, [
    makePass({ risesInMs: 3 * 60_000, potentiallyVisible: false }),
  ]);
  tick();
  assert.equal(fired.length, 0);
});

test("does not fire before the lead window, then fires once inside it", () => {
  // 20 min out with a 10 min lead: nothing yet.
  const passes = [makePass({ risesInMs: 20 * 60_000 })];
  const { fired, tick } = makeService(CFG, passes);
  tick();
  assert.equal(fired.length, 0);
  // Move the same pass to 8 min out and tick again.
  passes[0] = makePass({ risesInMs: 8 * 60_000 });
  tick();
  assert.equal(fired.length, 1);
});

test("respects satellite group toggles", () => {
  const starlink = makePass({
    risesInMs: 4 * 60_000,
    category: "starlink" as SatelliteCategory,
    name: "STARLINK-1007",
    catalogNumber: "44238",
  });
  const { fired, tick } = makeService(CFG, [starlink]); // showStarlink is false
  tick();
  assert.equal(fired.length, 0);
});
