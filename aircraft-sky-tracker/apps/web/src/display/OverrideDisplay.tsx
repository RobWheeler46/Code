import { useViewPoll } from "../hooks/useViewPoll.js";
import { SkyDisplay } from "./SkyDisplay.js";

interface Props {
  postcode: string;
}

/**
 * Per-viewer location override (?postcode=). Shows the sky around an arbitrary
 * postcode for this tab only, by polling /api/view - the shared default and
 * other viewers are unaffected.
 */
export function OverrideDisplay({ postcode }: Props) {
  const view = useViewPoll(postcode);

  if (!view.valid) {
    return (
      <div className="sky">
        <div className="no-aircraft">Postcode “{postcode}” not recognised</div>
      </div>
    );
  }

  if (!view.config) {
    return (
      <div className="sky">
        <div className="no-aircraft">Loading {postcode}…</div>
      </div>
    );
  }

  return (
    <>
      <SkyDisplay
        aircraft={view.aircraft}
        snapshotTimestamp={view.snapshotTimestamp}
        config={view.config}
        sourceStatus={view.connected ? "connected" : "reconnecting"}
        connected={view.connected}
      />
      <div className="override-badge">📍 {view.config.postcode}</div>
    </>
  );
}
