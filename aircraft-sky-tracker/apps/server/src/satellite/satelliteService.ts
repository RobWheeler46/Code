/**
 * SatelliteService (FRD v3.2 §36-84).
 *
 * Refreshes orbital elements from the provider (cached, resilient - FRD §55,
 * §77), propagates them with SGP4 for the configured observer every couple of
 * seconds, filters to the enabled groups above the minimum elevation, assesses
 * visibility, and broadcasts a satellite snapshot. Fully independent of aircraft
 * tracking (FRD §36) - a satellite failure never affects aircraft (§77).
 */

import { type Satellite, compassDirection } from "@ast/shared";
import type { OrbitalDataProvider, OrbitalElement } from "./orbitalProvider.js";
import { observe, observerFrom, sunElevationDeg, type ObserverGd } from "./sgp4Service.js";
import { isSunlit, sunEci } from "./astro.js";
import { simulationSatellites, skyBearing } from "./simulationSatellites.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("satellite");

const TICK_MS = 2000; // position recompute cadence (FRD §54)
const REFRESH_MS = 8 * 60 * 60 * 1000; // orbital element refresh (FRD §55)
const DARK_SUN_ELEVATION_DEG = -4; // sky dark enough for a naked-eye pass (§46)

export interface SatelliteConfigView {
  showSatellites: boolean;
  minElevationDeg: number;
  showStations: boolean;
  showBright: boolean;
  showStarlink: boolean;
  latitude: number;
  longitude: number;
}

export interface SatelliteCounts {
  loaded: number;
  aboveHorizon: number;
  aboveMinElevation: number;
  potentiallyVisible: number;
  displayed: number;
}

export type OrbitalSourceStatus = "connected" | "degraded" | "disconnected";

export class SatelliteService {
  private elements: OrbitalElement[] = [];
  private elementsFetchedAt = 0;
  private status: OrbitalSourceStatus = "disconnected";
  private snapshot: Satellite[] = [];
  private counts: SatelliteCounts = {
    loaded: 0,
    aboveHorizon: 0,
    aboveMinElevation: 0,
    potentiallyVisible: 0,
    displayed: 0,
  };
  private tickTimer: NodeJS.Timeout | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly provider: OrbitalDataProvider,
    private readonly getConfig: () => SatelliteConfigView,
    private readonly onSnapshot: (satellites: Satellite[]) => void,
    private readonly simulation: boolean,
  ) {}

  async start(): Promise<void> {
    if (!this.simulation) {
      await this.refreshElements();
      this.refreshTimer = setInterval(() => void this.refreshElements(), REFRESH_MS);
      this.refreshTimer.unref();
    } else {
      this.status = "connected";
    }
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
    log.info("satellite service started", { simulation: this.simulation });
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  getSnapshot(): Satellite[] {
    return this.snapshot;
  }

  getSatellite(catalogNumber: string): Satellite | undefined {
    return this.snapshot.find((s) => s.catalogNumber === catalogNumber);
  }

  diagnostics(): {
    provider: string;
    status: OrbitalSourceStatus;
    elementCacheAgeMs: number | null;
    counts: SatelliteCounts;
  } {
    return {
      provider: this.simulation ? "simulation" : this.provider.name,
      status: this.status,
      elementCacheAgeMs: this.elementsFetchedAt > 0 ? Date.now() - this.elementsFetchedAt : null,
      counts: this.counts,
    };
  }

  private async refreshElements(): Promise<void> {
    const cfg = this.getConfig();
    try {
      const els = await this.provider.fetchElements(cfg.showStarlink);
      if (els.length > 0) {
        this.elements = els;
        this.elementsFetchedAt = Date.now();
        this.status = "connected";
        log.info("orbital elements refreshed", { loaded: els.length });
      }
    } catch (err) {
      // Keep using cached elements during outages (FRD §77).
      this.status = this.elements.length > 0 ? "degraded" : "disconnected";
      log.warn("orbital refresh failed", { error: String(err) });
    }
  }

  private groupEnabled(category: Satellite["category"], cfg: SatelliteConfigView): boolean {
    if (category === "station") return cfg.showStations;
    if (category === "bright") return cfg.showBright;
    if (category === "starlink") return cfg.showStarlink;
    return cfg.showBright;
  }

  private tick(): void {
    const cfg = this.getConfig();
    if (!cfg.showSatellites) {
      this.snapshot = [];
      this.counts = { loaded: 0, aboveHorizon: 0, aboveMinElevation: 0, potentiallyVisible: 0, displayed: 0 };
      this.onSnapshot([]);
      return;
    }
    const snapshot = this.simulation ? this.computeSimulation(cfg) : this.computeLive(cfg);
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
  }

  private computeSimulation(cfg: SatelliteConfigView): Satellite[] {
    const now = Date.now();
    const observer = observerFrom(cfg.latitude, cfg.longitude);
    const darkSky = sunElevationDeg(observer, new Date(now)) < DARK_SUN_ELEVATION_DEG;
    const all = simulationSatellites(now, darkSky);
    this.counts = {
      loaded: all.length,
      aboveHorizon: all.filter((s) => s.elevationDegrees > 0).length,
      aboveMinElevation: all.filter((s) => s.elevationDegrees >= cfg.minElevationDeg).length,
      potentiallyVisible: all.filter((s) => s.potentiallyVisible).length,
      displayed: 0,
    };
    const displayed = all.filter(
      (s) => s.elevationDegrees >= cfg.minElevationDeg && this.groupEnabled(s.category, cfg),
    );
    this.counts.displayed = displayed.length;
    return displayed.sort((a, b) => b.elevationDegrees - a.elevationDegrees);
  }

  private computeLive(cfg: SatelliteConfigView): Satellite[] {
    const now = new Date();
    const observer = observerFrom(cfg.latitude, cfg.longitude);
    const sun = sunEci(now);
    const darkSky = sunElevationDeg(observer, now) < DARK_SUN_ELEVATION_DEG;
    const next = new Date(now.getTime() + 20_000);

    let aboveHorizon = 0;
    let aboveMin = 0;
    let visible = 0;
    const displayed: Satellite[] = [];

    for (const el of this.elements) {
      const obs = observe(el.satrec, observer, now);
      if (!obs) continue;
      if (obs.elevationDeg > 0) aboveHorizon++;
      const illuminated = isSunlit(obs.eci, sun);
      const potentiallyVisible = obs.elevationDeg >= cfg.minElevationDeg && illuminated && darkSky;
      if (obs.elevationDeg >= cfg.minElevationDeg) aboveMin++;
      if (potentiallyVisible) visible++;

      if (obs.elevationDeg < cfg.minElevationDeg || !this.groupEnabled(el.category, cfg)) continue;

      const nextObs = observe(el.satrec, observer, next);
      const direction = nextObs
        ? compassDirection(
            skyBearing(
              { az: obs.azimuthDeg, el: obs.elevationDeg },
              { az: nextObs.azimuthDeg, el: nextObs.elevationDeg },
            ),
          )
        : undefined;

      displayed.push({
        catalogNumber: el.catalogNumber,
        name: el.name,
        category: el.category,
        latitude: obs.subLat,
        longitude: obs.subLon,
        orbitalAltitudeKm: Math.round(obs.altitudeKm),
        azimuthDegrees: obs.azimuthDeg,
        elevationDegrees: obs.elevationDeg,
        rangeKm: Math.round(obs.rangeKm),
        velocityKmPerSecond: obs.velocityKmPerSec,
        illuminated,
        potentiallyVisible,
        direction,
        dataTimestamp: now.toISOString(),
      });
    }

    this.counts = {
      loaded: this.elements.length,
      aboveHorizon,
      aboveMinElevation: aboveMin,
      potentiallyVisible: visible,
      displayed: displayed.length,
    };
    return displayed.sort((a, b) => b.elevationDegrees - a.elevationDegrees);
  }
}
