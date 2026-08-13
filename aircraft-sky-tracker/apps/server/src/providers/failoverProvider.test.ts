import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderAircraft } from "@ast/shared";
import type { AircraftProvider } from "./types.js";
import { FailoverProvider } from "./failoverProvider.js";

class FakeProvider implements AircraftProvider {
  calls = 0;
  constructor(
    readonly name: string,
    private behaviour: () => ProviderAircraft[],
  ) {}
  setBehaviour(behaviour: () => ProviderAircraft[]): void {
    this.behaviour = behaviour;
  }
  async fetchAircraft(): Promise<ProviderAircraft[]> {
    this.calls++;
    return this.behaviour();
  }
}

const ac = (hex: string): ProviderAircraft[] => [{ icaoHex: hex, latitude: 51, longitude: -1 }];
const boom = (): ProviderAircraft[] => {
  throw new Error("provider down");
};

test("uses the primary provider when healthy", async () => {
  const primary = new FakeProvider("primary", () => ac("P"));
  const backup = new FakeProvider("backup", () => ac("B"));
  const fo = new FailoverProvider([primary, backup], { now: () => 1000 });

  const out = await fo.fetchAircraft(51, -1, 10);
  assert.equal(out[0]?.icaoHex, "P");
  assert.equal(backup.calls, 0);
  assert.equal(fo.name, "primary");
});

test("fails over to the backup when the primary throws", async () => {
  const primary = new FakeProvider("primary", boom);
  const backup = new FakeProvider("backup", () => ac("B"));
  const fo = new FailoverProvider([primary, backup], { now: () => 1000, cooldownMs: 30000 });

  const out = await fo.fetchAircraft(51, -1, 10);
  assert.equal(out[0]?.icaoHex, "B");
  assert.equal(fo.name, "backup");
});

test("skips a cooled-down primary until its cooldown expires, then recovers", async () => {
  let t = 1000;
  const primary = new FakeProvider("primary", boom);
  const backup = new FakeProvider("backup", () => ac("B"));
  const fo = new FailoverProvider([primary, backup], { now: () => t, cooldownMs: 30000 });

  // First call: primary throws -> cooldown, backup used.
  await fo.fetchAircraft(51, -1, 10);
  assert.equal(primary.calls, 1);

  // 10s later: primary still cooling down -> not retried, backup used.
  t = 11000;
  await fo.fetchAircraft(51, -1, 10);
  assert.equal(primary.calls, 1, "primary should not be retried during cooldown");
  assert.equal(fo.name, "backup");

  // After cooldown: primary recovers and is retried first.
  t = 32000;
  primary.setBehaviour(() => ac("P"));
  const out = await fo.fetchAircraft(51, -1, 10);
  assert.equal(primary.calls, 2);
  assert.equal(out[0]?.icaoHex, "P");
  assert.equal(fo.name, "primary");
});

test("an empty result is a success, not a failover", async () => {
  const primary = new FakeProvider("primary", () => []);
  const backup = new FakeProvider("backup", () => ac("B"));
  const fo = new FailoverProvider([primary, backup], { now: () => 1000 });

  const out = await fo.fetchAircraft(51, -1, 10);
  assert.deepEqual(out, []);
  assert.equal(backup.calls, 0);
});

test("throws when every provider fails", async () => {
  const primary = new FakeProvider("primary", boom);
  const backup = new FakeProvider("backup", boom);
  const fo = new FailoverProvider([primary, backup], { now: () => 1000 });

  await assert.rejects(() => fo.fetchAircraft(51, -1, 10));
});
