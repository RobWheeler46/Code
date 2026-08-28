import { useEffect, useState } from "react";
import type { Aircraft, AppConfig, SourceStatus, Satellite } from "@ast/shared";
import { AircraftCanvas } from "./AircraftCanvas.js";
import { DisplayStatus } from "./DisplayStatus.js";
import { AircraftDetailsOverlay } from "./AircraftDetailsOverlay.js";
import { SatelliteDetailsOverlay } from "./SatelliteDetailsOverlay.js";
import { InterestingAlert } from "./InterestingAlert.js";
import type { InterestingEntry } from "../hooks/useWebSocket.js";

interface Props {
  aircraft: Aircraft[];
  snapshotTimestamp: number;
  config: AppConfig;
  sourceStatus: SourceStatus;
  connected: boolean;
  interestingEntry?: InterestingEntry;
  satellites?: Satellite[];
  satelliteTimestamp?: number;
}

/** The main display: canvas + optional header + status (FRD §47, §56-59). */
export function SkyDisplay({
  aircraft,
  snapshotTimestamp,
  config,
  sourceStatus,
  connected,
  interestingEntry,
  satellites = [],
  satelliteTimestamp = 0,
}: Props) {
  const [selected, setSelected] = useState<Aircraft | null>(null);
  const [selectedSat, setSelectedSat] = useState<string | null>(null);

  // Keep the selected overlay's data fresh, and drop it if the aircraft leaves.
  useEffect(() => {
    if (!selected) return;
    const still = aircraft.find((a) => a.id === selected.id);
    setSelected(still ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft]);

  useEffect(() => {
    if (!selected && !selectedSat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelected(null);
        setSelectedSat(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, selectedSat]);

  const selectedSatellite = selectedSat
    ? (satellites.find((s) => s.catalogNumber === selectedSat) ?? null)
    : null;

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
        satellites={satellites}
        satelliteTimestamp={satelliteTimestamp}
        onSelect={(a) => {
          setSelectedSat(null);
          setSelected(a);
        }}
        onSelectSatellite={(s) => {
          setSelected(null);
          setSelectedSat(s.catalogNumber);
        }}
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

      <InterestingAlert entry={interestingEntry} config={config} />

      {selected && (
        <AircraftDetailsOverlay aircraft={selected} onClose={() => setSelected(null)} />
      )}
      {selectedSatellite && (
        <SatelliteDetailsOverlay
          satellite={selectedSatellite}
          onClose={() => setSelectedSat(null)}
        />
      )}
    </div>
  );
}
