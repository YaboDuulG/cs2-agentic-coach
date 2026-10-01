"use client";

import { Card, CardHeader, EmptyState } from "@/components/ui";
import type { OpeningDuelRow } from "./derive";

const KILL = "var(--color-accent)";
const DEATH = "var(--color-danger)";

/**
 * Who takes the first fight of a round and whether they win it. One diverging
 * row per player: first kills grow right, first deaths grow left of a shared
 * zero. Sorted by net; values sit beside the bars so nothing needs hover.
 */
export function OpeningDuels({ rows, scoped }: { rows: OpeningDuelRow[]; scoped: boolean }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.firstKills, r.firstDeaths)));

  return (
    <Card>
      <CardHeader
        title="Opening duels"
        description={scoped ? "The first kill of the selected round." : "First kills against first deaths across the match, sorted by net."}
        actions={
          <ul className="flex items-center gap-3 text-[12px]" style={{ color: "var(--color-text-2)" }} aria-label="Legend">
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: KILL }} />
              First kills
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: DEATH }} />
              First deaths
            </li>
          </ul>
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="No opening duels" description="No kills were recorded for this selection." />
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-3 text-[13px] sm:grid-cols-[minmax(0,10rem)_1fr_3rem]">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: r.side === "CT" ? "var(--color-ct)" : r.side === "T" ? "var(--color-t)" : "var(--color-line-strong)" }}
                />
                <span className="truncate">{r.name}</span>
              </span>
              <span className="grid grid-cols-2 items-center" aria-hidden="true">
                <span className="flex items-center justify-end gap-1.5 pr-1">
                  <span className="num text-[11px]" style={{ color: "var(--color-text-3)" }}>
                    {r.firstDeaths || ""}
                  </span>
                  <span className="h-2.5 rounded-l-[4px]" style={{ width: `${(r.firstDeaths / max) * 100}%`, background: DEATH }} />
                </span>
                <span className="flex items-center gap-1.5 border-l pl-1" style={{ borderColor: "var(--color-line-strong)" }}>
                  <span className="h-2.5 rounded-r-[4px]" style={{ width: `${(r.firstKills / max) * 100}%`, background: KILL }} />
                  <span className="num text-[11px]" style={{ color: "var(--color-text-3)" }}>
                    {r.firstKills || ""}
                  </span>
                </span>
              </span>
              <span className="num text-right font-semibold" style={{ color: r.net > 0 ? "var(--color-good)" : r.net < 0 ? "var(--color-danger)" : "var(--color-text-2)" }}>
                <span className="sr-only">
                  {r.firstKills} first kills, {r.firstDeaths} first deaths, net
                </span>
                {r.net > 0 ? `+${r.net}` : r.net}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
