/**
 * Board document shared by PlanningBoard, CritiquePanel and the stratbook
 * page. Coordinates are normalised 0..1 so a sketch is resolution-independent;
 * colours are token names (`--color-ct`) resolved at draw time so a saved
 * strat follows the active theme.
 */

export interface BoardPoint {
  x: number;
  y: number;
}

export interface BoardLine {
  points: BoardPoint[];
  color: string;
  width: number;
}

export type MarkerType = "CT" | "T" | "smoke" | "flash" | "he" | "molotov";

export interface BoardMarker {
  type: MarkerType;
  x: number;
  y: number;
  label?: string;
}

export interface BoardJson {
  lines: BoardLine[];
  markers: BoardMarker[];
}

export const MAPS: { id: string; name: string }[] = [
  { id: "de_mirage", name: "Mirage" },
  { id: "de_nuke", name: "Nuke" },
  { id: "de_anubis", name: "Anubis" },
  { id: "de_ancient", name: "Ancient" },
  { id: "de_inferno", name: "Inferno" },
  { id: "de_vertigo", name: "Vertigo" },
  { id: "de_dust2", name: "Dust 2" },
];

export const MARKER_TYPES: MarkerType[] = ["CT", "T", "smoke", "flash", "he", "molotov"];

/** Fixed colours per CS utility, the same in every theme. */
export const MARKER_TOKEN: Record<MarkerType, string> = {
  CT: "--color-ct",
  T: "--color-t",
  smoke: "--color-text-3",
  flash: "--color-rank",
  he: "--color-warning",
  molotov: "--color-danger",
};

export const MARKER_NAME: Record<MarkerType, string> = {
  CT: "CT",
  T: "T",
  smoke: "Smoke",
  flash: "Flash",
  he: "HE",
  molotov: "Molotov",
};

export const MARKER_LABEL: Record<MarkerType, string> = {
  CT: "CT",
  T: "T",
  smoke: "SM",
  flash: "FL",
  he: "HE",
  molotov: "MO",
};

export const PEN_TOKENS: { token: string; name: string }[] = [
  { token: "--color-ct", name: "CT blue" },
  { token: "--color-t", name: "T gold" },
  { token: "--color-rank", name: "Yellow" },
  { token: "--color-focus", name: "Light blue" },
];

export function emptyBoard(): BoardJson {
  return { lines: [], markers: [] };
}

export function isBoardEmpty(b: BoardJson): boolean {
  return b.lines.length === 0 && b.markers.length === 0;
}

// Strats saved by the previous board used 800px pixel coordinates and
// capitalised marker names; both are folded into the current shape here.
const LEGACY_SIDE = 800;
const LEGACY_TYPES: Record<string, MarkerType> = {
  ct: "CT",
  t: "T",
  smoke: "smoke",
  flash: "flash",
  he: "he",
  molotov: "molotov",
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Parse a `strategy_json` string. Returns null when it is not a board. */
export function parseBoard(raw: string): { board: BoardJson; map?: string } | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const o = data as { map?: unknown; lines?: unknown; markers?: unknown };

  const lines: BoardLine[] = [];
  let maxCoord = 0;
  if (Array.isArray(o.lines)) {
    for (const l of o.lines as unknown[]) {
      const line = l as { points?: unknown; color?: unknown; width?: unknown };
      if (!Array.isArray(line.points)) continue;
      const points: BoardPoint[] = [];
      for (const p of line.points as unknown[]) {
        const pt = p as { x?: unknown; y?: unknown };
        const x = num(pt.x);
        const y = num(pt.y);
        if (x === null || y === null) continue;
        maxCoord = Math.max(maxCoord, x, y);
        points.push({ x, y });
      }
      if (points.length === 0) continue;
      lines.push({ points, color: typeof line.color === "string" ? line.color : PEN_TOKENS[0].token, width: num(line.width) ?? 3 });
    }
  }

  const markers: BoardMarker[] = [];
  if (Array.isArray(o.markers)) {
    for (const m of o.markers as unknown[]) {
      const mk = m as { type?: unknown; x?: unknown; y?: unknown; label?: unknown };
      const type = typeof mk.type === "string" ? LEGACY_TYPES[mk.type.toLowerCase()] : undefined;
      const x = num(mk.x);
      const y = num(mk.y);
      if (!type || x === null || y === null) continue;
      maxCoord = Math.max(maxCoord, x, y);
      markers.push({ type, x, y, ...(typeof mk.label === "string" ? { label: mk.label } : {}) });
    }
  }

  if (maxCoord > 1) {
    for (const l of lines) l.points = l.points.map((p) => ({ x: p.x / LEGACY_SIDE, y: p.y / LEGACY_SIDE }));
    for (const m of markers) {
      m.x /= LEGACY_SIDE;
      m.y /= LEGACY_SIDE;
    }
  }

  return { board: { lines, markers }, map: typeof o.map === "string" ? o.map : undefined };
}
