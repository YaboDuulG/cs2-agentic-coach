"use client";

import { Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { UpgradeModal } from "@/components/paywall/UpgradeModal";
import { Button, Card, CardHeader, GradeChip, Notice, Skeleton } from "@/components/ui";
import type { CoachingResponse, ReportV2 } from "@/lib/api/client";
import { FindingCard, categoryLabel } from "./FindingCard";
import { Collapsible, ReportText } from "./ReportText";

type Shape = "full" | "redacted" | "teaser";

// Three shapes the server sends for report_v2 (services/billing/entitlements.py).
// The card draws whichever arrived; nothing is hidden or revealed client-side.
function shapeOf(report: ReportV2): Shape {
  if (!report.paywalled_preview) return "full";
  if (report.paywalled_preview.locked || (report.key_findings.length === 0 && report.finding_categories)) return "teaser";
  return "redacted";
}

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function CoachingCard({ coaching, loading, pending }: { coaching?: CoachingResponse["coaching"]; loading?: boolean; pending?: boolean }) {
  const [upgradeTier, setUpgradeTier] = useState<string | null>(null);
  const report = coaching?.report_v2 ?? null;
  const shape = report ? shapeOf(report) : null;
  const isTeam = report?.mode === "TEAM_ANALYSIS";
  const isScouting = report?.mode === "OPPOSITION_RESEARCH";

  const findings = useMemo(
    () => [...(report?.key_findings ?? [])].sort((a, b) => (SEVERITY_ORDER[(a.severity ?? "").toUpperCase()] ?? 3) - (SEVERITY_ORDER[(b.severity ?? "").toUpperCase()] ?? 3)),
    [report],
  );

  const eyebrow = isScouting ? "Opponent dossier" : isTeam ? "Team report" : "Coaching report";
  const text = isTeam ? coaching?.team_report : coaching?.individual_report;
  const playerReports = Object.entries(coaching?.player_reports ?? {});

  if (loading || pending) {
    return (
      <Card>
        <CardHeader eyebrow={eyebrow} title={pending ? "Coach is finishing the report" : "Loading the report"} />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="mt-3 h-24 w-full" />
      </Card>
    );
  }

  if (!coaching) {
    return (
      <Card>
        <CardHeader eyebrow={eyebrow} title="No report for this match" />
        <Notice tone="info">The coach did not return a report. Use Notes to re-run coaching.</Notice>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        eyebrow={eyebrow}
        title={report?.summary.headline || (report ? "What to fix before the next match" : "Full text report")}
        actions={report ? <GradeChip grade={report.summary.grade} score={report.summary.score} /> : undefined}
      />

      {report && shape === "teaser" ? (
        <TeaserBody report={report} onUpgrade={() => setUpgradeTier(report.paywalled_preview?.tier_needed ?? "TEAM")} />
      ) : report ? (
        <div className="space-y-3">
          {findings.length === 0 ? (
            <Notice tone="info">The coach verified every round and found nothing to flag. Keep doing what you did.</Notice>
          ) : (
            findings.map((f, i) => <FindingCard key={`${f.category ?? "f"}-${f.round ?? i}-${i}`} finding={f} />)
          )}
          {shape === "redacted" && report.paywalled_preview ? (
            <LockedPanel
              count={report.paywalled_preview.hidden_insights_count}
              cta={report.paywalled_preview.upgrade_cta}
              onUpgrade={() => setUpgradeTier(report.paywalled_preview?.tier_needed ?? "SOLO_PRO")}
            />
          ) : null}
        </div>
      ) : null}

      {text ? (
        <div className="mt-4">
          <Collapsible summary="Full text report" defaultOpen={!report}>
            <ReportText text={text} />
          </Collapsible>
        </div>
      ) : null}

      {isTeam && playerReports.length > 0 ? (
        <div className="mt-4 space-y-2">
          <p className="eyebrow">Per player</p>
          {playerReports.map(([name, md]) => (
            <Collapsible key={name} summary={name}>
              <ReportText text={md} />
            </Collapsible>
          ))}
        </div>
      ) : null}

      <UpgradeModal open={upgradeTier != null} onClose={() => setUpgradeTier(null)} tierNeeded={upgradeTier} />
    </Card>
  );
}

function LockedPanel({ count, cta, onUpgrade }: { count: number; cta?: string; onUpgrade: () => void }) {
  return (
    <div className="surface-2 flex flex-col gap-3 p-4 sm:flex-row sm:items-center" style={{ borderStyle: "dashed" }}>
      <Lock size={16} aria-hidden="true" style={{ color: "var(--color-text-3)" }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          <span className="num">{count}</span> more {count === 1 ? "finding" : "findings"} in this match
        </p>
        <p className="text-[13px]" style={{ color: "var(--color-text-2)" }}>
          {cta || "Solo Pro shows every finding with its round, benchmark and drill."}
        </p>
      </div>
      <Button size="sm" onClick={onUpgrade}>
        Unlock the full report
      </Button>
    </div>
  );
}

/** Grade only plus a category histogram: the server sent no findings. */
function TeaserBody({ report, onUpgrade }: { report: ReportV2; onUpgrade: () => void }) {
  const entries = Object.entries(report.finding_categories ?? {}).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return (
    <div className="space-y-4">
      {entries.length > 0 ? (
        <div>
          <p className="eyebrow mb-2">
            <span className="num">{total}</span> findings by category
          </p>
          <ul className="space-y-1.5">
            {entries.map(([cat, n]) => (
              <li key={cat} className="grid grid-cols-[minmax(0,10rem)_1fr_2.5rem] items-center gap-3 text-[13px]">
                <span className="truncate capitalize">{categoryLabel(cat)}</span>
                <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--color-surface-2)" }} aria-hidden="true">
                  <span className="block h-full rounded-full" style={{ width: `${(n / max) * 100}%`, background: "var(--color-accent)" }} />
                </span>
                <span className="num text-right" style={{ color: "var(--color-text-2)" }}>
                  {n}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <LockedPanel count={report.paywalled_preview?.hidden_insights_count ?? total} cta={report.paywalled_preview?.upgrade_cta} onUpgrade={onUpgrade} />
    </div>
  );
}
