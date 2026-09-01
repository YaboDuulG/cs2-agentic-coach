"use client";

// Killfeed synchronized to playback: shows kills with tick <= current tick,
// newest first. Low-frequency sync — the store subscription quantizes the
// tick (floor(tick/16)) so the list re-renders a few times a second, not
// once per animation frame. Clicking a row seeks to the kill's tick and
// selects the attacker.

import { useMemo } from "react";

import { RoundTelemetry } from "@/lib/api/client";
import { usePlayback } from "@/lib/stores/playback";

const QUANT = 16;

function formatWeapon(weapon: string): string {
  return weapon.replace(/^weapon_/i, "").replace(/_/g, " ").toUpperCase();
}

export function Killfeed({ telemetry }: { telemetry: RoundTelemetry }) {
  const qTick = usePlayback((s) => Math.floor(s.tick / QUANT));
  const setTick = usePlayback((s) => s.setTick);
  const selectPlayer = usePlayback((s) => s.selectPlayer);

  const teamOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of telemetry.players) m.set(p.player, p.team);
    return m;
  }, [telemetry]);

  const currentTick = qTick * QUANT;
  const visible = useMemo(
    () =>
      telemetry.kills
        .filter((k) => k.tick <= currentTick)
        .sort((a, b) => b.tick - a.tick),
    [telemetry, currentTick],
  );

  const teamColor = (player: string) =>
    (teamOf.get(player) || "").toUpperCase() === "CT" ? "var(--color-ct)" : "var(--color-t)";

  return (
    <div className="flex min-h-0 flex-col">
      <h3 className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">
        Killfeed
      </h3>
      <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {visible.length === 0 ? (
          <p className="py-3 text-center font-mono text-xs italic text-[var(--color-text-muted)]">
            No kills yet this round
          </p>
        ) : (
          visible.map((k, i) => (
            <button
              key={`${k.tick}-${k.attacker}-${k.victim}-${i}`}
              type="button"
              onClick={() => {
                setTick(k.tick);
                selectPlayer(k.attacker);
              }}
              className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border-primary)] bg-[var(--color-bg-secondary)] p-2 text-left text-xs transition-[background-color,border-color] duration-[var(--dur-fast)] hover:border-[var(--color-border-strong)]"
              aria-label={`Seek to ${k.attacker} killing ${k.victim}`}
            >
              <span
                className="max-w-[35%] truncate font-bold"
                style={{ color: teamColor(k.attacker) }}
                title={k.attacker}
              >
                {k.attacker}
              </span>
              <span className="shrink-0 rounded border border-[var(--color-border-primary)] px-1 font-mono text-[9px] text-[var(--color-text-muted)]">
                {formatWeapon(k.weapon)}
              </span>
              {k.headshot && (
                <span
                  className="shrink-0 font-mono text-[9px] font-bold text-[var(--color-accent-secondary)]"
                  title="Headshot"
                >
                  HS
                </span>
              )}
              <span className="shrink-0 text-[var(--color-text-muted)]" aria-hidden="true">
                →
              </span>
              <span
                className="min-w-0 flex-1 truncate font-bold"
                style={{ color: teamColor(k.victim) }}
                title={k.victim}
              >
                {k.victim}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
