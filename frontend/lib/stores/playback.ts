"use client";

// Demo playback state shared by the minimap, tick scrubber, playback
// controls, and killfeed — one store so they never drift out of sync.

import { create } from "zustand";

export interface PlaybackState {
  round: number;
  tick: number;
  minTick: number;
  maxTick: number;
  playing: boolean;
  speed: 1 | 2 | 4 | 8;
  selectedPlayer: string | null;
  setRound: (round: number) => void;
  setTick: (tick: number) => void;
  setRange: (min: number, max: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (speed: 1 | 2 | 4 | 8) => void;
  selectPlayer: (player: string | null) => void;
  /** Advance by elapsed wall-clock ms at the demo tickrate × speed. */
  advance: (elapsedMs: number, tickrate: number) => void;
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  round: 1,
  tick: 0,
  minTick: 0,
  maxTick: 0,
  playing: false,
  speed: 1,
  selectedPlayer: null,
  setRound: (round) => set({ round, playing: false }),
  setTick: (tick) => {
    const { minTick, maxTick } = get();
    set({ tick: Math.min(maxTick, Math.max(minTick, tick)) });
  },
  setRange: (minTick, maxTick) => set({ minTick, maxTick, tick: minTick }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed }),
  selectPlayer: (selectedPlayer) => set({ selectedPlayer }),
  advance: (elapsedMs, tickrate) => {
    const { tick, maxTick, speed, playing } = get();
    if (!playing) return;
    const next = tick + (elapsedMs / 1000) * tickrate * speed;
    if (next >= maxTick) {
      set({ tick: maxTick, playing: false });
    } else {
      set({ tick: next });
    }
  },
}));

// Name required by the module-5 spec — same store.
export const useDemoPlaybackStore = usePlayback;
