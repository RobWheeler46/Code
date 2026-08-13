/** Aircraft provider factory (FRD §22). */

import type { AircraftProvider } from "./types.js";
import {
  createAirplanesLiveProvider,
  createAdsbFiProvider,
} from "./reApiProvider.js";
import { OpenSkyProvider } from "./openSkyProvider.js";
import { FailoverProvider } from "./failoverProvider.js";
import { SimulationProvider } from "./simulationProvider.js";
import type { AircraftProviderName } from "../config/env.js";

export function createAircraftProvider(
  name: AircraftProviderName,
): AircraftProvider {
  switch (name) {
    case "simulation":
      return new SimulationProvider();
    case "airplaneslive":
      return createAirplanesLiveProvider();
    case "adsbfi":
      return createAdsbFiProvider();
    case "opensky":
      return new OpenSkyProvider();
    case "failover":
    default:
      // adsb.fi primary, OpenSky backup (a genuinely independent source).
      return new FailoverProvider([createAdsbFiProvider(), new OpenSkyProvider()]);
  }
}

export type { AircraftProvider } from "./types.js";
