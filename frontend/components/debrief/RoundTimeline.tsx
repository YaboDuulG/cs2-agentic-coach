"use client";

import { Fragment } from "react";
import { Card, CardHeader } from "@/components/ui";
import type { JobRound } from "@/lib/api/hooks";
import { roundWinner, sideSwitchAfter } from "./derive";
import { useDebriefFilter } from "./useDebriefFilter";

const TEAM_COLOR = { a: "var(--color-ct)", b: "var(--color-t)" } as const;

/**
 * One square per round in the winning team's colour, a gap at every side
 * switch. Click selects the round for every section below; click again clears.
 */
export function RoundTimeline({ rounds, names }: { rounds: JobRound[]; names: { a: string; b: string } }) {
  const { round: selected, setRound } = useDebriefFilter();
  const sorted = [...rounds].sort((x, y) => x.round - y.round);

  return (
    <Card>
      <CardHeader
        title="Rounds"
        description="Who won each round. Select one to scope the duels and the map."
        actions={<Legend names={names} />}
      />
      <div className="flex flex-wrap items-end gap-1" role="group" aria-label="Rounds">
        {sorted.map((r, i) => {
          const winner = roundWinner(r);
          const active = selected === r.round;
          const title = `Round ${r.round} · ${winner ? names[winner] : "no result"} · CT $${r.ct_spend.toLocaleString()} · T $${r.t_spend.toLocaleString()}`;
          return (
            <Fragment key={r.round}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setRound(active ? null : r.round)}
                title={title}
                aria-label={title}
                className="num flex h-9 w-7 flex-col items-center justify-end gap-1 rounded-(--radius-sm) text-[11px] transition-colors duration-[var(--dur-fast)]"
                style={{
                  color: active ? "var(--color-text)" : "var(--color-text-3)",
                  background: active ? "var(--color-surface-2)" : "transparent",
                  outline: active ? "1px solid var(--color-line-strong)" : undefined,
                }}
              >
                <span className="block h-4 w-4 rounded-[3px]" style={{ background: winner ? TEAM_COLOR[winner] : "var(--color-line-strong)" }} />
                {r.round}
              </button>
              {i < sorted.length - 1 && sideSwitchAfter(r.round) ? (
                <span aria-hidden="true" className="mx-1 h-6 w-px self-center" style={{ background: "var(--color-line-strong)" }} />
              ) : null}
            </Fragment>
          );
        })}
      </div>
    </Card>
  );
}

export function Legend({ names }: { names: { a: string; b: string } }) {
  return (
    <ul className="flex flex-wrap items-center gap-3 text-[12px]" style={{ color: "var(--color-text-2)" }} aria-label="Legend">
      {(["a", "b"] as const).map((t) => (
        <li key={t} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: TEAM_COLOR[t] }} />
          {names[t]}
          <span style={{ color: "var(--color-text-3)" }}>{t === "a" ? "(started CT)" : "(started T)"}</span>
        </li>
      ))}
    </ul>
  );
}
