import { type Aircraft, compassDirection } from "@ast/shared";

interface Props {
  aircraft: Aircraft;
  onClose: () => void;
}

/** Optional aircraft detail overlay (FRD §60). Not permanently visible. */
export function AircraftDetailsOverlay({ aircraft, onClose }: Props) {
  const identifier = aircraft.registration ?? aircraft.callsign ?? aircraft.icaoHex;
  const destination = aircraft.destination?.displayName;
  const heading =
    aircraft.trackDegrees !== undefined ? compassDirection(aircraft.trackDegrees) : "—";

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <div className="reg" style={{ fontSize: "1.4rem", fontWeight: 600 }}>
          {identifier}
        </div>
        <div className="sub" style={{ marginBottom: "1rem" }}>
          {aircraft.aircraftTypeCode ?? "Unknown type"}
          {aircraft.callsign ? ` · ${aircraft.callsign}` : ""}
        </div>

        {destination && (
          <div style={{ marginBottom: "1rem", fontSize: "1rem" }}>
            → {destination}
          </div>
        )}

        <div className="rows">
          <span className="k">Altitude</span>
          <span className="v">
            {aircraft.altitudeFeet !== undefined
              ? `${aircraft.altitudeFeet.toLocaleString()} ft`
              : "—"}
          </span>
          <span className="k">Speed</span>
          <span className="v">
            {aircraft.groundSpeedKnots !== undefined
              ? `${Math.round(aircraft.groundSpeedKnots)} kt`
              : "—"}
          </span>
          <span className="k">Distance</span>
          <span className="v">{aircraft.distanceMiles.toFixed(1)} mi</span>
          <span className="k">Heading</span>
          <span className="v">{heading}</span>
        </div>

        <div className="actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
