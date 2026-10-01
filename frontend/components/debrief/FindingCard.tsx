"use client";

import { Badge, type BadgeTone } from "@/components/ui";
import type { KeyFinding } from "@/lib/api/client";
import { clock } from "@/lib/format";
import { useDebriefFilter } from "./useDebriefFilter";

const SEVERITY_TONE: Record<string, BadgeTone> = { HIGH: "danger", MEDIUM: "warning", LOW: "neutral" };

export function categoryLabel(category?: string | null): string {
  if (!category) return "Finding";
  return category.toLowerCase().replace(/_/g, " ");
}

/**
 * One coaching finding, exactly as the server sent it: the redacted shape
 * has only round, category, severity and observation, and that is all we
 * show for it. The round chip is the deep link into the Rounds section.
 */
export function FindingCard({ finding }: { finding: Partial<KeyFinding> }) {
  const { jumpToRound } = useDebriefFilter();
  const severity = (finding.severity ?? "").toUpperCase();
  const rounds = finding.rounds?.length ? finding.rounds : finding.round != null ? [finding.round] : [];

  return (
    <article className="surface-2 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="eyebrow">{categoryLabel(finding.category)}</span>
        {severity ? <Badge tone={SEVERITY_TONE[severity] ?? "neutral"}>{severity.toLowerCase()}</Badge> : null}
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {rounds.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => jumpToRound(r)}
              className="num rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors duration-[var(--dur-fast)] hover:bg-(--color-accent-soft)"
              style={{ color: "var(--color-focus)", border: "1px solid var(--color-line)" }}
              title={`Show round ${r}`}
            >
              R{r}
            </button>
          ))}
          {finding.tick != null ? (
            <span className="num text-[11px]" style={{ color: "var(--color-text-3)" }} title={`Tick ${finding.tick}`}>
              {clock(finding.tick)}
            </span>
          ) : null}
        </span>
      </div>
      {finding.observation ? <p className="text-sm">{finding.observation}</p> : null}
      {finding.grounded_pro_benchmark ? (
        <p className="num mt-2 text-[12px]" style={{ color: "var(--color-text-2)" }}>
          {finding.grounded_pro_benchmark}
        </p>
      ) : null}
      {finding.actionable_drill ? (
        <p className="mt-2 text-[13px]" style={{ color: "var(--color-text-2)" }}>
          <span className="font-semibold" style={{ color: "var(--color-text)" }}>
            Drill:
          </span>{" "}
          {finding.actionable_drill}
        </p>
      ) : null}
    </article>
  );
}
