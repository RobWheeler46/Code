import { useWebSocket } from "../hooks/useWebSocket.js";
import { useConfig } from "../hooks/useConfig.js";
import { SkyDisplay } from "./SkyDisplay.js";

/** The default live display, fed by the global WebSocket (FRD §44-45). */
export function LiveDisplay() {
  const live = useWebSocket();
  // Initial config (fast REST fetch) as a fallback until the WS delivers it.
  const { config: restConfig } = useConfig();
  const config = live.config ?? restConfig;

  if (!config) {
    return (
      <div className="sky">
        <div className="no-aircraft">Connecting…</div>
      </div>
    );
  }

  return (
    <SkyDisplay
      aircraft={live.aircraft}
      snapshotTimestamp={live.snapshotTimestamp}
      config={config}
      sourceStatus={live.sourceStatus}
      connected={live.connected}
      interestingEntry={live.interestingEntry}
      satellites={live.satellites}
      satelliteTimestamp={live.satelliteTimestamp}
      satelliteAlert={live.satelliteAlert}
      insights={live.insights}
      lookNow={live.lookNow}
    />
  );
}
