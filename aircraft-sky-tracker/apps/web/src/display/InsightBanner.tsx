import { useState } from "react";
import { pickPrimaryInsight, type Insight } from "@ast/shared";

interface Props {
  insights: Insight[];
  /** Show the banner at all (config.showSkyInsights, FRD v3.8 §91). */
  enabled: boolean;
}

/**
 * The single prominent main-screen Sky Insight (FRD v3.8 §91). Shows one
 * contextual line about the most notable object in view, with an expandable
 * "Why?" that lists the evidence behind it (§92). Everything else stays in the
 * aircraft details drawer.
 */
export function InsightBanner({ insights, enabled }: Props) {
  const [showWhy, setShowWhy] = useState(false);
  if (!enabled) return null;
  const primary = pickPrimaryInsight(insights);
  if (!primary) return null;

  return (
    <div className={`insight-banner insight-${primary.confidence}`} role="status">
      <div className="insight-title">{primary.title}</div>
      {primary.lines.map((line, i) => (
        <div key={i} className={i === 0 ? "insight-subject" : "insight-line"}>
          {line}
        </div>
      ))}
      <div className="insight-meta">
        <span className="insight-confidence">{primary.confidence}</span>
        {primary.why.length > 0 && (
          <button
            type="button"
            className="insight-why-toggle"
            onClick={() => setShowWhy((v) => !v)}
            aria-expanded={showWhy}
          >
            {showWhy ? "Hide" : "Why?"}
          </button>
        )}
      </div>
      {showWhy && primary.why.length > 0 && (
        <ul className="insight-why">
          {primary.why.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
