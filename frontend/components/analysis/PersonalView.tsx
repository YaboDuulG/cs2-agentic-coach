"use client";

import { ReportV2 } from "@/lib/api/client";
import { Card } from "@/components/ui";
import { GatedInsightCard } from "@/components/paywall";
import { InsightCard } from "./InsightCard";
import { MetricRadar } from "./MetricRadar";
import { bySeverity, reportState } from "./reportState";

// Personal improvement: score/grade header, then drill-focused findings.
// All three server states (full / FREE-redacted / teaser) are shapes the
// SERVER decided on — this view just renders what arrived.
export function PersonalView({ report }: { report: ReportV2 }) {
  const state = reportState(report);
  const findings = report.key_findings ?? [];
  const summary = report.summary ?? { grade: "" };

  return (
    <div className="space-y-4">
      <Card elevated className="flex items-center gap-5 p-5">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: "var(--color-secondary-soft)",
            border: "1px solid var(--color-border-secondary)",
          }}
        >
          <span
            className="text-3xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent-secondary)" }}
          >
            {summary.grade || "–"}
          </span>
        </div>
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Personal improvement
          </p>
          {summary.score != null && (
            <p
              className="mt-0.5 text-sm"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}
            >
              Score {summary.score}
            </p>
          )}
          {summary.headline && (
            <p className="mt-1 text-sm" style={{ color: "var(--color-text-primary)" }}>
              {summary.headline}
            </p>
          )}
        </div>
      </Card>

      {state === "full" && (
        <div className="space-y-3">
          {[...findings].sort(bySeverity).map((finding, i) => (
            <InsightCard key={i} finding={finding} />
          ))}
          {findings.length === 0 && (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
              No findings in this report.
            </p>
          )}
        </div>
      )}

      {state === "redacted" && (
        <div className="space-y-3">
          {/* The one takeaway the server kept in the FREE view. */}
          {findings.map((finding, i) => (
            <InsightCard key={i} finding={finding} />
          ))}
          {report.paywalled_preview && <GatedInsightCard preview={report.paywalled_preview} />}
        </div>
      )}

      {state === "teaser" && (
        <div className="space-y-3">
          <Card className="p-4">
            <p
              className="mb-2 text-[10px] font-bold uppercase tracking-wider"
              style={{ color: "var(--color-text-muted)" }}
            >
              Finding categories
            </p>
            <MetricRadar categories={report.finding_categories ?? {}} />
          </Card>
          {report.paywalled_preview && <GatedInsightCard preview={report.paywalled_preview} />}
        </div>
      )}
    </div>
  );
}
