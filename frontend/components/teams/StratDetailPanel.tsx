"use client";

import { useState } from "react";
import { PlanningBoard } from "@/components/stratbook/PlanningBoard";
import { boardFromCanvas } from "@/components/teams/canvasToBoard";
import { STATUS_LABEL, STATUS_TONE, shortUserId } from "@/components/teams/util";
import { Badge, Button, Card, CardHeader, SkeletonRows, toast } from "@/components/ui";
import type { StratRevision, StratStatus, StratSummary } from "@/lib/api/client";
import { HttpError, useStratDetail, useStratTransition } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

// Mirrors services/stratbook state machine; the server returns 409 for anything else.
const TRANSITIONS: Record<StratStatus, StratStatus[]> = {
  DRAFT: ["IN_REVIEW", "ARCHIVED"],
  IN_REVIEW: ["ACTIVE", "DRAFT", "ARCHIVED"],
  ACTIVE: ["ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const ACTION_LABEL: Record<StratStatus, string> = {
  DRAFT: "Back to draft",
  IN_REVIEW: "Send for review",
  ACTIVE: "Approve",
  ARCHIVED: "Archive",
};

function RevisionRow({ r, current }: { r: StratRevision; current: boolean }) {
  const steps = r.canvas?.steps?.length ?? 0;
  const utility = r.canvas?.steps?.reduce((n, s) => n + (s.utility?.length ?? 0), 0) ?? 0;
  return (
    <li className="surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="num text-sm font-semibold">r{r.revision_no}</span>
        {current ? <Badge tone="accent">Current</Badge> : null}
        <Badge>{r.source || "manual"}</Badge>
        <span className="num ml-auto text-[12px]" style={{ color: "var(--color-text-3)" }}>
          {relativeTime(r.created_at)}
        </span>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: "var(--color-text-2)" }}>
        by <span className="num">{shortUserId(r.author_id)}</span> · <span className="num">{steps}</span> {steps === 1 ? "step" : "steps"} ·{" "}
        <span className="num">{utility}</span> utility
      </p>
      {r.description ? <p className="mt-1 text-sm">{r.description}</p> : null}
    </li>
  );
}

/** The selected strat: its revisions and the transitions the state machine allows. */
export function StratDetailPanel({ teamId, strat }: { teamId: string; strat: StratSummary | null }) {
  const detail = useStratDetail(strat?.id ?? null);
  const transition = useStratTransition(teamId);
  const [stepIndex, setStepIndex] = useState(0);

  if (!strat) {
    return (
      <Card>
        <CardHeader title="Strat" description="Pick a strat from the library to see its revisions and move it along." />
      </Card>
    );
  }

  async function move(status: StratStatus) {
    if (!strat) return;
    try {
      await transition.mutateAsync({ stratId: strat.id, status });
      toast.success(`${strat.title} is now ${STATUS_LABEL[status].toLowerCase()}.`);
    } catch (e) {
      const msg = e instanceof HttpError && e.status === 409 ? "That move is not allowed from the current status." : e instanceof Error ? e.message : "Could not update the strat.";
      toast.error(msg);
    }
  }

  const revisions = (detail.data?.revisions ?? []).slice().sort((a, b) => b.revision_no - a.revision_no);
  const current = revisions.find((r) => r.id === detail.data?.current_revision_id) ?? revisions[0];
  const steps = current?.canvas?.steps ?? [];
  const step = Math.min(stepIndex, Math.max(0, steps.length - 1));

  return (
    <Card>
      <CardHeader
        eyebrow={`${mapLabel(strat.map_name)} · ${strat.side}${strat.buy_type ? ` · ${strat.buy_type}` : ""}`}
        title={strat.title}
        actions={<Badge tone={STATUS_TONE[strat.status]}>{STATUS_LABEL[strat.status]}</Badge>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TRANSITIONS[strat.status].map((next) => (
          <Button
            key={next}
            size="sm"
            variant={next === "ACTIVE" ? "primary" : next === "ARCHIVED" ? "danger" : "secondary"}
            onClick={() => move(next)}
            loading={transition.isPending && transition.variables?.status === next}
            disabled={transition.isPending}
          >
            {ACTION_LABEL[next]}
          </Button>
        ))}
      </div>

      {detail.isLoading ? (
        <SkeletonRows rows={2} />
      ) : current ? (
        <div className="mb-4">
          <PlanningBoard map={strat.map_name} value={boardFromCanvas(current.canvas, strat.side, step)} onChange={() => {}} readOnly height={300} />
          {steps.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Strat steps">
              {steps.map((st, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
                  style={{
                    background: i === step ? "var(--color-accent)" : "var(--color-surface-2)",
                    color: i === step ? "var(--color-accent-ink)" : "var(--color-text-2)",
                  }}
                  onClick={() => setStepIndex(i)}
                >
                  <span className="num">{st.t}s</span> {st.label}
                </button>
              ))}
            </div>
          ) : steps.length === 1 ? (
            <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-2)" }}>
              <span className="num">{steps[0].t}s</span> {steps[0].label}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="eyebrow mb-2">Revisions</p>
      {detail.isLoading ? null : revisions.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
          No revisions yet. Draft one from Discord with /strat edit.
        </p>
      ) : (
        <ul className="space-y-2">
          {revisions.map((r) => (
            <RevisionRow key={r.id} r={r} current={r.id === detail.data?.current_revision_id} />
          ))}
        </ul>
      )}
    </Card>
  );
}
