/** Aircraft provider abstraction (FRD §22, §102). */

import type { ProviderAircraft } from "@ast/shared";

/**
 * The one interface the rest of the backend depends on. Alternative sources
 * (Airplanes.live, local ADS-B, OpenSky, simulation) all implement this so the
 * frontend never learns which provider produced the data (FRD §102).
 */
export interface AircraftProvider {
  readonly name: string;
  fetchAircraft(
    latitude: number,
    longitude: number,
    radiusMiles: number,
  ): Promise<ProviderAircraft[]>;
}
