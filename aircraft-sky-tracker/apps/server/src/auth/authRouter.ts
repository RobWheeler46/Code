/**
 * Google Sign-In + account saved-locations routes (FRD v3.6 §12, §26-27).
 * Mounted under /api. Sign-in is optional (disabled unless Google credentials are
 * configured). Saved-location CRUD is gated by the user's session; applying a
 * location to the shared observer additionally needs the site password, since it
 * changes what everyone viewing the display sees.
 */

import { randomBytes } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import type { AppConfig, SavedLocation } from "@ast/shared";
import type { GoogleAuth } from "./googleAuth.js";
import type { AccountRepo } from "../persistence/accountRepo.js";
import {
  sessionUserId,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  readCookie,
} from "./session.js";
import { basicAuthMiddleware } from "../api/auth.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("auth.router");
const OAUTH_STATE_COOKIE = "ast_oauth_state";

export interface AuthRouterDeps {
  google: GoogleAuth;
  accounts: AccountRepo;
  /** Apply a chosen location to the shared observer config. */
  applyLocation: (input: {
    latitude: number;
    longitude: number;
    displayName?: string;
    accuracyRadiusKm?: number;
  }) => Promise<AppConfig>;
}

function redirectUri(req: Request): string {
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string) ?? req.headers.host ?? "";
  return `${proto}://${host}/api/auth/google/callback`;
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { google, accounts } = deps;

  // Require a signed-in user for account routes.
  const requireUser = (req: Request, res: Response, next: NextFunction): void => {
    const uid = sessionUserId(req);
    if (!uid) {
      res.status(401).json({ error: "Not signed in" });
      return;
    }
    (req as Request & { userId: string }).userId = uid;
    next();
  };

  router.get("/auth/config", (_req: Request, res: Response) => {
    res.json({ googleEnabled: google.configured });
  });

  router.get("/auth/me", (req: Request, res: Response) => {
    const uid = sessionUserId(req);
    const user = uid ? accounts.getUser(uid) : undefined;
    res.json({ user: user ?? null });
  });

  // Start the OAuth flow: set a state cookie and redirect to Google.
  router.get("/auth/google", (req: Request, res: Response) => {
    if (!google.configured) {
      res.status(404).json({ error: "Google Sign-In is not configured" });
      return;
    }
    const state = randomBytes(16).toString("hex");
    const secure = process.env["NODE_ENV"] === "production" ? "; Secure" : "";
    res.append(
      "Set-Cookie",
      `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`,
    );
    res.redirect(google.authUrl(redirectUri(req), state));
  });

  // OAuth callback: verify state, exchange the code, start a session.
  router.get("/auth/google/callback", async (req: Request, res: Response) => {
    if (!google.configured) {
      res.status(404).send("Google Sign-In is not configured");
      return;
    }
    const code = typeof req.query.code === "string" ? req.query.code : undefined;
    const state = typeof req.query.state === "string" ? req.query.state : undefined;
    const expected = readCookie(req, OAUTH_STATE_COOKIE);
    // Clear the state cookie regardless of outcome.
    res.append("Set-Cookie", `${OAUTH_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    if (!code || !state || !expected || state !== expected) {
      res.status(400).send("Sign-in failed: invalid state. Please try again.");
      return;
    }
    try {
      const profile = await google.exchangeCode(code, redirectUri(req));
      accounts.upsertUser(profile);
      setSessionCookie(res, createSessionToken(profile.id));
      log.info("user signed in", { hasEmail: Boolean(profile.email) });
      res.redirect("/");
    } catch (err) {
      log.warn("sign-in failed", { error: String(err) });
      res.status(502).send("Sign-in failed. Please try again.");
    }
  });

  router.post("/auth/logout", (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // --- Saved locations (per signed-in user) ---
  router.get("/account/locations", requireUser, (req: Request, res: Response) => {
    res.json({ locations: accounts.listLocations((req as Request & { userId: string }).userId) });
  });

  router.post("/account/locations", requireUser, (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 60) : "";
    const lat = Number(body.latitude);
    const lon = Number(body.longitude);
    if (!label) {
      res.status(400).json({ error: "A label is required" });
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
      res.status(400).json({ error: "Invalid coordinates" });
      return;
    }
    const accuracyRadiusKm = Number.isFinite(Number(body.accuracyRadiusKm))
      ? Number(body.accuracyRadiusKm)
      : undefined;
    const saved = accounts.addLocation(userId, {
      label,
      latitude: lat,
      longitude: lon,
      isHome: Boolean(body.isHome),
      accuracyRadiusKm,
    });
    res.status(201).json(saved);
  });

  router.delete("/account/locations/:id", requireUser, (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const ok = accounts.deleteLocation(userId, req.params.id ?? "");
    res.status(ok ? 200 : 404).json({ deleted: ok });
  });

  router.post("/account/locations/:id/home", requireUser, (req: Request, res: Response) => {
    const userId = (req as Request & { userId: string }).userId;
    const ok = accounts.setHome(userId, req.params.id ?? "");
    res.status(ok ? 200 : 404).json({ ok });
  });

  // Apply a saved location to the shared observer (needs session + site password).
  router.post(
    "/account/locations/:id/use",
    requireUser,
    basicAuthMiddleware,
    async (req: Request, res: Response) => {
      const userId = (req as Request & { userId: string }).userId;
      const loc: SavedLocation | undefined = accounts.getLocation(userId, req.params.id ?? "");
      if (!loc) {
        res.status(404).json({ error: "Saved location not found" });
        return;
      }
      const config = await deps.applyLocation({
        latitude: loc.latitude,
        longitude: loc.longitude,
        displayName: loc.label,
        accuracyRadiusKm: loc.accuracyRadiusKm,
      });
      res.json(config);
    },
  );

  return router;
}
