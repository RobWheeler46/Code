import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "@ast/shared";
import { createInMemoryDatabase } from "./db.js";
import { SettingsRepo } from "./settingsRepo.js";

test("seeds default configuration (SN25 4TP, 10 miles, minimal)", () => {
  const repo = new SettingsRepo(createInMemoryDatabase());
  const config = repo.ensureSeeded();
  assert.equal(config.postcode, "SN25 4TP");
  assert.equal(config.radiusMiles, 10);
  assert.equal(config.displayMode, "minimal");
  assert.equal(config.showRegistration, true);
  assert.equal(config.showDestination, true);
  assert.equal(config.showFlightNumber, false);
});

test("ensureSeeded is idempotent", () => {
  const repo = new SettingsRepo(createInMemoryDatabase());
  const a = repo.ensureSeeded();
  const b = repo.ensureSeeded();
  assert.deepEqual(a, b);
});

test("save persists changes and round-trips booleans", () => {
  const repo = new SettingsRepo(createInMemoryDatabase());
  const seeded = repo.ensureSeeded();
  const saved = repo.save({
    ...seeded,
    postcode: "EC1A 1BB",
    latitude: 51.52,
    longitude: -0.1,
    showAltitude: true,
    showRegistration: false,
  });
  assert.equal(saved.postcode, "EC1A 1BB");
  assert.equal(saved.showAltitude, true);
  assert.equal(saved.showRegistration, false);
  // Re-read from the DB.
  assert.equal(repo.get().postcode, "EC1A 1BB");
  assert.equal(repo.get().showAltitude, true);
});

test("reset restores defaults over customised settings", () => {
  const repo = new SettingsRepo(createInMemoryDatabase());
  repo.ensureSeeded();
  repo.save({
    ...DEFAULT_CONFIG,
    postcode: "EC1A 1BB",
    latitude: 51.52,
    longitude: -0.1,
    showTrails: true,
    radiusMiles: 25,
  });
  const reset = repo.save({ ...DEFAULT_CONFIG });
  assert.equal(reset.postcode, "SN25 4TP");
  assert.equal(reset.radiusMiles, 10);
  assert.equal(reset.showTrails, false);
});
