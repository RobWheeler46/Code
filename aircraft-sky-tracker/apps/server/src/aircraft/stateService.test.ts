import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProviderAircraft } from "@ast/shared";
import { GeoService } from "../geo/geoService.js";
import { AircraftStateService } from "./stateService.js";
import type { RouteService } from "../routes/routeService.js";

// Centre near SN25 4TP (Swindon). Coordinates are illustrative only.
const CENTRE = { latitude: 51.6, longitude: -1.78 };

/** Route service stub - no network, no destinations/registrations. */
const routesStub = {
  getDestination: () => undefined,
  getRegistration: () => undefined,
} as unknown as RouteService;

function makeState(): AircraftStateService {
  return new AircraftStateService(new GeoService({ ...CENTRE }), routesStub);
}

/** An aircraft ~offsetMiles north of centre (no callsign -> no route lookups). */
function aircraftNorth(hex: string, offsetMiles: number): ProviderAircraft {
  return {
    icaoHex: hex,
    registration: `G-${hex}`,
    latitude: CENTRE.latitude + offsetMiles / 69,
    longitude: CENTRE.longitude,
    trackDegrees: 180,
    positionAgeSeconds: 1,
  };
}

test("aircraft inside the radius is displayed", () => {
  const state = makeState();
  const out = state.update([aircraftNorth("AAA", 5)], 10, "test");
  assert.equal(out.length, 1);
  assert.equal(state.getCounts().insideRadius, 1);
  assert.ok((out[0]?.distanceMiles ?? 99) < 10);
});

test("ground aircraft are shown by default and hidden when the option is on", () => {
  const airborne = aircraftNorth("AIR", 4);
  const grounded: ProviderAircraft = { ...aircraftNorth("GND", 3), onGround: true };

  // Default: both appear, and the ground flag is carried through.
  const shown = makeState().update([airborne, grounded], 10, "test");
  assert.equal(shown.length, 2);
  assert.equal(shown.find((a) => a.icaoHex === "GND")?.onGround, true);

  // hideGround = true: the grounded aircraft is excluded, the airborne one stays.
  const filtered = makeState().update([airborne, grounded], 10, "test", Date.now(), "", undefined, true);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.icaoHex, "AIR");
});

test("aircraft beyond the radius does not appear", () => {
  const state = makeState();
  const out = state.update([aircraftNorth("BBB", 12)], 10, "test");
  assert.equal(out.length, 0);
  assert.equal(state.getCounts().insideRadius, 0);
});

test("radius boundary: just inside vs just outside", () => {
  const state = makeState();
  const inside = state.update([aircraftNorth("IN", 9.8)], 10, "test");
  assert.equal(inside.length, 1);
  const state2 = makeState();
  const outside = state2.update([aircraftNorth("OUT", 10.5)], 10, "test");
  assert.equal(outside.length, 0);
});

test("bearing due north is ~0 degrees", () => {
  const state = makeState();
  const out = state.update([aircraftNorth("NRT", 5)], 10, "test");
  const bearing = out[0]?.bearingFromCentre ?? -1;
  assert.ok(bearing < 1 || bearing > 359, `got ${bearing}`);
});

test("aircraft that leaves the feed is held then removed after 30s", () => {
  const state = makeState();
  const t0 = 1_000_000;
  state.update([aircraftNorth("HOLD", 5)], 10, "test", t0);
  // Not present in the next poll, but within hold window -> still displayed.
  let out = state.update([], 10, "test", t0 + 10_000);
  assert.equal(out.length, 1, "should hold recently-seen aircraft");
  // Past the 30s hold window -> removed.
  out = state.update([], 10, "test", t0 + 31_000);
  assert.equal(out.length, 0, "should remove stale aircraft after hold");
});

test("live aircraft that moves outside the radius is removed immediately", () => {
  const state = makeState();
  state.update([aircraftNorth("MOVE", 5)], 10, "test");
  const out = state.update([aircraftNorth("MOVE", 12)], 10, "test");
  assert.equal(out.length, 0);
});
