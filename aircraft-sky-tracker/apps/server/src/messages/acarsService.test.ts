import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AcarsService, type AcarsPolicyView } from "./acarsService.js";
import {
  SimulationAcarsProvider,
  type AcarsMessageProvider,
  type AcarsTracked,
  type ProviderMessage,
} from "./acarsProviders.js";

const NOW = Date.parse("2026-09-11T20:00:00Z");

function tracked(over: Partial<AcarsTracked> = {}): AcarsTracked {
  return { icaoHex: "4008B3", callsign: "BAW1462", registration: "G-EUUA", ...over };
}

function msg(over: Partial<ProviderMessage> = {}): ProviderMessage {
  return {
    id: "m1",
    aircraftId: "4008B3",
    timestamp: new Date(NOW).toISOString(),
    medium: "VDL2",
    label: "H1",
    category: "position",
    decoded: { summary: "Position report" },
    rawTextAvailable: false,
    raw: "RAWPAYLOAD",
    source: "simulation",
    correlationConfidence: "confirmed",
    assertedRegistration: "G-EUUA",
    assertedCallsign: "BAW1462",
    ...over,
  };
}

/** Provider that returns a fixed batch once, then nothing. */
function fixedProvider(batch: ProviderMessage[]): AcarsMessageProvider {
  let done = false;
  return {
    name: "test",
    enabled: true,
    poll() {
      if (done) return [];
      done = true;
      return batch;
    },
  };
}

function makeService(
  batch: ProviderMessage[],
  policy: AcarsPolicyView,
): { service: AcarsService; broadcast: import("@ast/shared").AcarsMessage[] } {
  const broadcast: import("@ast/shared").AcarsMessage[] = [];
  const service = new AcarsService(fixedProvider(batch), () => policy, (m) => broadcast.push(m));
  return { service, broadcast };
}

const ON: AcarsPolicyView = { showAcarsMessages: true, acarsDisplayMode: "decoded", deploymentAllowsRaw: false };

describe("AcarsService policy + correlation", () => {
  it("emits nothing when the feature is off", () => {
    const { service, broadcast } = makeService([msg()], {
      showAcarsMessages: false,
      acarsDisplayMode: "decoded",
      deploymentAllowsRaw: false,
    });
    service.onSnapshot([tracked()], NOW);
    assert.equal(broadcast.length, 0);
    assert.equal(service.messagesFor("4008B3").length, 0);
  });

  it("shows a correlated message and broadcasts it", () => {
    const { service, broadcast } = makeService([msg()], ON);
    service.onSnapshot([tracked()], NOW);
    assert.equal(broadcast.length, 1);
    assert.equal(service.messagesFor("4008B3").length, 1);
  });

  it("rejects a message whose asserted identity conflicts with the aircraft", () => {
    const { service, broadcast } = makeService([msg({ assertedRegistration: "X-WRONG" })], ON);
    service.onSnapshot([tracked()], NOW);
    assert.equal(broadcast.length, 0, "conflicting identity must not be shown");
  });

  it("rejects a message with no correlating aircraft in view", () => {
    const { service, broadcast } = makeService([msg({ aircraftId: "UNKNWN" })], ON);
    service.onSnapshot([tracked()], NOW);
    assert.equal(broadcast.length, 0);
  });

  it("rejects a weakly-correlated message", () => {
    const { service, broadcast } = makeService(
      [msg({ correlationConfidence: "medium", assertedRegistration: undefined })],
      ON,
    );
    service.onSnapshot([tracked()], NOW);
    assert.equal(broadcast.length, 0, "only strong correlation is displayable");
  });

  it("never exposes raw text in decoded mode", () => {
    const { service } = makeService([msg()], ON);
    service.onSnapshot([tracked()], NOW);
    const [m] = service.messagesFor("4008B3");
    assert.equal(m!.rawTextAvailable, false);
    assert.equal(m!.raw, undefined);
  });

  it("user 'full' cannot expose raw when the deployment forbids it (§Legal)", () => {
    const { service } = makeService([msg()], {
      showAcarsMessages: true,
      acarsDisplayMode: "full",
      deploymentAllowsRaw: false,
    });
    service.onSnapshot([tracked()], NOW);
    const [m] = service.messagesFor("4008B3");
    assert.equal(m!.rawTextAvailable, false);
    assert.equal(m!.raw, undefined);
  });

  it("exposes raw only when the deployment permits AND the user chose full", () => {
    const { service } = makeService([msg()], {
      showAcarsMessages: true,
      acarsDisplayMode: "full",
      deploymentAllowsRaw: true,
    });
    service.onSnapshot([tracked()], NOW);
    const [m] = service.messagesFor("4008B3");
    assert.equal(m!.rawTextAvailable, true);
    assert.equal(m!.raw, "RAWPAYLOAD");
  });
});

describe("AcarsService query + retention", () => {
  it("hides technical categories from the default view but includeAll shows them", () => {
    const batch = [
      msg({ id: "a", category: "position" }),
      msg({ id: "b", category: "technical" }),
    ];
    const { service } = makeService(batch, ON);
    service.onSnapshot([tracked()], NOW);
    assert.equal(service.messagesFor("4008B3").length, 1); // technical hidden
    assert.equal(service.messagesFor("4008B3", { includeAll: true }).length, 2);
  });

  it("prunes buffers for aircraft no longer present", () => {
    const { service } = makeService([msg()], ON);
    service.onSnapshot([tracked()], NOW);
    assert.equal(service.messagesFor("4008B3").length, 1);
    service.onSnapshot([], NOW + 1000); // aircraft left
    assert.equal(service.messagesFor("4008B3").length, 0);
  });

  it("reports a datalink summary", () => {
    const { service } = makeService([msg()], ON);
    service.onSnapshot([tracked()], NOW);
    const d = service.datalinkFor("4008B3");
    assert.equal(d.active, true);
    assert.equal(d.messagesThisPass, 1);
  });
});

describe("SimulationAcarsProvider", () => {
  it("streams messages over time and eventually injects the negative cases", () => {
    const provider = new SimulationAcarsProvider();
    const t = tracked();
    const emitted: ProviderMessage[] = [];
    // Poll every second for ~4 minutes of simulated time.
    for (let s = 0; s <= 240; s++) {
      emitted.push(...provider.poll([t], NOW + s * 1000));
    }
    assert.ok(emitted.length >= 8, "should stream several messages");
    assert.ok(emitted.some((m) => m.aircraftId === "UNKNWN"), "includes an unmatched message");
    assert.ok(emitted.some((m) => m.assertedRegistration === "X-WRONG"), "includes a conflicting-identity message");
    assert.ok(emitted.some((m) => m.category === "oooi"), "includes an OOOI message");
  });
});
