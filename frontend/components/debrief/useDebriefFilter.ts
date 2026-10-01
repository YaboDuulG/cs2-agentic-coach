"use client";

import { createContext, useContext } from "react";

export type SectionKey = "report" | "rounds" | "duels" | "players" | "map";

export interface DebriefFilter {
  /** Selected round, or null for "All rounds". Scopes Rounds, Duels and Map. */
  round: number | null;
  setRound: (round: number | null) => void;
  rounds: number[];
  section: SectionKey;
  setSection: (key: SectionKey) => void;
  /** Deep link from a finding: select the round and bring the Rounds section into view. */
  jumpToRound: (round: number) => void;
}

export const DebriefFilterContext = createContext<DebriefFilter | null>(null);

export function useDebriefFilter(): DebriefFilter {
  const ctx = useContext(DebriefFilterContext);
  if (!ctx) throw new Error("useDebriefFilter must be used inside <Debrief>");
  return ctx;
}
