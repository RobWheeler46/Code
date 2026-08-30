import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThreeLe, SpaceTrackProvider } from "./spaceTrackProvider.js";
import { observe, observerFrom } from "./sgp4Service.js";

// Space-Track "3le": name line prefixed with "0 ", then the two element lines.
const THREE_LE = `0 ISS (ZARYA)
1 25544U 98067A   24240.50000000  .00016717  00000-0  30074-3 0  9993
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50152710 39900
0 HST
1 20580U 90037B   24240.20000000  .00001000  00000-0  50000-4 0  9990
2 20580  28.4700 100.0000 0002500 200.0000 160.0000 15.09000000 400000`;

test("parseThreeLe parses triples, strips the 0-prefix and assigns categories", () => {
  const els = parseThreeLe(THREE_LE, (cat) => (cat === "25544" ? "station" : "bright"));
  assert.equal(els.length, 2);
  const iss = els.find((e) => e.catalogNumber === "25544");
  assert.equal(iss?.name, "ISS (ZARYA)"); // "0 " prefix removed
  assert.equal(iss?.category, "station");
  assert.equal(iss?.intlDesignator, "1998-067A");
  assert.equal(els.find((e) => e.catalogNumber === "20580")?.category, "bright");
  // The rebuilt satrec must propagate.
  const obs = observe(iss!.satrec, observerFrom(51.59, -1.79), new Date("2024-08-27T21:00:00Z"));
  assert.ok(obs && Number.isFinite(obs.elevationDeg));
});

test("parseThreeLe ignores malformed content", () => {
  assert.equal(parseThreeLe("junk\nmore junk", () => "bright").length, 0);
});

test("SpaceTrackProvider is not configured without credentials", async () => {
  const provider = new SpaceTrackProvider(undefined, undefined);
  assert.equal(provider.configured, false);
  await assert.rejects(() => provider.fetchElements(false), /not configured/);
});

test("SpaceTrackProvider reports configured when credentials are present", () => {
  assert.equal(new SpaceTrackProvider("user", "pass").configured, true);
});
