import { test } from "node:test";
import assert from "node:assert/strict";
import type { Aircraft } from "@ast/shared";
import { createInMemoryDatabase } from "../persistence/db.js";
import { HistoryRepo } from "../persistence/historyRepo.js";
import { HistoryService } from "./historyService.js";

// Deterministic date function for tests: UTC calendar date from the timestamp.
const dateFn = (now: number) => new Date(now).toISOString().slice(0, 10);

function service(): { svc: HistoryService; repo: HistoryRepo } {
  const repo = new HistoryRepo(createInMemoryDatabase());
  const svc = new HistoryService(repo, dateFn);
  return { svc, repo };
}

function ac(overrides: Partial<Aircraft> = {}): Aircraft {
  return {
    id: "ABC123",
    icaoHex: "ABC123",
    latitude: 51.6,
    longitude: -1.8,
    distanceMiles: 5,
    bearingFromCentre: 0,
    positionAgeSeconds: 1,
    lastUpdated: "",
    source: "test",
    ...overrides,
  } as Aircraft;
}

const DAY = "2026-08-21T12:00:00Z";
const t = (iso: string) => new Date(iso).getTime();

test("creates a pass when an aircraft is first seen", () => {
  const { svc, repo } = service();
  svc.ingest([ac({ altitudeFeet: 10000, groundSpeedKnots: 300 })], t(DAY));
  svc.flush();
  const passes = repo.listByDate("2026-08-21");
  assert.equal(passes.length, 1);
  assert.equal(passes[0]?.icaoHex, "ABC123");
});

test("tracks closest approach (minimum distance)", () => {
  const { svc, repo } = service();
  svc.ingest([ac({ distanceMiles: 5 })], t(DAY));
  svc.ingest([ac({ distanceMiles: 3 })], t(DAY) + 1000);
  svc.ingest([ac({ distanceMiles: 4 })], t(DAY) + 2000);
  svc.flush();
  assert.equal(repo.listByDate("2026-08-21")[0]?.closestApproachMiles, 3);
});

test("tracks min/max altitude and max speed", () => {
  const { svc, repo } = service();
  svc.ingest([ac({ altitudeFeet: 12000, groundSpeedKnots: 300 })], t(DAY));
  svc.ingest([ac({ altitudeFeet: 8000, groundSpeedKnots: 420 })], t(DAY) + 1000);
  svc.ingest([ac({ altitudeFeet: 15000, groundSpeedKnots: 380 })], t(DAY) + 2000);
  svc.flush();
  const p = repo.listByDate("2026-08-21")[0];
  assert.equal(p?.minimumAltitudeFeet, 8000);
  assert.equal(p?.maximumAltitudeFeet, 15000);
  assert.equal(p?.maximumGroundSpeedKnots, 420);
});

test("completes (persists) a pass when the aircraft leaves", () => {
  const { svc, repo } = service();
  svc.ingest([ac()], t(DAY));
  svc.ingest([], t(DAY) + 2000); // aircraft gone -> pass closed
  const passes = repo.listByDate("2026-08-21");
  assert.equal(passes.length, 1);
});

test("a re-entry after leaving creates a second pass", () => {
  const { svc, repo } = service();
  svc.ingest([ac()], t(DAY));
  svc.ingest([], t(DAY) + 2000);
  svc.ingest([ac()], t(DAY) + 4000);
  svc.flush();
  assert.equal(repo.listByDate("2026-08-21").length, 2);
});

test("upgrades destination only when confidence improves", () => {
  const { svc, repo } = service();
  svc.ingest([ac({ destination: { displayName: "Bristol", confidence: "low" } })], t(DAY));
  svc.ingest(
    [ac({ destination: { displayName: "Edinburgh", confidence: "high" } })],
    t(DAY) + 1000,
  );
  svc.flush();
  const p = repo.listByDate("2026-08-21")[0];
  assert.equal(p?.destination, "Edinburgh");
  assert.equal(p?.routeConfidence, "high");
});

test("filters passes by date", () => {
  const { svc, repo } = service();
  svc.ingest([ac({ icaoHex: "AAA", id: "AAA" })], t("2026-08-20T10:00:00Z"));
  svc.ingest([], t("2026-08-20T10:05:00Z"));
  svc.ingest([ac({ icaoHex: "BBB", id: "BBB" })], t("2026-08-21T10:00:00Z"));
  svc.flush();
  assert.equal(repo.listByDate("2026-08-20").length, 1);
  assert.equal(repo.listByDate("2026-08-21").length, 1);
  assert.deepEqual(
    repo.listDates().map((d) => d.date),
    ["2026-08-21", "2026-08-20"],
  );
});

test("prunes passes older than the retention window", () => {
  const { svc, repo } = service();
  svc.configure(true, 7);
  svc.ingest([ac({ icaoHex: "OLD", id: "OLD" })], t("2026-08-01T10:00:00Z"));
  svc.ingest([], t("2026-08-01T10:05:00Z"));
  svc.ingest([ac({ icaoHex: "NEW", id: "NEW" })], t("2026-08-21T10:00:00Z"));
  svc.ingest([], t("2026-08-21T10:05:00Z"));
  const removed = svc.pruneExpired(t("2026-08-21T12:00:00Z"));
  assert.equal(removed, 1);
  assert.equal(repo.listByDate("2026-08-01").length, 0);
  assert.equal(repo.listByDate("2026-08-21").length, 1);
});

test("does not record when history is disabled", () => {
  const { svc, repo } = service();
  svc.configure(false, 31);
  svc.ingest([ac()], t(DAY));
  svc.flush();
  assert.equal(repo.listByDate("2026-08-21").length, 0);
});
