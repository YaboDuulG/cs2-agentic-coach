"use client";

// 2D tactical radar — a <canvas> renderer for round playback.
//
// Rendering isolation (hard requirement): the per-tick loop never goes
// through React state. One requestAnimationFrame loop reads
// usePlayback.getState() each frame, calls advance() while playing, and
// paints straight onto the 2D context. React re-renders only when the
// telemetry prop changes (round switch / new match).
//
// Documented approximations:
// - World→canvas mapping is derived from the telemetry's own bounding box
//   (8% padding, aspect preserved, letterboxed) — pending per-map radar
//   calibration. Positions are internally consistent but not aligned to
//   official radar imagery; the optional underlay is stretched to the same
//   letterboxed viewport and is likewise approximate.
// - The "vision cone" is the motion direction from the last two trajectory
//   points — the telemetry carries no view angles.

import { useEffect, useRef } from "react";

import { RoundTelemetry, RoundTelemetryPoint } from "@/lib/api/client";
import { usePlayback } from "@/lib/stores/playback";

const TRAIL_LEN = 8; // fading trail of the last ~8 sampled positions
const CONE_HALF_ANGLE = Math.PI / 7;

interface Track {
  name: string;
  isCT: boolean;
  points: RoundTelemetryPoint[]; // sorted by tick
}

/** Index of the last point with point.tick <= tick, or -1 (binary search). */
function segmentIndex(points: RoundTelemetryPoint[], tick: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].tick <= tick) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/** Motion direction into points[endIdx] from the nearest earlier distinct
 *  point. Approximation of facing — telemetry has no view angles. */
function headingOf(points: RoundTelemetryPoint[], endIdx: number): number | null {
  for (let j = endIdx; j > 0 && j > endIdx - 4; j--) {
    const dx = points[j].x - points[j - 1].x;
    const dy = points[j].y - points[j - 1].y;
    if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
  }
  return null;
}

interface Sampled {
  x: number;
  y: number;
  idx: number;
  heading: number | null;
}

/** Linear interpolation between sampled points (telemetry samples ~every 2s).
 *  Returns null once the trajectory has ended (death or round end). */
function playerAt(points: RoundTelemetryPoint[], tick: number): Sampled | null {
  const n = points.length;
  if (n === 0) return null;
  if (tick <= points[0].tick) {
    return { x: points[0].x, y: points[0].y, idx: 0, heading: headingOf(points, 0) };
  }
  if (tick > points[n - 1].tick) return null;
  const i = segmentIndex(points, tick);
  if (i >= n - 1) {
    return { x: points[i].x, y: points[i].y, idx: i, heading: headingOf(points, i) };
  }
  const a = points[i];
  const b = points[i + 1];
  const f = (tick - a.tick) / (b.tick - a.tick || 1);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    idx: i,
    heading: headingOf(points, i + 1),
  };
}

/** Like playerAt but clamps past the trajectory end — used for grenade throw
 *  origins, which can outlive the thrower's track. */
function clampedAt(points: RoundTelemetryPoint[], tick: number): Sampled | null {
  const p = playerAt(points, tick);
  if (p) return p;
  const last = points[points.length - 1];
  if (last && tick > last.tick) {
    return { x: last.x, y: last.y, idx: points.length - 1, heading: null };
  }
  return null;
}

export function TacticalRadar({ telemetry }: { telemetry: RoundTelemetry }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resolve theme tokens once per telemetry load — never per frame.
    const styles = getComputedStyle(canvas);
    const token = (name: string, fallback: string) =>
      styles.getPropertyValue(name).trim() || fallback;
    const colors = {
      bg: token("--color-bg-primary", "#050C15"),
      grid: token("--color-border-primary", "rgba(45, 125, 210, 0.2)"),
      ct: token("--color-ct", "#2D7DD2"),
      t: token("--color-t", "#C9A227"),
      danger: token("--color-danger", "#FF4D6D"),
      accent: token("--color-accent-secondary", "#C9A227"),
      electric: token("--color-accent-electric", "#38BDF8"),
      warning: token("--color-warning", "#F59E0B"),
      text: token("--color-text-primary", "#F0F4FF"),
      muted: token("--color-text-secondary", "#8BA7CC"),
    };
    const fontFamily = styles.fontFamily || "sans-serif";

    const grenadeStyle = (type: string): { color: string; glyph: string } => {
      const t = type.toLowerCase();
      if (t.includes("smoke")) return { color: colors.muted, glyph: "S" };
      if (t.includes("flash")) return { color: colors.electric, glyph: "F" };
      if (t.includes("molotov") || t.includes("inc") || t.includes("inferno") || t.includes("fire"))
        return { color: colors.warning, glyph: "M" };
      if (t.includes("decoy")) return { color: colors.muted, glyph: "D" };
      if (t.includes("he")) return { color: colors.danger, glyph: "H" };
      return { color: colors.muted, glyph: (type[0] || "?").toUpperCase() };
    };

    // World bounds from all telemetry points, 8% padding.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    for (const p of telemetry.players) for (const pt of p.points) include(pt.x, pt.y);
    for (const k of telemetry.kills) {
      include(k.attacker_x, k.attacker_y);
      include(k.victim_x, k.victim_y);
    }
    for (const g of telemetry.grenades) include(g.x, g.y);
    if (!Number.isFinite(minX)) {
      minX = 0;
      maxX = 1;
      minY = 0;
      maxY = 1;
    }
    const padX = (maxX - minX || 1) * 0.08;
    const padY = (maxY - minY || 1) * 0.08;
    minX -= padX;
    maxX += padX;
    minY -= padY;
    maxY += padY;
    const worldW = maxX - minX;
    const worldH = maxY - minY;

    const tracks: Track[] = telemetry.players
      .map((p) => ({
        name: p.player,
        isCT: p.team.toUpperCase() === "CT",
        points: [...p.points].sort((a, b) => a.tick - b.tick),
      }))
      .filter((t) => t.points.length > 0);
    const trackByName = new Map(tracks.map((t) => [t.name, t]));

    // Optional map underlay, drawn dimmed when the env base URL is set.
    let underlay: HTMLImageElement | null = null;
    const base = process.env.NEXT_PUBLIC_MINIMAP_BASE_URL;
    if (base) {
      const mapKey = telemetry.map.split("/").pop() || telemetry.map;
      const img = new Image();
      img.onload = () => {
        underlay = img;
      };
      img.src = `${base.replace(/\/$/, "")}/${mapKey}.png`;
    }

    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    });
    ro.observe(container);

    const draw = (tick: number, selectedPlayer: string | null) => {
      const w = canvas.width;
      const h = canvas.height;
      const u = window.devicePixelRatio || 1; // device-pixel unit

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, w, h);

      // Preserve aspect ratio, letterbox (approximation — see header note).
      const scale = Math.min(w / worldW, h / worldH);
      const offX = (w - worldW * scale) / 2;
      const offY = (h - worldH * scale) / 2;
      const px = (x: number) => offX + (x - minX) * scale;
      const py = (y: number) => offY + (maxY - y) * scale; // CS2 y-up → canvas y-down

      if (underlay) {
        ctx.globalAlpha = 0.22;
        ctx.drawImage(underlay, offX, offY, worldW * scale, worldH * scale);
        ctx.globalAlpha = 1;
      }

      // Dark tactical grid.
      const step = Math.max(24, Math.min(w, h) / 14);
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      for (let gx = 0; gx <= w; gx += step) {
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
      }
      for (let gy = 0; gy <= h; gy += step) {
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Grenades — throw→land line + land marker, from the throw tick on.
      for (const g of telemetry.grenades) {
        if (g.tick > tick) continue;
        const { color, glyph } = grenadeStyle(g.type);
        const lx = px(g.x);
        const ly = py(g.y);
        const thrower = trackByName.get(g.thrower);
        const origin = thrower ? clampedAt(thrower.points, g.tick) : null;
        if (origin) {
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1 * u;
          ctx.setLineDash([4 * u, 4 * u]);
          ctx.beginPath();
          ctx.moveTo(px(origin.x), py(origin.y));
          ctx.lineTo(lx, ly);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * u;
        ctx.beginPath();
        ctx.arc(lx, ly, 7 * u, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.font = `bold ${8 * u}px ${fontFamily}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(glyph, lx, ly);
      }

      // Players — fading trail, vision-cone wedge, dot, selected label.
      for (const tr of tracks) {
        const pos = playerAt(tr.points, tick);
        if (!pos) continue; // trajectory ended (dead / round over)
        const color = tr.isCT ? colors.ct : colors.t;
        const cx = px(pos.x);
        const cy = py(pos.y);

        const startJ = Math.max(0, pos.idx - (TRAIL_LEN - 1));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5 * u;
        ctx.lineCap = "round";
        for (let j = startJ; j < pos.idx; j++) {
          const age = pos.idx - j;
          ctx.globalAlpha = 0.35 * (1 - age / TRAIL_LEN);
          ctx.beginPath();
          ctx.moveTo(px(tr.points[j].x), py(tr.points[j].y));
          ctx.lineTo(px(tr.points[j + 1].x), py(tr.points[j + 1].y));
          ctx.stroke();
        }
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(px(tr.points[pos.idx].x), py(tr.points[pos.idx].y));
        ctx.lineTo(cx, cy);
        ctx.stroke();
        ctx.globalAlpha = 1;

        if (pos.heading !== null) {
          const ang = -pos.heading; // canvas y is flipped vs. world y
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.18;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, 16 * u, ang - CONE_HALF_ANGLE, ang + CONE_HALF_ANGLE);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        const selected = selectedPlayer === tr.name;
        const rDot = (selected ? 5.5 : 4) * u;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(cx, cy, rDot, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = colors.bg;
        ctx.lineWidth = 1 * u;
        ctx.stroke();

        if (selected) {
          ctx.strokeStyle = colors.text;
          ctx.lineWidth = 1 * u;
          ctx.beginPath();
          ctx.arc(cx, cy, rDot + 3 * u, 0, Math.PI * 2);
          ctx.stroke();
          ctx.font = `600 ${11 * u}px ${fontFamily}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "alphabetic";
          ctx.strokeStyle = colors.bg;
          ctx.lineWidth = 3 * u;
          ctx.strokeText(tr.name, cx, cy - (rDot + 8 * u));
          ctx.fillStyle = colors.text;
          ctx.fillText(tr.name, cx, cy - (rDot + 8 * u));
        }
      }

      // Kill markers — X at victim position from the kill tick onward.
      for (const k of telemetry.kills) {
        if (k.tick > tick) continue;
        const x = px(k.victim_x);
        const y = py(k.victim_y);
        const s = 5 * u;
        ctx.strokeStyle = colors.danger;
        ctx.lineWidth = 2 * u;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - s, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s);
        ctx.lineTo(x - s, y + s);
        ctx.stroke();
        if (k.headshot) {
          ctx.strokeStyle = colors.accent;
          ctx.lineWidth = 1.5 * u;
          ctx.beginPath();
          ctx.arc(x, y, s + 3 * u, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    };

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const elapsed = Math.min(now - last, 250); // clamp background-tab jumps
      last = now;
      const state = usePlayback.getState();
      if (state.playing) state.advance(elapsed, telemetry.tickrate || 64);
      const after = usePlayback.getState();
      draw(after.tick, after.selectedPlayer);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [telemetry]);

  return (
    <div
      ref={containerRef}
      className="relative w-full aspect-square overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border-primary)] bg-[var(--color-bg-primary)]"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={`Tactical minimap for round ${telemetry.round} on ${telemetry.map}`}
      />
    </div>
  );
}
