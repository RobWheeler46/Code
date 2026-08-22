import { useEffect, useRef, useState } from "react";
import { type AppConfig, compassDirection } from "@ast/shared";
import type { InterestingEntry } from "../hooks/useWebSocket.js";

interface Props {
  entry: InterestingEntry | undefined;
  config: AppConfig;
}

interface Banner {
  id: number;
  identifier: string;
  label: string;
  detail: string;
}

const BANNER_MS = 10_000;
const MAX_BANNERS = 3;

/**
 * On-screen interesting-aircraft entry alerts (FRD v3.0 §52-55). Shows a small
 * stack of banners when in-app alerts are enabled, and fires a permission-based
 * browser/OS notification when enabled. The app works regardless of whether
 * notification permission is granted (FRD §54).
 */
export function InterestingAlert({ entry, config }: Props) {
  const [banners, setBanners] = useState<Banner[]>([]);
  const lastId = useRef(0);

  useEffect(() => {
    if (!entry || entry.id === lastId.current) return;
    lastId.current = entry.id;

    const a = entry.aircraft;
    const identifier = a.registration ?? a.callsign ?? a.icaoHex;
    const label = a.interest?.label ?? "Interesting";
    const direction = compassDirection(a.bearingFromCentre);
    const detail = [
      a.aircraftTypeCode,
      `${a.distanceMiles.toFixed(1)} mi ${direction}`,
      a.destination?.displayName ? `→ ${a.destination.displayName}` : undefined,
    ]
      .filter((s): s is string => Boolean(s))
      .join(" · ");

    // Browser/OS notification (optional, permission-based).
    if (
      config.browserNotifications &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        new Notification(`${label} aircraft nearby`, {
          body: `${identifier} · ${detail}`,
          tag: a.icaoHex,
        });
      } catch {
        /* notifications unavailable - ignore */
      }
    }

    // In-app banner.
    if (config.inAppAlerts) {
      const id = entry.id;
      setBanners((b) => [...b, { id, identifier, label, detail }].slice(-MAX_BANNERS));
      window.setTimeout(() => {
        setBanners((b) => b.filter((x) => x.id !== id));
      }, BANNER_MS);
    }
  }, [entry?.id, config.inAppAlerts, config.browserNotifications]);

  if (banners.length === 0) return null;

  return (
    <div className="alert-stack">
      {banners.map((b) => (
        <div
          key={b.id}
          className="alert-card"
          onClick={() => setBanners((x) => x.filter((y) => y.id !== b.id))}
        >
          <div className="alert-title">
            <span className="alert-star">★</span> {b.label} aircraft nearby
          </div>
          <div className="alert-id">{b.identifier}</div>
          <div className="alert-detail">{b.detail}</div>
        </div>
      ))}
    </div>
  );
}
