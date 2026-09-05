import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SimulationOperationalProvider,
  AirframesOperationalProvider,
  OperationalIntelligenceService,
} from "./operationalIntelligence.js";

const sim = new SimulationOperationalProvider();
const tracked = (callsign?: string) => ({ icaoHex: "ABC123", callsign, registration: "G-ABCD", airborne: true });

test("simulation: no callsign yields no operational evidence", async () => {
  assert.equal(await sim.lookup(tracked(undefined)), undefined);
});

test("simulation: produces the FRD §106 scenario variety across callsigns", async () => {
  const callsigns = Array.from({ length: 40 }, (_, i) => `SIM${i}`);
  const results = await Promise.all(callsigns.map((c) => sim.lookup(tracked(c))));
  const present = results.filter((r): r is NonNullable<typeof r> => r !== undefined);
  // Every present evidence has OOOI and at least one source.
  for (const r of present) {
    assert.ok(r.sources.length > 0);
    assert.ok(r.oooi.out || r.oooi.off || r.oooi.on || r.oooi.in);
  }
  // Variety: a confirmed (two sources), a possible route change, and a stale (undefined).
  assert.ok(present.some((r) => r.sources.includes("airframes") && r.sources.includes("adsbdb")));
  assert.ok(present.some((r) => r.possibleRouteChange));
  assert.ok(results.some((r) => r === undefined));
});

test("simulation is deterministic per callsign", async () => {
  const a = await sim.lookup(tracked("BAW1462"));
  const b = await sim.lookup(tracked("BAW1462"));
  assert.deepEqual(a, b);
});

test("Airframes provider is disabled without enable flag + key, and inert", async () => {
  assert.equal(new AirframesOperationalProvider(false, "rest", "https://x/v1", "key").enabled, false);
  assert.equal(new AirframesOperationalProvider(true, "rest", "https://x/v1", undefined).enabled, false);
  const enabled = new AirframesOperationalProvider(true, "rest", "https://x/v1", "key");
  assert.equal(enabled.enabled, true);
  assert.equal(await enabled.lookup(tracked("BAW1")), undefined); // live mapping pending
});

test("service returns nothing when the provider is disabled", async () => {
  const svc = new OperationalIntelligenceService(
    new AirframesOperationalProvider(false, "rest", "https://x/v1", undefined),
  );
  assert.equal(svc.sourceName, "none");
  assert.equal(await svc.lookup(tracked("BAW1462")), undefined);
});
