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
import { AircraftStateService } from "./aircraft/stateService.js";
import { AircraftPollingService } from "./aircraft/pollingService.js";
import { WebSocketService } from "./websocket/wsService.js";
import { DiagnosticsService } from "./diagnostics/diagnosticsService.js";
import { createAircraftProvider } from "./providers/index.js";
import {
  createApiRouter,
  type ApiContext,
  type UpdateOutcome,
  type ValidateResult,
} from "./api/router.js";
import { basicAuthMiddleware, isAuthEnabled } from "./api/auth.js";

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
  const state = new AircraftStateService(geo, routes);
  const ws = new WebSocketService();
  let provider = createAircraftProvider(env.aircraftProvider);

  const polling = new AircraftPollingService(provider, env.aircraftPollIntervalMs, {
    onResult: (raw, meta) => {
      const cfg = settings.get();
      const aircraft = state.update(raw, cfg.radiusMiles, provider.name);
      ws.broadcast({
        type: "aircraft.snapshot",
        timestamp: Date.now(),
        aircraft,
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
    startedAtMs,
  );

  // Send the current state to each newly connected client (FRD §45).
  ws.setHooks({
    onConnect: (): ServerMessage[] => {
      const messages: ServerMessage[] = [
        { type: "config.updated", config: settings.get() },
        { type: "aircraft.snapshot", timestamp: Date.now(), aircraft: state.snapshot() },
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
        "interpolationEnabled",
      ] as const;
      for (const key of booleanKeys) {
        if (update[key] !== undefined) next[key] = Boolean(update[key]);
      }

      const saved = settings.save(next);
      applyRuntimeConfig(saved, centreChanged);
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

    snapshot: (): { generatedAt: string; aircraft: Aircraft[] } => ({
      generatedAt: new Date().toISOString(),
      aircraft: state.snapshot(),
    }),

    health: () => diagnostics.health(),
    diagnostics: () => diagnostics.report(),
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
  // Optional Basic Auth for internet-facing deployments (FRD §79).
  if (isAuthEnabled()) {
    app.use(basicAuthMiddleware);
    log.info("HTTP Basic Auth enabled (health check remains public)");
  }
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
    } else {
      log.warn("aircraft polling not started - settings screen available for diagnosis (FRD §85)");
    }
  });

  const shutdown = (signal: string): void => {
    log.info("shutting down", { signal });
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
