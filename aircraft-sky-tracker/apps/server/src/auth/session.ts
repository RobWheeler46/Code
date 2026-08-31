/**
 * Stateless signed session cookies for Google Sign-In (FRD v3.6 §12). A cookie
 * holds {uid, exp} signed with HMAC-SHA256 so no server-side session store is
 * needed. HttpOnly + SameSite=Lax; Secure in production. No third-party JWT
 * dependency (pure node:crypto).
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.js";

export const SESSION_COOKIE = "ast_session";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// A stable secret survives restarts (sessions persist); fall back to a per-boot
// random secret if none is configured (sessions then reset on restart).
const SECRET = env.sessionSecret || env.sitePassword || randomBytes(32).toString("hex");

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(payload: string): string {
  return base64url(createHmac("sha256", SECRET).update(payload).digest());
}

/** Build a signed session token for a user id. */
export function createSessionToken(userId: string, now: number = Date.now()): string {
  const payload = base64url(Buffer.from(JSON.stringify({ uid: userId, exp: now + MAX_AGE_MS })));
  return `${payload}.${sign(payload)}`;
}

/** Verify a session token and return the user id, or undefined if invalid. */
export function verifySessionToken(token: string | undefined, now: number = Date.now()): string | undefined {
  if (!token) return undefined;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return undefined;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return undefined;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      uid?: unknown;
      exp?: unknown;
    };
    if (typeof data.uid !== "string" || typeof data.exp !== "number") return undefined;
    if (data.exp < now) return undefined;
    return data.uid;
  } catch {
    return undefined;
  }
}

/** Read a cookie value from the request Cookie header (no cookie-parser dep). */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** The signed-in user id for a request, if the session cookie is valid. */
export function sessionUserId(req: Request): string | undefined {
  return verifySessionToken(readCookie(req, SESSION_COOKIE));
}

export function setSessionCookie(res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (env.isProduction) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=0"];
  if (env.isProduction) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}
