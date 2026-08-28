/**
 * Canvas geographic-projection renderer (FRD §27, §48-57, §71-75, Phase 1.1).
 *
 * This is a projection, not a map. Aircraft sit at their true relative position
 * about the configured centre, their outlines point along their track, and the
 * text labels stay horizontal. Positions are interpolated between ~1 Hz
 * snapshots for smooth 60 FPS motion (FRD §52).
 *
 * Phase 1.1 additions: type-aware silhouettes (jet / turboprop / light /
 * helicopter), optional trails, and optional destination arcs.
 */

import {
  type Aircraft,
  type AppConfig,
  type AircraftSilhouette,
  type Satellite,
  haversineDistanceMiles,
  bearingDegrees,
  distanceBearingToEastNorth,
  projectionScale,
  projectToScreen,
  compassDirection,
} from "@ast/shared";

const FADE_IN_MS = 500; // FRD §53
const FADE_OUT_MS = 750; // FRD §53
const IMPLAUSIBLE_JUMP_MILES = 5; // snap instead of interpolate (FRD §53)
const ICON_SIZE = 34; // px (FRD §55: ~30-45)
const TRAIL_MAX_POINTS = 24; // ~24s of history at 1 Hz
const INTEREST_COLOUR = "#ffcf6b"; // amber highlight for interesting aircraft

interface Fix {
  latitude: number;
  longitude: number;
  track: number | undefined;
  ts: number;
}

interface RenderState {
  id: string;
  prev: Fix;
  cur: Fix;
  data: Aircraft;
  firstSeenMs: number;
  removedAtMs: number | undefined;
  history: { latitude: number; longitude: number }[];
}

interface SatFix {
  az: number;
  el: number;
  ts: number;
}

interface SatState {
  prev: SatFix;
  cur: SatFix;
  data: Satellite;
  firstSeenMs: number;
}

export interface HitTarget {
  id: string;
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class SkyRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private config: AppConfig | undefined;
  private states = new Map<string, RenderState>();
  private satStates = new Map<string, SatState>();
  private hitTargets: HitTarget[] = [];
  private satHitTargets: HitTarget[] = [];
  private cssWidth = 0;
  private cssHeight = 0;
  private scale = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  setConfig(config: AppConfig): void {
    this.config = config;
  }

  /** Match the backing store to the CSS size and device pixel ratio. */
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = rect.width || window.innerWidth;
    this.cssHeight = rect.height || window.innerHeight;
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Merge a new server snapshot into the interpolation state (FRD §52-53). */
  ingest(aircraft: Aircraft[], _timestamp: number): void {
    const now = performance.now();
    const seen = new Set<string>();

    for (const a of aircraft) {
      seen.add(a.id);
      const existing = this.states.get(a.id);
      const fix: Fix = {
        latitude: a.latitude,
        longitude: a.longitude,
        track: a.trackDegrees,
        ts: now,
      };
      if (!existing) {
        this.states.set(a.id, {
          id: a.id,
          prev: fix,
          cur: fix,
          data: a,
          firstSeenMs: now,
          removedAtMs: undefined,
          history: [{ latitude: a.latitude, longitude: a.longitude }],
        });
        continue;
      }
      existing.removedAtMs = undefined;
      existing.data = a;
      const jump = haversineDistanceMiles(
        existing.cur.latitude,
        existing.cur.longitude,
        a.latitude,
        a.longitude,
      );
      // Snap on an implausible jump; otherwise interpolate from the last fix.
      existing.prev = jump > IMPLAUSIBLE_JUMP_MILES ? fix : existing.cur;
      existing.cur = fix;
      existing.history.push({ latitude: a.latitude, longitude: a.longitude });
      if (existing.history.length > TRAIL_MAX_POINTS) existing.history.shift();
    }

    // Anything absent from this snapshot begins fading out (FRD §53).
    for (const state of this.states.values()) {
      if (!seen.has(state.id) && state.removedAtMs === undefined) {
        state.removedAtMs = now;
      }
    }
  }

  getHitTargets(): HitTarget[] {
    return this.hitTargets;
  }

  /** Project a lat/lon to screen coordinates using the current viewport. */
  private projectLatLon(latitude: number, longitude: number): { x: number; y: number } {
    const config = this.config;
    if (!config) return { x: 0, y: 0 };
    const distance = haversineDistanceMiles(
      config.latitude,
      config.longitude,
      latitude,
      longitude,
    );
    const bearing = bearingDegrees(config.latitude, config.longitude, latitude, longitude);
    return projectToScreen(
      distanceBearingToEastNorth(distance, bearing),
      this.cssWidth,
      this.cssHeight,
      this.scale,
    );
  }

  /** Draw one frame at time `now` (performance.now()). */
  render(now: number): void {
    const ctx = this.ctx;
    const config = this.config;
    // Recover if the first measurement happened before layout (0-sized mount).
    if (this.cssWidth === 0 || this.cssHeight === 0) this.resize();
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.hitTargets = [];
    this.satHitTargets = [];
    if (!config) return;

    const w = this.cssWidth;
    const h = this.cssHeight;
    this.scale = projectionScale(w, h, config.radiusMiles);

    if (config.viewMode === "screen") {
      this.drawScreenBackdrop(config, w / 2, h / 2);
    } else {
      this.drawReference(config, w / 2, h / 2);
    }

    const occupied: Rect[] = [];

    // Satellites are a secondary layer, drawn under aircraft (FRD §69).
    if (config.showSatellites) this.drawSatellites(config, now, occupied);

    // Compute drawable placements, closest-to-centre first (label priority §72).
    const placements = [...this.states.values()]
      .map((s) => this.place(s, config, now))
      .filter((p): p is Placement => p !== undefined)
      .sort((a, b) => a.data.distanceMiles - b.data.distanceMiles);

    for (const p of placements) {
      this.drawAircraft(p, config, occupied);
      this.hitTargets.push({ id: p.id, x: p.x, y: p.y });
    }
  }

  /**
   * Observer-sky projection (FRD §66-67): zenith at centre, the configured
   * minimum elevation at the outer boundary; azimuth is the compass angle
   * (north up). This is deliberately different from the aircraft geographic
   * projection - satellites are not within the aircraft radius (FRD §68).
   */
  private projectSky(
    azimuthDeg: number,
    elevationDeg: number,
    minElevationDeg: number,
  ): { x: number; y: number } {
    const maxR = (Math.min(this.cssWidth, this.cssHeight) / 2) * 0.92;
    const span = Math.max(1, 90 - minElevationDeg);
    const r = maxR * clamp((90 - elevationDeg) / span, 0, 1);
    const az = (azimuthDeg * Math.PI) / 180;
    return {
      x: this.cssWidth / 2 + r * Math.sin(az),
      y: this.cssHeight / 2 - r * Math.cos(az),
    };
  }

  /** Merge a satellite snapshot into the interpolation state. */
  ingestSatellites(satellites: Satellite[], _timestamp: number): void {
    const now = performance.now();
    const seen = new Set<string>();
    for (const s of satellites) {
      seen.add(s.catalogNumber);
      const existing = this.satStates.get(s.catalogNumber);
      const fix: SatFix = { az: s.azimuthDegrees, el: s.elevationDegrees, ts: now };
      if (!existing) {
        this.satStates.set(s.catalogNumber, { prev: fix, cur: fix, data: s, firstSeenMs: now });
      } else {
        existing.prev = existing.cur;
        existing.cur = fix;
        existing.data = s;
      }
    }
    for (const [id, st] of this.satStates) {
      if (!seen.has(id)) {
        // Fade out quickly, then drop.
        if (now - st.cur.ts > 4000) this.satStates.delete(id);
      }
    }
  }

  private drawSatellites(config: AppConfig, now: number, occupied: Rect[]): void {
    const ctx = this.ctx;
    for (const st of this.satStates.values()) {
      const frac =
        config.interpolationEnabled && st.cur.ts > st.prev.ts
          ? clamp((now - st.cur.ts) / (st.cur.ts - st.prev.ts), 0, 1)
          : 1;
      const az = angleLerp(st.prev.az, st.cur.az, frac);
      const el = lerp(st.prev.el, st.cur.el, frac);
      const p = this.projectSky(az, el, config.satelliteMinElevationDeg);
      const fadeIn = clamp((now - st.firstSeenMs) / 400, 0, 1);
      this.drawSatelliteMarker(st.data, p.x, p.y, fadeIn);
      this.drawSatelliteLabel(st.data, p.x, p.y, fadeIn, occupied);
      this.satHitTargets.push({ id: st.data.catalogNumber, x: p.x, y: p.y });
    }
  }

  private drawSatelliteMarker(sat: Satellite, x: number, y: number, alpha: number): void {
    const ctx = this.ctx;
    const size = sat.category === "station" ? 7 : sat.category === "bright" ? 5.5 : 3.5;
    const colour = sat.potentiallyVisible ? "#8fe3ff" : "rgba(150,170,200,0.85)";
    ctx.save();
    ctx.globalAlpha = alpha * (sat.category === "starlink" ? 0.8 : 1);
    ctx.strokeStyle = colour;
    ctx.fillStyle = "rgba(10,16,26,0.6)";
    ctx.lineWidth = 1.4;
    if (sat.category === "starlink") {
      // Small dot.
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
    } else {
      // Diamond, distinct from aircraft outlines (FRD §52).
      ctx.beginPath();
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      if (sat.category === "station") ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawSatelliteLabel(
    sat: Satellite,
    x: number,
    y: number,
    alpha: number,
    occupied: Rect[],
  ): void {
    const ctx = this.ctx;
    const size = Math.max(11, Math.min(15, this.cssHeight / 65));
    const text = sat.name;
    ctx.font = font(size, sat.category === "station");
    const w = ctx.measureText(text).width;
    let top = y + 10;
    const rect: Rect = { x: x - w / 2, y: top, w, h: size * 1.2 };
    for (let i = 0; i < 4 && occupied.some((r) => overlaps(r, rect)); i++) {
      top += size * 1.25;
      rect.y = top;
    }
    occupied.push(rect);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = sat.potentiallyVisible ? "#8fe3ff" : "#9aa0a6";
    ctx.fillText(text, x, top);
    ctx.restore();
  }

  getSatelliteHitTargets(): HitTarget[] {
    return this.satHitTargets;
  }

  /**
   * Schematic geographic backdrop for on-screen (desk) use (FRD v3.2 screen
   * mode): concentric range rings, an 8-point compass rose with cardinal
   * labels, and a labelled centre (home) marker. Purely orientation chrome -
   * self-contained, no map tiles - so aircraft/satellites still stand out.
   */
  private drawScreenBackdrop(config: AppConfig, cx: number, cy: number): void {
    const ctx = this.ctx;
    const R = config.radiusMiles * this.scale; // outer ring = configured radius
    const fracs = [0.25, 0.5, 0.75, 1];

    ctx.save();
    ctx.lineWidth = 1;

    // Compass spokes (cardinals brighter than intercardinals).
    for (let deg = 0; deg < 360; deg += 45) {
      const rad = (deg * Math.PI) / 180;
      ctx.strokeStyle = deg % 90 === 0 ? "rgba(120,140,170,0.22)" : "rgba(120,140,170,0.10)";
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(rad) * R, cy - Math.cos(rad) * R);
      ctx.stroke();
    }

    // Range rings.
    for (const f of fracs) {
      ctx.strokeStyle = f === 1 ? "rgba(120,140,170,0.38)" : "rgba(120,140,170,0.18)";
      ctx.beginPath();
      ctx.arc(cx, cy, R * f, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Ring distance labels along a NNE diagonal, clear of the north spoke/label.
    ctx.font = font(Math.max(10, Math.min(13, this.cssHeight / 70)), false);
    ctx.fillStyle = "rgba(150,165,190,0.6)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelRad = (22 * Math.PI) / 180;
    for (const f of fracs) {
      const rr = R * f;
      ctx.fillText(
        `${fmtMiles(config.radiusMiles * f)} mi`,
        cx + Math.sin(labelRad) * rr + 3,
        cy - Math.cos(labelRad) * rr,
      );
    }

    // Cardinal labels just inside the outer ring, centred on each axis so they
    // stay on-canvas whichever dimension the ring fills (portrait or landscape).
    ctx.fillStyle = "rgba(190,205,230,0.85)";
    ctx.font = font(Math.max(12, Math.min(16, this.cssHeight / 55)), true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const rInner = R - Math.max(14, R * 0.05);
    ctx.fillText("N", cx, cy - rInner);
    ctx.fillText("S", cx, cy + rInner);
    ctx.fillText("E", cx + rInner, cy);
    ctx.fillText("W", cx - rInner, cy);

    // Centre (home) marker: small plus + postcode label.
    ctx.strokeStyle = "rgba(160,175,200,0.8)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx - 5, cy);
    ctx.lineTo(cx + 5, cy);
    ctx.moveTo(cx, cy - 5);
    ctx.lineTo(cx, cy + 5);
    ctx.stroke();
    if (config.postcode) {
      ctx.fillStyle = "rgba(150,165,190,0.7)";
      ctx.font = font(Math.max(10, Math.min(13, this.cssHeight / 70)), false);
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(config.postcode, cx, cy + 8);
    }
    ctx.restore();
  }

  private drawReference(config: AppConfig, cx: number, cy: number): void {
    const ctx = this.ctx;
    if (config.showRangeRing) {
      ctx.strokeStyle = "rgba(120,130,150,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, config.radiusMiles * this.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (config.showCentreMarker) {
      ctx.fillStyle = "rgba(160,170,190,0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private place(state: RenderState, config: AppConfig, now: number): Placement | undefined {
    // Fade lifecycle (FRD §53).
    let alpha = clamp((now - state.firstSeenMs) / FADE_IN_MS, 0, 1);
    if (state.removedAtMs !== undefined) {
      const out = 1 - (now - state.removedAtMs) / FADE_OUT_MS;
      if (out <= 0) {
        this.states.delete(state.id);
        return undefined;
      }
      alpha = Math.min(alpha, out);
    }

    const frac =
      config.interpolationEnabled && state.cur.ts > state.prev.ts
        ? clamp((now - state.cur.ts) / (state.cur.ts - state.prev.ts), 0, 1)
        : 1;

    const latitude = lerp(state.prev.latitude, state.cur.latitude, frac);
    const longitude = lerp(state.prev.longitude, state.cur.longitude, frac);
    const track = angleLerp(
      state.prev.track ?? state.cur.track ?? 0,
      state.cur.track ?? state.prev.track ?? 0,
      frac,
    );

    const screen = this.projectLatLon(latitude, longitude);

    return {
      id: state.id,
      data: state.data,
      history: state.history,
      x: screen.x,
      y: screen.y,
      track: state.data.trackDegrees === undefined ? undefined : track,
      silhouette: (state.data.silhouette as AircraftSilhouette | undefined) ?? "generic",
      alpha,
    };
  }

  private drawAircraft(p: Placement, config: AppConfig, occupied: Rect[]): void {
    const ctx = this.ctx;
    const highlight = config.highlightInteresting && p.data.interest !== undefined;

    if (config.showTrails) this.drawTrail(p);
    if (config.showDestinationArcs) this.drawDestinationArc(p);

    // Highlight ring for interesting aircraft (FRD Phase 3).
    if (highlight) {
      ctx.save();
      ctx.globalAlpha = p.alpha * 0.75;
      ctx.strokeStyle = INTEREST_COLOUR;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ICON_SIZE * 0.8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = p.alpha;
    this.drawIcon(p.x, p.y, p.track ?? 0, p.silhouette, highlight);
    ctx.restore();

    // Labels stay horizontal (FRD §51).
    const lines = this.labelLines(p.data, config);
    if (lines.length > 0) {
      this.drawLabels(p, lines, occupied);
    }
  }

  /** Fading breadcrumb trail behind an aircraft (FRD Phase 1.1). */
  private drawTrail(p: Placement): void {
    if (p.history.length < 2) return;
    const ctx = this.ctx;
    const points = p.history.map((h) => this.projectLatLon(h.latitude, h.longitude));
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1] as { x: number; y: number };
      const b = points[i] as { x: number; y: number };
      const segAlpha = (i / points.length) * 0.45 * p.alpha;
      ctx.strokeStyle = `rgba(160,180,220,${segAlpha})`;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Faint ray from the aircraft toward its destination's bearing (Phase 1.1). */
  private drawDestinationArc(p: Placement): void {
    const dest = p.data.destination;
    if (!dest || dest.latitude === undefined || dest.longitude === undefined) return;
    const ctx = this.ctx;
    const bearing = bearingDegrees(
      p.data.latitude,
      p.data.longitude,
      dest.latitude,
      dest.longitude,
    );
    const rad = (bearing * Math.PI) / 180;
    const length = Math.min(this.cssWidth, this.cssHeight) * 0.42;
    const dx = Math.sin(rad) * length; // east component -> +x
    const dy = -Math.cos(rad) * length; // north component -> -y
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.strokeStyle = "rgba(150,170,255,0.28)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 6]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Type-aware silhouette, nose-up at zero rotation (FRD §20, §51, §55).
   * The classifier picks the most specific silhouette; "generic" (and anything
   * unmatched) uses the swept-wing airliner outline.
   */
  private drawIcon(
    x: number,
    y: number,
    trackDegrees: number,
    silhouette: AircraftSilhouette,
    highlight = false,
  ): void {
    const ctx = this.ctx;
    const s = ICON_SIZE / 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((trackDegrees * Math.PI) / 180); // 0=N,90=E (FRD §51)
    ctx.scale(s, s);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = highlight ? INTEREST_COLOUR : "#f2f2f2";
    ctx.fillStyle = "rgba(10,12,16,0.55)";
    switch (silhouette) {
      case "a380": this.pathQuadWide(22, 19); break;
      case "b747": this.pathQuadWide(19, 20); break;
      case "c17": this.pathC17(); break;
      case "a400m": this.pathA400m(); break;
      case "fighter": this.pathFighter(); break;
      case "military": this.pathMilitary(); break;
      case "bizjet": this.pathBizjet(); break;
      case "turboprop": this.pathTurboprop(); break;
      case "helicopter": this.pathHelicopter(); break;
      case "light": this.pathLight(); break;
      case "b737": this.pathAirliner(true); break;
      case "a320":
      case "generic":
      default: this.pathAirliner(false);
    }
    ctx.restore();
  }

  /** Short perpendicular tick marking an engine pod. */
  private engineTick(x: number, y: number, len = 3): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y - len / 2);
    ctx.lineTo(x, y + len / 2);
    ctx.stroke();
  }

  /** Swept-wing narrowbody airliner (a320 / b737 / generic). */
  private pathAirliner(winglets: boolean): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(2, -6);
    ctx.lineTo(16, 2);
    ctx.lineTo(16, 5);
    ctx.lineTo(2, 2);
    ctx.lineTo(2, 10);
    ctx.lineTo(7, 14);
    ctx.lineTo(7, 16);
    ctx.lineTo(0, 13);
    ctx.lineTo(-7, 16);
    ctx.lineTo(-7, 14);
    ctx.lineTo(-2, 10);
    ctx.lineTo(-2, 2);
    ctx.lineTo(-16, 5);
    ctx.lineTo(-16, 2);
    ctx.lineTo(-2, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    this.engineTick(9, 1);
    this.engineTick(-9, 1);
    if (winglets) {
      ctx.beginPath();
      ctx.moveTo(16, 3.5);
      ctx.lineTo(17.5, 0.5);
      ctx.moveTo(-16, 3.5);
      ctx.lineTo(-17.5, 0.5);
      ctx.stroke();
    }
  }

  /** Four-engine widebody. wing = half-span, nose = fuselage length (a380/b747). */
  private pathQuadWide(wing: number, nose: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -nose);
    ctx.lineTo(2.6, -6);
    ctx.lineTo(wing, 3);
    ctx.lineTo(wing, 6);
    ctx.lineTo(2.6, 3);
    ctx.lineTo(2.6, 12);
    ctx.lineTo(9, 16);
    ctx.lineTo(9, 18);
    ctx.lineTo(0, 15);
    ctx.lineTo(-9, 18);
    ctx.lineTo(-9, 16);
    ctx.lineTo(-2.6, 12);
    ctx.lineTo(-2.6, 3);
    ctx.lineTo(-wing, 6);
    ctx.lineTo(-wing, 3);
    ctx.lineTo(-2.6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const x of [wing * 0.35, wing * 0.68]) {
      this.engineTick(x, 1.5);
      this.engineTick(-x, 1.5);
    }
  }

  /** Four swept jets, broad fuselage, T-tail (Boeing C-17). */
  private pathC17(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(3, -5);
    ctx.lineTo(18, 4);
    ctx.lineTo(18, 7);
    ctx.lineTo(3, 4);
    ctx.lineTo(3, 12);
    ctx.lineTo(0, 14);
    ctx.lineTo(-3, 12);
    ctx.lineTo(-3, 4);
    ctx.lineTo(-18, 7);
    ctx.lineTo(-18, 4);
    ctx.lineTo(-3, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const x of [6.5, 13]) {
      this.engineTick(x, 2);
      this.engineTick(-x, 2);
    }
    ctx.beginPath(); // T-tail
    ctx.moveTo(-7, 13);
    ctx.lineTo(7, 13);
    ctx.stroke();
  }

  /** Four turboprops, high straight wing, T-tail (Airbus A400M). */
  private pathA400m(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(2.4, -5);
    ctx.lineTo(19, -4);
    ctx.lineTo(19, -1);
    ctx.lineTo(2.4, 0);
    ctx.lineTo(2.4, 11);
    ctx.lineTo(0, 14);
    ctx.lineTo(-2.4, 11);
    ctx.lineTo(-2.4, 0);
    ctx.lineTo(-19, -1);
    ctx.lineTo(-19, -4);
    ctx.lineTo(-2.4, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    for (const x of [6.5, 13]) {
      this.engineTick(x, -2.5, 4);
      this.engineTick(-x, -2.5, 4);
    }
    ctx.beginPath(); // T-tail
    ctx.moveTo(-7, 13);
    ctx.lineTo(7, 13);
    ctx.stroke();
  }

  /** Sharp swept delta (fighter / fast jet). */
  private pathFighter(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -16);
    ctx.lineTo(2, -2);
    ctx.lineTo(13, 10);
    ctx.lineTo(11, 12);
    ctx.lineTo(2, 8);
    ctx.lineTo(3, 15);
    ctx.lineTo(0, 13);
    ctx.lineTo(-3, 15);
    ctx.lineTo(-2, 8);
    ctx.lineTo(-11, 12);
    ctx.lineTo(-13, 10);
    ctx.lineTo(-2, -2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** Broad chevron (generic military). */
  private pathMilitary(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(16, 11);
    ctx.lineTo(6, 11);
    ctx.lineTo(0, 6);
    ctx.lineTo(-6, 11);
    ctx.lineTo(-16, 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** Slim fuselage, small swept wings, rear engines, T-tail (business jet). */
  private pathBizjet(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(1.3, -3);
    ctx.lineTo(11, 4);
    ctx.lineTo(11, 6);
    ctx.lineTo(1.3, 3);
    ctx.lineTo(1.3, 10);
    ctx.lineTo(0, 13);
    ctx.lineTo(-1.3, 10);
    ctx.lineTo(-1.3, 3);
    ctx.lineTo(-11, 6);
    ctx.lineTo(-11, 4);
    ctx.lineTo(-1.3, -3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    this.engineTick(3, 9);
    this.engineTick(-3, 9);
    ctx.beginPath(); // T-tail
    ctx.moveTo(-5, 13);
    ctx.lineTo(5, 13);
    ctx.stroke();
  }

  /** Straight-wing turboprop with two nacelles. */
  private pathTurboprop(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(2, -4);
    ctx.lineTo(15, -3);
    ctx.lineTo(15, 0);
    ctx.lineTo(2, 1);
    ctx.lineTo(2, 11);
    ctx.lineTo(7, 15);
    ctx.lineTo(0, 13);
    ctx.lineTo(-7, 15);
    ctx.lineTo(-2, 11);
    ctx.lineTo(-2, 1);
    ctx.lineTo(-15, 0);
    ctx.lineTo(-15, -3);
    ctx.lineTo(-2, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Nacelles on the wings.
    ctx.beginPath();
    ctx.moveTo(8, -5);
    ctx.lineTo(8, 1);
    ctx.moveTo(-8, -5);
    ctx.lineTo(-8, 1);
    ctx.stroke();
  }

  /** Small straight-wing single (light aircraft). */
  private pathLight(): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(1.5, -5);
    ctx.lineTo(13, -3);
    ctx.lineTo(13, -1);
    ctx.lineTo(1.5, 1);
    ctx.lineTo(1.5, 9);
    ctx.lineTo(5, 12);
    ctx.lineTo(0, 11);
    ctx.lineTo(-5, 12);
    ctx.lineTo(-1.5, 9);
    ctx.lineTo(-1.5, 1);
    ctx.lineTo(-13, -1);
    ctx.lineTo(-13, -3);
    ctx.lineTo(-1.5, -5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Propeller line at the nose.
    ctx.beginPath();
    ctx.moveTo(-4, -13);
    ctx.lineTo(4, -13);
    ctx.stroke();
  }

  /** Helicopter: rotor disc, fuselage and tail boom. */
  private pathHelicopter(): void {
    const ctx = this.ctx;
    // Rotor disc.
    ctx.beginPath();
    ctx.arc(0, -1, 14, 0, Math.PI * 2);
    ctx.stroke();
    // Rotor blades.
    ctx.beginPath();
    ctx.moveTo(-14, -1);
    ctx.lineTo(14, -1);
    ctx.moveTo(0, -15);
    ctx.lineTo(0, 13);
    ctx.stroke();
    // Fuselage pod + tail boom.
    ctx.beginPath();
    ctx.ellipse(0, -1, 3.5, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(0, 15);
    ctx.lineTo(-3, 16);
    ctx.stroke();
  }

  /**
   * Build the label lines with fallbacks:
   *   identifier: registration -> callsign -> ICAO hex (FRD §74)
   *   destination: friendly/airport/code -> "Heading XX" -> nothing (FRD §17,§73)
   */
  private labelLines(a: Aircraft, config: AppConfig): LabelLine[] {
    const lines: LabelLine[] = [];
    const interesting = config.highlightInteresting && a.interest !== undefined;
    const identifier = a.registration ?? a.callsign ?? a.icaoHex;
    // Interesting aircraft always show their identifier + reason (FRD Phase 3).
    if ((config.showRegistration || interesting) && identifier) {
      lines.push({ text: identifier, primary: true });
    }
    if (interesting && a.interest) {
      lines.push({ text: a.interest.label, primary: false, accent: true });
    }
    if (config.showDestination) {
      const dest = a.destination?.displayName;
      if (dest) {
        lines.push({ text: dest, primary: false });
      } else if (a.trackDegrees !== undefined) {
        lines.push({ text: `Heading ${compassDirection(a.trackDegrees)}`, primary: false });
      }
    }
    if (config.displayMode === "informative") {
      const extras: string[] = [];
      if (config.showAltitude && a.altitudeFeet !== undefined) {
        extras.push(`${a.altitudeFeet.toLocaleString()} ft`);
      }
      if (config.showDistance) extras.push(`${a.distanceMiles.toFixed(1)} mi`);
      if (config.showFlightNumber && a.callsign) extras.push(a.callsign);
      if (extras.length > 0) lines.push({ text: extras.join("  ·  "), primary: false });
    }
    return lines;
  }

  private drawLabels(p: Placement, lines: LabelLine[], occupied: Rect[]): void {
    const ctx = this.ctx;
    const regSize = Math.max(14, Math.min(20, this.cssHeight / 45));
    const subSize = Math.max(12, Math.min(16, this.cssHeight / 60));
    const lineHeight = regSize * 1.25;

    // Measure widest line for the collision box.
    let maxW = 0;
    for (const line of lines) {
      ctx.font = font(line.primary ? regSize : subSize, line.primary);
      maxW = Math.max(maxW, ctx.measureText(line.text).width);
    }

    const blockH = lines.length * lineHeight;
    const topBase = p.y + ICON_SIZE * 0.75;

    // Nudge down to avoid collisions; drop trailing lines if still blocked (§71-72).
    let visibleLines = lines;
    let top = topBase;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rect: Rect = { x: p.x - maxW / 2, y: top, w: maxW, h: blockH };
      if (!occupied.some((r) => overlaps(r, rect))) break;
      top += lineHeight;
      if (attempt >= 3 && visibleLines.length > 1) {
        visibleLines = visibleLines.slice(0, 1); // keep registration (§72)
      }
    }
    occupied.push({ x: p.x - maxW / 2, y: top, w: maxW, h: visibleLines.length * lineHeight });

    if (top > topBase + 2) {
      // Small leader line from the icon to an offset label (FRD §71).
      ctx.save();
      ctx.globalAlpha = p.alpha * 0.5;
      ctx.strokeStyle = "#9aa0a6";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + ICON_SIZE * 0.5);
      ctx.lineTo(p.x, top);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let y = top;
    for (const line of visibleLines) {
      ctx.font = font(line.primary ? regSize : subSize, line.primary || Boolean(line.accent));
      ctx.fillStyle = line.accent
        ? INTEREST_COLOUR
        : line.primary
          ? "#f2f2f2"
          : "#9aa0a6";
      ctx.fillText(line.text, p.x, y);
      y += lineHeight;
    }
    ctx.restore();
  }
}

interface Placement {
  id: string;
  data: Aircraft;
  history: { latitude: number; longitude: number }[];
  x: number;
  y: number;
  track: number | undefined;
  silhouette: AircraftSilhouette;
  alpha: number;
}

interface LabelLine {
  text: string;
  primary: boolean;
  accent?: boolean;
}

function font(size: number, bold: boolean): string {
  return `${bold ? "600" : "400"} ${size}px Inter, Arial, sans-serif`;
}

/** Compact miles: integer when whole, else one decimal (e.g. 2.5). */
function fmtMiles(d: number): string {
  return Number.isInteger(d) ? String(d) : d.toFixed(1);
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate angles along the shortest path. */
function angleLerp(a: number, b: number, t: number): number {
  const diff = ((b - a + 540) % 360) - 180;
  return (a + diff * t + 360) % 360;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
