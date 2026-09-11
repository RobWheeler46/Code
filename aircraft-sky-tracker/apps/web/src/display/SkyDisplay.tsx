import { useEffect, useState, type CSSProperties } from "react";
import {
  type Aircraft,
  type AppConfig,
  type SourceStatus,
  type Satellite,
  type Insight,
  type LookNowPrediction,
  resolveDisplayScale,
  locationTooApproximateForTrueSky,
} from "@ast/shared";
import { AircraftCanvas } from "./AircraftCanvas.js";
import { DisplayStatus } from "./DisplayStatus.js";
import { AircraftDetailsOverlay } from "./AircraftDetailsOverlay.js";
import { SatelliteDetailsOverlay } from "./SatelliteDetailsOverlay.js";
import { InterestingAlert } from "./InterestingAlert.js";
import { SatelliteAlert } from "./SatelliteAlert.js";
import { InsightBanner } from "./InsightBanner.js";
import { LookNowBanner } from "./LookNowBanner.js";
import type {
  InterestingEntry,
  SatelliteAlertEntry,
  AircraftMessageEntry,
} from "../hooks/useWebSocket.js";

interface Props {
  aircraft: Aircraft[];
  snapshotTimestamp: number;
  config: AppConfig;
  sourceStatus: SourceStatus;
  connected: boolean;
  interestingEntry?: InterestingEntry;
  satellites?: Satellite[];
  satelliteTimestamp?: number;
  satelliteAlert?: SatelliteAlertEntry;
  insights?: Insight[];
  lookNow?: LookNowPrediction[];
  aircraftMessage?: AircraftMessageEntry;
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
  satelliteAlert,
  insights = [],
  lookNow = [],
  aircraftMessage,
}: Props) {
  const [selected, setSelected] = useState<Aircraft | null>(null);
  const [selectedSat, setSelectedSat] = useState<string | null>(null);
  const uiScale = useUiScale(config);

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
    <div className="sky" style={{ "--ui-scale": uiScale } as CSSProperties}>
      {config.showHeader && (
        <div className="header">
          📍 {config.locationName ?? config.postcode} · {config.radiusMiles} mi
          {(config.locationConfidence === "approximate" ||
            config.locationConfidence === "coarse") && (
            <span className="header-approx"> · approximate</span>
          )}
        </div>
      )}

      {/* True Sky needs an accurate observer; warn on a coarse fix (FRD v3.6 §10). */}
      {config.viewMode === "true-sky" &&
        locationTooApproximateForTrueSky(config.locationConfidence) && (
          <div className="true-sky-notice">
            Location is only approximate — improve it in Settings for an accurate Sky View.
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

      <LookNowBanner predictions={lookNow} enabled={config.showLookNow} />

      <InsightBanner insights={insights} enabled={config.showSkyInsights} />

      <InterestingAlert entry={interestingEntry} config={config} />

      <SatelliteAlert entry={satelliteAlert} config={config} />

      {selected && (
        <AircraftDetailsOverlay
          aircraft={selected}
          onClose={() => setSelected(null)}
          showAviation={config.showAviationContext}
          showAcars={config.showAcarsMessages}
          aircraftMessage={aircraftMessage}
        />
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

/** Resolve the overlay size multiplier, tracking viewport size (FRD §12-13). */
function useUiScale(config: AppConfig): number {
  const [size, setSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return resolveDisplayScale({
    displayScale: config.displayScale,
    viewingDistance: config.viewingDistance,
    width: size.w,
    height: size.h,
  });
}
