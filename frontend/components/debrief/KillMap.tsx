"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui";
import { mapLabel } from "@/lib/format";
import { killBounds, type AnnotatedKill } from "./derive";

const SIZE = 600;
const SIDE_COLOR = { CT: "var(--color-ct)", T: "var(--color-t)" } as const;

/**
 * Kill positions for the selected rounds, projected onto the bounding box of
 * every kill in the match (so the frame is stable when the filter changes).
 * No map image is available; a grid gives the eye something to anchor to.
 */
export function KillMap({ matchId, map, kills, allKills }: { matchId: string; map?: string | null; kills: AnnotatedKill[]; allKills: AnnotatedKill[] }) {
  const bounds = useMemo(() => killBounds(allKills.map((k) => k.kill)), [allKills]);

  const project = (x: number, y: number) => {
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * SIZE,
      // Game Y grows north; SVG Y grows down.
      y: SIZE - ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * SIZE,
    };
  };

  const marks = kills.filter(({ kill }) => !(kill.attacker_x === 0 && kill.attacker_y === 0 && kill.victim_x === 0 && kill.victim_y === 0));

  return (
    <Card>
      <CardHeader
        title="Kill map"
        description={`${mapLabel(map)} · kill positions in game coordinates. Dots are killers, crosses are victims.`}
        actions={
          <Link href={`/analysis/${matchId}/replay`} className="link flex items-center gap-1 text-sm">
            Open replay lab (beta) <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        }
      />
      {!bounds || marks.length === 0 ? (
        <EmptyState title="No positions to draw" description="This demo carried no kill coordinates for the selected rounds." />
      ) : (
        <>
          <ul className="mb-3 flex flex-wrap items-center gap-4 text-[12px]" style={{ color: "var(--color-text-2)" }} aria-label="Legend">
            {(["CT", "T"] as const).map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: SIDE_COLOR[s], boxShadow: "0 0 0 2px var(--color-bg)" }} />
                {s} kill
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="num text-[13px] leading-none" style={{ color: "var(--color-text-3)" }}>
                ×
              </span>
              victim
            </li>
            <li className="num" style={{ color: "var(--color-text-3)" }}>
              {marks.length} {marks.length === 1 ? "kill" : "kills"}
            </li>
          </ul>
          <div className="surface-2 mx-auto w-full max-w-xl overflow-hidden p-2">
            <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="block h-auto w-full" role="img" aria-label={`${marks.length} kill positions on ${mapLabel(map)}`}>
              <defs>
                <pattern id="killmap-grid" width={SIZE / 12} height={SIZE / 12} patternUnits="userSpaceOnUse">
                  <path d={`M ${SIZE / 12} 0 L 0 0 0 ${SIZE / 12}`} fill="none" stroke="var(--color-line)" strokeWidth="1" />
                </pattern>
              </defs>
              <rect width={SIZE} height={SIZE} fill="var(--color-bg-2)" />
              <rect width={SIZE} height={SIZE} fill="url(#killmap-grid)" />
              {marks.map(({ kill, killerSide }, i) => {
                const a = project(kill.attacker_x, kill.attacker_y);
                const v = project(kill.victim_x, kill.victim_y);
                const color = killerSide ? SIDE_COLOR[killerSide] : "var(--color-text-3)";
                const title = `R${kill.round} · ${kill.killer} → ${kill.victim} (${kill.weapon}${kill.headshot ? ", HS" : ""})`;
                return (
                  <g key={`${kill.round}-${kill.tick}-${i}`}>
                    <title>{title}</title>
                    <line x1={a.x} y1={a.y} x2={v.x} y2={v.y} stroke={color} strokeWidth="1" strokeOpacity="0.35" />
                    <g stroke="var(--color-text-3)" strokeWidth="1.5" strokeLinecap="round">
                      <line x1={v.x - 4} y1={v.y - 4} x2={v.x + 4} y2={v.y + 4} />
                      <line x1={v.x - 4} y1={v.y + 4} x2={v.x + 4} y2={v.y - 4} />
                    </g>
                    <circle cx={a.x} cy={a.y} r="4" fill={color} stroke="var(--color-bg)" strokeWidth="2" />
                  </g>
                );
              })}
            </svg>
          </div>
        </>
      )}
    </Card>
  );
}
