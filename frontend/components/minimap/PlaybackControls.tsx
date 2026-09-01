"use client";

// Transport controls over the shared playback store: play/pause, speed
// cycle, and bounded round prev/next.

import { Button } from "@/components/ui";
import { usePlayback } from "@/lib/stores/playback";

const SPEEDS = [1, 2, 4, 8] as const;

export function PlaybackControls({ totalRounds }: { totalRounds: number }) {
  const playing = usePlayback((s) => s.playing);
  const speed = usePlayback((s) => s.speed);
  const round = usePlayback((s) => s.round);
  const toggle = usePlayback((s) => s.toggle);
  const setSpeed = usePlayback((s) => s.setSpeed);
  const setRound = usePlayback((s) => s.setRound);

  const cycleSpeed = () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={playing ? "secondary" : "primary"}
        onClick={toggle}
        onKeyDown={(e) => {
          // Space toggles only while this button is focused; preventDefault
          // stops the native keyup activation from double-toggling.
          if (e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
        aria-label={playing ? "Pause playback" : "Play playback"}
      >
        {playing ? "Pause" : "Play"}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={cycleSpeed}
        aria-label={`Playback speed ${speed}x, click to change`}
        className="font-mono"
      >
        {speed}x
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={round <= 1}
          onClick={() => setRound(round - 1)}
          aria-label="Previous round"
        >
          Prev
        </Button>
        <span className="whitespace-nowrap px-1 font-mono text-sm text-[var(--color-text-secondary)]">
          Round {round} / {totalRounds}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={round >= totalRounds}
          onClick={() => setRound(round + 1)}
          aria-label="Next round"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
