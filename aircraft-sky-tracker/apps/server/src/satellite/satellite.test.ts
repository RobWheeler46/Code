import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTle } from "./orbitalProvider.js";
import { isSunlit, sunEci, EARTH_RADIUS_KM } from "./astro.js";
import { observe, observerFrom, orbitFrom } from "./sgp4Service.js";
import { skyBearing } from "./simulationSatellites.js";

const ISS_TLE = `ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900`;

test("parseTle extracts catalog number, name and a usable satrec", () => {
  const els = parseTle(ISS_TLE, "station");
  assert.equal(els.length, 1);
  assert.equal(els[0]?.catalogNumber, "25544");
  assert.equal(els[0]?.name, "ISS (ZARYA)");
  assert.equal(els[0]?.category, "station");
  // The satrec must propagate to a real look angle.
  const obs = observe(els[0]!.satrec, observerFrom(51.59, -1.79), new Date("2024-08-27T21:00:00Z"));
  assert.ok(obs);
  assert.ok(Number.isFinite(obs.elevationDeg));
  assert.ok(obs.altitudeKm > 300 && obs.altitudeKm < 500, `alt ${obs.altitudeKm}`);
});

test("parseTle ignores malformed blocks", () => {
  assert.equal(parseTle("garbage\nmore garbage", "bright").length, 0);
});

test("parseTle captures the international designator", () => {
  const els = parseTle(ISS_TLE, "station");
  assert.equal(els[0]?.intlDesignator, "1998-067A");
});

test("orbitFrom derives ISS orbital characteristics", () => {
  const el = parseTle(ISS_TLE, "station")[0]!;
  const orbit = orbitFrom(el, new Date("2024-08-27T12:00:00Z"));
  // ISS orbits roughly every 92-93 minutes at ~51.6° inclination, ~420 km.
  assert.ok(orbit.periodMinutes > 90 && orbit.periodMinutes < 95, `period ${orbit.periodMinutes}`);
  assert.ok(
    orbit.inclinationDegrees > 51 && orbit.inclinationDegrees < 52,
    `inclination ${orbit.inclinationDegrees}`,
  );
  assert.ok(orbit.apogeeKm > 380 && orbit.apogeeKm < 460, `apogee ${orbit.apogeeKm}`);
  assert.ok(orbit.perigeeKm > 380 && orbit.perigeeKm < 460, `perigee ${orbit.perigeeKm}`);
  assert.ok(orbit.apogeeKm >= orbit.perigeeKm);
  assert.equal(orbit.intlDesignator, "1998-067A");
  // Epoch is day 240.5 of 2024 = 2024-08-27T12:00Z, so age is ~0 here.
  assert.ok(Math.abs(orbit.elementAgeHours) < 1, `age ${orbit.elementAgeHours}`);
});

test("isSunlit: a satellite on the sunward side is lit", () => {
  const date = new Date("2024-06-21T12:00:00Z");
  const sun = sunEci(date);
  // A point 500 km up on the sunward side.
  const mag = Math.hypot(sun.x, sun.y, sun.z);
  const dir = { x: sun.x / mag, y: sun.y / mag, z: sun.z / mag };
  const r = EARTH_RADIUS_KM + 500;
  assert.equal(isSunlit({ x: dir.x * r, y: dir.y * r, z: dir.z * r }, sun), true);
});

test("isSunlit: a satellite in the anti-sun shadow cylinder is dark", () => {
  const date = new Date("2024-06-21T12:00:00Z");
  const sun = sunEci(date);
  const mag = Math.hypot(sun.x, sun.y, sun.z);
  const dir = { x: sun.x / mag, y: sun.y / mag, z: sun.z / mag };
  // Directly behind Earth, well inside the umbra cylinder.
  assert.equal(isSunlit({ x: -dir.x * 6800, y: -dir.y * 6800, z: -dir.z * 6800 }, sun), false);
});

test("skyBearing: eastward azimuth change reads as a compass bearing", () => {
  // Rising in the east and moving north across the sky.
  const b = skyBearing({ az: 90, el: 20 }, { az: 90, el: 40 });
  assert.ok(Number.isFinite(b));
});
