/**
 * LocationService (FRD §8, §29, §40, §82, §85).
 *
 * Responsibilities: normalise postcode, validate postcode, obtain coordinates,
 * cache coordinates. Only the backend talks to Postcodes.io (FRD §8) and only
 * coordinates - never the raw postcode - flow onward to aircraft providers.
 */

import { LocationCacheRepo } from "../persistence/locationCacheRepo.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("location");
const POSTCODES_BASE = "https://api.postcodes.io/postcodes";
const REQUEST_TIMEOUT_MS = 8000;
const PROVIDER = "postcodes.io";

export interface ResolvedLocation {
  valid: boolean;
  postcode: string;
  latitude: number;
  longitude: number;
  /** Where the coordinates came from, for diagnostics. */
  origin?: "postcodes.io" | "cache";
}

interface PostcodesIoResponse {
  status: number;
  result: {
    postcode: string;
    latitude: number;
    longitude: number;
  } | null;
}

/** UK postcode format, tolerant of spacing (validated for real by the API). */
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

export class LocationService {
  private readonly cache: LocationCacheRepo;

  constructor(cache: LocationCacheRepo = new LocationCacheRepo()) {
    this.cache = cache;
  }

  /** Canonicalise for display/storage: uppercase, single internal space. */
  normalise(postcode: string): string {
    return postcode.trim().toUpperCase().replace(/\s+/g, " ");
  }

  /** Compact form for the Postcodes.io path segment (no spaces). */
  private toPathSegment(postcode: string): string {
    return postcode.replace(/\s+/g, "").toUpperCase();
  }

  looksLikePostcode(postcode: string): boolean {
    return UK_POSTCODE_RE.test(postcode.trim());
  }

  /**
   * Validate a postcode and resolve real coordinates via Postcodes.io (FRD §40).
   * Never hard-codes coordinates. Returns valid:false on HTTP 404. Throws on
   * network/other failure so callers can distinguish "not found" from "offline".
   */
  async validateAndResolve(postcode: string): Promise<ResolvedLocation> {
    const normalised = this.normalise(postcode);
    if (!this.looksLikePostcode(normalised)) {
      return { valid: false, postcode: normalised, latitude: 0, longitude: 0 };
    }

    const url = `${POSTCODES_BASE}/${encodeURIComponent(this.toPathSegment(normalised))}`;
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      log.error("postcode lookup failed", { postcode: normalised, error: String(err) });
      throw new Error(`Postcodes.io request failed: ${String(err)}`);
    }

    if (res.status === 404) {
      log.info("postcode not recognised", { postcode: normalised });
      return { valid: false, postcode: normalised, latitude: 0, longitude: 0 };
    }
    if (!res.ok) {
      throw new Error(`Postcodes.io returned HTTP ${res.status}`);
    }

    const body = (await res.json()) as PostcodesIoResponse;
    if (!body.result) {
      return { valid: false, postcode: normalised, latitude: 0, longitude: 0 };
    }

    const canonical = this.normalise(body.result.postcode);
    const latitude = body.result.latitude;
    const longitude = body.result.longitude;
    this.cache.put(canonical, latitude, longitude, PROVIDER);
    log.info("postcode resolved", { postcode: canonical, latitude, longitude });
    return { valid: true, postcode: canonical, latitude, longitude, origin: "postcodes.io" };
  }

  /**
   * Coordinates for startup (FRD §85). Prefer a successful live resolution;
   * fall back to cached coordinates if the service is unavailable. Returns
   * undefined only when there is no cache and resolution failed.
   */
  async resolveForStartup(postcode: string): Promise<ResolvedLocation | undefined> {
    const normalised = this.normalise(postcode);
    try {
      const resolved = await this.validateAndResolve(normalised);
      if (resolved.valid) return resolved;
      // Postcode genuinely not found; fall through to cache as a last resort.
    } catch {
      log.warn("postcode service unavailable at startup; trying cache", {
        postcode: normalised,
      });
    }

    const cached = this.cache.get(normalised);
    if (cached) {
      log.info("using cached coordinates", { postcode: normalised });
      return {
        valid: true,
        postcode: cached.postcode,
        latitude: cached.latitude,
        longitude: cached.longitude,
        origin: "cache",
      };
    }
    return undefined;
  }

  getCached(postcode: string): ResolvedLocation | undefined {
    const cached = this.cache.get(this.normalise(postcode));
    if (!cached) return undefined;
    return {
      valid: true,
      postcode: cached.postcode,
      latitude: cached.latitude,
      longitude: cached.longitude,
      origin: "cache",
    };
  }
}
