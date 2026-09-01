import { KeyFinding } from "@/lib/api/client";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

// Findings arrive as Partial<KeyFinding>: the FREE redaction keeps only
// round/category/severity/observation, so every section renders conditionally.
export interface InsightCardProps {
  finding: Partial<KeyFinding>;
  className?: string;
}

const SEVERITY_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  HIGH: {
    color: "var(--color-danger)",
    bg: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
    border: "color-mix(in srgb, var(--color-danger) 35%, transparent)",
  },
  MEDIUM: {
    color: "var(--color-warning)",
    bg: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
    border: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
  },
  LOW: {
    color: "var(--color-text-muted)",
    bg: "color-mix(in srgb, var(--color-text-muted) 12%, transparent)",
    border: "color-mix(in srgb, var(--color-text-muted) 35%, transparent)",
  },
};

function roundTickRef(finding: Partial<KeyFinding>): string | null {
  const parts: string[] = [];
  if (finding.rounds && finding.rounds.length > 0) {
    parts.push(finding.rounds.map((r) => `R${r}`).join(" "));
  } else if (finding.round != null) {
    parts.push(`R${finding.round}`);
  }
  if (finding.tick != null) parts.push(`tick ${finding.tick}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function InsightCard({ finding, className }: InsightCardProps) {
  const severity = (finding.severity ?? "").toUpperCase();
  const sev = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.LOW;
  const reference = roundTickRef(finding);

  return (
    <Card className={cn("p-4", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {severity && (
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{ color: sev.color, background: sev.bg, border: `1px solid ${sev.border}` }}
          >
            {severity}
          </span>
        )}
        {finding.category && (
          <span
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {finding.category.replace(/_/g, " ")}
          </span>
        )}
        {reference && (
          <span
            className="ml-auto text-[11px]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}
          >
            {reference}
          </span>
        )}
      </div>

      {finding.observation && (
        <p
          className="mt-2 text-sm leading-relaxed"
          style={{ color: "var(--color-text-primary)" }}
        >
          {finding.observation}
        </p>
      )}

      {finding.grounded_pro_benchmark && (
        <p
          className="mt-3 text-xs leading-relaxed"
          style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}
        >
          <span
            className="mr-2 font-bold uppercase tracking-wider"
            style={{ color: "var(--color-accent-secondary)" }}
          >
            Pro benchmark
          </span>
          {finding.grounded_pro_benchmark}
        </p>
      )}

      {finding.actionable_drill && (
        <div
          className="mt-3 rounded-md p-3"
          style={{
            background: "var(--color-accent-soft)",
            borderLeft: "2px solid var(--color-accent-primary)",
          }}
        >
          <p
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: "var(--color-accent-primary)" }}
          >
            Drill
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {finding.actionable_drill}
          </p>
        </div>
      )}
    </Card>
  );
}
