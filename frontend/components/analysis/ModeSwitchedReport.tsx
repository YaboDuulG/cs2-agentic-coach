"use client";

import { CoachingResponse } from "@/lib/api/client";
import { PersonalView } from "./PersonalView";
import { TeamView } from "./TeamView";
import { OppoResearchView } from "./OppoResearchView";

export interface ModeSwitchedReportProps {
  coaching?: CoachingResponse;
  /** Query still in flight — shows the skeleton without blocking surrounding UI. */
  isLoading?: boolean;
}

function ReportSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Coaching report loading">
      <div className="card h-24 animate-pulse" />
      <div className="card h-40 animate-pulse" style={{ opacity: 0.8 }} />
      <div className="card h-40 animate-pulse" style={{ opacity: 0.6 }} />
    </div>
  );
}

/**
 * Picks the mode view from report_v2.mode. Skeleton while the report is still
 * cooking; graceful null for legacy cached reports that predate report_v2.
 */
export function ModeSwitchedReport({ coaching, isLoading }: ModeSwitchedReportProps) {
  if (isLoading || coaching?.status === "pending") return <ReportSkeleton />;

  const report = coaching?.coaching?.report_v2;
  if (!report) return null;

  switch (report.mode) {
    case "TEAM_ANALYSIS":
      return <TeamView report={report} />;
    case "OPPOSITION_RESEARCH":
      return <OppoResearchView report={report} />;
    case "PERSONAL_IMPROVEMENT":
    default:
      // Teasers can arrive with mode unset (build_teaser passes it through);
      // the personal layout is the safe default.
      return <PersonalView report={report} />;
  }
}
