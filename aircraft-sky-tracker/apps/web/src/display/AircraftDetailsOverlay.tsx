import { useEffect, useRef, useState } from "react";
import {
  type Aircraft,
  type AircraftMeta,
  type FlightIntelligence,
  type Insight,
  flightStateLabel,
  oooiRows,
} from "@ast/shared";

interface Props {
  aircraft: Aircraft;
  onClose: () => void;
}

interface Photo {
  url?: string;
  link?: string;
  photographer?: string;
}

const SILHOUETTE_LABEL: Record<string, string> = {
  a320: "Airbus A320 family",
  b737: "Boeing 737 family",
  a380: "Airbus A380",
  b747: "Boeing 747",
  bizjet: "Business jet",
  turboprop: "Turboprop",
  helicopter: "Helicopter",
  light: "Light aircraft",
  a400m: "Airbus A400M",
  c17: "Boeing C-17",
  fighter: "Fighter / fast jet",
  military: "Military",
};

const COMPASS16 = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

function compass16(deg: number): string {
  return COMPASS16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16] as string;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  confirmed: "Route confirmed",
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
  unknown: "Unknown route",
};

const AUTO_CLOSE_MS = 30_000; // FRD §86

type Row = [string, string | undefined];

/**
 * Aircraft detail drawer (FRD v3.0 §42-47). Right-hand panel on desktop, bottom
 * sheet on narrow screens. Fetches a photo and registry metadata on open, shows
 * route / live / aircraft sections plus collapsible technical + data-quality,
 * and auto-closes after inactivity for kiosk use (FRD §86).
 */
export function AircraftDetailsOverlay({ aircraft, onClose }: Props) {
  const identifier = aircraft.registration ?? aircraft.callsign ?? aircraft.icaoHex;
  const dest = aircraft.destination;
  const silLabel = aircraft.silhouette ? SILHOUETTE_LABEL[aircraft.silhouette] : undefined;
  const t = aircraft.technical;

  const [photo, setPhoto] = useState<Photo | undefined>();
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [meta, setMeta] = useState<AircraftMeta | undefined>();
  const [flight, setFlight] = useState<FlightIntelligence | undefined>();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [showTechnical, setShowTechnical] = useState(false);
  const [showQuality, setShowQuality] = useState(false);

  // Photo (planespotters proxy) + registry metadata (adsbdb) on open.
  useEffect(() => {
    let active = true;
    setPhoto(undefined);
    setPhotoLoaded(false);
    setMeta(undefined);
    const params = new URLSearchParams();
    if (aircraft.registration) params.set("reg", aircraft.registration);
    params.set("hex", aircraft.icaoHex);
    void fetch(`/api/aircraft/photo?${params.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<Photo>) : {}))
      .then((p) => active && setPhoto(p))
      .catch(() => active && setPhoto({}));
    void fetch(`/api/aircraft/${encodeURIComponent(aircraft.icaoHex)}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ meta: AircraftMeta }>) : { meta: {} }))
      .then((d) => active && setMeta(d.meta ?? {}))
      .catch(() => active && setMeta({}));
    setFlight(undefined);
    void fetch(`/api/aircraft/${encodeURIComponent(aircraft.icaoHex)}/flight-intelligence`)
      .then((r) => (r.ok ? (r.json() as Promise<FlightIntelligence>) : undefined))
      .then((f) => active && setFlight(f))
      .catch(() => undefined);
    setInsights([]);
    void fetch(`/api/aircraft/${encodeURIComponent(aircraft.icaoHex)}/insights`)
      .then((r) => (r.ok ? (r.json() as Promise<{ insights: Insight[] }>) : { insights: [] }))
      .then((d) => active && setInsights(d.insights ?? []))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [aircraft.icaoHex, aircraft.registration]);

  // Auto-close after inactivity (FRD §86), reset on interaction.
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

  const vr = aircraft.verticalRateFpm;
  const climbArrow = vr === undefined ? "" : vr > 100 ? " ↑" : vr < -100 ? " ↓" : "";
  const ft = (n: number | undefined) => (n === undefined ? undefined : `${n.toLocaleString()} ft`);

  const routeConf = dest ? CONFIDENCE_LABEL[dest.confidence] : undefined;
  const originCode = dest?.originIata ?? dest?.originIcao;
  const destCode = dest?.iata ?? dest?.icao;

  const liveRows: Row[] = [
    ["Altitude", aircraft.altitudeFeet !== undefined ? `${aircraft.altitudeFeet.toLocaleString()} ft${climbArrow}` : undefined],
    ["Vertical rate", vr !== undefined ? `${vr > 0 ? "+" : ""}${vr.toLocaleString()} ft/min` : undefined],
    ["Ground speed", aircraft.groundSpeedKnots !== undefined ? `${Math.round(aircraft.groundSpeedKnots)} kt` : undefined],
    ["Track", aircraft.trackDegrees !== undefined ? `${Math.round(aircraft.trackDegrees)}° ${compass16(aircraft.trackDegrees)}` : undefined],
    ["Distance", `${aircraft.distanceMiles.toFixed(1)} mi`],
    ["Position", `${compass16(aircraft.bearingFromCentre)} of centre`],
  ];

  const aircraftRows: Row[] = [
    ["Registration", aircraft.registration],
    ["ICAO Hex", aircraft.icaoHex],
    ["Manufacturer", meta?.manufacturer],
    ["Model", meta?.model],
    ["Type code", aircraft.aircraftTypeCode],
    ["Operator", meta?.operator],
    ["Registered", meta?.registeredCountry],
  ];

  const techRows: Row[] = [
    ["Geometric alt", ft(t?.altitudeGeomFeet)],
    ["IAS", t?.indicatedAirspeedKnots !== undefined ? `${Math.round(t.indicatedAirspeedKnots)} kt` : undefined],
    ["TAS", t?.trueAirspeedKnots !== undefined ? `${Math.round(t.trueAirspeedKnots)} kt` : undefined],
    ["Mach", t?.mach !== undefined ? t.mach.toFixed(3) : undefined],
    ["Mag heading", t?.magHeadingDegrees !== undefined ? `${Math.round(t.magHeadingDegrees)}°` : undefined],
    ["True heading", t?.trueHeadingDegrees !== undefined ? `${Math.round(t.trueHeadingDegrees)}°` : undefined],
    ["Selected alt (MCP)", ft(t?.selectedAltitudeMcpFeet)],
    ["Selected alt (FMS)", ft(t?.selectedAltitudeFmsFeet)],
    ["Selected heading", t?.selectedHeadingDegrees !== undefined ? `${Math.round(t.selectedHeadingDegrees)}°` : undefined],
    ["QNH", t?.qnhHpa !== undefined ? `${Math.round(t.qnhHpa)} hPa` : undefined],
    ["Outside air temp", t?.outsideAirTempC !== undefined ? `${Math.round(t.outsideAirTempC)}°C` : undefined],
    ["Squawk", aircraft.squawk],
    ["Emergency", aircraft.emergency],
    ["Nav modes", t?.navModes && t.navModes.length > 0 ? t.navModes.join(", ") : undefined],
  ];

  const qualityRows: Row[] = [
    ["Source", aircraft.source],
    ["Position age", `${aircraft.positionAgeSeconds.toFixed(1)} s`],
    ["ADS-B version", t?.adsbVersion !== undefined ? String(t.adsbVersion) : undefined],
    ["Nav integrity (NIC)", t?.navIntegrityCategory !== undefined ? String(t.navIntegrityCategory) : undefined],
    ["Route source", dest ? "adsbdb" : undefined],
  ];

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
            <div className="drawer-id">{identifier}</div>
            <div className="drawer-sub">
              {[silLabel, aircraft.aircraftTypeCode].filter(Boolean).join(" · ") || "Aircraft"}
            </div>
            {dest?.airline && <div className="drawer-sub">{dest.airline}</div>}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {aircraft.interest && (
          <div className="interest-badge">★ {aircraft.interest.reasons.join(" · ")}</div>
        )}

        {photo?.url && (
          <div className="photo-wrap">
            <img
              className="aircraft-photo"
              src={photo.url}
              alt={`${identifier} aircraft`}
              onLoad={() => setPhotoLoaded(true)}
              style={{ opacity: photoLoaded ? 1 : 0 }}
            />
            {photo.photographer && (
              <div className="photo-credit">
                Photo © {photo.photographer}
                {photo.link && (
                  <>
                    {" · "}
                    <a href={photo.link} target="_blank" rel="noreferrer noopener">
                      planespotters.net
                    </a>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Route */}
        <div className="drawer-route">
          {dest?.displayName ? (
            <>
              <div className="route-line">
                <span>{dest.originName ?? "—"}</span>
                <span className="route-arrow">→</span>
                <span>{dest.displayName}</span>
              </div>
              {(originCode || destCode) && (
                <div className="route-codes">
                  {originCode ?? "—"} → {destCode ?? "—"}
                </div>
              )}
              {(routeConf || dest?.sources) && (
                <div className="route-conf">
                  {[routeConf, dest?.sources && dest.sources.length > 0 ? dest.sources.join(" + ") : undefined]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
            </>
          ) : (
            <div className="route-line">
              Heading{" "}
              {aircraft.trackDegrees !== undefined ? compass16(aircraft.trackDegrees) : "—"}
            </div>
          )}
        </div>

        {insights.length > 0 && <InsightsSection insights={insights} />}

        {flight && <FlightIntelligenceSection flight={flight} />}

        <Section title="Live" rows={liveRows} />
        <Section title="Aircraft" rows={aircraftRows} />

        <Collapsible
          title="More technical"
          open={showTechnical}
          onToggle={() => setShowTechnical((v) => !v)}
          rows={techRows}
        />
        <Collapsible
          title="Data quality"
          open={showQuality}
          onToggle={() => setShowQuality((v) => !v)}
          rows={qualityRows}
        />

        <div className="actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  const visible = rows.filter((r): r is [string, string] => Boolean(r[1]));
  if (visible.length === 0) return <div className="hint">No data available.</div>;
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

function Section({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.every((r) => !r[1])) return null;
  return (
    <>
      <h2>{title}</h2>
      <Rows rows={rows} />
    </>
  );
}

/** Operational flight intelligence: state, OOOI, ETA, sources (FRD v3.8 §53). */
function FlightIntelligenceSection({ flight }: { flight: FlightIntelligence }) {
  const oooi = oooiRows(flight.oooi).filter((r) => r.time);
  const rows: Row[] = [
    ["Flight", flight.callsign],
    ["Status", flightStateLabel(flight.flightState)],
    ["Airline", flight.airline],
    ["Route confidence", capitalise(flight.routeConfidence)],
    ["Estimated arrival", flight.eta ? formatTime(flight.eta.time) : undefined],
  ];
  // Nothing operational to show and no callsign -> skip entirely.
  if (rows.every((r) => !r[1]) && oooi.length === 0 && !flight.possibleRouteChange) return null;

  return (
    <>
      <h2>Flight intelligence</h2>
      {flight.possibleRouteChange && (
        <div className="route-change">
          <div className="route-change-head">
            Possible route change ({flight.possibleRouteChange.confidence})
          </div>
          <div>
            {flight.possibleRouteChange.previousDestination} →{" "}
            <strong>{flight.possibleRouteChange.newDestination}</strong>
          </div>
        </div>
      )}
      <Rows rows={rows} />
      {oooi.length > 0 && (
        <div className="oooi">
          {oooi.map((r) => (
            <span key={r.label} style={{ display: "contents" }}>
              <span className="k">{r.label}</span>
              <span className="v">{r.time ? formatTime(r.time) : "—"}</span>
            </span>
          ))}
        </div>
      )}
      {flight.sources.length > 0 && (
        <div className="route-conf">Sources: {flight.sources.join(" · ")}</div>
      )}
    </>
  );
}

/** Sky Insights for this aircraft, each with its evidence ("Why?", §92, §103). */
function InsightsSection({ insights }: { insights: Insight[] }) {
  const ordered = [...insights].sort((a, b) => b.priority - a.priority);
  return (
    <>
      <h2>Sky insights</h2>
      {ordered.map((ins) => (
        <div key={ins.id} className={`insight-card insight-${ins.confidence}`}>
          <div className="insight-card-head">
            <span className="insight-card-title">{ins.title}</span>
            <span className="insight-confidence">{ins.confidence}</span>
          </div>
          {ins.lines.length > 1 && (
            <div className="insight-card-lines">{ins.lines.slice(1).join(" · ")}</div>
          )}
          {ins.why.length > 0 && (
            <ul className="insight-why">
              {ins.why.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </>
  );
}

function capitalise(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
}

function Collapsible({
  title,
  open,
  onToggle,
  rows,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  rows: Row[];
}) {
  if (rows.every((r) => !r[1])) return null;
  return (
    <>
      <button className="collapsible" onClick={onToggle}>
        {title} <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && <Rows rows={rows} />}
    </>
  );
}
