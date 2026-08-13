import { useEffect, useState } from "react";
import { LiveDisplay } from "./display/LiveDisplay.js";
import { OverrideDisplay } from "./display/OverrideDisplay.js";
import { SettingsPage } from "./settings/SettingsPage.js";
import { DiagnosticsPage } from "./diagnostics/DiagnosticsPage.js";
import { AuthGate } from "./components/AuthGate.js";

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

/** Read a ?postcode= override from the URL once, if present. */
function readOverridePostcode(): string | null {
  const value = new URLSearchParams(window.location.search).get("postcode");
  return value && value.trim().length > 0 ? value.trim() : null;
}

export function App() {
  const [view, setView] = useState<View>("display");
  const [overridePostcode] = useState<string | null>(readOverridePostcode);

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
    return (
      <AuthGate title="Settings" onBack={() => setView("display")}>
        <SettingsPage onBack={() => setView("display")} />
      </AuthGate>
    );
  }
  if (view === "diagnostics") {
    return (
      <AuthGate title="System Diagnostics" onBack={() => setView("display")}>
        <DiagnosticsPage onBack={() => setView("display")} />
      </AuthGate>
    );
  }

  // A ?postcode= URL shows that area for this tab only (per-viewer override).
  return overridePostcode ? (
    <OverrideDisplay postcode={overridePostcode} />
  ) : (
    <LiveDisplay />
  );
}
