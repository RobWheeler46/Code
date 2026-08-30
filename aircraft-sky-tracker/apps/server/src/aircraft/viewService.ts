/**
 * ViewService - per-viewer location override (?postcode= URL parameter).
 *
 * Produces an on-demand aircraft snapshot for an arbitrary postcode without
 * touching the global tracking state or other viewers. Reuses the shared
 * provider, normaliser, route enrichment and geo maths. Snapshots are cached
 * briefly per centre so a viewer polling at ~1 Hz (and multiple viewers of the
 * same postcode) coalesce into gentle provider usage.
 *
 * "multiple simultaneously configured locations" was out of MVP scope (FRD §6);
 * this is a read-only per-view override, not a second configured location.
 */

import type { Aircraft, AppConfig } from "@ast/shared";
import {
  haversineDistanceMiles,
  bearingDegrees,
  aircraftSilhouetteFromType,
  categoryFromSilhouette,
} from "@ast/shared";
import { normaliseAircraft } from "./normaliser.js";
import { evaluateInterest, parseWatchlist } from "./interest.js";
import type { RouteService } from "../routes/routeService.js";
import type { LocationService } from "../location/locationService.js";
import type { SettingsRepo } from "../persistence/settingsRepo.js";
import type { AircraftProvider } from "../providers/types.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("view");
// Cache per centre for a couple of seconds so per-viewer polling stays gentle on
// the shared provider (the global 1 Hz loop is the dominant consumer).
const SNAPSHOT_TTL_MS = 2000;

export interface ViewResult {
  valid: boolean;
  postcode: string;
  config?: AppConfig;
  aircraft?: Aircraft[];
  timestamp?: number;
}

interface Snapshot {
  aircraft: Aircraft[];
  ts: number;
}

export class ViewService {
  private snapshots = new Map<string, Snapshot>();

  constructor(
    private readonly location: LocationService,
    private readonly settings: SettingsRepo,
    private readonly routes: RouteService,
    private readonly provider: AircraftProvider,
  ) {}

  /** Resolve a postcode and return an aircraft snapshot for that area. */
  async getView(postcodeInput: string): Promise<ViewResult> {
    const normalised = this.location.normalise(postcodeInput);

    // Prefer the cache (no network) then a live resolution.
    let resolved = this.location.getCached(normalised);
    if (!resolved) {
      try {
        const r = await this.location.validateAndResolve(normalised);
        if (r.valid) resolved = r;
      } catch {
        // Offline: fall through to "not resolvable".
      }
    }
    if (!resolved || !resolved.valid) {
      return { valid: false, postcode: normalised };
    }

    const globalConfig = this.settings.get();
    const radius = globalConfig.radiusMiles;

    let aircraft: Aircraft[] = [];
    try {
      aircraft = await this.snapshotFor(
        resolved.latitude,
        resolved.longitude,
        radius,
        globalConfig.watchlist,
        globalConfig.lowAltitudeThresholdFeet,
      );
    } catch (err) {
      log.warn("view snapshot failed", { postcode: resolved.postcode, error: String(err) });
    }

    // Effective config: global display settings, centre replaced by the override.
    const config: AppConfig = {
      ...globalConfig,
      postcode: resolved.postcode,
      latitude: resolved.latitude,
      longitude: resolved.longitude,
    };
    return {
      valid: true,
      postcode: resolved.postcode,
      config,
      aircraft,
      timestamp: Date.now(),
    };
  }

  private async snapshotFor(
    lat: number,
    lon: number,
    radius: number,
    watchlist: string,
    lowAltitudeFeet: number,
  ): Promise<Aircraft[]> {
    const key = `${lat.toFixed(4)},${lon.toFixed(4)},${radius},${watchlist}`;
    const now = Date.now();
    const cached = this.snapshots.get(key);
    if (cached && now - cached.ts < SNAPSHOT_TTL_MS) return cached.aircraft;

    const watchTokens = parseWatchlist(watchlist);
    const raw = await this.provider.fetchAircraft(lat, lon, radius);
    const source = this.provider.name;
    const hideGround = this.settings.get().hideGroundAircraft;
    const out: Aircraft[] = [];

    for (const item of raw) {
      const n = normaliseAircraft(item, source);
      if (!n) continue;
      if (hideGround && n.onGround) continue;
      const distance = haversineDistanceMiles(lat, lon, n.latitude, n.longitude);
      if (distance > radius) continue;
      const bearing = bearingDegrees(lat, lon, n.latitude, n.longitude);

      let registration = n.registration;
      let type = n.aircraftTypeCode;
      if (!registration) {
        const meta = this.routes.getRegistration(n.icaoHex);
        if (meta) {
          registration = registration ?? meta.registration;
          type = type ?? meta.aircraftTypeCode;
        }
      }
      const destination = this.routes.getDestination({
        icaoHex: n.icaoHex,
        registration,
        callsign: n.callsign,
        latitude: n.latitude,
        longitude: n.longitude,
        trackDegrees: n.trackDegrees,
      });

      const silhouette = aircraftSilhouetteFromType(type);
      const category = categoryFromSilhouette(silhouette);
      const interest = evaluateInterest(
        {
          icaoHex: n.icaoHex,
          registration,
          callsign: n.callsign,
          aircraftTypeCode: type,
          aircraftCategory: category,
          altitudeFeet: n.altitudeFeet,
          providerFlags: n.providerFlags,
        },
        watchTokens,
        lowAltitudeFeet,
      );

      out.push({
        id: n.id,
        icaoHex: n.icaoHex,
        registration,
        callsign: n.callsign,
        latitude: n.latitude,
        longitude: n.longitude,
        altitudeFeet: n.altitudeFeet,
        groundSpeedKnots: n.groundSpeedKnots,
        trackDegrees: n.trackDegrees,
        onGround: n.onGround,
        distanceMiles: round(distance, 2),
        bearingFromCentre: round(bearing, 1),
        aircraftTypeCode: type,
        aircraftCategory: category,
        silhouette,
        destination,
        interest,
        verticalRateFpm: n.verticalRateFpm,
        squawk: n.squawk,
        emergency: n.emergency,
        technical: n.technical,
        positionAgeSeconds: n.positionAgeSeconds,
        lastUpdated: new Date(now).toISOString(),
        source,
      });
    }

    out.sort((a, b) => a.distanceMiles - b.distanceMiles);
    this.snapshots.set(key, { aircraft: out, ts: now });
    return out;
  }
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
