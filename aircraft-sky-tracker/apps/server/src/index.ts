/**
 * Local Aircraft Sky Tracker - server entry point.
 *
 * Wires the components together and runs the startup sequence (FRD §84-85):
 * open SQLite, load/seed configuration, resolve coordinates, start the web
 * server + WebSocket, then aircraft polling and route enrichment.
 */

import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  DEFAULT_CONFIG,
  type AppConfig,
  type ConfigUpdate,
  type Aircraft,
  type ServerMessage,
} from "@ast/shared";

import { env } from "./config/env.js";
import { createLogger } from "./logging/logger.js";
import { openDatabase, closeDatabase } from "./persistence/db.js";
import { SettingsRepo } from "./persistence/settingsRepo.js";
import { LocationService } from "./location/locationService.js";
import { GeoService } from "./geo/geoService.js";
import { RouteService } from "./routes/routeService.js";
import { PhotoService } from "./routes/photoService.js";
import { AircraftStateService } from "./aircraft/stateService.js";
import { ViewService } from "./aircraft/viewService.js";
import { AircraftPollingService } from "./aircraft/pollingService.js";
import { WebSocketService } from "./websocket/wsService.js";
import { AlertService } from "./alerts/alertService.js";
import { HistoryService } from "./history/historyService.js";
import { SatelliteService, type SatelliteConfigView } from "./satellite/satelliteService.js";
import { PassPredictionService } from "./satellite/passPredictionService.js";
import { SatelliteAlertService } from "./satellite/satelliteAlertService.js";
import { CelesTrakProvider } from "./satellite/orbitalProvider.js";
import { SpaceTrackProvider } from "./satellite/spaceTrackProvider.js";
import { FailoverOrbitalProvider } from "./satellite/failoverOrbitalProvider.js";
import { OrbitalElementCache } from "./satellite/orbitalCache.js";
import {
  IpWhoIsProvider,
  clientIp,
  cloudflareLocation,
} from "./location/ipLocationProvider.js";
import {
  classifyConfidence,
  deriveFlightState,
  type DetectedLocation,
  type LocationSource,
  type FlightIntelligence,
} from "@ast/shared";
import {
  OperationalIntelligenceService,
  SimulationOperationalProvider,
  AirframesOperationalProvider,
} from "./routes/operationalIntelligence.js";
import { InsightsEngine } from "./insights/insightsEngine.js";
import { AccountRepo } from "./persistence/accountRepo.js";
import { GoogleAuth } from "./auth/googleAuth.js";
import { createAuthRouter } from "./auth/authRouter.js";
import { orbitFrom } from "./satellite/sgp4Service.js";
import { DiagnosticsService } from "./diagnostics/diagnosticsService.js";
import { createAircraftProvider } from "./providers/index.js";
import {
  createApiRouter,
  type ApiContext,
  type UpdateOutcome,
  type ValidateResult,
} from "./api/router.js";
import { isAuthEnabled } from "./api/auth.js";

const log = createLogger("server");
const startedAtMs = Date.now();

async function main(): Promise<void> {
  openDatabase();

  const settings = new SettingsRepo();
  const seedDefaults: AppConfig = {
    ...DEFAULT_CONFIG,
    postcode: env.defaultPostcode,
    radiusMiles: env.defaultRadiusMiles,
  };
  let config = settings.ensureSeeded(seedDefaults);

  const location = new LocationService();
  const ipLocation = new IpWhoIsProvider();
  const accounts = new AccountRepo();
  const googleAuth = new GoogleAuth();
  const operational = new OperationalIntelligenceService(
    env.aircraftProvider === "simulation"
      ? new SimulationOperationalProvider()
      : new AirframesOperationalProvider(
          env.airframesEnabled,
          env.airframesMode,
          env.airframesUrl,
          env.airframesApiKey,
        ),
  );

  // Resolve coordinates if we do not have them yet (FRD §84-85).
  if (config.latitude === 0 && config.longitude === 0) {
    const resolved = await location.resolveForStartup(config.postcode);
    if (resolved) {
      config = settings.save({
        ...config,
        postcode: resolved.postcode,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
      });
      log.info("startup coordinates resolved", {
        postcode: config.postcode,
        origin: resolved.origin,
      });
    } else {
      log.error("could not resolve coordinates; polling will not start", {
        postcode: config.postcode,
      });
    }
  }

  const haveCoordinates = config.latitude !== 0 || config.longitude !== 0;

  // Core services.
  const geo = new GeoService({
    latitude: config.latitude,
    longitude: config.longitude,
  });
  const routes = new RouteService();
  const photos = new PhotoService();
  const state = new AircraftStateService(geo, routes);
  const ws = new WebSocketService();
  const provider = createAircraftProvider(env.aircraftProvider);
  const viewService = new ViewService(location, settings, routes, provider);
  const alerts = new AlertService({
    topic: env.notifyNtfyTopic,
    server: env.notifyNtfyServer,
  });
  const history = new HistoryService();
  history.configure(config.historyEnabled, config.historyRetentionDays);
  history.pruneExpired();

  /**
   * Build the operational picture for one aircraft (§53, §102): the live route
   * decision (ADS-B + adsbdb) merged with operational evidence (OOOI / state /
   * ETA / diversion). Shared by the /flight-intelligence endpoint and the Sky
   * Insights Engine.
   */
  async function buildFlightIntelligence(aircraft: Aircraft): Promise<FlightIntelligence> {
    const dest = aircraft.destination;
    const airborne = aircraft.onGround !== true;
    const op = await operational.lookup({
      icaoHex: aircraft.icaoHex,
      callsign: aircraft.callsign,
      registration: aircraft.registration,
      airborne,
    });
    const sources = new Set<string>(op?.sources ?? []);
    for (const s of dest?.sources ?? []) sources.add(s);
    sources.add("ADS-B");
    return {
      available: op !== undefined,
      callsign: aircraft.callsign,
      airline: dest?.airline ?? op?.airline,
      origin: dest?.originName ?? op?.origin,
      destination: dest?.displayName ?? op?.destination,
      routeConfidence: dest?.confidence ?? op?.routeConfidenceHint ?? "unknown",
      flightState: deriveFlightState(op?.oooi ?? {}, airborne),
      oooi: op?.oooi ?? {},
      eta: op?.eta,
      possibleRouteChange: op?.possibleRouteChange,
      sources: [...sources],
    };
  }

  // Sky Insights Engine (FRD v3.8 §63): turns per-aircraft evidence into the
  // one prominent main-screen insight (§91) plus the drawer's evidence list.
  // Lifecycle deltas + route.updated are streamed to clients (§104); the full
  // snapshot is sent on connect (below) for state sync.
  const insights = new InsightsEngine(
    (aircraft) => buildFlightIntelligence(aircraft),
    (events) => {
      const timestamp = Date.now();
      for (const e of events) {
        switch (e.kind) {
          case "created":
            ws.broadcast({ type: "insight.created", insight: e.insight, timestamp });
            break;
          case "updated":
            ws.broadcast({ type: "insight.updated", insight: e.insight, timestamp });
            break;
          case "expired":
            ws.broadcast({
              type: "insight.expired",
              id: e.id,
              subjectId: e.subjectId,
              timestamp,
            });
            break;
          case "route-updated":
            ws.broadcast({
              type: "route.updated",
              aircraftId: e.aircraftId,
              previousDestination: e.previousDestination,
              newDestination: e.newDestination,
              confidence: e.confidence,
              timestamp,
            });
            break;
        }
      }
    },
  );

  // Satellite layer (FRD v3.2 §36-84) - independent of aircraft tracking.
  const satelliteConfigView = (): SatelliteConfigView => {
    const c = settings.get();
    return {
      showSatellites: c.showSatellites,
      minElevationDeg: c.satelliteMinElevationDeg,
      showStations: c.satelliteShowStations,
      showBright: c.satelliteShowBright,
      showStarlink: c.satelliteShowStarlink,
      latitude: c.latitude,
      longitude: c.longitude,
    };
  };
  // Persist last-good orbital elements next to the database so the satellite
  // layer survives a CelesTrak outage across restarts (FRD §77).
  const orbitalCache = new OrbitalElementCache(
    resolve(dirname(env.databasePath), "orbital-elements.json"),
  );
  // CelesTrak is primary; Space-Track (if credentials are configured) is an
  // independent backup so a single-source outage can't empty the sky (FRD §77).
  const spaceTrack = new SpaceTrackProvider(env.spaceTrackUser, env.spaceTrackPassword);
  const orbitalProvider = new FailoverOrbitalProvider(
    new CelesTrakProvider(),
    spaceTrack.configured ? spaceTrack : undefined,
  );
  if (spaceTrack.configured) log.info("Space-Track orbital backup enabled");
  const satellites = new SatelliteService(
    orbitalProvider,
    satelliteConfigView,
    (sats) => ws.broadcast({ type: "satellite.snapshot", timestamp: Date.now(), satellites: sats }),
    env.aircraftProvider === "simulation",
    orbitalCache,
  );
  const satellitePasses = new PassPredictionService(
    () => satellites.getElements(),
    satelliteConfigView,
    env.aircraftProvider === "simulation",
  );
  const satelliteAlerts = new SatelliteAlertService(
    () => {
      const c = settings.get();
      return {
        enabled: c.satelliteAlertsEnabled,
        leadMinutes: c.satelliteAlertLeadMinutes,
        visibleOnly: c.satelliteAlertVisibleOnly,
        showStations: c.satelliteShowStations,
        showBright: c.satelliteShowBright,
        showStarlink: c.satelliteShowStarlink,
      };
    },
    () => satellitePasses.getPasses().passes,
    { topic: env.notifyNtfyTopic, server: env.notifyNtfyServer },
    (pass, minutesUntil) =>
      ws.broadcast({ type: "satellite.alert", pass, minutesUntil, timestamp: Date.now() }),
  );

  const polling = new AircraftPollingService(provider, env.aircraftPollIntervalMs, {
    onResult: (raw, meta) => {
      const cfg = settings.get();
      const aircraft = state.update(
        raw,
        cfg.radiusMiles,
        provider.name,
        Date.now(),
        cfg.watchlist,
        cfg.lowAltitudeThresholdFeet,
        cfg.hideGroundAircraft,
      );
      ws.broadcast({
        type: "aircraft.snapshot",
        timestamp: Date.now(),
        aircraft,
      });
      // Interesting-aircraft entry alerts: in-app (WebSocket) + optional push.
      alerts.onSnapshot(aircraft, Date.now(), (entered) => {
        ws.broadcast({ type: "aircraft.interesting.enter", aircraft: entered });
      });
      // Record aircraft pass history (global location only, FRD §56).
      history.ingest(aircraft);
      // Update Sky Insights from the new snapshot (§63); broadcasts on change.
      void insights.onSnapshot(aircraft, Date.now()).catch((err: unknown) => {
        log.debug("insights update failed", { error: String(err) });
      });
      log.debug("poll processed", {
        received: meta.received,
        displayed: aircraft.length,
        durationMs: meta.durationMs,
      });
    },
    onStatusChange: (status) => {
      ws.broadcast({ type: "source.status", status });
      log.info("aircraft source status", { status });
    },
    onError: (message) => {
      ws.broadcast({ type: "error.status", message: "Live data temporarily unavailable" });
      log.debug("poll error surfaced", { message });
    },
  });

  polling.setCentre({
    latitude: config.latitude,
    longitude: config.longitude,
    radiusMiles: config.radiusMiles,
  });

  const diagnostics = new DiagnosticsService(
    settings,
    polling,
    state,
    routes,
    ws,
    location,
    alerts,
    history,
    startedAtMs,
  );

  // Send the current state to each newly connected client (FRD §45).
  ws.setHooks({
    onConnect: (): ServerMessage[] => {
      const messages: ServerMessage[] = [
        { type: "config.updated", config: settings.get() },
        { type: "aircraft.snapshot", timestamp: Date.now(), aircraft: state.snapshot() },
        { type: "satellite.snapshot", timestamp: Date.now(), satellites: satellites.getSnapshot() },
        { type: "insights.snapshot", timestamp: Date.now(), insights: insights.list() },
        { type: "source.status", status: polling.getStatus() },
      ];
      return messages;
    },
  });

  // Apply a validated configuration at runtime: move the centre, reset state,
  // (re)start polling and notify clients.
  function applyRuntimeConfig(next: AppConfig, centreChanged: boolean): void {
    geo.setCentre({ latitude: next.latitude, longitude: next.longitude });
    polling.setCentre({
      latitude: next.latitude,
      longitude: next.longitude,
      radiusMiles: next.radiusMiles,
    });
    if (centreChanged) state.clear();
    ws.broadcast({ type: "config.updated", config: next });
    if (next.latitude !== 0 || next.longitude !== 0) polling.start();
  }

  /** Set the observer to explicit coordinates from a detected/device/saved fix. */
  function applyObserverLocation(input: {
    latitude: number;
    longitude: number;
    source: LocationSource;
    displayName?: string;
    accuracyRadiusKm?: number;
  }): AppConfig {
    const accuracyKm =
      Number.isFinite(input.accuracyRadiusKm) && (input.accuracyRadiusKm as number) > 0
        ? input.accuracyRadiusKm
        : undefined;
    const name = input.displayName?.trim().slice(0, 120) || undefined;
    const saved = settings.save({
      ...settings.get(),
      latitude: input.latitude,
      longitude: input.longitude,
      postcode: name ?? "",
      locationSource: input.source,
      locationConfidence: classifyConfidence(input.source, accuracyKm),
      locationAccuracyRadiusKm: accuracyKm,
      locationName: name,
    });
    applyRuntimeConfig(saved, true);
    log.info("location applied", { source: input.source, confidence: saved.locationConfidence });
    return saved;
  }

  const apiContext: ApiContext = {
    getConfig: () => settings.get(),

    updateConfig: async (update: ConfigUpdate): Promise<UpdateOutcome> => {
      const current = settings.get();
      const next: AppConfig = { ...current };
      let centreChanged = false;

      if (typeof update.postcode === "string") {
        const normalised = location.normalise(update.postcode);
        if (normalised !== current.postcode) {
          let resolved;
          try {
            resolved = await location.validateAndResolve(normalised);
          } catch {
            return { ok: false, status: 502, error: "Postcode service unavailable" };
          }
          if (!resolved.valid) {
            return { ok: false, status: 400, error: "Postcode not recognised" };
          }
          next.postcode = resolved.postcode;
          next.latitude = resolved.latitude;
          next.longitude = resolved.longitude;
          // An explicit postcode is a "good" fix (FRD v3.6 §8).
          next.locationSource = "postcode";
          next.locationConfidence = "good";
          next.locationName = resolved.postcode;
          next.locationAccuracyRadiusKm = undefined;
          centreChanged = true;
        }
      }

      if (update.radiusMiles !== undefined) {
        const r = Number(update.radiusMiles);
        if (!Number.isFinite(r) || r <= 0 || r > 100) {
          return { ok: false, status: 400, error: "Radius must be between 0 and 100 miles" };
        }
        if (r !== current.radiusMiles) centreChanged = true;
        next.radiusMiles = r;
      }

      if (update.aircraftSource !== undefined) {
        if (!["internet", "local", "hybrid"].includes(update.aircraftSource)) {
          return { ok: false, status: 400, error: "Invalid aircraft source" };
        }
        next.aircraftSource = update.aircraftSource;
      }
      if (update.displayMode !== undefined) {
        if (!["minimal", "informative"].includes(update.displayMode)) {
          return { ok: false, status: 400, error: "Invalid display mode" };
        }
        next.displayMode = update.displayMode;
      }
      if (update.viewMode !== undefined) {
        if (!["true-sky", "ceiling", "screen", "map"].includes(update.viewMode)) {
          return { ok: false, status: 400, error: "Invalid view mode" };
        }
        next.viewMode = update.viewMode;
      }
      if (update.viewingDistance !== undefined) {
        if (!["close", "normal", "across-room"].includes(update.viewingDistance)) {
          return { ok: false, status: 400, error: "Invalid viewing distance" };
        }
        next.viewingDistance = update.viewingDistance;
      }
      if (update.displayScale !== undefined) {
        if (!["automatic", "compact", "standard", "large"].includes(update.displayScale)) {
          return { ok: false, status: 400, error: "Invalid display scale" };
        }
        next.displayScale = update.displayScale;
      }

      const booleanKeys = [
        "showRegistration",
        "showDestination",
        "showFlightNumber",
        "showAltitude",
        "showDistance",
        "showCentreMarker",
        "showRangeRing",
        "showHeader",
        "showTrails",
        "showDestinationArcs",
        "interpolationEnabled",
        "highlightInteresting",
        "hideGroundAircraft",
        "historyEnabled",
        "inAppAlerts",
        "browserNotifications",
        "showSkyInsights",
        "showSatellites",
        "satelliteShowStations",
        "satelliteShowBright",
        "satelliteShowStarlink",
        "satelliteAlertsEnabled",
        "satelliteAlertVisibleOnly",
      ] as const;
      for (const key of booleanKeys) {
        if (update[key] !== undefined) next[key] = Boolean(update[key]);
      }

      if (update.watchlist !== undefined) {
        if (typeof update.watchlist !== "string" || update.watchlist.length > 500) {
          return { ok: false, status: 400, error: "Watchlist must be a string under 500 characters" };
        }
        next.watchlist = update.watchlist;
      }

      if (update.lowAltitudeThresholdFeet !== undefined) {
        const ft = Number(update.lowAltitudeThresholdFeet);
        if (!Number.isFinite(ft) || ft < 100 || ft > 60000) {
          return { ok: false, status: 400, error: "Low-altitude threshold must be 100-60000 ft" };
        }
        next.lowAltitudeThresholdFeet = Math.round(ft);
      }

      if (update.historyRetentionDays !== undefined) {
        const days = Number(update.historyRetentionDays);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
          return { ok: false, status: 400, error: "History retention must be 1-365 days" };
        }
        next.historyRetentionDays = Math.round(days);
      }

      if (update.satelliteMinElevationDeg !== undefined) {
        const deg = Number(update.satelliteMinElevationDeg);
        if (!Number.isFinite(deg) || deg < 0 || deg > 89) {
          return { ok: false, status: 400, error: "Satellite minimum elevation must be 0-89°" };
        }
        next.satelliteMinElevationDeg = Math.round(deg);
      }

      if (update.satelliteAlertLeadMinutes !== undefined) {
        const min = Number(update.satelliteAlertLeadMinutes);
        if (!Number.isFinite(min) || min < 1 || min > 120) {
          return { ok: false, status: 400, error: "Alert lead time must be 1-120 minutes" };
        }
        next.satelliteAlertLeadMinutes = Math.round(min);
      }

      const saved = settings.save(next);
      applyRuntimeConfig(saved, centreChanged);
      history.configure(saved.historyEnabled, saved.historyRetentionDays);
      history.pruneExpired();
      log.info("configuration updated", { postcode: saved.postcode, radiusMiles: saved.radiusMiles });
      return { ok: true, status: 200, config: saved };
    },

    resetConfig: async (): Promise<AppConfig> => {
      const resolved = await location
        .validateAndResolve(env.defaultPostcode)
        .catch(() => location.getCached(env.defaultPostcode));
      const base: AppConfig = {
        ...DEFAULT_CONFIG,
        postcode: env.defaultPostcode,
        radiusMiles: env.defaultRadiusMiles,
      };
      if (resolved && resolved.valid) {
        base.latitude = resolved.latitude;
        base.longitude = resolved.longitude;
      }
      const saved = settings.save(base);
      applyRuntimeConfig(saved, true);
      history.configure(saved.historyEnabled, saved.historyRetentionDays);
      log.info("configuration reset to defaults", { postcode: saved.postcode });
      return saved;
    },

    validateLocation: async (postcode: string): Promise<ValidateResult> => {
      const resolved = await location.validateAndResolve(postcode);
      return {
        valid: resolved.valid,
        postcode: resolved.postcode,
        latitude: resolved.latitude,
        longitude: resolved.longitude,
      };
    },

    detectLocation: async (headers): Promise<DetectedLocation> => {
      // Prefer Cloudflare edge headers if present; else server-side IP lookup.
      const edge = cloudflareLocation(headers);
      if (edge) return edge;
      const detected = await ipLocation.lookup(clientIp(headers));
      return (
        detected ?? {
          latitude: 0,
          longitude: 0,
          source: "ip",
          confidence: "unknown",
          detectedAt: new Date().toISOString(),
        }
      );
    },

    applyLocation: async (input): Promise<UpdateOutcome> => {
      const lat = Number(input.latitude);
      const lon = Number(input.longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        return { ok: false, status: 400, error: "Invalid latitude" };
      }
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
        return { ok: false, status: 400, error: "Invalid longitude" };
      }
      const source: LocationSource =
        input.source === "device" ? "device" : input.source === "manual" ? "manual" : "ip";
      const accuracyKm =
        Number.isFinite(Number(input.accuracyRadiusKm)) && Number(input.accuracyRadiusKm) > 0
          ? Number(input.accuracyRadiusKm)
          : undefined;
      const name = typeof input.displayName === "string" ? input.displayName : undefined;
      const saved = applyObserverLocation({
        latitude: lat,
        longitude: lon,
        source,
        displayName: name,
        accuracyRadiusKm: accuracyKm,
      });
      return { ok: true, status: 200, config: saved };
    },

    snapshot: (): { generatedAt: string; aircraft: Aircraft[] } => ({
      generatedAt: new Date().toISOString(),
      aircraft: state.snapshot(),
    }),

    health: () => diagnostics.health(),
    diagnostics: () => diagnostics.report(),
    photo: (registration, icaoHex) => photos.getPhoto(registration, icaoHex),
    aircraftDetail: async (icaoHex) => {
      const aircraft = state.snapshot().find((a) => a.icaoHex === icaoHex) ?? null;
      const meta = await routes.getAircraftMeta(icaoHex);
      return { aircraft, meta };
    },
    flightIntelligence: async (icaoHex): Promise<FlightIntelligence> => {
      const aircraft = state.snapshot().find((a) => a.icaoHex === icaoHex);
      // Degrade cleanly when the aircraft is no longer tracked (§108).
      if (!aircraft) {
        return {
          available: false,
          routeConfidence: "unknown",
          flightState: "unknown",
          oooi: {},
          sources: [],
        };
      }
      return buildFlightIntelligence(aircraft);
    },
    insights: () => ({
      generatedAt: new Date().toISOString(),
      insights: insights.list(),
    }),
    aircraftInsights: (icaoHex) => insights.forAircraft(icaoHex),
    view: (postcode) => viewService.getView(postcode),

    history: (date) => {
      const day = date ?? history.todayDate();
      return { date: day, passes: history.listByDate(day) };
    },
    historyDates: () => history.listDates(),
    deleteHistory: (date) => ({ deleted: history.deleteByDate(date) }),

    satellites: () => ({
      generatedAt: new Date().toISOString(),
      satellites: satellites.getSnapshot(),
    }),
    satellite: (catalogNumber) => satellites.getSatellite(catalogNumber) ?? null,
    satelliteDetail: (catalogNumber) => {
      const element = satellites.getElement(catalogNumber);
      return {
        satellite: satellites.getSatellite(catalogNumber) ?? null,
        orbit: element ? orbitFrom(element, new Date()) : undefined,
        nextPass: satellitePasses.nextPassFor(catalogNumber),
      };
    },
    orbitalStatus: () => satellites.diagnostics(),
    satellitePasses: () => satellitePasses.getPasses(),
  };

  // HTTP application.
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());
  app.use(hostGuard);
  // Health check stays public so platform probes (e.g. Railway) work even when
  // Basic Auth is enabled.
  app.get("/api/health", (_req: Request, res: Response) => {
    res.json(apiContext.health());
  });
  // Viewing the display is always open; individual config/diagnostics routes
  // enforce Basic Auth themselves when SITE_PASSWORD is set (FRD §79).
  if (isAuthEnabled()) {
    log.info("config/diagnostics password protection enabled (viewing is open)");
  }
  // Google Sign-In + account saved-locations (optional; FRD v3.6 §12, §26).
  app.use(
    "/api",
    createAuthRouter({
      google: googleAuth,
      accounts,
      applyLocation: async (input) =>
        applyObserverLocation({ ...input, source: "manual" }),
    }),
  );
  if (googleAuth.configured) log.info("Google Sign-In enabled");
  app.use("/api", createApiRouter(apiContext));
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // Serve the built frontend in production (FRD §26).
  const here = dirname(fileURLToPath(import.meta.url));
  const webDist = resolve(here, "../../web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(resolve(webDist, "index.html"));
    });
    log.info("serving frontend", { webDist });
  } else {
    log.info("frontend build not found; run the Vite dev server for the UI", { webDist });
  }

  const server = createServer(app);
  ws.attach(server);

  server.listen(env.httpPort, () => {
    log.info("http server listening", { port: env.httpPort, url: `http://localhost:${env.httpPort}` });
    if (haveCoordinates) {
      polling.start();
      void satellites.start(); // FRD §36 - independent of aircraft; never blocks
      satellitePasses.start();
      satelliteAlerts.start();
    } else {
      log.warn("aircraft polling not started - settings screen available for diagnosis (FRD §85)");
    }
  });

  // Debounced history persistence + periodic retention pruning (FRD §62, §78).
  const historyFlushTimer = setInterval(() => history.flush(), 15_000);
  const historyPruneTimer = setInterval(() => history.pruneExpired(), 60 * 60 * 1000);
  historyFlushTimer.unref();
  historyPruneTimer.unref();

  const shutdown = (signal: string): void => {
    log.info("shutting down", { signal });
    clearInterval(historyFlushTimer);
    clearInterval(historyPruneTimer);
    history.flush();
    satellites.stop();
    satellitePasses.stop();
    satelliteAlerts.stop();
    polling.stop();
    ws.close();
    server.close();
    closeDatabase();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

/** Restrict unexpected Host values for LAN deployments (FRD §80). */
function hostGuard(req: Request, res: Response, next: NextFunction): void {
  if (env.allowedHosts.length === 0) {
    next();
    return;
  }
  const host = (req.headers.host ?? "").toLowerCase();
  if (env.allowedHosts.includes(host)) {
    next();
    return;
  }
  res.status(403).json({ error: "Host not allowed" });
}

main().catch((err: unknown) => {
  log.error("fatal startup error", { error: String(err) });
  process.exit(1);
});
