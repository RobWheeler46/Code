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

  /** Per-aircraft context: airspace membership + contrail estimate. */
  async aircraftContext(aircraft: Aircraft): Promise<AircraftAviationContext> {
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

    return { airspace, contrail };
  }
}
