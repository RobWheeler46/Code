import { useCallback, useEffect, useState } from "react";
import { authHeaders } from "../auth.js";

interface Props {
  onBack: () => void;
}

interface DiagnosticsReport {
  postcode: string;
  radiusMiles: number;
  aircraftProvider: string;
  providerStatus: string;
  locationStatus: "valid" | "unresolved";
  aircraftReceived: number;
  aircraftInsideRadius: number;
  aircraftDisplayed: number;
  routeCacheEntries: number;
  lastPollDurationMs: number;
  lastSuccessfulPoll: string | null;
  lastAircraftUpdateMsAgo: number | null;
  webSocketClients: number;
  routeProvider: string;
  lastRouteLookup: string | null;
  lastHttpStatus: number | null;
  pollingIntervalMs: number;
  uptimeSeconds: number;
  alertsEnabled: boolean;
  lastAlert: string | null;
  passesToday: number;
  interestingToday: number;
  routeConfidence: { confirmed: number; high: number; medium: number; low: number; unknown: number };
  flightIntelligenceSources: string[];
}

interface OrbitalStatus {
  provider: string;
  status: string;
  elementCacheAgeMs: number | null;
  counts: {
    loaded: number;
    aboveHorizon: number;
    aboveMinElevation: number;
    potentiallyVisible: number;
    displayed: number;
  };
}

/** System diagnostics screen (FRD §66-67). */
export function DiagnosticsPage({ onBack }: Props) {
  const [report, setReport] = useState<DiagnosticsReport | undefined>();
  const [orbital, setOrbital] = useState<OrbitalStatus | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/diagnostics", { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReport((await res.json()) as DiagnosticsReport);
      setError(undefined);
    } catch (err) {
      setError(String(err));
    }
    try {
      const res = await fetch("/api/orbital-status");
      if (res.ok) setOrbital((await res.json()) as OrbitalStatus);
    } catch {
      /* satellites are optional */
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="page">
      <h1>System Diagnostics</h1>
      {error && <div className="status-line err">{error}</div>}
      {!report ? (
        <p className="hint">Loading…</p>
      ) : (
        <>
          <h2>Location</h2>
          <div className="rows">
            <span className="k">Postcode</span>
            <span className="v">{report.postcode}</span>
            <span className="k">Radius</span>
            <span className="v">{report.radiusMiles} miles</span>
            <span className="k">Location status</span>
            <span className={`v ${report.locationStatus === "valid" ? "badge-ok" : "badge-err"}`}>
              {report.locationStatus === "valid" ? "✓ Valid" : "Unresolved"}
            </span>
          </div>

          <h2>Data sources</h2>
          <div className="rows">
            <span className="k">Aircraft</span>
            <span className={`v ${statusClass(report.providerStatus)}`}>
              {statusLabel(report.providerStatus)} ({report.aircraftProvider})
            </span>
            <span className="k">Route data</span>
            <span className="v badge-ok">✓ {report.routeProvider}</span>
            <span className="k">Flight intelligence</span>
            <span className="v">{report.flightIntelligenceSources.join(", ") || "—"}</span>
            <span className="k">Airframes</span>
            <span className="v">
              {report.flightIntelligenceSources.includes("airframes")
                ? "Enabled"
                : "Disabled (set AIRFRAMES_API_KEY)"}
            </span>
            <span className="k">Last HTTP response</span>
            <span className="v">{report.lastHttpStatus ?? "—"}</span>
          </div>

          <h2>Route confidence</h2>
          <div className="rows">
            <span className="k">Confirmed</span>
            <span className="v">{report.routeConfidence.confirmed}</span>
            <span className="k">High</span>
            <span className="v">{report.routeConfidence.high}</span>
            <span className="k">Medium</span>
            <span className="v">{report.routeConfidence.medium}</span>
            <span className="k">Low</span>
            <span className="v">{report.routeConfidence.low}</span>
            <span className="k">Unknown</span>
            <span className="v">{report.routeConfidence.unknown}</span>
          </div>

          <h2>Live aircraft</h2>
          <div className="rows">
            <span className="k">Provider returned</span>
            <span className="v">{report.aircraftReceived}</span>
            <span className="k">Inside {report.radiusMiles} miles</span>
            <span className="v">{report.aircraftInsideRadius}</span>
            <span className="k">Displayed</span>
            <span className="v">{report.aircraftDisplayed}</span>
            <span className="k">Route cache</span>
            <span className="v">{report.routeCacheEntries} entries</span>
            <span className="k">Last route lookup</span>
            <span className="v">{report.lastRouteLookup ?? "—"}</span>
          </div>

          <h2>Performance</h2>
          <div className="rows">
            <span className="k">Last aircraft update</span>
            <span className="v">{formatAgo(report.lastAircraftUpdateMsAgo)}</span>
            <span className="k">Last query</span>
            <span className="v">{report.lastPollDurationMs} ms</span>
            <span className="k">Polling interval</span>
            <span className="v">{report.pollingIntervalMs} ms</span>
            <span className="k">WebSocket clients</span>
            <span className="v">{report.webSocketClients}</span>
            <span className="k">Uptime</span>
            <span className="v">{formatUptime(report.uptimeSeconds)}</span>
          </div>

          <h2>History / Alerts</h2>
          <div className="rows">
            <span className="k">Passes today</span>
            <span className="v">{report.passesToday}</span>
            <span className="k">Interesting today</span>
            <span className="v">{report.interestingToday}</span>
            <span className="k">Push alerts</span>
            <span className={`v ${report.alertsEnabled ? "badge-ok" : ""}`}>
              {report.alertsEnabled ? "✓ Enabled" : "Off (set NOTIFY_NTFY_TOPIC)"}
            </span>
            <span className="k">Last alert</span>
            <span className="v">{report.lastAlert ?? "—"}</span>
          </div>

          {orbital && (
            <>
              <h2>Satellites</h2>
              <div className="rows">
                <span className="k">Orbital source</span>
                <span className={`v ${orbital.status === "connected" ? "badge-ok" : "badge-warn"}`}>
                  {orbital.status} ({orbital.provider})
                </span>
                <span className="k">Element cache age</span>
                <span className="v">{formatAgeMinutes(orbital.elementCacheAgeMs)}</span>
                <span className="k">Loaded</span>
                <span className="v">{orbital.counts.loaded}</span>
                <span className="k">Above horizon</span>
                <span className="v">{orbital.counts.aboveHorizon}</span>
                <span className="k">Above minimum</span>
                <span className="v">{orbital.counts.aboveMinElevation}</span>
                <span className="k">Potentially visible</span>
                <span className="v">{orbital.counts.potentiallyVisible}</span>
                <span className="k">Displayed</span>
                <span className="v">{orbital.counts.displayed}</span>
              </div>
            </>
          )}
        </>
      )}

      <div className="actions">
        <button onClick={() => void load()}>Refresh</button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

function statusClass(status: string): string {
  if (status === "connected") return "badge-ok";
  if (status === "reconnecting") return "badge-warn";
  return "badge-err";
}

function statusLabel(status: string): string {
  if (status === "connected") return "✓ Connected";
  if (status === "reconnecting") return "⟳ Reconnecting";
  return "✗ Disconnected";
}

function formatAgo(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(1)} sec ago`;
}

function formatAgeMinutes(ms: number | null): string {
  if (ms === null) return "—";
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} hr ${min % 60} min` : `${min} min`;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
