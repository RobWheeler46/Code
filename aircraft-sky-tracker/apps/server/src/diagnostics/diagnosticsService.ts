/** DiagnosticsService (FRD §29, §42-43, §67). Source health, counts, timings. */

import type { AppConfig } from "@ast/shared";
import type { SettingsRepo } from "../persistence/settingsRepo.js";
import type { AircraftPollingService } from "../aircraft/pollingService.js";
import type { AircraftStateService } from "../aircraft/stateService.js";
import type { RouteService } from "../routes/routeService.js";
import type { WebSocketService } from "../websocket/wsService.js";
import type { LocationService } from "../location/locationService.js";
import type { AlertService } from "../alerts/alertService.js";
import type { HistoryService } from "../history/historyService.js";
import { env } from "../config/env.js";

export interface HealthReport {
  status: "healthy" | "degraded" | "starting";
  aircraftSource: string;
  routeSource: string;
  lastAircraftPollMsAgo: number | null;
}

export interface DiagnosticsReport {
  postcode: string;
  radiusMiles: number;
  aircraftProvider: string;
  providerStatus: string;
  locationStatus: "valid" | "unresolved";
  aircraftReceived: number;
  aircraftInsideRadius: number;
  aircraftDisplayed: number;
  routeCacheEntries: number;
  lastPollDurationMs: number;
  lastSuccessfulPoll: string | null;
  lastAircraftUpdateMsAgo: number | null;
  webSocketClients: number;
  routeProvider: string;
  lastRouteLookup: string | null;
  lastHttpStatus: number | null;
  pollingIntervalMs: number;
  uptimeSeconds: number;
  alertsEnabled: boolean;
  lastAlert: string | null;
  passesToday: number;
  interestingToday: number;
}

export class DiagnosticsService {
  constructor(
    private readonly settings: SettingsRepo,
    private readonly polling: AircraftPollingService,
    private readonly state: AircraftStateService,
    private readonly routes: RouteService,
    private readonly ws: WebSocketService,
    private readonly location: LocationService,
    private readonly alerts: AlertService,
    private readonly history: HistoryService,
    private readonly startedAtMs: number,
  ) {}

  private locationStatus(config: AppConfig): "valid" | "unresolved" {
    const hasCoords = config.latitude !== 0 || config.longitude !== 0;
    return hasCoords && this.location.getCached(config.postcode)
      ? "valid"
      : hasCoords
        ? "valid"
        : "unresolved";
  }

  health(): HealthReport {
    const status = this.polling.getStatus();
    const lastPollMsAgo =
      this.polling.lastPollAtMs > 0 ? Date.now() - this.polling.lastPollAtMs : null;
    return {
      status:
        status === "connected"
          ? "healthy"
          : status === "reconnecting"
            ? "degraded"
            : "starting",
      aircraftSource: status,
      routeSource: "connected",
      lastAircraftPollMsAgo: lastPollMsAgo,
    };
  }

  report(): DiagnosticsReport {
    const config = this.settings.get();
    const counts = this.state.getCounts();
    const lastPollMsAgo =
      this.polling.lastPollAtMs > 0 ? Date.now() - this.polling.lastPollAtMs : null;
    return {
      postcode: config.postcode,
      radiusMiles: config.radiusMiles,
      aircraftProvider: this.polling.getProviderName(),
      providerStatus: this.polling.getStatus(),
      locationStatus: this.locationStatus(config),
      aircraftReceived: counts.received,
      aircraftInsideRadius: counts.insideRadius,
      aircraftDisplayed: counts.displayed,
      routeCacheEntries: this.routes.cacheEntryCount(),
      lastPollDurationMs: this.polling.lastPollDurationMs,
      lastSuccessfulPoll: this.polling.lastSuccessfulPoll ?? null,
      lastAircraftUpdateMsAgo: lastPollMsAgo,
      webSocketClients: this.ws.clientCount(),
      routeProvider: env.routeProvider,
      lastRouteLookup: this.routes.lastCallsign ?? null,
      lastHttpStatus: this.routes.lastHttpStatus ?? null,
      pollingIntervalMs: env.aircraftPollIntervalMs,
      uptimeSeconds: Math.floor((Date.now() - this.startedAtMs) / 1000),
      alertsEnabled: this.alerts.enabled,
      lastAlert: this.alerts.lastAlert ?? null,
      passesToday: this.history.passesToday(),
      interestingToday: this.history.interestingToday(),
    };
  }
}
