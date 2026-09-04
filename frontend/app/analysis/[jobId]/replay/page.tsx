"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DemoViewer } from "@/components/minimap";
import { PageSection, PageTransition } from "@/components/ui";

// Replay lab — the round playback viewer, quarantined off the main debrief
// while it's rough (missing map underlays, coordinate quirks). Lives here so
// it can be tested and improved without degrading the analysis page.
export default function ReplayLabPage() {
  const params = useParams<{ jobId: string }>();
  const jobId = params.jobId;
  const [meta, setMeta] = useState<{ scope: string; map?: string; rounds: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/jobs/${jobId}?light=true`)
      .then(r => r.json())
      .catch(() => null)
      .then(d => {
        if (cancelled) return;
        setMeta({ scope: jobId, map: d?.map, rounds: d?.total_rounds ?? 0 });
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return (
    <div className="min-h-screen px-6 py-20" style={{ background: "var(--color-bg-primary)" }}>
      <PageTransition className="relative max-w-5xl mx-auto">
        <PageSection className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p
              className="text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-secondary)" }}
            >
              Replay lab · beta
            </p>
            <h1 className="heading-display mt-1" style={{ fontSize: "1.4rem" }}>
              {meta?.map?.toUpperCase() ?? "Round playback"}
            </h1>
          </div>
          <Link
            href={`/analysis/${jobId}`}
            className="text-xs font-mono font-semibold"
            style={{ color: "var(--color-accent-primary)" }}
          >
            ← Back to debrief
          </Link>
        </PageSection>

        <PageSection className="mb-6">
          <p
            className="rounded-lg border px-4 py-2.5 text-xs"
            style={{
              color: "var(--color-text-secondary)",
              borderColor:
                "color-mix(in srgb, var(--color-accent-secondary) 40%, transparent)",
              background: "var(--color-bg-card)",
            }}
          >
            Experimental: playback is a work in progress (map underlays and positioning are
            still being tuned). The debrief page has the reliable views.
          </p>
        </PageSection>

        <PageSection className="card p-0 overflow-hidden">
          <DemoViewer matchId={jobId} totalRounds={meta?.rounds ?? 0} />
        </PageSection>
      </PageTransition>
    </div>
  );
}
