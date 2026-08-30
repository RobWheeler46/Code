import { useEffect, useState } from "react";
import type { AppConfig, ConfigUpdate } from "@ast/shared";
import { useConfig } from "../hooks/useConfig.js";

interface Props {
  onBack: () => void;
}

type Validation =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "valid"; postcode: string }
  | { state: "invalid"; message: string };

const RADIUS_OPTIONS = [2, 5, 10, 15, 20, 30];

const DISPLAY_TOGGLES: { key: keyof AppConfig; label: string }[] = [
  { key: "showRegistration", label: "Registration" },
  { key: "showDestination", label: "Destination" },
  { key: "showFlightNumber", label: "Flight number" },
  { key: "showAltitude", label: "Altitude" },
  { key: "showDistance", label: "Distance" },
  { key: "showCentreMarker", label: "Centre marker" },
  { key: "showRangeRing", label: "Range circle" },
  { key: "showHeader", label: "Header" },
  { key: "showTrails", label: "Trails" },
  { key: "showDestinationArcs", label: "Destination arcs" },
];

/** Settings screen (FRD §62-65). */
export function SettingsPage({ onBack }: Props) {
  const { config, update, reset, validatePostcode } = useConfig();
  const [draft, setDraft] = useState<AppConfig | undefined>(config);
  const [postcodeInput, setPostcodeInput] = useState("");
  const [validation, setValidation] = useState<Validation>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (config && !draft) {
      setDraft(config);
      setPostcodeInput(config.postcode);
    }
  }, [config, draft]);

  if (!draft) {
    return (
      <div className="page">
        <h1>Settings</h1>
        <p className="hint">Loading configuration…</p>
        <div className="actions">
          <button onClick={onBack}>Back</button>
        </div>
      </div>
    );
  }

  const setToggle = (key: keyof AppConfig, value: boolean) => {
    setDraft({ ...draft, [key]: value });
  };

  const checkPostcode = async () => {
    if (!postcodeInput.trim()) return;
    setValidation({ state: "checking" });
    try {
      const result = await validatePostcode(postcodeInput);
      if (result.valid) {
        setValidation({ state: "valid", postcode: result.postcode });
      } else {
        setValidation({
          state: "invalid",
          message: "Postcode not recognised. Please check the postcode and try again.",
        });
      }
    } catch {
      setValidation({
        state: "invalid",
        message: "Could not check postcode - the lookup service may be unavailable.",
      });
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveError(undefined);
    try {
      const patch: ConfigUpdate = {
        radiusMiles: draft.radiusMiles,
        aircraftSource: draft.aircraftSource,
        viewMode: draft.viewMode,
        viewingDistance: draft.viewingDistance,
        displayScale: draft.displayScale,
        showRegistration: draft.showRegistration,
        showDestination: draft.showDestination,
        showFlightNumber: draft.showFlightNumber,
        showAltitude: draft.showAltitude,
        showDistance: draft.showDistance,
        showCentreMarker: draft.showCentreMarker,
        showRangeRing: draft.showRangeRing,
        showHeader: draft.showHeader,
        showTrails: draft.showTrails,
        showDestinationArcs: draft.showDestinationArcs,
        highlightInteresting: draft.highlightInteresting,
        watchlist: draft.watchlist,
        lowAltitudeThresholdFeet: draft.lowAltitudeThresholdFeet,
        hideGroundAircraft: draft.hideGroundAircraft,
        inAppAlerts: draft.inAppAlerts,
        browserNotifications: draft.browserNotifications,
        historyEnabled: draft.historyEnabled,
        historyRetentionDays: draft.historyRetentionDays,
        showSatellites: draft.showSatellites,
        satelliteMinElevationDeg: draft.satelliteMinElevationDeg,
        satelliteShowStations: draft.satelliteShowStations,
        satelliteShowBright: draft.satelliteShowBright,
        satelliteShowStarlink: draft.satelliteShowStarlink,
        satelliteAlertsEnabled: draft.satelliteAlertsEnabled,
        satelliteAlertLeadMinutes: draft.satelliteAlertLeadMinutes,
        satelliteAlertVisibleOnly: draft.satelliteAlertVisibleOnly,
      };
      // Only change the active location once a new postcode is entered (FRD §63).
      const normalised = postcodeInput.trim().toUpperCase().replace(/\s+/g, " ");
      if (normalised && normalised !== draft.postcode) {
        patch.postcode = postcodeInput;
      }
      const saved = await update(patch);
      setDraft(saved);
      setPostcodeInput(saved.postcode);
      setValidation({ state: "idle" });
      onBack();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const doReset = async () => {
    const restored = await reset();
    setDraft(restored);
    setPostcodeInput(restored.postcode);
    setConfirmReset(false);
    setValidation({ state: "idle" });
  };

  return (
    <div className="page">
      <h1>Settings</h1>

      <h2>Location</h2>
      <div className="field">
        <label htmlFor="postcode">Postcode</label>
        <input
          id="postcode"
          type="text"
          value={postcodeInput}
          onChange={(e) => {
            setPostcodeInput(e.target.value);
            setValidation({ state: "idle" });
          }}
          onBlur={() => void checkPostcode()}
          placeholder="SN25 4TP"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <div className={`status-line ${validationClass(validation)}`}>
          {validationMessage(validation)}
        </div>
      </div>

      <div className="field">
        <label htmlFor="radius">Tracking radius</label>
        <select
          id="radius"
          value={draft.radiusMiles}
          onChange={(e) => setDraft({ ...draft, radiusMiles: Number(e.target.value) })}
        >
          {RADIUS_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r} miles
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="source">Aircraft source</label>
        <select
          id="source"
          value={draft.aircraftSource}
          onChange={(e) =>
            setDraft({ ...draft, aircraftSource: e.target.value as AppConfig["aircraftSource"] })
          }
        >
          <option value="internet">Internet</option>
          <option value="local" disabled>
            Local ADS-B (future)
          </option>
          <option value="hybrid" disabled>
            Hybrid (future)
          </option>
        </select>
      </div>

      <h2>Display</h2>
      <div className="field">
        <label htmlFor="viewmode">View mode</label>
        <select
          id="viewmode"
          value={draft.viewMode}
          onChange={(e) => setDraft({ ...draft, viewMode: e.target.value as AppConfig["viewMode"] })}
        >
          <option value="ceiling">Ceiling — pure sky view (projector)</option>
          <option value="screen">Screen — with range rings &amp; compass</option>
          <option value="map">Map — real street map tiles</option>
        </select>
        <p className="hint">
          Ceiling is the clean look-up view. Screen adds a schematic backdrop (range rings,
          compass rose and cardinal directions) for a desk monitor. Map plots aircraft on a
          real street map (tiles are fetched from the internet) with satellites in a small
          sky inset.
        </p>
      </div>

      <div className="field">
        <label htmlFor="displayscale">Display scale</label>
        <select
          id="displayscale"
          value={draft.displayScale}
          onChange={(e) =>
            setDraft({ ...draft, displayScale: e.target.value as AppConfig["displayScale"] })
          }
        >
          <option value="automatic">Automatic — fit to screen</option>
          <option value="compact">Compact</option>
          <option value="standard">Standard</option>
          <option value="large">Large</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="viewingdistance">Viewing distance</label>
        <select
          id="viewingdistance"
          value={draft.viewingDistance}
          onChange={(e) =>
            setDraft({ ...draft, viewingDistance: e.target.value as AppConfig["viewingDistance"] })
          }
        >
          <option value="close">Close</option>
          <option value="normal">Normal</option>
          <option value="across-room">Across room</option>
        </select>
        <p className="hint">
          Automatic scale adapts icons, markers and text to the screen size; viewing distance
          nudges everything larger for a TV/projector across the room, or smaller up close.
        </p>
      </div>
      {DISPLAY_TOGGLES.map((toggle) => (
        <label className="check" key={toggle.key}>
          <input
            type="checkbox"
            checked={Boolean(draft[toggle.key])}
            onChange={(e) => setToggle(toggle.key, e.target.checked)}
          />
          {toggle.label}
        </label>
      ))}
      <label className="check">
        <input
          type="checkbox"
          checked={draft.hideGroundAircraft}
          onChange={(e) => setToggle("hideGroundAircraft", e.target.checked)}
        />
        Hide aircraft on the ground
      </label>
      <div className="hint">
        When on, aircraft reporting as on the ground (taxiing or parked) are excluded, so
        only airborne traffic is shown.
      </div>

      <h2>Interesting aircraft</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.highlightInteresting}
          onChange={(e) => setToggle("highlightInteresting", e.target.checked)}
        />
        Highlight interesting aircraft
      </label>
      <div className="field">
        <label htmlFor="watchlist">Watchlist</label>
        <input
          id="watchlist"
          type="text"
          value={draft.watchlist}
          onChange={(e) => setDraft({ ...draft, watchlist: e.target.value })}
          placeholder="G-EUUA, A388, SPIT"
          spellCheck={false}
        />
        <div className="hint">
          Registrations or type codes to always flag, separated by commas.
          Military, heavy (A380/747), helicopters and low aircraft are flagged
          automatically. Phone push alerts are enabled by setting the
          NOTIFY_NTFY_TOPIC server variable.
        </div>
      </div>
      <div className="field">
        <label htmlFor="lowalt">Low aircraft threshold (ft)</label>
        <input
          id="lowalt"
          type="text"
          inputMode="numeric"
          value={String(draft.lowAltitudeThresholdFeet)}
          onChange={(e) => {
            const n = Number(e.target.value.replace(/[^0-9]/g, ""));
            setDraft({ ...draft, lowAltitudeThresholdFeet: Number.isFinite(n) ? n : 0 });
          }}
        />
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.inAppAlerts}
          onChange={(e) => setToggle("inAppAlerts", e.target.checked)}
        />
        In-app alerts (on-screen banner)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.browserNotifications}
          onChange={(e) => {
            const on = e.target.checked;
            setToggle("browserNotifications", on);
            if (on && typeof Notification !== "undefined" && Notification.permission === "default") {
              void Notification.requestPermission();
            }
          }}
        />
        Browser notifications
      </label>
      {draft.browserNotifications &&
        typeof Notification !== "undefined" &&
        Notification.permission === "denied" && (
          <div className="hint">
            Notifications are blocked for this site — enable them in your browser
            to receive alerts. The app works fine without them.
          </div>
        )}

      <h2>History</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.historyEnabled}
          onChange={(e) => setToggle("historyEnabled", e.target.checked)}
        />
        Record aircraft history
      </label>
      <div className="field">
        <label htmlFor="retention">Retention</label>
        <select
          id="retention"
          value={draft.historyRetentionDays}
          onChange={(e) =>
            setDraft({ ...draft, historyRetentionDays: Number(e.target.value) })
          }
        >
          {[7, 14, 31, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </div>

      <h2>Satellites</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.showSatellites}
          onChange={(e) => setToggle("showSatellites", e.target.checked)}
        />
        Show satellites
      </label>
      <div className="field">
        <label htmlFor="satelev">Minimum elevation</label>
        <select
          id="satelev"
          value={draft.satelliteMinElevationDeg}
          onChange={(e) =>
            setDraft({ ...draft, satelliteMinElevationDeg: Number(e.target.value) })
          }
        >
          {[5, 10, 15, 30, 45].map((d) => (
            <option key={d} value={d}>
              {d}°
            </option>
          ))}
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.satelliteShowStations}
          onChange={(e) => setToggle("satelliteShowStations", e.target.checked)}
        />
        Space stations (ISS, Tiangong)
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.satelliteShowBright}
          onChange={(e) => setToggle("satelliteShowBright", e.target.checked)}
        />
        Bright satellites
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.satelliteShowStarlink}
          onChange={(e) => setToggle("satelliteShowStarlink", e.target.checked)}
        />
        Bright Starlink passes
      </label>
      <div className="hint">
        Satellite positions come from CelesTrak orbital data propagated with SGP4;
        the centre of the display is directly overhead (zenith).
      </div>

      <h2>Satellite pass alerts</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.satelliteAlertsEnabled}
          onChange={(e) => setToggle("satelliteAlertsEnabled", e.target.checked)}
        />
        Alert before an upcoming pass
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.satelliteAlertVisibleOnly}
          onChange={(e) => setToggle("satelliteAlertVisibleOnly", e.target.checked)}
          disabled={!draft.satelliteAlertsEnabled}
        />
        Only potentially-visible (naked-eye) passes
      </label>
      <div className="field">
        <label htmlFor="alertlead">Advance warning (minutes)</label>
        <input
          id="alertlead"
          type="number"
          min={1}
          max={120}
          value={draft.satelliteAlertLeadMinutes}
          disabled={!draft.satelliteAlertsEnabled}
          onChange={(e) =>
            setDraft({ ...draft, satelliteAlertLeadMinutes: Number(e.target.value) })
          }
        />
      </div>
      <div className="hint">
        Alerts fire for the satellite groups you're showing above (e.g. ISS, bright
        satellites), and appear on screen — plus a phone push when a ntfy topic is set on
        the server. In-app / browser notifications reuse the aircraft-alert setting.
      </div>

      {saveError && <div className="status-line err">{saveError}</div>}

      <div className="actions">
        <button className="danger" onClick={() => setConfirmReset(true)}>
          Reset defaults
        </button>
        <button className="primary" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onBack}>Back</button>
      </div>

      {confirmReset && (
        <div className="overlay-backdrop" onClick={() => setConfirmReset(false)}>
          <div className="panel" onClick={(e) => e.stopPropagation()}>
            <h1 style={{ fontSize: "1rem" }}>Reset settings?</h1>
            <p className="hint">This will restore:</p>
            <div className="rows">
              <span className="k">Postcode</span>
              <span className="v">SN25 4TP</span>
              <span className="k">Radius</span>
              <span className="v">10 miles</span>
              <span className="k">Display</span>
              <span className="v">Minimal</span>
            </div>
            <div className="actions">
              <button onClick={() => setConfirmReset(false)}>Cancel</button>
              <button className="danger" onClick={() => void doReset()}>
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function validationClass(v: Validation): string {
  switch (v.state) {
    case "valid":
      return "ok";
    case "invalid":
      return "err";
    case "checking":
      return "pending";
    default:
      return "";
  }
}

function validationMessage(v: Validation): string {
  switch (v.state) {
    case "checking":
      return "Checking postcode…";
    case "valid":
      return `✓ Valid UK postcode (${v.postcode})`;
    case "invalid":
      return v.message;
    default:
      return "";
  }
}
