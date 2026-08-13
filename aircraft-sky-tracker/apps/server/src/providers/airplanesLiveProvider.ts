/**
 * Backwards-compatible shim. The airplanes.live adapter is now the generic
 * re-api provider (see reApiProvider.ts), since airplanes.live, adsb.fi and
 * adsb.lol share one JSON format.
 */
export {
  ReApiProvider as AirplanesLiveProvider,
  createAirplanesLiveProvider,
} from "./reApiProvider.js";
