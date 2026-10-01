"use client";

import Link from "next/link";
import { ProgressMark, type PipelineStage } from "@/components/identity/ProgressMark";
import { mapLabel } from "@/lib/format";

function elapsed(seconds?: number): string {
  if (seconds == null || seconds < 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

const COPY: Record<PipelineStage, string> = {
  0: "Parsing the demo: every tick, every kill, every grenade.",
  1: "Computing round stats and pro baselines.",
  2: "The coach is reading your rounds against pro play.",
  3: "Report ready.",
};

/**
 * One screen for every running stage. The mark lights up stage by stage; the
 * page keeps polling and swaps to the debrief on its own.
 */
export function WaitingScreen({
  stage,
  map,
  elapsedSeconds,
  queued,
}: {
  stage: PipelineStage;
  map?: string | null;
  elapsedSeconds?: number;
  queued?: boolean;
}) {
  const time = elapsed(elapsedSeconds);
  const detail = queued ? `Waiting for a parser${time ? ` · ${time}` : ""}` : time ? `${time} elapsed` : undefined;

  return (
    <div className="enter flex min-h-[60vh] flex-col items-center justify-center gap-8 py-12 text-center">
      <div>
        <p className="eyebrow mb-2">Debrief{map ? ` · ${mapLabel(map)}` : ""}</p>
        <h1 className="text-2xl sm:text-3xl">Analysing your demo</h1>
        <p className="mt-2 max-w-md text-sm" style={{ color: "var(--color-text-2)" }}>
          {COPY[stage]}
          {" "}We&apos;ll keep this page updated; a full debrief takes a few minutes.
        </p>
      </div>
      <ProgressMark stage={stage} detail={detail} />
      <Link href="/matches" className="link text-sm">
        Back to matches
      </Link>
    </div>
  );
}
