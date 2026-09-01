"use client";

// Timeline scrubber over [minTick, maxTick]. Subscribes to the store with a
// quantized tick selector so playback moves the thumb a handful of times per
// second instead of re-rendering per frame; dragging writes exact ticks back
// via setTick (which never pauses — dragging while playing just retargets).

import { usePlayback } from "@/lib/stores/playback";

const QUANT = 8; // re-render every 8 ticks (~8x/s at 64 tick, 1x speed)

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function TickScrubber({
  tickrate,
  killTicks,
}: {
  tickrate: number;
  killTicks: number[];
}) {
  const minTick = usePlayback((s) => s.minTick);
  const maxTick = usePlayback((s) => s.maxTick);
  const qTick = usePlayback((s) => Math.floor(s.tick / QUANT));
  const setTick = usePlayback((s) => s.setTick);

  const span = Math.max(1, maxTick - minTick);
  const tick = Math.min(maxTick, Math.max(minTick, qTick * QUANT));
  const rate = tickrate || 64;

  return (
    <div className="w-full">
      <div className="relative">
        <input
          type="range"
          min={minTick}
          max={maxTick}
          step={1}
          value={tick}
          onChange={(e) => setTick(Number(e.target.value))}
          aria-label="Seek playback tick"
          className="w-full cursor-pointer"
          style={{ accentColor: "var(--color-accent-primary)" }}
        />
        {/* Kill notches under the track */}
        <div className="pointer-events-none relative h-1.5" aria-hidden="true">
          {killTicks.map((t, i) => (
            <div
              key={`${t}-${i}`}
              className="absolute top-0 h-full w-px"
              style={{
                left: `${((Math.min(maxTick, Math.max(minTick, t)) - minTick) / span) * 100}%`,
                background: "var(--color-danger)",
              }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-xs text-[var(--color-text-muted)]">
        <span>{formatTime((tick - minTick) / rate)}</span>
        <span>{formatTime(span / rate)}</span>
      </div>
    </div>
  );
}
