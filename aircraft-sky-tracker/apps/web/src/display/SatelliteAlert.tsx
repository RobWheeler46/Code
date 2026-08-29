import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "@ast/shared";
import type { SatelliteAlertEntry } from "../hooks/useWebSocket.js";

interface Props {
  entry: SatelliteAlertEntry | undefined;
  config: AppConfig;
}

interface Banner {
  id: number;
  headline: string;
  detail: string;
}

const BANNER_MS = 20_000; // satellite alerts linger a little longer than aircraft
const MAX_BANNERS = 3;

function headlineFor(entry: SatelliteAlertEntry): string {
  const { pass, minutesUntil } = entry;
  if (minutesUntil <= 0) return `${pass.name} visible now`;
  return `${pass.name} visible in ${minutesUntil} minute${minutesUntil === 1 ? "" : "s"}`;
}

function detailFor(entry: SatelliteAlertEntry): string {
  const { pass } = entry;
  return [
    `best ${localTime(pass.maxTime)}`,
    `max ${pass.maxElevationDegrees}°`,
    pass.direction,
    pass.potentiallyVisible ? "potentially visible" : undefined,
  ]
    .filter((s): s is string => Boolean(s))
    .join(" · ");
}

/**
 * On-screen satellite pass alerts (FRD v3.2 §61-62) - "ISS visible in 10
 * minutes". Shows a small stack of banners and, when enabled, fires a
 * permission-based browser/OS notification. Reuses the aircraft-alert styling.
 */
export function SatelliteAlert({ entry, config }: Props) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const lastId = useRef(0);

  useEffect(() => {
    if (!entry || entry.id === lastId.current) return;
    lastId.current = entry.id;

    const headline = headlineFor(entry);
    const detail = detailFor(entry);

    if (
      config.browserNotifications &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(headline, { body: detail, tag: `sat-${entry.pass.catalogNumber}` });
      } catch {
        /* notifications unavailable - ignore */
      }
    }

    if (config.inAppAlerts) {
      const id = entry.id;
      setBanners((b) => [...b, { id, headline, detail }].slice(-MAX_BANNERS));
      window.setTimeout(() => {
        setBanners((b) => b.filter((x) => x.id !== id));
      }, BANNER_MS);
    }
  }, [entry?.id, config.inAppAlerts, config.browserNotifications]);

  if (banners.length === 0) return null;

  return (
    <div className="alert-stack sat-alert-stack">
      {banners.map((b) => (
        <div
          key={b.id}
          className="alert-card sat-alert-card"
          onClick={() => setBanners((x) => x.filter((y) => y.id !== b.id))}
        >
          <div className="alert-title">
            <span className="alert-star">🛰</span> Satellite pass
          </div>
          <div className="alert-id">{b.headline}</div>
          <div className="alert-detail">{b.detail}</div>
        </div>
      ))}
    </div>
  );
}

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}
