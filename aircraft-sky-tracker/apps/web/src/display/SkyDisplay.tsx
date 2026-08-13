import { useEffect, useState } from "react";
import type { Aircraft, AppConfig, SourceStatus } from "@ast/shared";
import { AircraftCanvas } from "./AircraftCanvas.js";
import { DisplayStatus } from "./DisplayStatus.js";
import { AircraftDetailsOverlay } from "./AircraftDetailsOverlay.js";

interface Props {
  aircraft: Aircraft[];
  snapshotTimestamp: number;
  config: AppConfig;
  sourceStatus: SourceStatus;
  connected: boolean;
}

/** The main display: canvas + optional header + status (FRD §47, §56-59). */
export function SkyDisplay({
  aircraft,
  snapshotTimestamp,
  config,
  sourceStatus,
  connected,
}: Props) {
  const [selected, setSelected] = useState<Aircraft | null>(null);

  // Keep the selected overlay's data fresh, and drop it if the aircraft leaves.
  useEffect(() => {
    if (!selected) return;
    const still = aircraft.find((a) => a.id === selected.id);
    setSelected(still ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  return (
    <div className="sky">
      {config.showHeader && (
        <div className="header">
          {config.postcode} · {config.radiusMiles} mi
        </div>
      )}

      <AircraftCanvas
        aircraft={aircraft}
        snapshotTimestamp={snapshotTimestamp}
        config={config}
        onSelect={setSelected}
      />

      {/* The blank black display is intentional (FRD §59); the optional
          "No aircraft nearby" hint appears only in informative mode. */}
      {config.displayMode === "informative" &&
        aircraft.length === 0 &&
        connected &&
        sourceStatus === "connected" && (
          <div className="no-aircraft">No aircraft nearby</div>
        )}

      <DisplayStatus sourceStatus={sourceStatus} connected={connected} />

      {selected && (
        <AircraftDetailsOverlay aircraft={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
