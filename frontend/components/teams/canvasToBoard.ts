import type { BoardJson, BoardMarker, MarkerType } from "@/components/stratbook/boardJson";
import type { StratCanvasJson } from "@/lib/api/client";

const UTILITY: Record<string, MarkerType> = { smoke: "smoke", flash: "flash", he: "he", molotov: "molotov", incendiary: "molotov" };

// Canvas coordinates are floats the bot and the API never bound; values past 1
// are read as a 1024-unit radar and clamped so a strat still lands on the map.
function norm(v: number): number {
  const n = v > 1 ? v / 1024 : v;
  return Math.min(1, Math.max(0, n));
}

/** Projects one step of a team strat's canvas onto the sketch board, read-only. */
export function boardFromCanvas(canvas: StratCanvasJson | undefined, side: string, stepIndex: number): BoardJson {
  const step = canvas?.steps?.[stepIndex];
  if (!step) return { lines: [], markers: [] };
  const playerType: MarkerType = /^ct/i.test(side) ? "CT" : "T";
  const markers: BoardMarker[] = Object.entries(step.positions ?? {}).map(([player, p]) => ({
    type: playerType,
    x: norm(p.x),
    y: norm(p.y),
    label: player,
  }));
  const lines = [];
  for (const u of step.utility ?? []) {
    const type = UTILITY[u.type?.toLowerCase()] ?? "smoke";
    markers.push({ type, x: norm(u.to.x), y: norm(u.to.y), label: u.callout });
    lines.push({
      points: [
        { x: norm(u.from.x), y: norm(u.from.y) },
        { x: norm(u.to.x), y: norm(u.to.y) },
      ],
      color: "--color-text-3",
      width: 2,
    });
  }
  return { lines, markers };
}
