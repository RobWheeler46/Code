import type { SourceStatus } from "@ast/shared";

interface Props {
  sourceStatus: SourceStatus;
  connected: boolean;
}

/**
 * Small, unobtrusive live-data status (FRD §68). Shows nothing while healthy;
 * the black display always remains visible.
 */
export function DisplayStatus({ sourceStatus, connected }: Props) {
  if (connected && sourceStatus === "connected") return null;

  const message =
    !connected || sourceStatus === "disconnected"
      ? "LIVE DATA UNAVAILABLE · RECONNECTING…"
      : "RECONNECTING…";

  return (
    <div className="display-status">
      <span className="reconnecting">{message}</span>
    </div>
  );
}
