import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessIdentity,
  decideRoute,
  type TrackedIdentity,
  type RouteEvidence,
} from "./confidenceEngine.js";

// Tracked aircraft near SN25 4TP heading NNW toward Edinburgh.
const TRACKED: TrackedIdentity = {
  icaoHex: "4008B3",
  registration: "G-EUUA",
  callsign: "BAW1462",
  trackDegrees: 340,
  latitude: 51.6,
  longitude: -1.7,
};

function adsbdb(overrides: Partial<RouteEvidence> = {}): RouteEvidence {
  return {
    source: "adsbdb",
    aircraftIcaoHex: "4008B3",
    aircraftRegistration: "G-EUUA",
    callsign: "BAW1462",
    destinationName: "Edinburgh",
    destinationIcao: "EGPH",
    destinationLatitude: 55.95,
    destinationLongitude: -3.19,
    originName: "Bristol",
    originIcao: "EGGD",
    airline: "British Airways",
    evidenceAgeMinutes: 10,
    ...overrides,
  };
}

test("identity: ICAO exact is confirmed", () => {
  assert.equal(assessIdentity(TRACKED, adsbdb()), "confirmed");
});

test("identity: registration mismatch is rejected", () => {
  assert.equal(
    assessIdentity(TRACKED, adsbdb({ aircraftRegistration: "G-EUUB" })),
    "rejected",
  );
});

test("identity: ICAO mismatch is rejected", () => {
  assert.equal(assessIdentity(TRACKED, adsbdb({ aircraftIcaoHex: "999999" })), "rejected");
});

test("identity: callsign only is weak", () => {
  const ev = adsbdb({ aircraftIcaoHex: undefined, aircraftRegistration: undefined });
  assert.equal(assessIdentity(TRACKED, ev), "weak");
});

test("single source (adsbdb) with strong evidence classifies High, not Confirmed", () => {
  const d = decideRoute(TRACKED, [adsbdb()]);
  assert.equal(d.classification, "high");
  assert.equal(d.identity, "confirmed");
  assert.ok(d.score >= 75, `score ${d.score}`);
  assert.equal(d.conflict, false);
  assert.deepEqual(d.sources, ["adsbdb"]);
  assert.equal(d.destination?.icao, "EGPH");
});

test("two independent sources agreeing reach Confirmed", () => {
  const airframes: RouteEvidence = {
    source: "airframes",
    aircraftIcaoHex: "4008B3",
    callsign: "BAW1462",
    destinationName: "Edinburgh",
    destinationIcao: "EGPH",
    destinationLatitude: 55.95,
    destinationLongitude: -3.19,
    hasActiveFlight: true,
    evidenceAgeMinutes: 5,
  };
  const d = decideRoute(TRACKED, [adsbdb(), airframes]);
  assert.equal(d.classification, "confirmed");
  assert.equal(d.conflict, false);
  assert.equal(d.sources.length, 2);
});

test("two sources disagreeing produce a conflict (Low, heading shown)", () => {
  const airframes: RouteEvidence = {
    source: "airframes",
    aircraftIcaoHex: "4008B3",
    callsign: "BAW1462",
    destinationName: "Heathrow",
    destinationIcao: "EGLL",
    hasActiveFlight: true,
  };
  const d = decideRoute(TRACKED, [adsbdb(), airframes]);
  assert.equal(d.conflict, true);
  assert.equal(d.classification, "low");
});

test("no destination evidence is Unknown", () => {
  const ev = adsbdb({ destinationName: undefined, destinationIcao: undefined, destinationIata: undefined });
  const d = decideRoute(TRACKED, [ev]);
  assert.equal(d.classification, "unknown");
});

test("rejected evidence alone yields Unknown with rejected identity", () => {
  const d = decideRoute(TRACKED, [adsbdb({ aircraftRegistration: "G-XXXX" })]);
  assert.equal(d.classification, "unknown");
  assert.equal(d.identity, "rejected");
});

test("stale evidence (>6h) downgrades the classification", () => {
  const fresh = decideRoute(TRACKED, [adsbdb({ evidenceAgeMinutes: 10 })]);
  const stale = decideRoute(TRACKED, [adsbdb({ evidenceAgeMinutes: 400 })]);
  assert.ok(stale.score < fresh.score, `stale ${stale.score} vs fresh ${fresh.score}`);
  assert.equal(stale.classification, "medium");
});

test("geographic implausibility (heading away) lowers the score", () => {
  const toward = decideRoute(TRACKED, [adsbdb()]);
  const away = decideRoute({ ...TRACKED, trackDegrees: 160 }, [adsbdb()]);
  assert.ok(away.score < toward.score, `away ${away.score} vs toward ${toward.score}`);
});

test("a route score never overrides a hard identity conflict (FRD §32)", () => {
  // Perfect route evidence but the registration conflicts -> still Unknown.
  const d = decideRoute(TRACKED, [
    adsbdb({ aircraftRegistration: "G-WRNG", evidenceAgeMinutes: 1 }),
  ]);
  assert.equal(d.classification, "unknown");
});
