import { useEffect, useRef, useState } from "react";
import {
  WS_PATH,
  type Aircraft,
  type AppConfig,
  type ServerMessage,
  type SourceStatus,
  type Satellite,
  type SatellitePass,
  type Insight,
  type LookNowPrediction,
} from "@ast/shared";

export interface InterestingEntry {
  aircraft: Aircraft;
  /** Monotonic id so consumers can react to each distinct entry event. */
  id: number;
}

export interface SatelliteAlertEntry {
  pass: SatellitePass;
  minutesUntil: number;
  /** Monotonic id so consumers can react to each distinct alert. */
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
  satellites: Satellite[];
  satelliteTimestamp: number;
  /** Latest upcoming-satellite-pass alert (FRD §61-62), or undefined. */
  satelliteAlert: SatelliteAlertEntry | undefined;
  /** Current set of active Sky Insights (FRD v3.8 §63, §103). */
  insights: Insight[];
  /** Current Look Now approaching-aircraft predictions (FRD v4.0 §16-19). */
  lookNow: LookNowPrediction[];
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
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [satelliteTimestamp, setSatelliteTimestamp] = useState<number>(0);
  const [satelliteAlert, setSatelliteAlert] = useState<SatelliteAlertEntry | undefined>(undefined);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [lookNow, setLookNow] = useState<LookNowPrediction[]>([]);

  const backoffRef = useRef(1000);
  const closedRef = useRef(false);
  const entryIdRef = useRef(0);
  const satAlertIdRef = useRef(0);

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
          case "satellite.snapshot":
            setSatellites(message.satellites);
            setSatelliteTimestamp(message.timestamp);
            break;
          case "insights.snapshot":
            // Full state sync (on connect / reconnect).
            setInsights(message.insights);
            break;
          case "insight.created":
          case "insight.updated":
            // Incremental delta: add or replace by id (FRD v3.8 §104).
            setInsights((prev) => {
              const next = prev.filter((i) => i.id !== message.insight.id);
              next.push(message.insight);
              return next;
            });
            break;
          case "insight.expired":
            setInsights((prev) => prev.filter((i) => i.id !== message.id));
            break;
          case "looknow.update":
            setLookNow(message.predictions);
            break;
          case "aircraft.interesting.enter":
            entryIdRef.current += 1;
            setInterestingEntry({ aircraft: message.aircraft, id: entryIdRef.current });
            break;
          case "satellite.alert":
            satAlertIdRef.current += 1;
            setSatelliteAlert({
              pass: message.pass,
              minutesUntil: message.minutesUntil,
              id: satAlertIdRef.current,
            });
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

  return {
    aircraft,
    snapshotTimestamp,
    sourceStatus,
    connected,
    config,
    interestingEntry,
    satellites,
    satelliteTimestamp,
    satelliteAlert,
    insights,
    lookNow,
  };
}
