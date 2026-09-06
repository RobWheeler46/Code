/**
 * Aviation weather provider (FRD v4.0 §46). Fetches free METAR and TAF from
 * AviationWeather.gov's machine-readable Data API for the nearest reporting
 * aerodrome to the observer. Results are cached (weather changes slowly, §perf)
 * and the browser never calls the API directly (backend-only, §79).
 */

import { createLogger } from "../logging/logger.js";
import {
  nearestStation,
  type WeatherReport,
  type FlightCategory,
} from "@ast/shared";

const log = createLogger("aviation.weather");
const METAR_URL = "https://aviationweather.gov/api/data/metar";
const TAF_URL = "https://aviationweather.gov/api/data/taf";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 20 * 60 * 1000; // 20 minutes

/** A small curated set of UK reporting aerodromes with coordinates. */
export interface Station {
  icao: string;
  name: string;
  latitude: number;
  longitude: number;
}

export const UK_METAR_STATIONS: Station[] = [
  { icao: "EGVN", name: "Brize Norton", latitude: 51.758, longitude: -1.578 },
  { icao: "EGVA", name: "Fairford", latitude: 51.682, longitude: -1.79 },
  { icao: "EGUB", name: "Benson", latitude: 51.616, longitude: -1.096 },
  { icao: "EGTK", name: "Oxford Kidlington", latitude: 51.837, longitude: -1.32 },
  { icao: "EGGD", name: "Bristol", latitude: 51.383, longitude: -2.719 },
  { icao: "EGDM", name: "Boscombe Down", latitude: 51.152, longitude: -1.747 },
  { icao: "EGLL", name: "London Heathrow", latitude: 51.477, longitude: -0.461 },
  { icao: "EGLF", name: "Farnborough", latitude: 51.276, longitude: -0.776 },
  { icao: "EGKK", name: "London Gatwick", latitude: 51.148, longitude: -0.19 },
  { icao: "EGBB", name: "Birmingham", latitude: 52.454, longitude: -1.748 },
  { icao: "EGFF", name: "Cardiff", latitude: 51.397, longitude: -3.343 },
  { icao: "EGHH", name: "Bournemouth", latitude: 50.78, longitude: -1.842 },
  { icao: "EGTC", name: "Cranfield", latitude: 52.072, longitude: -0.616 },
  { icao: "EGSC", name: "Cambridge", latitude: 52.205, longitude: 0.175 },
  { icao: "EGBJ", name: "Gloucestershire", latitude: 51.894, longitude: -2.167 },
  { icao: "EGDX", name: "St Athan", latitude: 51.398, longitude: -3.436 },
  { icao: "EGHI", name: "Southampton", latitude: 50.95, longitude: -1.357 },
];

interface MetarJson {
  icaoId?: string;
  name?: string;
  lat?: number;
  lon?: number;
  reportTime?: string;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  visib?: number | string;
  cover?: string;
  clouds?: { cover?: string; base?: number }[];
  fltCat?: string;
  rawOb?: string;
}

interface TafJson {
  rawTAF?: string;
}

interface CacheEntry {
  value: WeatherReport | undefined;
  expires: number;
}

function toFlightCategory(v: string | undefined): FlightCategory {
  switch ((v ?? "").toUpperCase()) {
    case "VFR":
      return "VFR";
    case "MVFR":
      return "MVFR";
    case "IFR":
      return "IFR";
    case "LIFR":
      return "LIFR";
    default:
      return "UNKNOWN";
  }
}

function cloudSummary(m: MetarJson): string | undefined {
  if (m.clouds && m.clouds.length > 0) {
    return m.clouds
      .map((c) => (c.base ? `${c.cover ?? "?"} ${c.base.toLocaleString()} ft` : c.cover ?? "?"))
      .join(", ");
  }
  return m.cover;
}

export class AviationWeatherProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<WeatherReport | undefined>>();

  constructor(private readonly stations: Station[] = UK_METAR_STATIONS) {}

  /** Nearest aerodrome weather to the observer, or undefined if unavailable. */
  async nearest(observerLat: number, observerLon: number): Promise<WeatherReport | undefined> {
    const near = nearestStation(observerLat, observerLon, this.stations);
    if (!near) return undefined;
    const station = near.station;

    const cached = this.cache.get(station.icao);
    if (cached && cached.expires > Date.now()) {
      return cached.value ? { ...cached.value, distanceMiles: round(near.distanceMiles) } : undefined;
    }
    const existing = this.inflight.get(station.icao);
    if (existing) {
      const v = await existing;
      return v ? { ...v, distanceMiles: round(near.distanceMiles) } : undefined;
    }

    const promise = this.fetchReport(station, near.distanceMiles)
      .then((report) => {
        this.cache.set(station.icao, { value: report, expires: Date.now() + CACHE_TTL_MS });
        return report;
      })
      .catch((err: unknown) => {
        log.warn("weather lookup failed", { station: station.icao, error: String(err) });
        return undefined;
      })
      .finally(() => this.inflight.delete(station.icao));

    this.inflight.set(station.icao, promise);
    return promise;
  }

  private async fetchReport(station: Station, distanceMiles: number): Promise<WeatherReport | undefined> {
    const metarRes = await fetch(
      `${METAR_URL}?ids=${encodeURIComponent(station.icao)}&format=json`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
    if (!metarRes.ok) return undefined;
    const metars = (await metarRes.json()) as MetarJson[];
    const m = metars[0];
    if (!m) return undefined;

    let rawTaf: string | undefined;
    try {
      const tafRes = await fetch(
        `${TAF_URL}?ids=${encodeURIComponent(station.icao)}&format=json`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (tafRes.ok) {
        const tafs = (await tafRes.json()) as TafJson[];
        rawTaf = tafs[0]?.rawTAF;
      }
    } catch {
      // TAF is optional; a missing forecast is not an error.
    }

    return {
      stationIcao: m.icaoId ?? station.icao,
      stationName: m.name ?? station.name,
      latitude: m.lat ?? station.latitude,
      longitude: m.lon ?? station.longitude,
      distanceMiles: round(distanceMiles),
      observedAt: m.reportTime,
      temperatureC: typeof m.temp === "number" ? m.temp : undefined,
      dewpointC: typeof m.dewp === "number" ? m.dewp : undefined,
      windDirectionDeg: typeof m.wdir === "number" ? m.wdir : undefined,
      windSpeedKt: typeof m.wspd === "number" ? m.wspd : undefined,
      visibility: m.visib !== undefined ? String(m.visib) : undefined,
      cloudSummary: cloudSummary(m),
      flightCategory: toFlightCategory(m.fltCat),
      rawMetar: m.rawOb,
      rawTaf,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
