import { useCallback, useEffect, useState } from "react";
import type { HistoryPass, HistoryDate } from "@ast/shared";
import { authHeaders } from "../auth.js";

interface Props {
  onBack: () => void;
}

/** Aircraft pass history screen (FRD v3.0 §60-63). */
export function HistoryPage({ onBack }: Props) {
  const [dates, setDates] = useState<HistoryDate[]>([]);
  const [selected, setSelected] = useState<string | undefined>();
  const [passes, setPasses] = useState<HistoryPass[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [confirmClear, setConfirmClear] = useState(false);

  const loadDates = useCallback(async () => {
    try {
      const res = await fetch("/api/history/dates");
      const list = (await res.json()) as HistoryDate[];
      setDates(list);
      setSelected((cur) => cur ?? list[0]?.date);
    } catch {
      /* ignore */
    }
  }, []);

  const loadPasses = useCallback(async (date?: string) => {
    try {
      const url = date ? `/api/history?date=${date}` : "/api/history";
      const res = await fetch(url);
      const body = (await res.json()) as { date: string; passes: HistoryPass[] };
      setPasses(body.passes);
      setSelected(body.date);
    } catch {
      setError("Could not load history.");
    }
  }, []);

  useEffect(() => {
    void loadDates();
    void loadPasses();
  }, [loadDates, loadPasses]);

  const clearDate = async () => {
    if (!selected) return;
    setError(undefined);
    try {
      const res = await fetch(`/api/history/${selected}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (res.status === 401) {
        setError("Password required — open Settings (S) to unlock, then try again.");
        setConfirmClear(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setConfirmClear(false);
      await loadDates();
      await loadPasses(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="page">
      <h1>History</h1>

      <div className="date-tabs">
        {dates.length === 0 && <span className="hint">No passes recorded yet.</span>}
        {dates.map((d) => (
          <button
            key={d.date}
            className={d.date === selected ? "date-tab active" : "date-tab"}
            onClick={() => void loadPasses(d.date)}
          >
            {formatDate(d.date)} <span className="count">{d.passes}</span>
          </button>
        ))}
      </div>

      {error && <div className="status-line err">{error}</div>}

      <div className="passes">
        {passes.length === 0 ? (
          <p className="hint">No aircraft recorded for this date.</p>
        ) : (
          passes.map((p) => <PassRow key={p.passId} pass={p} />)
        )}
      </div>

      <div className="actions">
        {selected && passes.length > 0 && (
          <button className="danger" onClick={() => setConfirmClear(true)}>
            Clear this date
          </button>
        )}
        <button onClick={onBack}>Back</button>
      </div>

      {confirmClear && selected && (
        <div className="overlay-backdrop" onClick={() => setConfirmClear(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: "1rem" }}>Clear history for {formatDate(selected)}?</h1>
            <p className="hint">This permanently removes {passes.length} pass records.</p>
            <div className="actions">
              <button onClick={() => setConfirmClear(false)}>Cancel</button>
              <button className="danger" onClick={() => void clearDate()}>
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PassRow({ pass }: { pass: HistoryPass }) {
  const identifier = pass.registration ?? pass.callsign ?? pass.icaoHex;
  const route =
    pass.origin && pass.destination
      ? `${pass.origin} → ${pass.destination}`
      : pass.destination
        ? `→ ${pass.destination}`
        : pass.interesting && pass.interestingReasons.length > 0
          ? pass.interestingReasons.join(", ")
          : "—";
  return (
    <div className={`pass ${pass.interesting ? "interesting" : ""}`}>
      <span className="pass-time">{formatTime(pass.lastSeen)}</span>
      <span className="pass-id">{identifier}</span>
      <span className="pass-type">{pass.aircraftType ?? ""}</span>
      <span className="pass-route">{route}</span>
      <span className="pass-stat">Closest {pass.closestApproachMiles.toFixed(1)} mi</span>
      <span className="pass-stat">
        {pass.minimumAltitudeFeet !== undefined
          ? `Lowest ${pass.minimumAltitudeFeet.toLocaleString()} ft`
          : ""}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function formatDate(date: string): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(
    new Date(),
  );
  if (date === today) return "Today";
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
