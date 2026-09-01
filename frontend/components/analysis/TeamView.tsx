"use client";

import { ReportV2 } from "@/lib/api/client";
import { Card } from "@/components/ui";
import { GatedInsightCard } from "@/components/paywall";
import { InsightCard } from "./InsightCard";
import { MetricRadar } from "./MetricRadar";
import { bySeverity, categoryHistogram, groupByCategory, reportState } from "./reportState";

// Team analysis: findings grouped by category with a radar of category counts.
// Renders exactly what the server sent — full, redacted, or teaser shape.
export function TeamView({ report }: { report: ReportV2 }) {
  const state = reportState(report);
  const findings = report.key_findings ?? [];
  const summary = report.summary ?? { grade: "" };
  const histogram =
    state === "teaser" ? (report.finding_categories ?? {}) : categoryHistogram(findings);
  const groups = groupByCategory(findings);

  return (
    <div className="space-y-4">
      <Card elevated className="flex flex-wrap items-center gap-4 p-5">
        <div>
          <p
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Team analysis
          </p>
          <p
            className="mt-0.5 text-2xl font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent-secondary)" }}
          >
            {summary.grade || "–"}
          </p>
        </div>
        {summary.headline && (
          <p className="min-w-0 flex-1 text-sm" style={{ color: "var(--color-text-primary)" }}>
            {summary.headline}
          </p>
        )}
      </Card>

      {Object.keys(histogram).length > 0 && (
        <Card className="p-4">
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Findings by category
          </p>
          <MetricRadar categories={histogram} />
        </Card>
      )}

      {state === "full" &&
        Object.entries(groups).map(([category, items]) => (
          <section key={category}>
            <h3
              className="mb-2 text-xs font-bold uppercase tracking-wider"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {category.replace(/_/g, " ")}
            </h3>
            <div className="space-y-3">
              {[...items].sort(bySeverity).map((finding, i) => (
                <InsightCard key={i} finding={finding} />
              ))}
            </div>
          </section>
        ))}

      {state === "redacted" && (
        <div className="space-y-3">
          {findings.map((finding, i) => (
            <InsightCard key={i} finding={finding} />
          ))}
          {report.paywalled_preview && <GatedInsightCard preview={report.paywalled_preview} />}
        </div>
      )}

      {state === "teaser" && report.paywalled_preview && (
        <GatedInsightCard preview={report.paywalled_preview} />
      )}
    </div>
  );
}
