"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, EmptyState } from "@/components/ui";
import { clock } from "@/lib/format";
import type { AnnotatedKill } from "./derive";
import { useDebriefFilter } from "./useDebriefFilter";

const SIDE_COLOR = { CT: "var(--color-ct)", T: "var(--color-t)" } as const;

/**
 * Every kill of one round at a time, in tick order. The filter row picks the
 * round; with "All rounds" the card pages through them with Prev / Next. No
 * inner scroll area: the page scrolls.
 */
export function DuelExplorer({ annotated, rounds }: { annotated: Map<number, AnnotatedKill[]>; rounds: number[] }) {
  const { round: selected, setRound } = useDebriefFilter();
  // Page only matters under "All rounds"; a selected round wins over it.
  const [page, setPage] = useState(0);
  const pageRound = rounds[Math.min(page, Math.max(0, rounds.length - 1))];
  const round = selected ?? pageRound;
  const kills = round != null ? (annotated.get(round) ?? []) : [];
  const idx = round != null ? rounds.indexOf(round) : -1;

  const go = (next: number) => {
    const r = rounds[next];
    if (r == null) return;
    setPage(next);
    if (selected != null) setRound(r);
  };

  return (
    <Card>
      <CardHeader
        title={round != null ? `Round ${round} kills` : "Kills"}
        description="Killer → victim in tick order. Traded means the killer died within five seconds."
        actions={
          rounds.length > 1 ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => go(idx - 1)} disabled={idx <= 0} aria-label="Previous round">
                ← Prev
              </Button>
              <span className="num text-[12px]" style={{ color: "var(--color-text-3)" }}>
                {idx + 1} / {rounds.length}
              </span>
              <Button variant="ghost" size="sm" onClick={() => go(idx + 1)} disabled={idx < 0 || idx >= rounds.length - 1} aria-label="Next round">
                Next →
              </Button>
            </>
          ) : undefined
        }
      />
      {kills.length === 0 ? (
        <EmptyState title="No kills in this round" description="A round with no recorded kills: a defuse, a timeout, or a cut demo." />
      ) : (
        <ol className="divide-y hairline">
          {kills.map(({ kill, firstBlood, traded, killerSide, victimSide }, i) => (
            <li key={`${kill.tick}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
              <span className="num w-10 shrink-0" style={{ color: "var(--color-text-3)" }}>
                {clock(kill.tick)}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Actor name={kill.killer} side={killerSide} />
                <span aria-hidden="true" style={{ color: "var(--color-text-3)" }}>
                  →
                </span>
                <Actor name={kill.victim} side={victimSide} />
              </span>
              <span className="num text-[12px]" style={{ color: "var(--color-text-2)" }}>
                {kill.weapon}
              </span>
              <span className="flex items-center gap-1">
                {kill.headshot ? <Badge tone="rank">HS</Badge> : null}
                {firstBlood ? <Badge tone="accent">first blood</Badge> : null}
                {traded ? <Badge tone="neutral">traded</Badge> : null}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function Actor({ name, side }: { name: string; side: "CT" | "T" | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: side ? SIDE_COLOR[side] : "var(--color-line-strong)" }} />
      <span className="truncate font-semibold">{name}</span>
      {side ? <span className="sr-only">({side})</span> : null}
    </span>
  );
}
