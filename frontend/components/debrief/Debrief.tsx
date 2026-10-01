"use client";

import { useCallback, useMemo, useState } from "react";
import { Notice, SkeletonRows, Tabs, type TabItem } from "@/components/ui";
import type { CoachingResponse } from "@/lib/api/client";
import { useCoaching, useJob, type JobPayload } from "@/lib/api/hooks";
import { CoachingCard } from "./CoachingCard";
import { DebriefHeader } from "./DebriefHeader";
import { annotateKills, openingDuels, playerRows, teamNames, teamScores } from "./derive";
import { DuelExplorer } from "./DuelExplorer";
import { EconomyChart } from "./EconomyChart";
import { FailedScreen } from "./FailedScreen";
import { KillMap } from "./KillMap";
import { NotesDrawer } from "./NotesDrawer";
import { OpeningDuels } from "./OpeningDuels";
import { PlayersTable } from "./PlayersTable";
import { RoundTimeline } from "./RoundTimeline";
import { DebriefFilterContext, type SectionKey } from "./useDebriefFilter";
import { useMediaQuery } from "./useMediaQuery";
import { WaitingScreen } from "./WaitingScreen";

const SECTIONS: TabItem<SectionKey>[] = [
  { key: "report", label: "Report" },
  { key: "rounds", label: "Rounds" },
  { key: "duels", label: "Duels" },
  { key: "players", label: "Players" },
  { key: "map", label: "Map" },
];

type Screen =
  | { kind: "waiting"; stage: 0 | 1 | 2; queued: boolean }
  | { kind: "parse-failed" }
  | { kind: "coach-failed" }
  | { kind: "done" };

/**
 * The page is a state machine over the job's stages; every state is read from
 * `status`, `stage` and `coach_status`, never inferred from which fields exist.
 */
function screenFor(job: JobPayload, coachingReady: boolean): Screen {
  if (job.status === "queued") return { kind: "waiting", stage: 0, queued: true };
  if (job.status === "processing") return { kind: "waiting", stage: 0, queued: false };
  if (job.status === "failed") return { kind: "parse-failed" };
  if (job.stage === "done" || coachingReady || job.coach_status === "done") return { kind: "done" };
  if (job.stage === "failed" || job.coach_status === "failed") return { kind: "coach-failed" };
  if (job.coach_status === undefined && job.stage !== "coach") return { kind: "waiting", stage: 1, queued: false };
  return { kind: "waiting", stage: 2, queued: false };
}

export function Debrief({ matchId }: { matchId: string }) {
  const job = useJob(matchId);
  const coaching = useCoaching(matchId, job.data?.status === "done" && job.data.stage !== "failed");
  const coachingReady = coaching.data?.status === "ready";

  if (job.isLoading) {
    return (
      <div className="py-8">
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (job.isError || !job.data) {
    return (
      <Notice tone="danger" title="Couldn't load this match" className="my-8">
        {job.error?.message ?? "The match could not be found."}
      </Notice>
    );
  }

  const screen = screenFor(job.data, coachingReady);
  if (screen.kind === "waiting") return <WaitingScreen stage={screen.stage} map={job.data.map} elapsedSeconds={job.data.elapsed_seconds} queued={screen.queued} />;
  if (screen.kind === "parse-failed") return <FailedScreen kind="parse" matchId={matchId} message={job.data.error} />;
  if (screen.kind === "coach-failed") return <FailedScreen kind="coaching" matchId={matchId} message={job.data.coach_error} />;

  return <DoneDebrief matchId={matchId} job={job.data} coaching={coaching.data} coachingLoading={coaching.isLoading} />;
}

function DoneDebrief({ matchId, job, coaching, coachingLoading }: { matchId: string; job: JobPayload; coaching?: CoachingResponse; coachingLoading: boolean }) {
  const desktop = useMediaQuery("(min-width: 768px)");
  const [section, setSection] = useState<SectionKey>("report");
  const [round, setRound] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const rounds = useMemo(() => job.rounds ?? [], [job.rounds]);
  const roundNumbers = useMemo(() => rounds.map((r) => r.round).sort((a, b) => a - b), [rounds]);
  const names = useMemo(() => teamNames(job.player_stats), [job.player_stats]);
  const score = useMemo(() => teamScores(rounds), [rounds]);
  const annotated = useMemo(() => annotateKills(job.kills ?? []), [job.kills]);
  const scoped = useMemo(() => (round == null ? annotated : new Map([[round, annotated.get(round) ?? []]])), [annotated, round]);
  const scopedKills = useMemo(() => [...scoped.values()].flat(), [scoped]);
  const allKills = useMemo(() => [...annotated.values()].flat(), [annotated]);
  const duels = useMemo(() => openingDuels(scoped), [scoped]);
  const players = useMemo(() => playerRows(annotated, job.player_stats), [annotated, job.player_stats]);

  const jumpToRound = useCallback((r: number) => {
    setRound(r);
    setSection("rounds");
    requestAnimationFrame(() => document.getElementById("rounds")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, []);

  const pickSection = (key: SectionKey) => {
    setSection(key);
    if (desktop) document.getElementById(key)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const show = (key: SectionKey) => desktop || section === key;
  const report = coaching?.coaching?.report_v2 ?? null;

  return (
    <DebriefFilterContext.Provider value={{ round, setRound, rounds: roundNumbers, section, setSection, jumpToRound }}>
      <DebriefHeader map={job.map} createdAt={job.created_at} teams={{ names, score }} report={report} isRecon={job.is_recon} onNotes={() => setNotesOpen(true)} />

      <div className="sticky top-(--nav-h) z-10 -mx-(--gutter) px-(--gutter)" style={{ background: "var(--color-bg)" }}>
        <Tabs items={SECTIONS} value={section} onChange={pickSection} label="Debrief sections" />
        <FilterRow rounds={roundNumbers} round={round} onChange={setRound} />
      </div>

      <div className="space-y-6">
        {show("report") ? (
          <section id="report" className="scroll-mt-36">
            <CoachingCard coaching={coaching?.coaching} loading={coachingLoading} pending={coaching?.status === "pending"} />
          </section>
        ) : null}
        {show("rounds") ? (
          <section id="rounds" className="scroll-mt-36 space-y-6">
            <RoundTimeline rounds={rounds} names={names} />
            <EconomyChart rounds={rounds} names={names} />
          </section>
        ) : null}
        {show("duels") ? (
          <section id="duels" className="scroll-mt-36 space-y-6">
            <OpeningDuels rows={duels} scoped={round != null} />
            <DuelExplorer annotated={annotated} rounds={roundNumbers} />
          </section>
        ) : null}
        {show("players") ? (
          <section id="players" className="scroll-mt-36">
            <PlayersTable rows={players} />
          </section>
        ) : null}
        {show("map") ? (
          <section id="map" className="scroll-mt-36">
            <KillMap matchId={matchId} map={job.map} kills={scopedKills} allKills={allKills} />
          </section>
        ) : null}
      </div>

      <NotesDrawer matchId={matchId} open={notesOpen} onClose={() => setNotesOpen(false)} />
    </DebriefFilterContext.Provider>
  );
}

/** One filter row above every section: "All rounds" or one round. */
function FilterRow({ rounds, round, onChange }: { rounds: number[]; round: number | null; onChange: (r: number | null) => void }) {
  const pill = (active: boolean) => ({
    background: active ? "var(--color-accent-soft)" : "var(--color-surface-2)",
    color: active ? "var(--color-accent)" : "var(--color-text-2)",
    border: "1px solid var(--color-line)",
  });
  return (
    <div className="tabstrip items-center gap-1.5 py-2" role="group" aria-label="Round filter">
      <button type="button" aria-pressed={round == null} onClick={() => onChange(null)} className="shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold" style={pill(round == null)}>
        All rounds
      </button>
      {rounds.map((r) => (
        <button key={r} type="button" aria-pressed={round === r} onClick={() => onChange(round === r ? null : r)} className="num shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold" style={pill(round === r)} aria-label={`Round ${r}`}>
          {r}
        </button>
      ))}
    </div>
  );
}
