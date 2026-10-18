/**
 * Aviation context service (FRD v4.0 §35-38, §46-47 - Release 4.3). Orchestrates
 * the airspace, weather, upper-air and military-context providers into:
 *   - an observer-level `AviationContext` (nearest METAR/TAF, airspace at the
 *     observer, a military-context note); and
 *   - a per-aircraft `AircraftAviationContext` (airspace the aircraft is inside +
 *     an experimental contrail estimate).
 *
 * Everything degrades gracefully: a failed weather or upper-air fetch simply
 * omits that part; airspace (curated, local) always works.
 */

import {
  airspaceForPoint,
  estimateContrail,
  observerLookAngles,
  solarElevationDeg,
  assessAircraftSpotability,
  FEET_TO_METRES,
  type Aircraft,
  type AviationContext,
  type AircraftAviationContext,
} from "@ast/shared";
import type { AirspaceProvider } from "./airspaceProvider.js";
import type { AviationWeatherProvider } from "./aviationWeatherProvider.js";
import type { OpenMeteoUpperAirProvider } from "./openMeteoProvider.js";
import type { ModProvider } from "./modProvider.js";

export interface Observer {
  latitude: number;
  longitude: number;
}

export class AviationContextService {
  constructor(
    private readonly airspace: AirspaceProvider,
    private readonly weather: AviationWeatherProvider,
    private readonly upperAir: OpenMeteoUpperAirProvider,
    private readonly mod: ModProvider,
  ) {}

  /** Observer-level context: nearest weather, airspace here, military note. */
  async observerContext(observer: Observer): Promise<AviationContext> {
    const regions = this.airspace.regions();
    const weather = await this.weather
      .nearest(observer.latitude, observer.longitude)
      .catch(() => undefined);
    const airspaceAtObserver = airspaceForPoint(
      observer.latitude,
      observer.longitude,
      undefined,
      regions,
    ).map((m) => m.region);
    const military = this.mod.context(observer.latitude, observer.longitude, regions, new Date());
    return {
      generatedAt: new Date().toISOString(),
      weather,
      airspaceAtObserver,
      military,
    };
  }

  /** Per-aircraft context: airspace, contrail estimate, spotability. */
  async aircraftContext(aircraft: Aircraft, observer: Observer): Promise<AircraftAviationContext> {
    const regions = this.airspace.regions();
    const airspace = airspaceForPoint(
      aircraft.latitude,
      aircraft.longitude,
      aircraft.altitudeFeet,
      regions,
    );

    let contrail;
    if (aircraft.altitudeFeet !== undefined && aircraft.altitudeFeet >= 20000) {
      const ua = await this.upperAir
        .upperAirAt(aircraft.latitude, aircraft.longitude, aircraft.altitudeFeet)
        .catch(() => undefined);
      contrail = estimateContrail(aircraft.altitudeFeet, ua?.tempC, ua?.relativeHumidity);
    } else {
      contrail = estimateContrail(aircraft.altitudeFeet, undefined, undefined);
    }

    // Spotability (§20-24): elevation/slant from geometry, cloud from the nearest
    // METAR, daylight from the Sun's elevation. Weather fetch is cached.
    const weather = await this.weather
      .nearest(observer.latitude, observer.longitude)
      .catch(() => undefined);
    const look = observerLookAngles(
      observer.latitude,
      observer.longitude,
      0,
      aircraft.latitude,
      aircraft.longitude,
      (aircraft.altitudeFeet ?? 0) * FEET_TO_METRES,
    );
    const spotability = assessAircraftSpotability({
      elevationDeg: look.elevationDegrees,
      slantRangeMiles: look.slantRangeMiles,
      altitudeFeet: aircraft.altitudeFeet,
      flightCategory: weather?.flightCategory,
      cloudBaseFeet: lowestCeilingFeet(weather?.cloudSummary),
      sunElevationDeg: solarElevationDeg(observer.latitude, observer.longitude, new Date()),
    });

    return { airspace, contrail, spotability };
  }
}

/** Lowest broken/overcast cloud base (feet) from a METAR cloud summary, if any. */
function lowestCeilingFeet(summary: string | undefined): number | undefined {
  if (!summary) return undefined;
  let lowest: number | undefined;
  for (const m of summary.matchAll(/(BKN|OVC)\s+([\d,]+)/gi)) {
    const ft = Number(m[2]!.replace(/,/g, ""));
    if (Number.isFinite(ft) && (lowest === undefined || ft < lowest)) lowest = ft;
  }
  return lowest;
}
