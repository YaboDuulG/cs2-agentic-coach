"use client";

import { useMemo, useState } from "react";

// Duel Explorer — the kill feed rebuilt for coaching. Kills grouped by round
// with the round winner, names colored by starting team, weapon + headshot
// markers, FIRST BLOOD on each round's opener, and a "traded" tag on kills
// that were answered within the 5s trade window. A player filter narrows the
// feed to one player's fights (their kills AND their deaths).
//
// Team colors: #2D7DD2 / #F2415F — validated pair (dataviz six checks, dark
// surface #08152A). Identity is never color-alone: names are text, tags are
// labeled chips.

interface Kill {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
  tick?: number;
  headshot?: boolean;
  killer_team?: string;
  victim_team?: string;
}

interface RoundInfo {
  round: number;
  winner: string;
}

const TEAM_A_COLOR = "#2D7DD2"; // started CT
const TEAM_B_COLOR = "#F2415F"; // started T
const TRADE_WINDOW_TICKS = 5 * 64;

function teamColor(team?: string): string {
  if (team === "CT") return TEAM_A_COLOR;
  if (team === "TERRORIST" || team === "T") return TEAM_B_COLOR;
  return "var(--color-text-secondary)";
}

function formatWeapon(weapon: string): string {
  return (weapon || "")
    .replace(/^weapon_/i, "")
    .replace(/_/g, " ")
    .trim();
}

export function DuelExplorer({
  kills,
  rounds,
  selectedRound,
}: {
  kills: Kill[];
  rounds: RoundInfo[];
  selectedRound: number | null;
}) {
  const [playerFilter, setPlayerFilter] = useState<string | null>(null);

  const players = useMemo(() => {
    const seen = new Map<string, string | undefined>();
    for (const k of kills) {
      if (k.killer && !seen.has(k.killer)) seen.set(k.killer, k.killer_team);
      if (k.victim && !seen.has(k.victim)) seen.set(k.victim, k.victim_team);
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [kills]);

  const winnerByRound = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of rounds) m.set(r.round, r.winner);
    return m;
  }, [rounds]);

  // Round -> ordered kills, plus per-kill annotations (first blood, traded).
  const grouped = useMemo(() => {
    const byRound = new Map<number, Kill[]>();
    for (const k of kills) {
      if (!byRound.has(k.round)) byRound.set(k.round, []);
      byRound.get(k.round)!.push(k);
    }
    const out: { round: number; entries: { kill: Kill; firstBlood: boolean; traded: boolean }[] }[] = [];
    for (const [round, list] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
      const ordered = [...list].sort((a, b) => (a.tick ?? 0) - (b.tick ?? 0));
      const entries = ordered.map((kill, i) => ({
        kill,
        firstBlood: i === 0,
        // Answered: the killer dies to anyone within the trade window.
        traded: ordered.some(
          (later) =>
            later.victim === kill.killer &&
            (later.tick ?? 0) > (kill.tick ?? 0) &&
            (later.tick ?? 0) <= (kill.tick ?? 0) + TRADE_WINDOW_TICKS,
        ),
      }));
      out.push({ round, entries });
    }
    return out;
  }, [kills]);

  const visible = grouped
    .filter((g) => selectedRound == null || g.round === selectedRound)
    .map((g) => ({
      ...g,
      entries: playerFilter
        ? g.entries.filter(
            (e) => e.kill.killer === playerFilter || e.kill.victim === playerFilter,
          )
        : g.entries,
    }))
    .filter((g) => g.entries.length > 0);

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>
          Duel explorer
        </h2>
        <p className="text-xs font-mono" style={{ color: "var(--color-text-muted)" }}>
          {selectedRound != null ? `Round ${selectedRound}` : "All rounds"}
          {playerFilter ? ` · ${playerFilter}` : ""}
        </p>
      </div>
      <p className="text-sm mb-4" style={{ color: "var(--color-text-secondary)" }}>
        Every kill, round by round — who opened, who got traded.
      </p>

      {/* Player filter — one row above the data, per interaction rules */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        <button
          onClick={() => setPlayerFilter(null)}
          className="rounded-full px-2.5 py-1 text-[11px] font-mono transition-colors"
          style={{
            border: "1px solid var(--color-border-primary)",
            background: playerFilter === null ? "var(--color-bg-secondary)" : "transparent",
            color:
              playerFilter === null
                ? "var(--color-text-primary)"
                : "var(--color-text-secondary)",
          }}
        >
          All players
        </button>
        {players.map(([name, team]) => (
          <button
            key={name}
            onClick={() => setPlayerFilter(playerFilter === name ? null : name)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-mono transition-colors"
            style={{
              border: "1px solid var(--color-border-primary)",
              background:
                playerFilter === name ? "var(--color-bg-secondary)" : "transparent",
              color:
                playerFilter === name
                  ? "var(--color-text-primary)"
                  : "var(--color-text-secondary)",
            }}
            title={`Show only ${name}'s kills and deaths`}
          >
            <span
              aria-hidden
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: teamColor(team) }}
            />
            {name}
          </button>
        ))}
      </div>

      <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-2">
        {visible.length === 0 && (
          <p className="text-sm py-6 text-center" style={{ color: "var(--color-text-muted)" }}>
            No duels match this filter.
          </p>
        )}
        {visible.map(({ round, entries }) => (
          <div key={round}>
            <div
              className="flex items-center gap-2 py-1 text-[11px] font-mono uppercase tracking-widest"
              style={{ color: "var(--color-text-muted)" }}
            >
              Round {round}
              {winnerByRound.get(round) && (
                <span style={{ color: teamColor(winnerByRound.get(round)) }}>
                  · {winnerByRound.get(round) === "CT" ? "CT side" : "T side"} won
                </span>
              )}
            </div>
            {entries.map(({ kill, firstBlood, traded }, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 py-1.5 border-b"
                style={{ borderColor: "var(--color-border-primary)" }}
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: teamColor(kill.killer_team) }}
                  >
                    {kill.killer}
                  </span>
                  {kill.headshot && (
                    <span
                      className="rounded px-1 text-[9px] font-mono font-bold"
                      title="Headshot"
                      style={{
                        color: "var(--color-accent-secondary)",
                        border: "1px solid color-mix(in srgb, var(--color-accent-secondary) 45%, transparent)",
                      }}
                    >
                      HS
                    </span>
                  )}
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    ⟶
                  </span>
                  <span
                    className="truncate text-sm"
                    style={{ color: teamColor(kill.victim_team) }}
                  >
                    {kill.victim}
                  </span>
                  {firstBlood && (
                    <span
                      className="rounded px-1.5 text-[9px] font-mono font-bold tracking-wide"
                      style={{
                        color: "var(--color-accent-secondary)",
                        border: "1px solid color-mix(in srgb, var(--color-accent-secondary) 45%, transparent)",
                      }}
                    >
                      FIRST BLOOD
                    </span>
                  )}
                  {traded && (
                    <span
                      className="rounded px-1.5 text-[9px] font-mono tracking-wide"
                      title="The killer was killed within 5 seconds — this kill was traded"
                      style={{
                        color: "var(--color-text-secondary)",
                        border: "1px solid var(--color-border-primary)",
                      }}
                    >
                      traded
                    </span>
                  )}
                </div>
                <span
                  className="flex-shrink-0 text-xs font-mono"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {formatWeapon(kill.weapon)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
