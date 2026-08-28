import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
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

/** Approximate a radius (miles) around a point as a lat/lon bounding box. */
function radiusBounds(lat: number, lon: number, miles: number): L.LatLngBoundsExpression {
  const dLat = miles / 69;
  const dLon = miles / (69 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [
    [lat - dLat, lon - dLon],
    [lat + dLat, lon + dLon],
  ];
}

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
  const mapDivRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SkyRenderer | null>(null);
  const leafletRef = useRef<L.Map | null>(null);
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

    const observer = new ResizeObserver(() => {
      renderer.resize();
      leafletRef.current?.invalidateSize(false);
    });
    observer.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      rendererRef.current = null;
    };
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

  // Manage the Leaflet base map (map mode only). Aircraft are projected through
  // the map so they align with the tiles; leaving map mode tears it down.
  useEffect(() => {
    const renderer = rendererRef.current;
    const div = mapDivRef.current;
    const wantMap =
      config.viewMode === "map" && config.latitude !== 0 && config.longitude !== 0 && div !== null;

    if (!wantMap) {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
      renderer?.setProjectionOverride(undefined);
      return;
    }

    let map = leafletRef.current;
    if (!map) {
      map = L.map(div, {
        zoomControl: false,
        attributionControl: true,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        fadeAnimation: false,
      });
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);
      leafletRef.current = map;
      renderer?.setProjectionOverride((lat, lon) => {
        const pt = leafletRef.current!.latLngToContainerPoint([lat, lon]);
        return { x: pt.x, y: pt.y };
      });
    }

    map.invalidateSize(false);
    map.fitBounds(radiusBounds(config.latitude, config.longitude, config.radiusMiles), {
      animate: false,
      padding: [16, 16],
    });
  }, [config.viewMode, config.latitude, config.longitude, config.radiusMiles]);

  // Remove the map on unmount.
  useEffect(
    () => () => {
      if (leafletRef.current) {
        leafletRef.current.remove();
        leafletRef.current = null;
      }
    },
    [],
  );

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

  return (
    <>
      <div ref={mapDivRef} className="sky-map" />
      <canvas ref={canvasRef} onClick={handleClick} />
    </>
  );
}
