import { useEffect, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket.js";
import { useConfig } from "./hooks/useConfig.js";
import { SkyDisplay } from "./display/SkyDisplay.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { DiagnosticsPage } from "./diagnostics/DiagnosticsPage.js";

type View = "display" | "settings" | "diagnostics";

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }
}

function isFormField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
}

export function App() {
  const [view, setView] = useState<View>("display");
  const live = useWebSocket();
  // Initial config (fast REST fetch) as a fallback until the WS delivers it.
  const { config: restConfig } = useConfig();
  const config = live.config ?? restConfig;

  // Keyboard shortcuts (FRD §61). Configurable in a future release.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFormField(e.target)) return;
      switch (e.key.toLowerCase()) {
        case "s":
          setView((v) => (v === "settings" ? "display" : "settings"));
          break;
        case "d":
          setView((v) => (v === "diagnostics" ? "display" : "diagnostics"));
          break;
        case "f":
          toggleFullscreen();
          break;
        case "escape":
          setView("display");
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (view === "settings") {
    return <SettingsPage onBack={() => setView("display")} />;
  }
  if (view === "diagnostics") {
    return <DiagnosticsPage onBack={() => setView("display")} />;
  }

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
    />
  );
}
