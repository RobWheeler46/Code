import { useEffect, useRef, useState } from "react";
import { type Satellite, type SatelliteDetail, compassDirection } from "@ast/shared";

interface Props {
  satellite: Satellite;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<string, string> = {
  station: "Space station",
  bright: "Bright / interesting satellite",
  starlink: "Starlink",
  other: "Satellite",
};

const AUTO_CLOSE_MS = 30_000; // FRD §86

type Row = [string, string | undefined];

/** Satellite detail drawer (FRD v3.2 §57-58) with orbit + next-pass detail. */
export function SatelliteDetailsOverlay({ satellite: s, onClose }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const timerRef = useRef<number | undefined>(undefined);
  const resetTimer = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => closeRef.current(), AUTO_CLOSE_MS);
  };
  useEffect(() => {
    resetTimer();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch extended orbit + next-pass detail when the drawer opens.
  const [detail, setDetail] = useState<SatelliteDetail | undefined>();
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/satellites/${encodeURIComponent(s.catalogNumber)}/detail`)
      .then((r) => (r.ok ? (r.json() as Promise<SatelliteDetail>) : undefined))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [s.catalogNumber]);

  const observation: Row[] = [
    ["Elevation", `${Math.round(s.elevationDegrees)}°`],
    ["Azimuth", `${Math.round(s.azimuthDegrees)}° ${compassDirection(s.azimuthDegrees)}`],
    ["Direction", s.direction ? `moving ${s.direction}` : undefined],
    ["Range", `${s.rangeKm.toLocaleString()} km`],
    ["Orbital altitude", `${s.orbitalAltitudeKm.toLocaleString()} km`],
    ["Velocity", `${s.velocityKmPerSecond.toFixed(2)} km/s`],
    ["Illuminated", s.illuminated ? "Yes" : "No"],
    ["Potentially visible", s.potentiallyVisible ? "Yes" : "No"],
    ["NORAD ID", s.catalogNumber],
  ];

  const orbit = detail?.orbit;
  const orbitRows: Row[] = orbit
    ? [
        ["Period", `${orbit.periodMinutes.toFixed(1)} min`],
        ["Inclination", `${orbit.inclinationDegrees.toFixed(1)}°`],
        ["Altitude", altitudeText(orbit.perigeeKm, orbit.apogeeKm)],
        ["Int'l designator", orbit.intlDesignator],
        ["Orbital data", `${formatAge(orbit.elementAgeHours)} old`],
      ]
    : [];

  const np = detail?.nextPass;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div
        className="drawer"
        onClick={(e) => e.stopPropagation()}
        onMouseMove={resetTimer}
        onScroll={resetTimer}
        onTouchStart={resetTimer}
      >
        <div className="drawer-head">
          <div>
            <div className="drawer-id">
              {s.category === "station" ? "◇" : s.category === "starlink" ? "·" : "◆"} {s.name}
            </div>
            <div className="drawer-sub">{CATEGORY_LABEL[s.category] ?? "Satellite"}</div>
            {s.potentiallyVisible && (
              <div className="drawer-sub" style={{ color: "#8fe3ff" }}>
                Potentially visible now
              </div>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <h2>Observation</h2>
        <DetailRows rows={observation} />

        {orbitRows.length > 0 && (
          <>
            <h2>Orbit</h2>
            <DetailRows rows={orbitRows} />
          </>
        )}

        {detail && (
          <>
            <h2>Next pass</h2>
            {np ? (
              <div className="rows">
                <span className="k">Rises</span>
                <span className="v">
                  {localTime(np.riseTime)} ({relativeTo(np.riseTime)})
                </span>
                <span className="k">Max elevation</span>
                <span className="v">
                  {np.maxElevationDegrees}° at {localTime(np.maxTime)}
                </span>
                <span className="k">Direction</span>
                <span className="v">{np.direction}</span>
                <span className="k">Visibility</span>
                <span className="v" style={np.potentiallyVisible ? { color: "#8fe3ff" } : undefined}>
                  {np.potentiallyVisible ? "Potentially visible" : "Not visible"}
                </span>
              </div>
            ) : (
              <p className="hint">No pass above the minimum elevation in the next 24 h.</p>
            )}
          </>
        )}

        <div className="actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function DetailRows({ rows }: { rows: Row[] }) {
  const visible = rows.filter((r): r is [string, string] => Boolean(r[1]));
  return (
    <div className="rows">
      {visible.map(([k, v]) => (
        <span key={k} style={{ display: "contents" }}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </span>
      ))}
    </div>
  );
}

/** Near-circular orbits read as a single altitude; elliptical show perigee-apogee. */
function altitudeText(perigeeKm: number, apogeeKm: number): string {
  const p = Math.round(perigeeKm);
  const a = Math.round(apogeeKm);
  if (a - p <= 30) return `~${Math.round((a + p) / 2).toLocaleString()} km`;
  return `${p.toLocaleString()}–${a.toLocaleString()} km`;
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

function relativeTo(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  return `in ${h} h ${mins % 60} min`;
}
