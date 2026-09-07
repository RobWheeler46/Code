/**
 * Simulated aircraft provider for development and testing (FRD §91-92).
 *
 * Generates aircraft that enter the area, move across it, occasionally turn and
 * leave it. Some have known destinations (callsigns the RouteService's
 * simulation table recognises), some have missing destinations, and one has a
 * missing registration - exercising the full UI without live traffic overhead.
 */

import type { ProviderAircraft } from "@ast/shared";
import { toRadians } from "@ast/shared";
import type { AircraftProvider } from "./types.js";

const MILES_PER_DEGREE_LAT = 69.0;
const MIN_ACTIVE = 7;
const MAX_ACTIVE = 12;

interface Template {
  icaoHex: string;
  registration?: string;
  callsign?: string;
  aircraftTypeCode?: string;
  altitudeFeet: number;
  groundSpeedKnots: number;
  onGround?: boolean;
  /** Climb (+) / descent (-) rate, ft/min; drives altitude and display colour. */
  verticalRateFpm?: number;
}

/**
 * Callsigns marked "known" are resolved to destinations by RouteService's
 * simulation table. Others exercise the heading / registration fallbacks.
 */
const ROSTER: Template[] = [
  { icaoHex: "SIM001", registration: "G-EUUA", callsign: "BAW1462", aircraftTypeCode: "A320", altitudeFeet: 13250, groundSpeedKnots: 312, verticalRateFpm: 1800 },
  { icaoHex: "SIM002", registration: "G-EZTA", callsign: "EZY812", aircraftTypeCode: "A319", altitudeFeet: 9800, groundSpeedKnots: 280, verticalRateFpm: -1500 },
  { icaoHex: "SIM003", registration: "G-LCYP", callsign: "RYR4TG", aircraftTypeCode: "B738", altitudeFeet: 15200, groundSpeedKnots: 330, verticalRateFpm: 0 },
  { icaoHex: "SIM004", registration: "PH-BXA", callsign: "KLM43F", aircraftTypeCode: "B738", altitudeFeet: 21000, groundSpeedKnots: 360, verticalRateFpm: 1200 },
  { icaoHex: "SIM005", registration: "G-TAWK", callsign: "TOM7YT", aircraftTypeCode: "B738", altitudeFeet: 7400, groundSpeedKnots: 260, verticalRateFpm: -900 },
  { icaoHex: "SIM006", registration: "G-EZUI", callsign: "EZY23UI", aircraftTypeCode: "A320", altitudeFeet: 4200, groundSpeedKnots: 240, verticalRateFpm: -1800 },
  // Registration present, callsign unknown to the route table -> heading fallback.
  { icaoHex: "SIM007", registration: "G-ABCD", callsign: "PVT001", aircraftTypeCode: "C172", altitudeFeet: 2500, groundSpeedKnots: 110, verticalRateFpm: 0 },
  // No registration and no callsign -> displays ICAO hex (FRD §74).
  { icaoHex: "SIM008", aircraftTypeCode: "PA28", altitudeFeet: 1800, groundSpeedKnots: 95, verticalRateFpm: 500 },
  // Distinct silhouettes / interesting aircraft (FRD v3.0 §20, §67).
  { icaoHex: "SIM009", registration: "A6-EDA", callsign: "UAE7", aircraftTypeCode: "A388", altitudeFeet: 38000, groundSpeedKnots: 480, verticalRateFpm: 0 },
  { icaoHex: "SIM010", registration: "G-CIVD", callsign: "BAW9", aircraftTypeCode: "B744", altitudeFeet: 34000, groundSpeedKnots: 470, verticalRateFpm: -1000 },
  { icaoHex: "SIM011", registration: "ZM406", callsign: "RRR406", aircraftTypeCode: "A400", altitudeFeet: 6000, groundSpeedKnots: 260, verticalRateFpm: 0 },
  { icaoHex: "SIM012", registration: "ZZ173", callsign: "RRR73", aircraftTypeCode: "C17", altitudeFeet: 8000, groundSpeedKnots: 300, verticalRateFpm: 1500 },
  { icaoHex: "SIM013", registration: "ZK355", callsign: "TARTN1", aircraftTypeCode: "EUFI", altitudeFeet: 5000, groundSpeedKnots: 420, verticalRateFpm: 2500 },
  { icaoHex: "SIM014", registration: "G-BIZJ", callsign: "EJA123", aircraftTypeCode: "E55P", altitudeFeet: 28000, groundSpeedKnots: 400, verticalRateFpm: -1200 },
  { icaoHex: "SIM015", registration: "G-POLA", callsign: "NPAS01", aircraftTypeCode: "EC35", altitudeFeet: 1200, groundSpeedKnots: 120, verticalRateFpm: 0 },
  { icaoHex: "SIM016", registration: "G-SPIT", aircraftTypeCode: "SPIT", altitudeFeet: 1500, groundSpeedKnots: 180, verticalRateFpm: 0 },
  // On the ground (taxiing) - hidden when "hide ground aircraft" is enabled.
  { icaoHex: "SIM017", registration: "G-TAXI", callsign: "GND17", aircraftTypeCode: "A320", altitudeFeet: 0, groundSpeedKnots: 12, onGround: true, verticalRateFpm: 0 },
];

interface SimFlight extends Template {
  latitude: number;
  longitude: number;
  trackDegrees: number;
  nextTurnAt: number;
}

export class SimulationProvider implements AircraftProvider {
  readonly name = "simulation";

  private active = new Map<string, SimFlight>();
  private lastTickMs = Date.now();
  private rosterCursor = 0;

  async fetchAircraft(
    latitude: number,
    longitude: number,
    radiusMiles: number,
  ): Promise<ProviderAircraft[]> {
    const now = Date.now();
    const dtSeconds = Math.min((now - this.lastTickMs) / 1000, 5);
    this.lastTickMs = now;

    this.advance(dtSeconds);
    this.cull(latitude, longitude, radiusMiles);
    this.spawnToTarget(latitude, longitude, radiusMiles, now);

    return [...this.active.values()].map((f) => ({
      icaoHex: f.icaoHex,
      registration: f.registration,
      aircraftTypeCode: f.aircraftTypeCode,
      callsign: f.callsign,
      latitude: f.latitude,
      longitude: f.longitude,
      altitudeFeet: f.altitudeFeet,
      groundSpeedKnots: f.groundSpeedKnots,
      trackDegrees: Math.round(f.trackDegrees),
      onGround: f.onGround,
      verticalRateFpm: f.onGround ? 0 : f.verticalRateFpm,
      positionAgeSeconds: 1,
    }));
  }

  private advance(dtSeconds: number): void {
    const now = Date.now();
    for (const f of this.active.values()) {
      // Occasional gentle turn (FRD §91).
      if (now >= f.nextTurnAt) {
        f.trackDegrees = (f.trackDegrees + (Math.random() * 40 - 20) + 360) % 360;
        f.nextTurnAt = now + 8000 + Math.random() * 12000;
      }
      const distanceMiles = (f.groundSpeedKnots * 1.15078 * dtSeconds) / 3600;
      const north = distanceMiles * Math.cos(toRadians(f.trackDegrees));
      const east = distanceMiles * Math.sin(toRadians(f.trackDegrees));
      f.latitude += north / MILES_PER_DEGREE_LAT;
      f.longitude +=
        east / (MILES_PER_DEGREE_LAT * Math.cos(toRadians(f.latitude)));
      // Evolve altitude by the vertical rate; clamp and hold at the bounds.
      if (!f.onGround && f.verticalRateFpm) {
        const next = f.altitudeFeet + (f.verticalRateFpm * dtSeconds) / 60;
        f.altitudeFeet = Math.max(500, Math.min(42000, next));
      }
    }
  }

  private cull(lat: number, lon: number, radiusMiles: number): void {
    const limit = radiusMiles * 1.4;
    for (const [hex, f] of this.active) {
      if (roughMiles(lat, lon, f.latitude, f.longitude) > limit) {
        this.active.delete(hex);
      }
    }
  }

  private spawnToTarget(
    lat: number,
    lon: number,
    radiusMiles: number,
    now: number,
  ): void {
    const target = MIN_ACTIVE + Math.floor(Math.random() * (MAX_ACTIVE - MIN_ACTIVE + 1));
    let guard = ROSTER.length;
    while (this.active.size < target && guard-- > 0) {
      const template = ROSTER[this.rosterCursor % ROSTER.length] as Template;
      this.rosterCursor++;
      if (this.active.has(template.icaoHex)) continue;
      this.active.set(template.icaoHex, this.spawn(template, lat, lon, radiusMiles, now));
    }
  }

  private spawn(
    template: Template,
    lat: number,
    lon: number,
    radiusMiles: number,
    now: number,
  ): SimFlight {
    const bearingFromCentre = Math.random() * 360;
    const distance = radiusMiles * (0.85 + Math.random() * 0.15);
    const north = distance * Math.cos(toRadians(bearingFromCentre));
    const east = distance * Math.sin(toRadians(bearingFromCentre));
    const startLat = lat + north / MILES_PER_DEGREE_LAT;
    const startLon = lon + east / (MILES_PER_DEGREE_LAT * Math.cos(toRadians(lat)));
    // Fly roughly across the area (towards centre, +/- 50 degrees).
    const towardsCentre = (bearingFromCentre + 180) % 360;
    const track = (towardsCentre + (Math.random() * 100 - 50) + 360) % 360;
    return {
      ...template,
      latitude: startLat,
      longitude: startLon,
      trackDegrees: track,
      nextTurnAt: now + 8000 + Math.random() * 12000,
    };
  }
}

/** Flat-earth mile approximation - adequate for a ~10 mile simulation cull. */
function roughMiles(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * MILES_PER_DEGREE_LAT;
  const dLon =
    (lon2 - lon1) * MILES_PER_DEGREE_LAT * Math.cos(toRadians((lat1 + lat2) / 2));
  return Math.hypot(dLat, dLon);
}
