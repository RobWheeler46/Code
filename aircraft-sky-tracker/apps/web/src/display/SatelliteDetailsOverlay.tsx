import { useEffect, useRef } from "react";
import { type Satellite, compassDirection } from "@ast/shared";

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

/** Satellite detail drawer (FRD v3.2 §57-58). */
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

  const rows: Row[] = [
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
  const visible = rows.filter((r): r is [string, string] => Boolean(r[1]));

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
        <div className="rows">
          {visible.map(([k, v]) => (
            <span key={k} style={{ display: "contents" }}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </span>
          ))}
        </div>

        <div className="actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
