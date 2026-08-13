/**
 * AircraftStateService (FRD §14, §29, §54).
 *
 * Maintains the current set of displayable aircraft: computes exact local
 * distance/bearing, applies the radius filter, enriches with destination and
 * (fallback) registration, and manages arrival / departure / stale lifecycle.
 * Live positions are kept in memory only (FRD §38).
 */

import type { Aircraft, ProviderAircraft } from "@ast/shared";
import { aircraftCategoryFromType } from "@ast/shared";
import { GeoService } from "../geo/geoService.js";
import { RouteService } from "../routes/routeService.js";
import {
  normaliseAircraft,
  MAX_POSITION_AGE_SECONDS,
} from "./normaliser.js";

/** How long to hold an aircraft that has dropped out of the feed (FRD §54). */
const HOLD_MS = 30_000;

interface TrackedAircraft {
  aircraft: Aircraft;
  lastSeenMs: number;
}

export interface StateCounts {
  received: number;
  insideRadius: number;
  displayed: number;
}

export class AircraftStateService {
  private readonly geo: GeoService;
  private readonly routes: RouteService;
  private tracked = new Map<string, TrackedAircraft>();
  private counts: StateCounts = { received: 0, insideRadius: 0, displayed: 0 };

  constructor(geo: GeoService, routes: RouteService) {
    this.geo = geo;
    this.routes = routes;
  }

  getCounts(): StateCounts {
    return this.counts;
  }

  snapshot(): Aircraft[] {
    return [...this.tracked.values()].map((t) => t.aircraft);
  }

  /** Process one provider poll and return the resulting displayable set. */
  update(
    raw: ProviderAircraft[],
    radiusMiles: number,
    source: string,
    now: number = Date.now(),
  ): Aircraft[] {
    let insideRadius = 0;
    const seen = new Set<string>();

    for (const item of raw) {
      const normalised = normaliseAircraft(item, source);
      if (!normalised) continue;

      const distanceMiles = this.geo.distanceMiles(
        normalised.latitude,
        normalised.longitude,
      );

      if (distanceMiles > radiusMiles) {
        // Live position outside the radius: ensure it is not displayed (FRD §14).
        this.tracked.delete(normalised.id);
        continue;
      }
      insideRadius++;
      seen.add(normalised.id);

      const bearingFromCentre = this.geo.bearingFromCentre(
        normalised.latitude,
        normalised.longitude,
      );

      // Registration fallback via adsbdb only when missing (FRD §21, §74).
      let registration = normalised.registration;
      let aircraftTypeCode = normalised.aircraftTypeCode;
      if (!registration) {
        const meta = this.routes.getRegistration(normalised.icaoHex);
        if (meta) {
          registration = registration ?? meta.registration;
          aircraftTypeCode = aircraftTypeCode ?? meta.aircraftTypeCode;
        }
      }

      const destination = this.routes.getDestination(normalised.callsign, {
        latitude: normalised.latitude,
        longitude: normalised.longitude,
        trackDegrees: normalised.trackDegrees,
      });

      const aircraft: Aircraft = {
        id: normalised.id,
        icaoHex: normalised.icaoHex,
        registration,
        callsign: normalised.callsign,
        latitude: normalised.latitude,
        longitude: normalised.longitude,
        altitudeFeet: normalised.altitudeFeet,
        groundSpeedKnots: normalised.groundSpeedKnots,
        trackDegrees: normalised.trackDegrees,
        distanceMiles: round(distanceMiles, 2),
        bearingFromCentre: round(bearingFromCentre, 1),
        aircraftTypeCode,
        aircraftCategory: aircraftCategoryFromType(aircraftTypeCode),
        destination,
        positionAgeSeconds: normalised.positionAgeSeconds,
        lastUpdated: new Date(now).toISOString(),
        source,
      };

      this.tracked.set(normalised.id, { aircraft, lastSeenMs: now });
    }

    // Hold aircraft that dropped out of the feed, then remove them (FRD §54).
    for (const [id, entry] of this.tracked) {
      if (seen.has(id)) continue;
      const ageMs = now - entry.lastSeenMs;
      if (ageMs > HOLD_MS) {
        this.tracked.delete(id);
      } else {
        entry.aircraft.positionAgeSeconds = Math.min(
          MAX_POSITION_AGE_SECONDS,
          entry.aircraft.positionAgeSeconds + ageMs / 1000,
        );
      }
    }

    this.counts = {
      received: raw.length,
      insideRadius,
      displayed: this.tracked.size,
    };
    return this.snapshot();
  }

  /** Drop all tracked aircraft (e.g. after a centre change). */
  clear(): void {
    this.tracked.clear();
    this.counts = { received: 0, insideRadius: 0, displayed: 0 };
  }
}

function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
