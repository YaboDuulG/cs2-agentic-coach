"use client";

import Link from "next/link";
import { use } from "react";
import { DemoViewer } from "@/components/minimap";
import { Badge, Notice, PageHeader } from "@/components/ui";
import { useJob } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";

// Replay lab: the round playback viewer, kept off the debrief while it is
// rough (no map underlays, coordinate quirks). Linked from the debrief's Map
// section only.
export default function ReplayLabPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = use(params);
  const job = useJob(jobId);
  const rounds = job.data?.status === "done" ? (job.data.total_rounds ?? 0) : 0;

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            Replay lab <Badge tone="warning">Beta</Badge>
          </span>
        }
        title={job.data?.map ? mapLabel(job.data.map) : "Round playback"}
        back={
          <Link href={`/analysis/${jobId}`} className="link">
            ← Back to debrief
          </Link>
        }
      />
      <Notice tone="info" className="mb-4">
        Experimental: map underlays and positioning are still being tuned. The debrief has the reliable views.
      </Notice>
      <div className="surface overflow-hidden p-0">
        <DemoViewer matchId={jobId} totalRounds={rounds} />
      </div>
    </div>
  );
}
