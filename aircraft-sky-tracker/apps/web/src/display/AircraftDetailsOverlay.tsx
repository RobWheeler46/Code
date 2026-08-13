import { useEffect, useState } from "react";
import { type Aircraft, compassDirection } from "@ast/shared";

interface Props {
  aircraft: Aircraft;
  onClose: () => void;
}

interface Photo {
  url?: string;
  link?: string;
  photographer?: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  jet: "Jet",
  turboprop: "Turboprop",
  piston: "Light aircraft",
  helicopter: "Helicopter",
};

/** Optional aircraft detail overlay with a photo (FRD §60, Phase 1.1). */
export function AircraftDetailsOverlay({ aircraft, onClose }: Props) {
  const identifier = aircraft.registration ?? aircraft.callsign ?? aircraft.icaoHex;
  const destination = aircraft.destination?.displayName;
  const heading =
    aircraft.trackDegrees !== undefined ? compassDirection(aircraft.trackDegrees) : "—";
  const typeLine =
    (aircraft.aircraftTypeCode ? aircraft.aircraftTypeCode : "") +
    (aircraft.aircraftCategory && CATEGORY_LABEL[aircraft.aircraftCategory]
      ? `${aircraft.aircraftTypeCode ? " · " : ""}${CATEGORY_LABEL[aircraft.aircraftCategory]}`
      : "");

  const [photo, setPhoto] = useState<Photo | undefined>();
  const [photoLoaded, setPhotoLoaded] = useState(false);

  // Fetch a photo for this aircraft (backend proxies planespotters, FRD §79).
  useEffect(() => {
    let active = true;
    setPhoto(undefined);
    setPhotoLoaded(false);
    const params = new URLSearchParams();
    if (aircraft.registration) params.set("reg", aircraft.registration);
    params.set("hex", aircraft.icaoHex);
    void fetch(`/api/aircraft/photo?${params.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<Photo>) : {}))
      .then((p) => {
        if (active) setPhoto(p);
      })
      .catch(() => {
        if (active) setPhoto({});
      });
    return () => {
      active = false;
    };
  }, [aircraft.id, aircraft.registration, aircraft.icaoHex]);

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
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

        <div className="reg" style={{ fontSize: "1.4rem", fontWeight: 600 }}>
          {identifier}
        </div>
        {aircraft.interest && (
          <div className="interest-badge">★ {aircraft.interest.reasons.join(" · ")}</div>
        )}
        <div className="sub" style={{ marginBottom: "1rem" }}>
          {typeLine || "Unknown type"}
          {aircraft.callsign ? ` · ${aircraft.callsign}` : ""}
        </div>

        {destination && (
          <div style={{ marginBottom: "1rem", fontSize: "1rem" }}>→ {destination}</div>
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
