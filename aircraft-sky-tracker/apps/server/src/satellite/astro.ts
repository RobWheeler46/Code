/**
 * Minimal solar-position + illumination helpers for satellite visibility
 * (FRD v3.2 §46). Low-precision Sun ephemeris (Astronomical Almanac) - accurate
 * to a fraction of a degree, which is ample for "is this pass visible" logic.
 */

export const EARTH_RADIUS_KM = 6378.137;
const DEG2RAD = Math.PI / 180;
const AU_KM = 149597870.7;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function julianDate(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Sun position in Earth-centred inertial coordinates (km). */
export function sunEci(date: Date): Vec3 {
  const jd = julianDate(date);
  const n = jd - 2451545.0;
  const T = n / 36525;
  const L = (280.46 + 0.9856474 * n) * DEG2RAD; // mean longitude
  const g = (357.528 + 0.9856003 * n) * DEG2RAD; // mean anomaly
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG2RAD;
  const eps = (23.439 - 0.0000004 * n) * DEG2RAD; // obliquity
  const rAu = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  const r = rAu * AU_KM;
  void T;
  return {
    x: r * Math.cos(lambda),
    y: r * Math.cos(eps) * Math.sin(lambda),
    z: r * Math.sin(eps) * Math.sin(lambda),
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function magnitude(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

/**
 * Whether a satellite at ECI position `sat` (km) is sunlit (not in Earth's
 * shadow), using a cylindrical umbra approximation.
 */
export function isSunlit(sat: Vec3, sun: Vec3): boolean {
  const sunMag = magnitude(sun);
  if (sunMag === 0) return true;
  const sunDir: Vec3 = { x: sun.x / sunMag, y: sun.y / sunMag, z: sun.z / sunMag };
  const along = dot(sat, sunDir);
  if (along >= 0) return true; // on the sunward side of Earth
  // Perpendicular distance from the Earth-Sun line.
  const perp: Vec3 = {
    x: sat.x - along * sunDir.x,
    y: sat.y - along * sunDir.y,
    z: sat.z - along * sunDir.z,
  };
  return magnitude(perp) > EARTH_RADIUS_KM;
}
