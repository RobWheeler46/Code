/**
 * Canvas geographic-projection renderer (FRD §27, §48-57, §71-75).
 *
 * This is a projection, not a map. Aircraft sit at their true relative position
 * about the configured centre, their outlines point along their track, and the
 * text labels stay horizontal. Positions are interpolated between ~1 Hz
 * snapshots for smooth 60 FPS motion (FRD §52).
 */

import {
  type Aircraft,
  type AppConfig,
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
  ingest(aircraft: Aircraft[], timestamp: number): void {
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
    const scale = projectionScale(w, h, config.radiusMiles);
    const centreX = w / 2;
    const centreY = h / 2;

    this.drawReference(config, scale, centreX, centreY);

    // Compute drawable placements, closest-to-centre first (label priority §72).
    const placements = [...this.states.values()]
      .map((s) => this.place(s, config, w, h, now))
      .filter((p): p is Placement => p !== undefined)
      .sort((a, b) => a.data.distanceMiles - b.data.distanceMiles);

    const occupied: Rect[] = [];
    for (const p of placements) {
      this.drawAircraft(p, config, occupied);
      this.hitTargets.push({ id: p.id, x: p.x, y: p.y });
    }
  }

  private drawReference(
    config: AppConfig,
    scale: number,
    cx: number,
    cy: number,
  ): void {
    const ctx = this.ctx;
    if (config.showRangeRing) {
      ctx.strokeStyle = "rgba(120,130,150,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, config.radiusMiles * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (config.showCentreMarker) {
      ctx.fillStyle = "rgba(160,170,190,0.7)";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private place(
    state: RenderState,
    config: AppConfig,
    w: number,
    h: number,
    now: number,
  ): Placement | undefined {
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

    const scale = projectionScale(w, h, config.radiusMiles);
    const distance = haversineDistanceMiles(
      config.latitude,
      config.longitude,
      latitude,
      longitude,
    );
    const bearing = bearingDegrees(config.latitude, config.longitude, latitude, longitude);
    const screen = projectToScreen(
      distanceBearingToEastNorth(distance, bearing),
      w,
      h,
      scale,
    );

    return {
      id: state.id,
      data: state.data,
      x: screen.x,
      y: screen.y,
      track: state.data.trackDegrees === undefined ? undefined : track,
      alpha,
    };
  }

  private drawAircraft(p: Placement, config: AppConfig, occupied: Rect[]): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    this.drawIcon(p.x, p.y, p.track ?? 0);
    ctx.restore();

    // Labels stay horizontal (FRD §51).
    const lines = this.labelLines(p.data, config);
    if (lines.length > 0) {
      this.drawLabels(p, lines, occupied);
    }
  }

  /** Purpose-designed jet silhouette, nose-up at zero rotation (FRD §55). */
  private drawIcon(x: number, y: number, trackDegrees: number): void {
    const ctx = this.ctx;
    const s = ICON_SIZE / 34;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((trackDegrees * Math.PI) / 180); // 0=N,90=E (FRD §51)
    ctx.scale(s, s);
    ctx.beginPath();
    // Nose
    ctx.moveTo(0, -16);
    // Right fuselage down to wing root
    ctx.lineTo(2, -6);
    // Right wing
    ctx.lineTo(16, 2);
    ctx.lineTo(16, 5);
    ctx.lineTo(2, 2);
    // Right rear fuselage
    ctx.lineTo(2, 10);
    // Right tailplane
    ctx.lineTo(7, 14);
    ctx.lineTo(7, 16);
    ctx.lineTo(0, 13);
    // Mirror to the left
    ctx.lineTo(-7, 16);
    ctx.lineTo(-7, 14);
    ctx.lineTo(-2, 10);
    ctx.lineTo(-2, 2);
    ctx.lineTo(-16, 5);
    ctx.lineTo(-16, 2);
    ctx.lineTo(-2, -6);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#f2f2f2";
    ctx.fillStyle = "rgba(10,12,16,0.55)";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Build the label lines with fallbacks:
   *   identifier: registration -> callsign -> ICAO hex (FRD §74)
   *   destination: friendly/airport/code -> "Heading XX" -> nothing (FRD §17,§73)
   */
  private labelLines(a: Aircraft, config: AppConfig): LabelLine[] {
    const lines: LabelLine[] = [];
    const identifier = a.registration ?? a.callsign ?? a.icaoHex;
    if (config.showRegistration && identifier) {
      lines.push({ text: identifier, primary: true });
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
      ctx.font = font(line.primary ? regSize : subSize, line.primary);
      ctx.fillStyle = line.primary ? "#f2f2f2" : "#9aa0a6";
      ctx.fillText(line.text, p.x, y);
      y += lineHeight;
    }
    ctx.restore();
  }
}

interface Placement {
  id: string;
  data: Aircraft;
  x: number;
  y: number;
  track: number | undefined;
  alpha: number;
}

interface LabelLine {
  text: string;
  primary: boolean;
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
