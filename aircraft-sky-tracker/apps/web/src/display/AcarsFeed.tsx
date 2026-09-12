import { type Aircraft, type AcarsMessage, acarsCategoryLabel } from "@ast/shared";

interface Props {
  /** Recent ACARS messages across aircraft, newest first. */
  messages: AcarsMessage[];
  /** Currently visible aircraft, used to filter and label the feed. */
  aircraft: Aircraft[];
  enabled: boolean;
}

const MAX_LINES = 6;

/** Short label for an aircraft: registration, then callsign, then hex. */
function labelFor(id: string, byId: Map<string, Aircraft>): string {
  const a = byId.get(id.toUpperCase());
  return a?.registration ?? a?.callsign ?? id;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

/**
 * Live ACARS feed at the bottom of the main screen (FRD v3.9 §Kiosk). Shows the
 * most recent decoded messages for aircraft that are currently visible, newest
 * first. Optional and off by default so the projector experience stays clean.
 */
export function AcarsFeed({ messages, aircraft, enabled }: Props) {
  if (!enabled) return null;
  const visible = new Set(aircraft.map((a) => a.icaoHex.toUpperCase()));
  const byId = new Map(aircraft.map((a) => [a.icaoHex.toUpperCase(), a]));
  const lines = messages.filter((m) => visible.has(m.aircraftId.toUpperCase())).slice(0, MAX_LINES);
  if (lines.length === 0) return null;

  return (
    <div className="acars-feed" role="log" aria-live="polite">
      <div className="acars-feed-title">Live ACARS</div>
      {lines.map((m) => (
        <div key={m.id} className="acars-feed-line">
          <span className="acars-feed-id">{labelFor(m.aircraftId, byId)}</span>
          <span className="acars-feed-time">{hhmm(m.timestamp)}</span>
          <span className="acars-feed-medium">{m.medium}</span>
          <span className="acars-feed-summary">
            {acarsCategoryLabel(m.category)} · {m.decoded.summary}
          </span>
        </div>
      ))}
      <div className="acars-feed-attribution">ACARS/VDL2 via Airframes.io + feeders</div>
    </div>
  );
}
