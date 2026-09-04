"use client";

import { useMemo } from "react";

// Opening-duel differential — who takes the first fight of the round and how
// it goes. One diverging bar row per player: first kills grow right, first
// deaths grow left of a shared zero axis. The single stat with the highest
// round-win correlation, charted instead of buried in a table.
//
// Dataviz method: one axis; validated pair #2D7DD2 / #F2415F on the dark
// surface; thin 10px bars with 4px rounded data-ends; direct labels at bar
// ends; legend present (2 series); values wear text tokens, not series color.

interface Kill {
  killer: string;
  victim: string;
  round: number;
  tick?: number;
  killer_team?: string;
  victim_team?: string;
}

const FK_COLOR = "#2D7DD2";
const FD_COLOR = "#F2415F";

export function OpeningDuelsChart({ kills }: { kills: Kill[] }) {
  const rows = useMemo(() => {
    // First (lowest-tick) kill of each round.
    const firstByRound = new Map<number, Kill>();
    for (const k of kills) {
      const cur = firstByRound.get(k.round);
      if (!cur || (k.tick ?? 0) < (cur.tick ?? 0)) firstByRound.set(k.round, k);
    }
    const tally = new Map<string, { fk: number; fd: number; team?: string }>();
    for (const fc of firstByRound.values()) {
      if (fc.killer) {
        const e = tally.get(fc.killer) ?? { fk: 0, fd: 0, team: fc.killer_team };
        e.fk++;
        tally.set(fc.killer, e);
      }
      if (fc.victim) {
        const e = tally.get(fc.victim) ?? { fk: 0, fd: 0, team: fc.victim_team };
        e.fd++;
        tally.set(fc.victim, e);
      }
    }
    return [...tally.entries()]
      .map(([name, e]) => ({ name, ...e, diff: e.fk - e.fd }))
      .sort((a, b) => b.diff - a.diff || b.fk - a.fk);
  }, [kills]);

  const max = Math.max(1, ...rows.map((r) => Math.max(r.fk, r.fd)));

  if (rows.length === 0) return null;

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>
          Opening duels
        </h2>
        {/* Legend — identity never color-alone */}
        <div className="flex items-center gap-4 text-[11px] font-mono" style={{ color: "var(--color-text-secondary)" }}>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: FK_COLOR }} />
            First kills
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: FD_COLOR }} />
            First deaths
          </span>
        </div>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--color-text-secondary)" }}>
        Who takes the first fight of the round — and whether they win it. Entrying at a
        deficit here loses rounds before they start.
      </p>

      <div className="space-y-2.5">
        {rows.map((r) => (
          <div
            key={r.name}
            className="grid items-center gap-2"
            style={{ gridTemplateColumns: "minmax(90px, 8rem) 1fr" }}
            title={`${r.name}: ${r.fk} first kills, ${r.fd} first deaths (${r.diff >= 0 ? "+" : ""}${r.diff})`}
          >
            <span className="truncate text-xs font-medium text-right" style={{ color: "var(--color-text-primary)" }}>
              {r.name}
            </span>
            <div className="grid items-center" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {/* First deaths grow left from the shared zero axis */}
              <div className="flex items-center justify-end gap-1.5">
                {r.fd > 0 && (
                  <span className="text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>
                    {r.fd}
                  </span>
                )}
                <div
                  aria-hidden
                  style={{
                    width: `${(r.fd / max) * 100}%`,
                    height: 10,
                    background: FD_COLOR,
                    borderRadius: "4px 0 0 4px",
                  }}
                />
              </div>
              {/* First kills grow right, 2px gap at the axis */}
              <div className="flex items-center gap-1.5" style={{ borderLeft: "2px solid var(--color-border-strong)", paddingLeft: 2 }}>
                <div
                  aria-hidden
                  style={{
                    width: `${(r.fk / max) * 100}%`,
                    height: 10,
                    background: FK_COLOR,
                    borderRadius: "0 4px 4px 0",
                  }}
                />
                {r.fk > 0 && (
                  <span className="text-[10px] font-mono" style={{ color: "var(--color-text-secondary)" }}>
                    {r.fk}
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
