import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDatabase } from "./db.js";
import { AccountRepo } from "./accountRepo.js";

function repo(): AccountRepo {
  return new AccountRepo(createInMemoryDatabase());
}

const PROFILE = { id: "sub-1", email: "a@b.com", name: "A B", picture: "http://x/y.png" };

test("upsertUser creates then refreshes a user", () => {
  const r = repo();
  r.upsertUser(PROFILE);
  assert.deepEqual(r.getUser("sub-1"), { email: "a@b.com", name: "A B", picture: "http://x/y.png" });
  r.upsertUser({ ...PROFILE, name: "New Name" });
  assert.equal(r.getUser("sub-1")?.name, "New Name");
});

test("saved locations are per-user and list Home first", () => {
  const r = repo();
  r.upsertUser(PROFILE);
  r.upsertUser({ id: "sub-2" });
  r.addLocation("sub-1", { label: "Work", latitude: 51.5, longitude: -0.1 });
  const home = r.addLocation("sub-1", { label: "Home", latitude: 51.6, longitude: -1.78, isHome: true });
  r.addLocation("sub-2", { label: "Elsewhere", latitude: 55, longitude: -1 });

  const list = r.listLocations("sub-1");
  assert.equal(list.length, 2);
  assert.equal(list[0]?.label, "Home"); // Home sorts first
  assert.equal(list[0]?.isHome, true);
  assert.equal(list[0]?.id, home.id);
  // Isolation: sub-2's location is not visible to sub-1.
  assert.equal(r.listLocations("sub-2").length, 1);
});

test("setHome moves the Home flag to exactly one location", () => {
  const r = repo();
  r.upsertUser(PROFILE);
  const a = r.addLocation("sub-1", { label: "A", latitude: 51, longitude: -1, isHome: true });
  const b = r.addLocation("sub-1", { label: "B", latitude: 52, longitude: -2 });
  assert.equal(r.setHome("sub-1", b.id), true);
  const list = r.listLocations("sub-1");
  assert.equal(list.find((l) => l.id === b.id)?.isHome, true);
  assert.equal(list.find((l) => l.id === a.id)?.isHome, false);
});

test("a user cannot delete or use another user's location", () => {
  const r = repo();
  r.upsertUser(PROFILE);
  r.upsertUser({ id: "sub-2" });
  const loc = r.addLocation("sub-1", { label: "Mine", latitude: 51, longitude: -1 });
  assert.equal(r.deleteLocation("sub-2", loc.id), false);
  assert.equal(r.getLocation("sub-2", loc.id), undefined);
  assert.equal(r.deleteLocation("sub-1", loc.id), true);
});
