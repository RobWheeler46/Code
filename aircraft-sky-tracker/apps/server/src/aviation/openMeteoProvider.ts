/**
 * Upper-air provider (FRD v4.0 §47) via Open-Meteo's free pressure-level data.
 * Supplies temperature and relative humidity at the pressure level nearest an
 * aircraft's altitude, for the experimental contrail estimate. Backend-only and
 * cached; upper-air conditions change slowly and vary little across the local area.
 */

import { createLogger } from "../logging/logger.js";

const log = createLogger("aviation.upperair");
const BASE = "https://api.open-meteo.com/v1/forecast";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Pressure levels requested, with their approximate ISA altitude in feet. */
const LEVELS: { hPa: number; feet: number }[] = [
  { hPa: 850, feet: 4780 },
  { hPa: 700, feet: 9880 },
  { hPa: 500, feet: 18290 },
  { hPa: 400, feet: 23570 },
  { hPa: 300, feet: 30070 },
  { hPa: 250, feet: 34000 },
  { hPa: 200, feet: 38660 },
  { hPa: 150, feet: 44650 },
];

export interface UpperAir {
  tempC?: number;
  relativeHumidity?: number;
  pressureHpa: number;
}

interface OpenMeteoResponse {
  hourly?: {
    time?: string[];
    [key: string]: string[] | number[] | undefined;
  };
}

interface CacheEntry {
  /** Per-level temp/RH for the current hour, keyed by hPa. */
  byLevel: Map<number, { tempC?: number; rh?: number }>;
  expires: number;
}

export class OpenMeteoUpperAirProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<CacheEntry | undefined>>();

  /** Temperature/humidity at the pressure level nearest `altitudeFeet`. */
  async upperAirAt(
    lat: number,
    lon: number,
    altitudeFeet: number,
  ): Promise<UpperAir | undefined> {
    const entry = await this.load(lat, lon);
    if (!entry) return undefined;
    const level = LEVELS.reduce((best, l) =>
      Math.abs(l.feet - altitudeFeet) < Math.abs(best.feet - altitudeFeet) ? l : best,
    );
    const v = entry.byLevel.get(level.hPa);
    if (!v) return { pressureHpa: level.hPa };
    return { tempC: v.tempC, relativeHumidity: v.rh, pressureHpa: level.hPa };
  }

  private async load(lat: number, lon: number): Promise<CacheEntry | undefined> {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached;
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.fetch(lat, lon)
      .then((entry) => {
        if (entry) this.cache.set(key, entry);
        return entry;
      })
      .catch((err: unknown) => {
        log.warn("upper-air lookup failed", { key, error: String(err) });
        return undefined;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }

  private async fetch(lat: number, lon: number): Promise<CacheEntry | undefined> {
    const vars = LEVELS.flatMap((l) => [
      `temperature_${l.hPa}hPa`,
      `relative_humidity_${l.hPa}hPa`,
    ]).join(",");
    const url = `${BASE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&hourly=${vars}&forecast_days=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as OpenMeteoResponse;
    const times = body.hourly?.time;
    if (!times || times.length === 0) return undefined;

    // Pick the hour nearest to now.
    const nowMs = Date.now();
    let idx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < times.length; i++) {
      const delta = Math.abs(new Date(times[i]! + "Z").getTime() - nowMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        idx = i;
      }
    }

    const byLevel = new Map<number, { tempC?: number; rh?: number }>();
    for (const l of LEVELS) {
      const temp = body.hourly?.[`temperature_${l.hPa}hPa`] as number[] | undefined;
      const rh = body.hourly?.[`relative_humidity_${l.hPa}hPa`] as number[] | undefined;
      byLevel.set(l.hPa, {
        tempC: temp?.[idx] ?? undefined,
        rh: rh?.[idx] ?? undefined,
      });
    }
    return { byLevel, expires: nowMs + CACHE_TTL_MS };
  }
}
