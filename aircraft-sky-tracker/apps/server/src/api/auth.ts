/**
 * Optional HTTP Basic Auth (FRD §79).
 *
 * Enabled only when SITE_PASSWORD is set - intended for internet-facing
 * deployments (e.g. Railway). When unset, the app is open (LAN/kiosk default).
 * A single credential gates the whole app, including the WebSocket upgrade;
 * browsers replay stored Basic credentials on same-origin WebSocket handshakes.
 */

import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { env } from "../config/env.js";

export function isAuthEnabled(): boolean {
  return typeof env.sitePassword === "string" && env.sitePassword.length > 0;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Validate an Authorization header against the configured credential. */
export function checkBasicAuth(header: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  if (sep === -1) return false;
  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);
  return safeEqual(user, env.siteUsername) && safeEqual(pass, env.sitePassword ?? "");
}

export function authorized(headers: IncomingHttpHeaders): boolean {
  return checkBasicAuth(headers.authorization);
}

/** Express middleware enforcing Basic Auth when enabled. */
export function basicAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (checkBasicAuth(req.headers.authorization)) {
    next();
    return;
  }
  res
    .status(401)
    .set("WWW-Authenticate", 'Basic realm="Local Aircraft Sky Tracker"')
    .json({ error: "Authentication required" });
}
