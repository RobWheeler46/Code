/**
 * ACARS message service (FRD v3.9). Correlates provider messages to the live
 * aircraft, enforces the display policy, keeps a short in-memory buffer (never a
 * raw archive, §Message Retention) and hands new messages to the broadcaster.
 *
 * Policy is enforced HERE, not in the UI: raw payloads are stripped unless the
 * deployment permits raw display AND the user chose "full"; a user preference can
 * never widen what the deployment allows (§Legal / Deployment Control).
 */

import {
  rawDisplayAllowed,
  isDisplayableCorrelation,
  isDefaultVisibleCategory,
  type AcarsMessage,
  type AcarsDisplayMode,
  type DatalinkSummary,
} from "@ast/shared";
import type { AcarsMessageProvider, AcarsTracked, ProviderMessage } from "./acarsProviders.js";

export interface AcarsPolicyView {
  /** Drawer ACARS section enabled (§Aircraft Details Panel). */
  showAcarsMessages: boolean;
  /** Main-screen ACARS feed enabled (§Kiosk). Either surface activates the pipeline. */
  showAcarsFeed?: boolean;
  acarsDisplayMode: AcarsDisplayMode;
  /** Deployment-level permission (ALLOW_RAW_ACARS_DISPLAY); never user-overridable. */
  deploymentAllowsRaw: boolean;
}

/** The datalink pipeline runs when any display surface is enabled and not "off". */
function acarsActive(policy: AcarsPolicyView): boolean {
  return (policy.showAcarsMessages || policy.showAcarsFeed === true) && policy.acarsDisplayMode !== "off";
}

export interface AcarsQuery {
  since?: string;
  limit?: number;
  medium?: string;
  category?: string;
  /** Include technical/operational/other categories hidden from the default view. */
  includeAll?: boolean;
}

interface Buffer {
  messages: AcarsMessage[];
  messagesThisPass: number;
  lastMessageAt?: string;
}

/** Retain only a short recent window per aircraft (in-memory, no archive). */
const MAX_PER_AIRCRAFT = 40;
const DEFAULT_LIMIT = 20;

export class AcarsService {
  private readonly buffers = new Map<string, Buffer>();
  private received = 0;
  private lastMessageAtMs = 0;

  constructor(
    private readonly provider: AcarsMessageProvider,
    private readonly policyView: () => AcarsPolicyView,
    private readonly onMessage: (message: AcarsMessage) => void,
  ) {}

  get sourceName(): string {
    return this.provider.enabled ? this.provider.name : "none";
  }

  /**
   * Ingest a poll of the eligible tracked aircraft. Does nothing (and clears no
   * state) when the feature is off, so aircraft tracking is never affected (§AC).
   */
  onSnapshot(tracked: AcarsTracked[], nowMs: number): void {
    const policy = this.policyView();
    // Prune buffers for aircraft no longer present regardless of the toggle.
    const present = new Set(tracked.map((t) => t.icaoHex));
    for (const hex of [...this.buffers.keys()]) if (!present.has(hex)) this.buffers.delete(hex);

    if (!acarsActive(policy)) return;

    const byHex = new Map(tracked.map((t) => [t.icaoHex, t]));
    const rawAllowed = rawDisplayAllowed(policy.deploymentAllowsRaw, policy.acarsDisplayMode);

    let raw: ProviderMessage[] = [];
    try {
      raw = this.provider.poll(tracked, nowMs);
    } catch {
      // Message-provider failure must not affect tracking (§AC); just skip.
      return;
    }

    for (const m of raw) {
      this.received++;
      const target = byHex.get(m.aircraftId);
      // No correlating aircraft in view, or a conflicting identity -> not shown.
      if (!target || conflicts(m, target)) continue;
      if (!isDisplayableCorrelation(m.correlationConfidence)) continue;

      const message = applyPolicy(m, rawAllowed);
      this.append(message, nowMs);
      this.onMessage(message);
    }
  }

  private append(message: AcarsMessage, nowMs: number): void {
    let buf = this.buffers.get(message.aircraftId);
    if (!buf) {
      buf = { messages: [], messagesThisPass: 0 };
      this.buffers.set(message.aircraftId, buf);
    }
    buf.messages.push(message);
    if (buf.messages.length > MAX_PER_AIRCRAFT) buf.messages.shift();
    buf.messagesThisPass++;
    buf.lastMessageAt = message.timestamp;
    this.lastMessageAtMs = nowMs;
  }

  /** Messages for one aircraft, newest first, filtered per the query (§API). */
  messagesFor(icaoHex: string, query: AcarsQuery = {}): AcarsMessage[] {
    const buf = this.buffers.get(icaoHex.toUpperCase());
    if (!buf) return [];
    let msgs = [...buf.messages].reverse();
    if (!query.includeAll) msgs = msgs.filter((m) => isDefaultVisibleCategory(m.category));
    if (query.since) {
      const since = Date.parse(query.since);
      if (Number.isFinite(since)) msgs = msgs.filter((m) => Date.parse(m.timestamp) > since);
    }
    if (query.medium) msgs = msgs.filter((m) => m.medium.toLowerCase() === query.medium!.toLowerCase());
    if (query.category) msgs = msgs.filter((m) => m.category === query.category);
    const limit = Number.isFinite(query.limit) && (query.limit as number) > 0 ? Math.min(query.limit as number, MAX_PER_AIRCRAFT) : DEFAULT_LIMIT;
    return msgs.slice(0, limit);
  }

  /** Datalink activity summary for the details panel (§Message Count). */
  datalinkFor(icaoHex: string): DatalinkSummary {
    const buf = this.buffers.get(icaoHex.toUpperCase());
    if (!buf || buf.messages.length === 0) return { active: false, messagesThisPass: 0 };
    return {
      active: true,
      lastMessageAt: buf.lastMessageAt,
      messagesThisPass: buf.messagesThisPass,
    };
  }

  /** Aircraft that currently have any buffered datalink activity. */
  activeAircraftCount(): number {
    let n = 0;
    for (const buf of this.buffers.values()) if (buf.messages.length > 0) n++;
    return n;
  }

  /** ACARS diagnostics block (§Diagnostics). */
  diagnostics(): {
    provider: string;
    realtime: string;
    messagesReceived: number;
    aircraftCorrelated: number;
    lastMessageMsAgo: number | null;
    rawDisplayEnabled: boolean;
  } {
    const policy = this.policyView();
    return {
      provider: this.sourceName,
      realtime: this.provider.enabled ? "connected" : "simulation/none",
      messagesReceived: this.received,
      aircraftCorrelated: this.buffers.size,
      lastMessageMsAgo: this.lastMessageAtMs ? Date.now() - this.lastMessageAtMs : null,
      rawDisplayEnabled: rawDisplayAllowed(policy.deploymentAllowsRaw, policy.acarsDisplayMode),
    };
  }
}

/** A message conflicts when its asserted identity disagrees with the aircraft. */
function conflicts(m: ProviderMessage, target: AcarsTracked): boolean {
  if (
    m.assertedRegistration &&
    target.registration &&
    m.assertedRegistration.toUpperCase() !== target.registration.toUpperCase()
  ) {
    return true;
  }
  if (
    m.assertedCallsign &&
    target.callsign &&
    m.assertedCallsign.toUpperCase() !== target.callsign.toUpperCase()
  ) {
    return true;
  }
  return false;
}

/** Strip provider-only fields and enforce the raw-display policy. */
function applyPolicy(m: ProviderMessage, rawAllowed: boolean): AcarsMessage {
  const {
    assertedRegistration: _r,
    assertedCallsign: _c,
    raw,
    ...rest
  } = m;
  return {
    ...rest,
    rawTextAvailable: rawAllowed && typeof raw === "string" && raw.length > 0,
    raw: rawAllowed ? raw : undefined,
  };
}
