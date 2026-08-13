/**
 * Internal REST API (FRD §39-43). The browser talks only to this backend
 * (FRD §39); no third-party host is ever contacted from the client.
 */

import { Router, type Request, type Response } from "express";
import type { AppConfig, ConfigUpdate, Aircraft } from "@ast/shared";
import type { HealthReport, DiagnosticsReport } from "../diagnostics/diagnosticsService.js";

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

/** Everything the HTTP layer needs from the application core. */
export interface ApiContext {
  getConfig(): AppConfig;
  updateConfig(update: ConfigUpdate): Promise<UpdateOutcome>;
  resetConfig(): Promise<AppConfig>;
  validateLocation(postcode: string): Promise<ValidateResult>;
  snapshot(): { generatedAt: string; aircraft: Aircraft[] };
  health(): HealthReport;
  diagnostics(): DiagnosticsReport;
}

export function createApiRouter(ctx: ApiContext): Router {
  const router = Router();

  // GET /api/config - current configuration.
  router.get("/config", (_req: Request, res: Response) => {
    res.json(ctx.getConfig());
  });

  // PUT /api/config - update configuration.
  router.put("/config", async (req: Request, res: Response) => {
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
  router.post("/config/reset", async (_req: Request, res: Response) => {
    const config = await ctx.resetConfig();
    res.json(config);
  });

  // POST /api/location/validate - validate a UK postcode and resolve coords.
  router.post("/location/validate", async (req: Request, res: Response) => {
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

  // GET /api/aircraft - current snapshot (diagnostics/development, FRD §41).
  router.get("/aircraft", (_req: Request, res: Response) => {
    res.json(ctx.snapshot());
  });

  // GET /api/health (FRD §42).
  router.get("/health", (_req: Request, res: Response) => {
    res.json(ctx.health());
  });

  // GET /api/diagnostics (FRD §43).
  router.get("/diagnostics", (_req: Request, res: Response) => {
    res.json(ctx.diagnostics());
  });

  return router;
}
