import { useEffect, useState } from "react";
import type { Aircraft, AppConfig } from "@ast/shared";

export interface ViewPollState {
  aircraft: Aircraft[];
  snapshotTimestamp: number;
  config: AppConfig | undefined;
  /** false once the server reports the postcode is not recognised. */
  valid: boolean;
  connected: boolean;
}

const POLL_INTERVAL_MS = 2000;

/**
 * Per-viewer location override (?postcode=). Polls /api/view for a specific
 * postcode instead of using the global WebSocket, so this tab shows that area
 * without affecting the shared default or other viewers.
 */
export function useViewPoll(postcode: string): ViewPollState {
  const [state, setState] = useState<ViewPollState>({
    aircraft: [],
    snapshotTimestamp: 0,
    config: undefined,
    valid: true,
    connected: false,
  });

  useEffect(() => {
    let active = true;
    let timer: number | undefined;

    const poll = async () => {
      try {
        const res = await fetch(`/api/view?postcode=${encodeURIComponent(postcode)}`);
        const body = (await res.json()) as {
          valid: boolean;
          config?: AppConfig;
          aircraft?: Aircraft[];
          timestamp?: number;
        };
        if (!active) return;
        if (body.valid && body.config) {
          setState({
            aircraft: body.aircraft ?? [],
            snapshotTimestamp: body.timestamp ?? Date.now(),
            config: body.config,
            valid: true,
            connected: true,
          });
        } else {
          setState((s) => ({ ...s, valid: false, connected: true }));
        }
      } catch {
        if (active) setState((s) => ({ ...s, connected: false }));
      } finally {
        if (active) timer = window.setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    void poll();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [postcode]);

  return state;
}
