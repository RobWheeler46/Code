/** GeoService: distance, bearing and radius filtering about a centre (FRD §29). */

import { haversineDistanceMiles, bearingDegrees } from "@ast/shared";

export interface Centre {
  latitude: number;
  longitude: number;
}

export class GeoService {
  private centre: Centre;

  constructor(centre: Centre) {
    this.centre = centre;
  }

  setCentre(centre: Centre): void {
    this.centre = centre;
  }

  getCentre(): Centre {
    return this.centre;
  }

  distanceMiles(latitude: number, longitude: number): number {
    return haversineDistanceMiles(
      this.centre.latitude,
      this.centre.longitude,
      latitude,
      longitude,
    );
  }

  bearingFromCentre(latitude: number, longitude: number): number {
    return bearingDegrees(
      this.centre.latitude,
      this.centre.longitude,
      latitude,
      longitude,
    );
  }

  withinRadius(latitude: number, longitude: number, radiusMiles: number): boolean {
    return this.distanceMiles(latitude, longitude) <= radiusMiles;
  }
}
