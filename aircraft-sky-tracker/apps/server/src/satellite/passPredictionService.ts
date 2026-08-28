/**
 * PassPredictionService (FRD v3.2 §59-60). Computes the upcoming meaningful
 * overhead passes for the enabled satellite groups and caches them, refreshing
 * on a slow interval (predictions only shift as orbital elements age). Shares
 * the loaded elements with the SatelliteService rather than fetching its own.
 */

import {
  type SatellitePass,
  type SatelliteCategory,
  compassDirection,
  DEFAULT_SATELLITE_PASS_WINDOW_HOURS,
} from "@ast/shared";
import type { OrbitalElement } from "./orbitalProvider.js";
import { observerFrom } from "./sgp4Service.js";
import { predictPasses } from "./passPrediction.js";
import { simulationPasses } from "./simulationSatellites.js";
import type { SatelliteConfigView } from "./satelliteService.js";
import { createLogger } from "../logging/logger.js";

const log = createLogger("satellite.passes");

const REFRESH_MS = 5 * 60 * 1000; // recompute cadence
const MAX_PASSES_PER_SATELLITE = 6; // keep a busy sky bounded

export interface PassPredictionResult {
  generatedAt: string;
  windowHours: number;
  passes: SatellitePass[];
}

function groupEnabled(category: SatelliteCategory, cfg: SatelliteConfigView): boolean {
  if (category === "station") return cfg.showStations;
  if (category === "starlink") return cfg.showStarlink;
  return cfg.showBright; // bright + other
}

export class PassPredictionService {
  private cache: PassPredictionResult = {
    generatedAt: new Date(0).toISOString(),
    windowHours: DEFAULT_SATELLITE_PASS_WINDOW_HOURS,
    passes: [],
  };
  private timer: NodeJS.Timeout | undefined;
  private readonly windowHours = DEFAULT_SATELLITE_PASS_WINDOW_HOURS;
  /** Whether the last live compute actually had orbital elements to work with. */
  private computedWithElements = false;

  constructor(
    private readonly getElements: () => OrbitalElement[],
    private readonly getConfig: () => SatelliteConfigView,
    private readonly simulation: boolean,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.recompute(), REFRESH_MS);
    this.timer.unref();
    this.recompute();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Current cached predictions; recomputes on demand if the cache is stale, or
   * if orbital elements have arrived since a prediction that had none (the first
   * compute can race the initial CelesTrak load).
   */
  getPasses(): PassPredictionResult {
    const ageMs = Date.now() - new Date(this.cache.generatedAt).getTime();
    const elementsNowReady =
      !this.simulation && !this.computedWithElements && this.getElements().length > 0;
    if (ageMs > REFRESH_MS || elementsNowReady) this.recompute();
    return this.cache;
  }

  private recompute(): void {
    const cfg = this.getConfig();
    const now = new Date();
    let passes: SatellitePass[];
    if (!cfg.showSatellites) {
      passes = [];
    } else if (this.simulation) {
      passes = simulationPasses(now.getTime(), cfg.minElevationDeg);
    } else {
      passes = this.computeLive(cfg, now);
    }
    passes.sort((a, b) => a.riseTime.localeCompare(b.riseTime));
    this.cache = {
      generatedAt: now.toISOString(),
      windowHours: this.windowHours,
      passes,
    };
  }

  private computeLive(cfg: SatelliteConfigView, now: Date): SatellitePass[] {
    const elements = this.getElements();
    this.computedWithElements = elements.length > 0;
    if (elements.length === 0) return [];
    const observer = observerFrom(cfg.latitude, cfg.longitude);
    const windowMs = this.windowHours * 60 * 60 * 1000;
    const started = Date.now();
    const out: SatellitePass[] = [];

    for (const el of elements) {
      if (!groupEnabled(el.category, cfg)) continue;
      let predicted;
      try {
        predicted = predictPasses(el.satrec, observer, {
          start: now,
          windowMs,
          minElevationDeg: cfg.minElevationDeg,
          maxPasses: MAX_PASSES_PER_SATELLITE,
        });
      } catch {
        continue; // one bad element set never breaks the whole prediction
      }
      for (const p of predicted) {
        const durationSeconds = Math.round((p.setTime.getTime() - p.riseTime.getTime()) / 1000);
        out.push({
          catalogNumber: el.catalogNumber,
          name: el.name,
          category: el.category,
          riseTime: p.riseTime.toISOString(),
          maxTime: p.maxTime.toISOString(),
          setTime: p.setTime.toISOString(),
          maxElevationDegrees: Math.round(p.maxElevationDeg),
          riseAzimuthDegrees: Math.round(p.riseAzimuthDeg),
          setAzimuthDegrees: Math.round(p.setAzimuthDeg),
          direction: `${compassDirection(p.riseAzimuthDeg)} → ${compassDirection(p.setAzimuthDeg)}`,
          durationSeconds,
          potentiallyVisible: p.potentiallyVisible,
          inProgress: p.riseTime.getTime() <= now.getTime() && p.setTime.getTime() > now.getTime(),
        });
      }
    }

    log.debug("pass prediction computed", {
      elements: elements.length,
      passes: out.length,
      durationMs: Date.now() - started,
    });
    return out;
  }
}
