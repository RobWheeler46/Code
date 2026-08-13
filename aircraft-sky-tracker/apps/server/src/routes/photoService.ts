/**
 * Aircraft photo enrichment via the planespotters.net public API (FRD Phase 1.1).
 *
 * The backend performs the lookup (FRD §79 - the browser never calls third
 * parties directly) and returns a thumbnail URL plus the attribution that
 * planespotters requires (photographer + link). Results are cached in memory to
 * stay well within fair-use limits; photos are non-critical enrichment.
 */

import { createLogger } from "../logging/logger.js";

const log = createLogger("photo");
const BASE = "https://api.planespotters.net/pub/photos";
const REQUEST_TIMEOUT_MS = 6000;
// planespotters rejects generic User-Agents; identify the app with a contact URL.
const USER_AGENT =
  "LocalAircraftSkyTracker/1.0 (+https://aircraft-sky-tracker-production.up.railway.app)";
const FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MISS_TTL_MS = 24 * 60 * 60 * 1000; // 1 day

export interface PhotoResult {
  /** Thumbnail image URL (planespotters CDN), or undefined if none found. */
  url?: string;
  /** Link to the full photo page (attribution requirement). */
  link?: string;
  /** Photographer name (attribution requirement). */
  photographer?: string;
}

interface PlanespottersPhoto {
  thumbnail?: { src?: string };
  thumbnail_large?: { src?: string };
  link?: string;
  photographer?: string;
}

interface PlanespottersResponse {
  photos?: PlanespottersPhoto[];
}

interface CacheEntry {
  value: PhotoResult;
  expires: number;
}

export class PhotoService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<PhotoResult>>();

  /** Look up a photo by registration (preferred) or ICAO hex. */
  async getPhoto(registration?: string, icaoHex?: string): Promise<PhotoResult> {
    const reg = registration?.trim().toUpperCase();
    const hex = icaoHex?.trim().toLowerCase();
    const key = reg ? `reg:${reg}` : hex ? `hex:${hex}` : "";
    if (!key) return {};

    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetchPhoto(reg, hex)
      .then((result) => {
        const ttl = result.url ? FOUND_TTL_MS : MISS_TTL_MS;
        this.cache.set(key, { value: result, expires: Date.now() + ttl });
        return result;
      })
      .catch((err: unknown) => {
        log.warn("photo lookup failed", { key, error: String(err) });
        return {} as PhotoResult;
      })
      .finally(() => {
        this.inflight.delete(key);
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private async fetchPhoto(reg?: string, hex?: string): Promise<PhotoResult> {
    // Prefer registration; fall back to ICAO hex.
    if (reg) {
      const byReg = await this.request(`${BASE}/reg/${encodeURIComponent(reg)}`);
      if (byReg.url) return byReg;
    }
    if (hex) {
      return this.request(`${BASE}/hex/${encodeURIComponent(hex)}`);
    }
    return {};
  }

  private async request(url: string): Promise<PhotoResult> {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const body = (await res.json()) as PlanespottersResponse;
    const photo = body.photos?.[0];
    if (!photo) return {};
    const src = photo.thumbnail_large?.src ?? photo.thumbnail?.src;
    if (!src) return {};
    return { url: src, link: photo.link, photographer: photo.photographer };
  }
}
