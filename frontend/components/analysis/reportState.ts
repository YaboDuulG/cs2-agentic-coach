import { KeyFinding, ReportV2 } from "@/lib/api/client";

// The three shapes the server sends for report_v2 (services/billing/entitlements.py):
//   "full"     — every finding included, paywalled_preview is null.
//   "redacted" — FREE view of a personal report: at most one takeaway finding
//                (round/category/severity/observation only) + paywalled_preview.
//   "teaser"   — TEAM/OPPO report without the tier: key_findings is empty and
//                finding_categories carries a histogram + paywalled_preview.
// The views only visualize what the server sent; nothing is gated client-side.
export type ReportState = "full" | "redacted" | "teaser";

export function reportState(report: ReportV2): ReportState {
  if (!report.paywalled_preview) return "full";
  const findings = report.key_findings ?? [];
  if (findings.length === 0 && report.finding_categories) return "teaser";
  return "redacted";
}

/** Finding count per category, for the radar when the server sent full findings. */
export function categoryHistogram(findings: Partial<KeyFinding>[]): Record<string, number> {
  return findings.reduce<Record<string, number>>((acc, f) => {
    const category = f.category ?? "OTHER";
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {});
}

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function bySeverity(a: Partial<KeyFinding>, b: Partial<KeyFinding>): number {
  const ra = SEVERITY_ORDER[(a.severity ?? "").toUpperCase()] ?? 3;
  const rb = SEVERITY_ORDER[(b.severity ?? "").toUpperCase()] ?? 3;
  return ra - rb;
}

export function groupByCategory(
  findings: Partial<KeyFinding>[],
): Record<string, Partial<KeyFinding>[]> {
  return findings.reduce<Record<string, Partial<KeyFinding>[]>>((acc, f) => {
    const category = f.category ?? "OTHER";
    (acc[category] ??= []).push(f);
    return acc;
  }, {});
}
