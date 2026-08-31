/**
 * Automatic Location Discovery model (FRD v3.6). A location has a source and a
 * confidence so the app knows how trustworthy the observer centre is - an
 * IP-derived area is not equivalent to a postcode or device GPS fix (FRD §4, §8).
 */

/** Where a location came from, lowest-to-highest inherent precision (FRD §17). */
export type LocationSource = "default" | "ip" | "device" | "postcode" | "manual";

/** How trustworthy the centre point is (FRD §8). */
export type LocationConfidence = "precise" | "good" | "approximate" | "coarse" | "unknown";

/** A resolved location returned by detection / used as the observer centre. */
export interface DetectedLocation {
  latitude: number;
  longitude: number;
  source: LocationSource;
  confidence: LocationConfidence;
  /** Provider accuracy radius in km, where known (FRD §5). */
  accuracyRadiusKm?: number;
  /** Human area label, e.g. "Swindon, Wiltshire" (FRD §3, §25). */
  displayName?: string;
  detectedAt: string;
}

/** IP accuracy radius (km) below which a network location is "approximate". */
export const IP_APPROXIMATE_RADIUS_KM = 50;

/**
 * Classify confidence from the source and (for IP) the accuracy radius (FRD §8).
 * Device fixes are precise; explicit postcode/manual are good; IP is approximate
 * or coarse depending on its radius; the system default is treated as good (it is
 * a real configured postcode).
 */
export function classifyConfidence(
  source: LocationSource,
  accuracyRadiusKm?: number,
): LocationConfidence {
  switch (source) {
    case "device":
      return "precise";
    case "postcode":
    case "manual":
    case "default":
      return "good";
    case "ip":
      if (accuracyRadiusKm === undefined) return "approximate";
      return accuracyRadiusKm <= IP_APPROXIMATE_RADIUS_KM ? "approximate" : "coarse";
    default:
      return "unknown";
  }
}

/** True Sky needs an accurate observer; warn when the fix is only coarse (FRD §10). */
export function locationTooApproximateForTrueSky(confidence: LocationConfidence): boolean {
  return confidence === "coarse" || confidence === "unknown";
}

/** Short human label for a confidence level (for the location indicator, §25). */
export function confidenceLabel(confidence: LocationConfidence): string {
  switch (confidence) {
    case "precise":
      return "Precise";
    case "good":
      return "Good";
    case "approximate":
      return "Approximate";
    case "coarse":
      return "Very approximate";
    default:
      return "Unknown";
  }
}

/** Short human label for a location source (for the location indicator, §25). */
export function sourceLabel(source: LocationSource): string {
  switch (source) {
    case "device":
      return "Device location";
    case "postcode":
      return "Postcode";
    case "manual":
      return "Chosen on map";
    case "ip":
      return "Network / IP";
    default:
      return "Default location";
  }
}
