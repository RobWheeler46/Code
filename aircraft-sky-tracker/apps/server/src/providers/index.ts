/** Aircraft provider factory (FRD §22). */

import type { AircraftProvider } from "./types.js";
import {
  createAirplanesLiveProvider,
  createAdsbFiProvider,
} from "./reApiProvider.js";
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
    default:
      return createAdsbFiProvider();
  }
}

export type { AircraftProvider } from "./types.js";
