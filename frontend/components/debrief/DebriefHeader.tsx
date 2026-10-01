"use client";

import { NotebookPen } from "lucide-react";
import Link from "next/link";
import { Button, GradeChip, ModeBadge, PageHeader } from "@/components/ui";
import type { ReportV2 } from "@/lib/api/client";
import { mapLabel, relativeTime } from "@/lib/format";

export interface HeaderTeams {
  names: { a: string; b: string };
  score: { a: number; b: number };
}

/** Map, the two teams with their score in side colours, grade, mode, date, Notes. */
export function DebriefHeader({
  map,
  createdAt,
  teams,
  report,
  isRecon,
  onNotes,
}: {
  map?: string | null;
  createdAt?: string | null;
  teams: HeaderTeams;
  report?: ReportV2 | null;
  isRecon?: boolean;
  onNotes: () => void;
}) {
  const when = relativeTime(createdAt);
  return (
    <PageHeader
      back={
        <Link href="/matches" className="link">
          ← Matches
        </Link>
      }
      eyebrow={[isRecon ? "Opponent dossier" : "Debrief", when].filter(Boolean).join(" · ")}
      title={mapLabel(map)}
      description={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold" style={{ color: "var(--color-ct)" }}>
            {teams.names.a}
          </span>
          <span className="num text-base font-semibold" style={{ color: "var(--color-text)" }}>
            {teams.score.a} – {teams.score.b}
          </span>
          <span className="font-semibold" style={{ color: "var(--color-t)" }}>
            {teams.names.b}
          </span>
          <span className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
            colours are first-half sides
          </span>
        </span>
      }
      actions={
        <>
          <GradeChip grade={report?.summary.grade} score={report?.summary.score} />
          <ModeBadge mode={report?.mode} />
          <Button variant="secondary" size="sm" onClick={onNotes}>
            <NotebookPen size={14} aria-hidden="true" />
            Notes
          </Button>
        </>
      }
    />
  );
}
