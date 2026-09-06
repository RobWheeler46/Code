/**
 * UK airspace provider (FRD v4.0 §35-36). The spec allows optionally loading
 * official NATS AIP datasets but warns against depending on fragile NOTAM
 * scraping, so this ships a clearly-curated approximation behind a provider seam:
 * a future `NatsDatasetProvider` can replace `StaticUkAirspaceProvider` without
 * touching the rest of the app.
 *
 * The curated set covers the aerodrome zones and danger areas around the default
 * location (accurate for the circular MATZ/ATZ/danger shapes; the control zone is
 * a circle approximation). It is not a complete or authoritative airspace picture.
 */

import type { AirspaceRegion } from "@ast/shared";

export interface AirspaceProvider {
  readonly source: string;
  regions(): AirspaceRegion[];
}

const SFC = { feet: 0, label: "SFC" };

/**
 * Curated regions near SN25 4TP (Swindon). Circles are the true shape for MATZ,
 * ATZ and most danger areas; the control zone is approximated as a circle.
 */
const CURATED_UK_REGIONS: AirspaceRegion[] = [
  {
    id: "EGVN-MATZ",
    name: "Brize Norton MATZ",
    type: "MATZ",
    airspaceClass: "G",
    lower: SFC,
    upper: { feet: 3300, label: "3,300 ft" },
    geometry: { kind: "circle", lat: 51.758, lon: -1.578, radiusNm: 5 },
    note: "Military aerodrome traffic zone.",
    source: "curated",
  },
  {
    id: "EGVN-CTR",
    name: "Brize Norton CTR",
    type: "CTR",
    airspaceClass: "D",
    lower: SFC,
    upper: { feet: 3500, label: "3,500 ft" },
    geometry: { kind: "circle", lat: 51.758, lon: -1.578, radiusNm: 5 },
    note: "Control zone (approximate circle).",
    source: "curated",
  },
  {
    id: "EGVA-MATZ",
    name: "Fairford MATZ",
    type: "MATZ",
    airspaceClass: "G",
    lower: SFC,
    upper: { feet: 3300, label: "3,300 ft" },
    geometry: { kind: "circle", lat: 51.682, lon: -1.79, radiusNm: 5 },
    source: "curated",
  },
  {
    id: "EGUB-MATZ",
    name: "Benson MATZ",
    type: "MATZ",
    airspaceClass: "G",
    lower: SFC,
    upper: { feet: 3300, label: "3,300 ft" },
    geometry: { kind: "circle", lat: 51.616, lon: -1.096, radiusNm: 5 },
    source: "curated",
  },
  {
    id: "EGDM-MATZ",
    name: "Boscombe Down MATZ",
    type: "MATZ",
    airspaceClass: "G",
    lower: SFC,
    upper: { feet: 3300, label: "3,300 ft" },
    geometry: { kind: "circle", lat: 51.152, lon: -1.747, radiusNm: 5 },
    source: "curated",
  },
  {
    id: "EGDL-ATZ",
    name: "Lyneham ATZ",
    type: "ATZ",
    airspaceClass: "G",
    lower: SFC,
    upper: { feet: 2000, label: "2,000 ft" },
    geometry: { kind: "circle", lat: 51.505, lon: -1.993, radiusNm: 2.5 },
    source: "curated",
  },
  {
    id: "SPTA-DANGER",
    name: "Salisbury Plain Danger Area",
    type: "danger",
    lower: SFC,
    upper: { feet: 50000, label: "FL500" },
    geometry: { kind: "circle", lat: 51.2, lon: -1.9, radiusNm: 12 },
    note: "Military training area (D123 complex, approximate).",
    source: "curated",
  },
];

/** Serves the curated static UK airspace set (FRD v4.0 §35). */
export class StaticUkAirspaceProvider implements AirspaceProvider {
  readonly source = "curated";
  constructor(private readonly regionsData: AirspaceRegion[] = CURATED_UK_REGIONS) {}
  regions(): AirspaceRegion[] {
    return this.regionsData;
  }
}
