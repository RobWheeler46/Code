import { useEffect, useRef } from "react";
import type { Aircraft, AppConfig, Satellite } from "@ast/shared";
import { SkyRenderer } from "./skyRenderer.js";

interface Props {
  aircraft: Aircraft[];
  snapshotTimestamp: number;
  config: AppConfig;
  satellites: Satellite[];
  satelliteTimestamp: number;
  onSelect: (aircraft: Aircraft) => void;
  onSelectSatellite: (satellite: Satellite) => void;
}

const CLICK_RADIUS = 40;

/** Hosts the canvas and drives the requestAnimationFrame render loop (FRD §52). */
export function AircraftCanvas({
  aircraft,
  snapshotTimestamp,
  config,
  satellites,
  satelliteTimestamp,
  onSelect,
  onSelectSatellite,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const aircraftRef = useRef<Aircraft[]>(aircraft);
  aircraftRef.current = aircraft;
  const satellitesRef = useRef<Satellite[]>(satellites);
  satellitesRef.current = satellites;

  // Create the renderer once and run the animation loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new SkyRenderer(canvas);
    rendererRef.current = renderer;
    renderer.setConfig(config);

    let raf = 0;
    const loop = () => {
      renderer.render(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // Track the element's real size so the canvas is correct even if it mounts
    // hidden/0-sized (e.g. a kiosk that starts before the display is shown) and
    // adapts to any viewport change / rotation (FRD §49, §76).
    const observer = new ResizeObserver(() => renderer.resize());
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      rendererRef.current = null;
    };
    // Renderer is created once; config/data changes are pushed via other effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setConfig(config);
  }, [config]);

  useEffect(() => {
    rendererRef.current?.ingest(aircraft, snapshotTimestamp);
  }, [aircraft, snapshotTimestamp]);

  useEffect(() => {
    rendererRef.current?.ingestSatellites(satellites, satelliteTimestamp);
  }, [satellites, satelliteTimestamp]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;

    // Aircraft take priority (primary layer, FRD §69).
    let bestId: string | undefined;
    let bestDist = CLICK_RADIUS;
    for (const target of renderer.getHitTargets()) {
      const d = Math.hypot(target.x - px, target.y - py);
      if (d <= bestDist) {
        bestDist = d;
        bestId = target.id;
      }
    }
    if (bestId) {
      const found = aircraftRef.current.find((a) => a.id === bestId);
      if (found) {
        onSelect(found);
        return;
      }
    }

    let bestSat: string | undefined;
    bestDist = CLICK_RADIUS;
    for (const target of renderer.getSatelliteHitTargets()) {
      const d = Math.hypot(target.x - px, target.y - py);
      if (d <= bestDist) {
        bestDist = d;
        bestSat = target.id;
      }
    }
    if (bestSat) {
      const found = satellitesRef.current.find((s) => s.catalogNumber === bestSat);
      if (found) onSelectSatellite(found);
    }
  };

  return <canvas ref={canvasRef} onClick={handleClick} />;
}
