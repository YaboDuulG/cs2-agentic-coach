"use client";

// Composition root for the 2D tactical viewer: fetches the round's
// telemetry (round comes from the shared playback store), seeds the store's
// tick range on load, and lays out radar + controls + scrubber + killfeed.
// The loading skeleton only occupies the radar square — the surrounding
// controls stay mounted and interactive.

import { useEffect, useMemo } from "react";

import { Card, Spinner } from "@/components/ui";
import { useRoundTelemetry } from "@/lib/api/hooks";
import { usePlayback } from "@/lib/stores/playback";

import { Killfeed } from "./Killfeed";
import { PlaybackControls } from "./PlaybackControls";
import { TacticalRadar } from "./TacticalRadar";
import { TickScrubber } from "./TickScrubber";

export function DemoViewer({
  matchId,
  totalRounds,
}: {
  matchId: string;
  totalRounds: number;
}) {
  const round = usePlayback((s) => s.round);
  const setRange = usePlayback((s) => s.setRange);
  const { data: telemetry, isLoading, isError } = useRoundTelemetry(matchId, round);

  const range = useMemo(() => {
    if (!telemetry) return null;
    let min = Infinity;
    let max = -Infinity;
    const see = (tick: number) => {
      if (tick < min) min = tick;
      if (tick > max) max = tick;
    };
    for (const p of telemetry.players) for (const pt of p.points) see(pt.tick);
    for (const k of telemetry.kills) see(k.tick);
    for (const g of telemetry.grenades) see(g.tick);
    return Number.isFinite(min) ? { min, max } : null;
  }, [telemetry]);

  // New round telemetry (round switch included) resets the store's range.
  useEffect(() => {
    if (range) setRange(range.min, range.max);
  }, [range, setRange]);

  const hasTrajectories = Boolean(
    telemetry && telemetry.players.some((p) => p.points.length > 0),
  );
  const killTicks = useMemo(
    () => (telemetry ? telemetry.kills.map((k) => k.tick) : []),
    [telemetry],
  );

  return (
    <div className="grid items-start gap-4 p-4 lg:grid-cols-[minmax(0,640px)_minmax(260px,1fr)]">
      <div className="w-full max-w-[640px]">
        {isLoading ? (
          <Card className="flex aspect-square w-full items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <Spinner size={28} />
              <p className="font-mono text-xs text-[var(--color-text-muted)]">
                Loading round {round} telemetry…
              </p>
            </div>
          </Card>
        ) : isError ? (
          <Card className="flex aspect-square w-full items-center justify-center p-6 text-center">
            <p className="font-mono text-sm text-[var(--color-danger)]">
              Could not load telemetry for round {round}.
            </p>
          </Card>
        ) : hasTrajectories && telemetry ? (
          <TacticalRadar telemetry={telemetry} />
        ) : (
          <Card className="flex aspect-square w-full items-center justify-center p-6 text-center">
            <p className="font-mono text-sm text-[var(--color-text-muted)]">
              No trajectory data for round {round}.
            </p>
          </Card>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <PlaybackControls totalRounds={totalRounds} />
        {telemetry && hasTrajectories && (
          <TickScrubber tickrate={telemetry.tickrate} killTicks={killTicks} />
        )}
        {telemetry && <Killfeed telemetry={telemetry} />}
      </div>
    </div>
  );
}
