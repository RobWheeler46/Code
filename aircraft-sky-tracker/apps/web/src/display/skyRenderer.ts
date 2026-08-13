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
  type AircraftCategory,
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
  private hitTargets: HitTarget[] = [];
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
    if (!config) return;

    const w = this.cssWidth;
    const h = this.cssHeight;
    this.scale = projectionScale(w, h, config.radiusMiles);

    this.drawReference(config, w / 2, h / 2);

    // Compute drawable placements, closest-to-centre first (label priority §72).
    const placements = [...this.states.values()]
      .map((s) => this.place(s, config, now))
      .filter((p): p is Placement => p !== undefined)
      .sort((a, b) => a.data.distanceMiles - b.data.distanceMiles);

    const occupied: Rect[] = [];
    for (const p of placements) {
      this.drawAircraft(p, config, occupied);
      this.hitTargets.push({ id: p.id, x: p.x, y: p.y });
    }
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
      category: state.data.aircraftCategory as AircraftCategory | undefined,
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
    this.drawIcon(p.x, p.y, p.track ?? 0, p.category ?? "unknown", highlight);
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
   * Type-aware silhouette, nose-up at zero rotation (FRD §51, §55, Phase 1.1).
   * Unknown/jet categories share the generic swept-wing outline.
   */
  private drawIcon(
    x: number,
    y: number,
    trackDegrees: number,
    category: AircraftCategory,
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
    switch (category) {
      case "helicopter":
        this.pathHelicopter();
        break;
      case "turboprop":
        this.pathTurboprop();
        break;
      case "piston":
        this.pathPiston();
        break;
      default:
        this.pathJet();
    }
    ctx.restore();
  }

  /** Swept-wing airliner / jet (default). */
  private pathJet(): void {
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

  /** Small straight-wing single (light / piston). */
  private pathPiston(): void {
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
  category: AircraftCategory | undefined;
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
