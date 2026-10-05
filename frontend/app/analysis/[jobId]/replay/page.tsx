"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import { sideInRound, sideOf } from "@/components/debrief/derive";
import { DemoViewer, Viewer3D } from "@/components/minimap";
import { Badge, Notice, PageHeader, Tabs } from "@/components/ui";
import { useJob, type JobKill } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";
import { radarCalibration } from "@/lib/maps";
import { usePlayback } from "@/lib/stores/playback";

type View = "2d" | "3d";

// Replay lab: the round playback viewer (2D radar with the real map image
// and the player tracks) and the 3D kill view, both on the same round from
// the shared playback store. Linked from the debrief's Map section.
export default function ReplayLabPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const job = useJob(jobId);
  const round = usePlayback((s) => s.round);
  const [view, setView] = useState<View>("2d");

  const done = job.data?.status === "done" ? job.data : null;
  const rounds = done?.total_rounds ?? 0;
  const roster = done?.player_stats;
  const calibrated = Boolean(radarCalibration(done?.map));

  const roundKills = useMemo(() => (done?.kills ?? []).filter((k) => k.round === round), [done, round]);
  const nameOf = (raw: string) => roster?.[raw]?.name ?? raw;
  const sideFor = (kill: JobKill, who: "killer" | "victim"): "CT" | "T" => {
    const id = who === "killer" ? kill.attacker_steamid : kill.victim_steamid;
    const start = sideOf((id && roster?.[id]?.team) || (who === "killer" ? kill.killer_team : kill.victim_team));
    return start ? sideInRound(start, kill.round) : "T";
  };

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Replay lab <Badge tone="warning">Beta</Badge>
          </span>
        }
        title={done?.map ? mapLabel(done.map) : "Round playback"}
        back={
          <Link href={`/analysis/${jobId}`} className="link">
            ← Back to debrief
          </Link>
        }
      />
      {!calibrated && done?.map ? (
        <Notice tone="info" className="mb-4">
          No radar calibration for {mapLabel(done.map)} yet: the 2D view fits the tracks to the square without the map image, and the 3D view is off.
        </Notice>
      ) : null}
      <Tabs<View>
        label="Replay views"
        value={view}
        onChange={setView}
        items={[
          { key: "2d", label: "2D radar" },
          { key: "3d", label: "3D kills" },
        ]}
        className="mb-4"
      />
      <div className="surface overflow-hidden p-0">
        {view === "2d" ? (
          <DemoViewer matchId={jobId} totalRounds={rounds} roster={roster} />
        ) : (
          <div className="p-4">
            <p className="mb-3 text-sm" style={{ color: "var(--color-text-2)" }}>
              Round <span className="num font-semibold">{round}</span> · pick the round with the 2D controls.
            </p>
            <Viewer3D kills={roundKills} map={done?.map ?? ""} sideOf={sideFor} nameOf={nameOf} />
          </div>
        )}
      </div>
    </div>
  );
}
