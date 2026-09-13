import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapAirframesMessage,
  categoriseAirframes,
  type AirframesRaw,
} from "./acarsProviders.js";

const HEX = "4075FD";

describe("Airframes message mapping (FRD v3.9)", () => {
  it("skips a bare link frame with no content", () => {
    const raw: AirframesRaw = {
      id: 1,
      sourceType: "vdl",
      label: null,
      text: null,
      timestamp: "2026-09-13T20:33:13.037Z",
      airframe: { tail: "9H-NEF", icao: "4D24DE" },
    };
    assert.equal(categoriseAirframes(raw), undefined);
    assert.equal(mapAirframesMessage(raw, HEX), undefined);
  });

  it("maps an ATIS/weather message", () => {
    const raw: AirframesRaw = {
      id: 2,
      sourceType: "vdl",
      label: "A9",
      text: "/FCOCAYA.TI2/LIRF ARR ATIS N\r\n1950Z LIRF ARR N 1950Z RWY 16L ILS X RWY 16R",
      timestamp: "2026-09-13T20:35:00Z",
      airframe: { tail: "G-TTNH", icao: "4075FD" },
    };
    const m = mapAirframesMessage(raw, HEX);
    assert.ok(m);
    assert.equal(m!.category, "weather");
    assert.equal(m!.medium, "VDL2");
    assert.equal(m!.aircraftId, HEX);
    assert.equal(m!.assertedRegistration, "G-TTNH");
    assert.equal(m!.assertedCallsign, undefined); // never asserted (format mismatch risk)
    assert.equal(m!.raw, raw.text);
    assert.equal(m!.rawTextAvailable, false); // set later by the service policy
  });

  it("maps a position message and includes coordinates in the detail", () => {
    const raw: AirframesRaw = {
      id: 3,
      sourceType: "acars",
      label: "H1",
      text: "POS N5140.0 W00042.0",
      timestamp: "2026-09-13T20:36:00Z",
      airframe: { tail: "G-ABCD", icao: HEX },
      latitude: 51.66,
      longitude: -0.7,
      altitude: 34000,
    };
    const m = mapAirframesMessage(raw, HEX);
    assert.equal(m!.category, "position");
    assert.equal(m!.medium, "ACARS");
    assert.ok(m!.decoded.lines?.some((l) => l.includes("51.66") && l.includes("34,000")));
  });

  it("maps a route message from departure/destination airports", () => {
    const raw: AirframesRaw = {
      id: 4,
      sourceType: "vdl",
      label: "RA",
      text: "CLEARED TO EGLL VIA...",
      timestamp: "2026-09-13T20:37:00Z",
      airframe: { tail: "G-XXXX", icao: HEX },
      departingAirport: "EGGD",
      destinationAirport: "EGLL",
    };
    const m = mapAirframesMessage(raw, HEX);
    assert.equal(m!.category, "route");
    assert.ok(m!.decoded.lines?.some((l) => l.includes("EGGD") && l.includes("EGLL")));
  });

  it("classifies OOOI and ETA content", () => {
    assert.equal(
      categoriseAirframes({ id: 5, sourceType: "acars", text: "OOOI OFF 2029Z" }),
      "oooi",
    );
    assert.equal(
      categoriseAirframes({ id: 6, sourceType: "acars", text: "ETA 2134Z EGLL" }),
      "eta",
    );
  });

  it("reads position/route from a nested flight object", () => {
    const raw: AirframesRaw = {
      id: 7,
      sourceType: "vdl",
      text: "PER/PD1511",
      timestamp: "2026-09-13T20:38:00Z",
      airframe: { tail: "N57451", icao: HEX },
      flight: { flightIcao: "UAL1084", latitude: 33.75, longitude: -118.5, altitude: 7325 },
    };
    const m = mapAirframesMessage(raw, HEX);
    assert.equal(m!.category, "position");
    assert.ok(m!.decoded.lines?.some((l) => l.includes("33.75")));
  });

  it("maps mediums correctly", () => {
    const base = { id: 8, text: "x", airframe: { tail: "G-A", icao: HEX } };
    assert.equal(mapAirframesMessage({ ...base, sourceType: "vdl" }, HEX)!.medium, "VDL2");
    assert.equal(mapAirframesMessage({ ...base, sourceType: "acars" }, HEX)!.medium, "ACARS");
    assert.equal(mapAirframesMessage({ ...base, sourceType: "hfdl" }, HEX)!.medium, "HFDL");
    assert.equal(mapAirframesMessage({ ...base, sourceType: "iridium" }, HEX)!.medium, "SATCOM");
  });
});
