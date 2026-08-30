import { test } from "node:test";
import assert from "node:assert/strict";
import { FailoverOrbitalProvider } from "./failoverOrbitalProvider.js";
import { parseTle, type OrbitalDataProvider, type OrbitalElement } from "./orbitalProvider.js";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900`;

function fixedProvider(name: string, els: OrbitalElement[]): OrbitalDataProvider {
  return { name, async fetchElements() { return els; } };
}
function failingProvider(name: string): OrbitalDataProvider {
  return { name, async fetchElements(): Promise<OrbitalElement[]> { throw new Error(`${name} down`); } };
}

const ISS = parseTle(ISS_TLE, "station");

test("uses the primary when it succeeds and does not call the secondary", async () => {
  let secondaryCalled = false;
  const secondary: OrbitalDataProvider = {
    name: "secondary",
    async fetchElements() {
      secondaryCalled = true;
      return [];
    },
  };
  const failover = new FailoverOrbitalProvider(fixedProvider("primary", ISS), secondary);
  const els = await failover.fetchElements(false);
  assert.equal(els.length, 1);
  assert.equal(secondaryCalled, false);
  assert.equal(failover.name, "primary");
});

test("falls back to the secondary when the primary throws", async () => {
  const failover = new FailoverOrbitalProvider(failingProvider("primary"), fixedProvider("secondary", ISS));
  const els = await failover.fetchElements(false);
  assert.equal(els.length, 1);
  assert.equal(failover.name, "secondary");
});

test("falls back to the secondary when the primary returns nothing", async () => {
  const failover = new FailoverOrbitalProvider(fixedProvider("primary", []), fixedProvider("secondary", ISS));
  const els = await failover.fetchElements(false);
  assert.equal(els.length, 1);
  assert.equal(failover.name, "secondary");
});

test("returns empty (no throw) when both fail and there is no secondary", async () => {
  const failover = new FailoverOrbitalProvider(failingProvider("primary"));
  const els = await failover.fetchElements(false);
  assert.deepEqual(els, []);
});
