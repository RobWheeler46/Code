/**
 * Internal REST API (FRD §39-43). The browser talks only to this backend
 * (FRD §39); no third-party host is ever contacted from the client.
 */

import { Router, type Request, type Response } from "express";
import type { AppConfig, ConfigUpdate, Aircraft } from "@ast/shared";
import type { HealthReport, DiagnosticsReport } from "../diagnostics/diagnosticsService.js";
import type { PhotoResult } from "../routes/photoService.js";
import type { ViewResult } from "../aircraft/viewService.js";
import type {
  HistoryPass,
  HistoryDate,
  AircraftMeta,
  Satellite,
  SatellitePass,
  SatelliteDetail,
  DetectedLocation,
  FlightIntelligence,
} from "@ast/shared";
import { basicAuthMiddleware, isAuthEnabled } from "./auth.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ValidateResult {
  valid: boolean;
  postcode: string;
  latitude: number;
  longitude: number;
}

export interface UpdateOutcome {
  ok: boolean;
  status: number;
  config?: AppConfig;
  error?: string;
}

/** Body for POST /api/location/apply (FRD v3.6). */
export interface LocationApplyInput {
  latitude?: unknown;
  longitude?: unknown;
  source?: unknown;
  displayName?: unknown;
  accuracyRadiusKm?: unknown;
}

/** Everything the HTTP layer needs from the application core. */
export interface ApiContext {
  getConfig(): AppConfig;
  updateConfig(update: ConfigUpdate): Promise<UpdateOutcome>;
  resetConfig(): Promise<AppConfig>;
  validateLocation(postcode: string): Promise<ValidateResult>;
  detectLocation(headers: import("node:http").IncomingHttpHeaders): Promise<DetectedLocation>;
  applyLocation(input: LocationApplyInput): Promise<UpdateOutcome>;
  snapshot(): { generatedAt: string; aircraft: Aircraft[] };
  health(): HealthReport;
  diagnostics(): DiagnosticsReport;
  photo(registration?: string, icaoHex?: string): Promise<PhotoResult>;
  aircraftDetail(icaoHex: string): Promise<{ aircraft: Aircraft | null; meta: AircraftMeta }>;
  flightIntelligence(icaoHex: string): Promise<FlightIntelligence>;
  view(postcode: string): Promise<ViewResult>;
  history(date?: string): { date: string; passes: HistoryPass[] };
  historyDates(): HistoryDate[];
  deleteHistory(date: string): { deleted: number };
  satellites(): { generatedAt: string; satellites: Satellite[] };
  satellite(catalogNumber: string): Satellite | null;
  satelliteDetail(catalogNumber: string): SatelliteDetail;
  orbitalStatus(): unknown;
  satellitePasses(): { generatedAt: string; windowHours: number; passes: SatellitePass[] };
}

export function createApiRouter(ctx: ApiContext): Router {
  const router = Router();

  // --- Public (view) endpoints: no authentication required ---

  // GET /api/auth/status - tells the client whether config changes need a
  // password, so it can show an unlock prompt only when necessary.
  router.get("/auth/status", (_req: Request, res: Response) => {
    res.json({ authRequired: isAuthEnabled() });
  });

  // GET /api/auth/check - protected; used by the client to verify a password.
  router.get("/auth/check", basicAuthMiddleware, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // GET /api/config - current configuration (needed to render the display).
  router.get("/config", (_req: Request, res: Response) => {
    res.json(ctx.getConfig());
  });

  // GET /api/view?postcode= - per-viewer location override (read-only, public).
  // Returns an aircraft snapshot + effective config for an arbitrary postcode
  // without changing the shared configuration or other viewers.
  router.get("/view", async (req: Request, res: Response) => {
    const postcode = typeof req.query.postcode === "string" ? req.query.postcode : "";
    if (postcode.trim().length === 0) {
      res.status(400).json({ error: "postcode query parameter required" });
      return;
    }
    try {
      res.json(await ctx.view(postcode));
    } catch (err) {
      res.status(502).json({ error: `View unavailable: ${String(err)}` });
    }
  });

  // --- Protected endpoints: viewing is open, changing config requires auth ---

  // PUT /api/config - update configuration.
  router.put("/config", basicAuthMiddleware, async (req: Request, res: Response) => {
    const update = req.body as ConfigUpdate;
    if (typeof update !== "object" || update === null) {
      res.status(400).json({ error: "Invalid configuration payload" });
      return;
    }
    const outcome = await ctx.updateConfig(update);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error ?? "Update failed" });
      return;
    }
    res.json(outcome.config);
  });

  // POST /api/config/reset - restore defaults.
  router.post("/config/reset", basicAuthMiddleware, async (_req: Request, res: Response) => {
    const config = await ctx.resetConfig();
    res.json(config);
  });

  // POST /api/location/validate - validate a UK postcode and resolve coords.
  router.post("/location/validate", basicAuthMiddleware, async (req: Request, res: Response) => {
    const postcode = (req.body as { postcode?: unknown })?.postcode;
    if (typeof postcode !== "string" || postcode.trim().length === 0) {
      res.status(400).json({ error: "postcode is required" });
      return;
    }
    try {
      const result = await ctx.validateLocation(postcode);
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: `Postcode service unavailable: ${String(err)}` });
    }
  });

  // GET /api/location/detect - approximate location from the caller's IP.
  // Public and read-only: it only suggests, and never stores the raw IP (§20).
  router.get("/location/detect", async (req: Request, res: Response) => {
    res.json(await ctx.detectLocation(req.headers));
  });

  // POST /api/location/apply - set the observer location from a detected/device
  // fix (explicit coordinates + source). Config change -> requires auth (§79).
  router.post("/location/apply", basicAuthMiddleware, async (req: Request, res: Response) => {
    const outcome = await ctx.applyLocation((req.body ?? {}) as LocationApplyInput);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    res.json(outcome.config);
  });

  // GET /api/aircraft - current snapshot (diagnostics/development, FRD §41).
  router.get("/aircraft", (_req: Request, res: Response) => {
    res.json(ctx.snapshot());
  });

  // GET /api/aircraft/photo?reg=&hex= - aircraft photo for the detail overlay.
  // Public: part of the open display. Proxies planespotters (FRD §79).
  router.get("/aircraft/photo", async (req: Request, res: Response) => {
    const reg = typeof req.query.reg === "string" ? req.query.reg : undefined;
    const hex = typeof req.query.hex === "string" ? req.query.hex : undefined;
    if (!reg && !hex) {
      res.status(400).json({ error: "reg or hex query parameter required" });
      return;
    }
    try {
      res.json(await ctx.photo(reg, hex));
    } catch {
      res.json({});
    }
  });

  // GET /api/aircraft/:icaoHex - detail (live aircraft + registry metadata,
  // FRD §45, §72). Public: part of the open display's detail drawer.
  router.get("/aircraft/:icaoHex", async (req: Request, res: Response) => {
    const hex = req.params.icaoHex ?? "";
    if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[A-Za-z0-9]{3,8}$/.test(hex)) {
      res.status(400).json({ error: "invalid icaoHex" });
      return;
    }
    try {
      res.json(await ctx.aircraftDetail(hex.toUpperCase()));
    } catch (err) {
      res.status(502).json({ error: `Aircraft detail unavailable: ${String(err)}` });
    }
  });

  // GET /api/aircraft/:icaoHex/flight-intelligence - operational flight data (§102).
  router.get("/aircraft/:icaoHex/flight-intelligence", async (req: Request, res: Response) => {
    const hex = req.params.icaoHex ?? "";
    if (!/^[0-9A-Fa-f]{6}$/.test(hex) && !/^[A-Za-z0-9]{3,8}$/.test(hex)) {
      res.status(400).json({ error: "invalid icaoHex" });
      return;
    }
    try {
      res.json(await ctx.flightIntelligence(hex.toUpperCase()));
    } catch (err) {
      res.status(502).json({ error: `Flight intelligence unavailable: ${String(err)}` });
    }
  });

  // GET /api/health (FRD §42).
  router.get("/health", (_req: Request, res: Response) => {
    res.json(ctx.health());
  });

  // GET /api/diagnostics (FRD §43) - protected (may reveal configuration).
  router.get("/diagnostics", basicAuthMiddleware, (_req: Request, res: Response) => {
    res.json(ctx.diagnostics());
  });

  // --- Aircraft history (FRD v3.0 §56-63, §72) ---

  // GET /api/history/dates - retained dates for the date selector (public).
  router.get("/history/dates", (_req: Request, res: Response) => {
    res.json(ctx.historyDates());
  });

  // GET /api/history?date=YYYY-MM-DD - passes for a date (default today, public).
  router.get("/history", (req: Request, res: Response) => {
    const date = typeof req.query.date === "string" ? req.query.date : undefined;
    if (date !== undefined && !DATE_RE.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    res.json(ctx.history(date));
  });

  // --- Satellites (FRD v3.2 §81). Public: part of the open sky display. ---

  // GET /api/satellites - current satellite snapshot.
  router.get("/satellites", (_req: Request, res: Response) => {
    res.json(ctx.satellites());
  });

  // GET /api/orbital-status - orbital-data source + counts (FRD §76).
  router.get("/orbital-status", (_req: Request, res: Response) => {
    res.json(ctx.orbitalStatus());
  });

  // GET /api/satellite-passes - upcoming overhead passes (FRD §59-60).
  router.get("/satellite-passes", (_req: Request, res: Response) => {
    res.json(ctx.satellitePasses());
  });

  // GET /api/satellites/:catalogNumber/detail - live state + orbit + next pass.
  router.get("/satellites/:catalogNumber/detail", (req: Request, res: Response) => {
    res.json(ctx.satelliteDetail(req.params.catalogNumber ?? ""));
  });

  // GET /api/satellites/:catalogNumber - one satellite's current detail.
  router.get("/satellites/:catalogNumber", (req: Request, res: Response) => {
    const sat = ctx.satellite(req.params.catalogNumber ?? "");
    if (!sat) {
      res.status(404).json({ error: "satellite not currently visible" });
      return;
    }
    res.json(sat);
  });

  // DELETE /api/history/:date - clear a date (destructive -> requires auth).
  router.delete("/history/:date", basicAuthMiddleware, (req: Request, res: Response) => {
    const date = req.params.date ?? "";
    if (!DATE_RE.test(date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    res.json(ctx.deleteHistory(date));
  });

  return router;
}
