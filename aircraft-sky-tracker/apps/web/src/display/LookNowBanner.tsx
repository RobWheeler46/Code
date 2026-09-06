import type { LookNowPrediction } from "@ast/shared";

interface Props {
  predictions: LookNowPrediction[];
  /** Show the banner at all (config.showLookNow, FRD v4.0 §16-19). */
  enabled: boolean;
}

function countdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * Look Now banner (FRD v4.0 §16-19): a single "look up now" prompt for the most
 * imminent approaching aircraft - when it arrives, how close, and where to look.
 * Confidence is shown plainly so it never implies certainty (§18). Interesting
 * approaches (military, watchlist, rare) are highlighted (§19).
 */
export function LookNowBanner({ predictions, enabled }: Props) {
  if (!enabled) return null;
  const p = predictions[0];
  if (!p) return null;

  const a = p.approach;
  return (
    <div className={`looknow-banner looknow-${p.confidence}${p.tag ? " looknow-interesting" : ""}`} role="status">
      <div className="looknow-head">
        {p.tag ? `${p.tag.toUpperCase()} APPROACHING` : "APPROACHING"}
      </div>
      <div className="looknow-subject">{p.label}</div>
      <div className="looknow-grid">
        <span className="k">Expected in</span>
        <span className="v">{countdown(a.timeToClosestSeconds)}</span>
        <span className="k">Closest approach</span>
        <span className="v">{a.horizontalDistanceMiles.toFixed(1)} mi</span>
        {a.altitudeFeet !== undefined && (
          <>
            <span className="k">Expected altitude</span>
            <span className="v">{a.altitudeFeet.toLocaleString()} ft</span>
          </>
        )}
        <span className="k">Look towards</span>
        <span className="v">{a.lookCompass}</span>
      </div>
      <div className="looknow-confidence">{p.confidence} confidence</div>
    </div>
  );
}
