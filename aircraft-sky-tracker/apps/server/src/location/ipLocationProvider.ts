/**
 * IP geolocation for Automatic Location Discovery (FRD v3.6 §18-20). Provider-
 * independent: the app is hosted on Railway (no Cloudflare), so this queries a
 * free, key-free IP-geolocation service server-side using the client's IP. Where
 * the app is fronted by Cloudflare, the edge visitor-location headers are used
 * instead (§18-19). The raw IP is only used for the lookup and is never stored
 * (§20); only the derived approximate location is kept.
 */

import type { IncomingHttpHeaders } from "node:http";
import { classifyConfidence, type DetectedLocation } from "@ast/shared";
import { createLogger } from "../logging/logger.js";

const log = createLogger("location.ip");
const REQUEST_TIMEOUT_MS = 6000;
// City-level fixes are treated as ~25 km; region/country-only as ~120 km (§5, §8).
const CITY_RADIUS_KM = 25;
const REGION_RADIUS_KM = 120;

export interface IpLocationProvider {
  readonly name: string;
  lookup(ip: string | undefined): Promise<DetectedLocation | undefined>;
}

/** Extract the client IP from proxy headers (Railway sets X-Forwarded-For). */
export function clientIp(headers: IncomingHttpHeaders): string | undefined {
  const cf = headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.length > 0) return cf;
  const fwd = headers["x-forwarded-for"];
  const raw = Array.isArray(fwd) ? fwd[0] : fwd;
  const first = raw?.split(",")[0]?.trim();
  if (first && isPublicIp(first)) return first;
  const real = headers["x-real-ip"];
  const realStr = Array.isArray(real) ? real[0] : real;
  return realStr && isPublicIp(realStr) ? realStr : undefined;
}

/** Cloudflare edge visitor-location headers, if present (§18). */
export function cloudflareLocation(headers: IncomingHttpHeaders): DetectedLocation | undefined {
  const lat = num(headers["cf-iplatitude"]);
  const lon = num(headers["cf-iplongitude"]);
  if (lat === undefined || lon === undefined) return undefined;
  const city = str(headers["cf-ipcity"]);
  const region = str(headers["cf-region"]);
  return {
    latitude: lat,
    longitude: lon,
    source: "ip",
    confidence: classifyConfidence("ip", CITY_RADIUS_KM),
    accuracyRadiusKm: CITY_RADIUS_KM,
    displayName: joinPlace(city, region),
    detectedAt: new Date().toISOString(),
  };
}

/** Free, key-free IP geolocation via ipwho.is (§18, provider-independent). */
export class IpWhoIsProvider implements IpLocationProvider {
  readonly name = "ipwho.is";

  async lookup(ip: string | undefined): Promise<DetectedLocation | undefined> {
    // Omitting the IP geolocates the caller (useful in local dev where the
    // forwarded IP is private); in production the client IP is passed.
    const url = `https://ipwho.is/${ip ? encodeURIComponent(ip) : ""}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as Record<string, unknown>;
      if (body["success"] === false) throw new Error(String(body["message"] ?? "lookup failed"));
      const lat = num(body["latitude"]);
      const lon = num(body["longitude"]);
      if (lat === undefined || lon === undefined) return undefined;
      const city = str(body["city"]);
      const region = str(body["region"]);
      const radiusKm = city ? CITY_RADIUS_KM : REGION_RADIUS_KM;
      return {
        latitude: lat,
        longitude: lon,
        source: "ip",
        confidence: classifyConfidence("ip", radiusKm),
        accuracyRadiusKm: radiusKm,
        displayName: joinPlace(city, region) ?? str(body["country"]),
        detectedAt: new Date().toISOString(),
      };
    } catch (err) {
      log.warn("ip geolocation failed", { error: String(err) });
      return undefined;
    }
  }
}

function isPublicIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("::ffff:127.")) return false;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip) || /^169\.254\./.test(ip)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return false;
  if (/^(fc|fd)/i.test(ip)) return false; // unique-local IPv6
  return ip.length > 0;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function joinPlace(city?: string, region?: string): string | undefined {
  return [city, region].filter((p): p is string => Boolean(p)).join(", ") || undefined;
}
