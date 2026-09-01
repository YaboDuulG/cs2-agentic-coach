"use client";

import { Crosshair } from "lucide-react";
import { ReportV2 } from "@/lib/api/client";
import { Card } from "@/components/ui";
import { GatedInsightCard } from "@/components/paywall";
import { InsightCard } from "./InsightCard";
import { MetricRadar } from "./MetricRadar";
import { bySeverity, categoryHistogram, groupByCategory, reportState } from "./reportState";

// Opposition research: "scouting dossier" framing. Buy-round and tendency
// categories lead the dossier; everything else follows. Server-shaped data
// only — the TEAM_SCOUTING teaser arrives with findings already stripped.
const EMPHASIZED = /BUY|ECON|TENDENC|DEFAULT|SETUP|PISTOL|FORCE/i;

export function OppoResearchView({ report }: { report: ReportV2 }) {
  const state = reportState(report);
  const findings = report.key_findings ?? [];
  const summary = report.summary ?? { grade: "" };
  const histogram =
    state === "teaser" ? (report.finding_categories ?? {}) : categoryHistogram(findings);
  const groups = groupByCategory(findings);
  const orderedCategories = Object.keys(groups).sort((a, b) => {
    const ea = EMPHASIZED.test(a) ? 0 : 1;
    const eb = EMPHASIZED.test(b) ? 0 : 1;
    return ea - eb || a.localeCompare(b);
  });

  return (
    <div className="space-y-4">
      <Card
        elevated
        className="p-5"
        style={{ borderColor: "var(--color-border-secondary)" }}
      >
        <div className="flex items-center gap-2">
          <Crosshair size={14} style={{ color: "var(--color-accent-secondary)" }} />
          <span
            className="text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-secondary)" }}
          >
            Scouting dossier
          </span>
          <span
            className="ml-auto text-lg font-bold"
            style={{ fontFamily: "var(--font-heading)", color: "var(--color-accent-secondary)" }}
          >
            {summary.grade || "–"}
          </span>
        </div>
        {summary.headline && (
          <p className="mt-2 text-sm" style={{ color: "var(--color-text-primary)" }}>
            {summary.headline}
          </p>
        )}
        <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Tendencies, buy-round behavior, and default setups read from the opponent&apos;s demo.
        </p>
      </Card>

      {Object.keys(histogram).length > 0 && (
        <Card className="p-4">
          <p
            className="mb-2 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Tendency profile
          </p>
          <MetricRadar categories={histogram} />
        </Card>
      )}

      {state === "full" &&
        orderedCategories.map((category) => {
          const emphasized = EMPHASIZED.test(category);
          return (
            <section key={category}>
              <h3
                className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider"
                style={{
                  color: emphasized
                    ? "var(--color-accent-secondary)"
                    : "var(--color-text-secondary)",
                }}
              >
                {category.replace(/_/g, " ")}
                {emphasized && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                    style={{
                      background: "var(--color-secondary-soft)",
                      border: "1px solid var(--color-border-secondary)",
                    }}
                  >
                    KEY READ
                  </span>
                )}
              </h3>
              <div className="space-y-3">
                {[...groups[category]].sort(bySeverity).map((finding, i) => (
                  <InsightCard key={i} finding={finding} />
                ))}
              </div>
            </section>
          );
        })}

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
