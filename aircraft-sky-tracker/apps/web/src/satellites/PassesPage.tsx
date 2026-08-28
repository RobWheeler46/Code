import { useCallback, useEffect, useState } from "react";
import type { SatellitePass } from "@ast/shared";

interface Props {
  onBack: () => void;
}

interface PassesResponse {
  generatedAt: string;
  windowHours: number;
  passes: SatellitePass[];
}

const CATEGORY_MARK: Record<string, string> = {
  station: "◇",
  bright: "◆",
  starlink: "·",
  other: "◆",
};

/** Upcoming satellite passes screen (FRD v3.2 §59-60). */
export function PassesPage({ onBack }: Props) {
  const [data, setData] = useState<PassesResponse | undefined>();
  const [error, setError] = useState<string | undefined>();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/satellite-passes");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as PassesResponse);
      setError(undefined);
    } catch {
      setError("Could not load satellite passes.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const passes = data?.passes ?? [];

  return (
    <div className="page">
      <h1>Upcoming passes</h1>
      <p className="hint">
        Overhead satellites above the minimum elevation for your location
        {data ? `, next ${data.windowHours} h` : ""}. Times are local (Europe/London).
      </p>

      {error && <div className="status-line err">{error}</div>}

      <div className="passes">
        {passes.length === 0 ? (
          <p className="hint">
            {data ? "No passes predicted in the window." : "Loading…"}
          </p>
        ) : (
          passes.map((p, i) => <PassRow key={`${p.catalogNumber}-${p.riseTime}-${i}`} pass={p} />)
        )}
      </div>

      <div className="actions">
        <button onClick={() => void load()}>Refresh</button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

function PassRow({ pass: p }: { pass: SatellitePass }) {
  return (
    <div className={`sat-pass ${p.potentiallyVisible ? "visible" : ""}`}>
      <span className="sat-pass-time">{formatTime(p.riseTime)}</span>
      <span className="sat-pass-name">
        {CATEGORY_MARK[p.category] ?? "◆"} {p.name}
        {p.inProgress && <span className="sat-pass-now">now</span>}
      </span>
      <span className="sat-pass-max">
        max <strong>{p.maxElevationDegrees}°</strong>
      </span>
      <span className="sat-pass-sub">
        {p.direction} · best {formatTime(p.maxTime)} · {formatDuration(p.durationSeconds)} ·{" "}
        {p.potentiallyVisible ? (
          <span className="vis">potentially visible</span>
        ) : (
          "not visible"
        )}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}
