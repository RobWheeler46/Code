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
        inAppAlerts: draft.inAppAlerts,
        browserNotifications: draft.browserNotifications,
        historyEnabled: draft.historyEnabled,
        historyRetentionDays: draft.historyRetentionDays,
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
