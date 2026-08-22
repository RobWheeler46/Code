import { useEffect, useRef, useState } from "react";
import {
  WS_PATH,
  type Aircraft,
  type AppConfig,
  type ServerMessage,
  type SourceStatus,
} from "@ast/shared";

export interface InterestingEntry {
  aircraft: Aircraft;
  /** Monotonic id so consumers can react to each distinct entry event. */
  id: number;
}

export interface LiveState {
  aircraft: Aircraft[];
  /** Server timestamp of the latest snapshot (ms) - used for interpolation. */
  snapshotTimestamp: number;
  sourceStatus: SourceStatus;
  connected: boolean;
  config: AppConfig | undefined;
  /** Latest interesting-aircraft entry event (FRD §52), or undefined. */
  interestingEntry: InterestingEntry | undefined;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * Single persistent WebSocket to the backend (FRD §44). Parses normalised
 * server messages and auto-reconnects with backoff (FRD §95). The browser never
 * contacts an aircraft provider directly (FRD §11).
 */
export function useWebSocket(): LiveState {
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [snapshotTimestamp, setSnapshotTimestamp] = useState<number>(0);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus>("disconnected");
  const [connected, setConnected] = useState(false);
  const [config, setConfig] = useState<AppConfig | undefined>(undefined);
  const [interestingEntry, setInterestingEntry] = useState<InterestingEntry | undefined>(
    undefined,
  );

  const backoffRef = useRef(1000);
  const closedRef = useRef(false);
  const entryIdRef = useRef(0);

  useEffect(() => {
    closedRef.current = false;
    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;

    const url = () => {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      return `${proto}//${window.location.host}${WS_PATH}`;
    };

    const connect = (): void => {
      const ws = new WebSocket(url());
      socket = ws;

      ws.onopen = () => {
        setConnected(true);
        backoffRef.current = 1000;
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case "aircraft.snapshot":
            setAircraft(message.aircraft);
            setSnapshotTimestamp(message.timestamp);
            break;
          case "config.updated":
            setConfig(message.config);
            break;
          case "source.status":
            setSourceStatus(message.status);
            break;
          case "aircraft.interesting.enter":
            entryIdRef.current += 1;
            setInterestingEntry({ aircraft: message.aircraft, id: entryIdRef.current });
            break;
          case "error.status":
            // Non-fatal; surfaced via source status in the UI.
            break;
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setSourceStatus("disconnected");
        if (closedRef.current) return;
        const wait = backoffRef.current;
        backoffRef.current = Math.min(wait * 2, MAX_BACKOFF_MS);
        reconnectTimer = window.setTimeout(connect, wait);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      closedRef.current = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { aircraft, snapshotTimestamp, sourceStatus, connected, config, interestingEntry };
}
