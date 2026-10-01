"use client";

import { useTheme } from "@/lib/theme/useTheme";

export const PIPELINE_STAGES = ["Parse", "Stats", "Coach"] as const;
export type PipelineStage = 0 | 1 | 2 | 3; // 3 = done

/**
 * The waiting screen's one orchestrated moment: the identity mark assembles
 * stage by stage. Opacity transitions only, so reduced-motion is respected by
 * nature. Three variants, one per theme.
 */
export function ProgressMark({ stage, size = 132, detail }: { stage: PipelineStage; size?: number; detail?: string }) {
  const { def } = useTheme();
  const op = (s: number) => (stage > s ? 1 : stage === s ? 0.6 : 0.14);
  const cls = (s: number) => (stage === s ? "progress-mark-active" : undefined);
  const t = "opacity 400ms var(--ease-out)";
  const announced = stage >= 3 ? "Report ready" : `${PIPELINE_STAGES[stage as 0 | 1 | 2]} in progress`;

  let svg: React.ReactNode;
  if (def.mark === "crosshair") {
    svg = (
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <g className={cls(0)} style={{ opacity: op(0), transition: t }}>
          <circle cx="50" cy="50" r="38" stroke="var(--color-accent)" strokeWidth="4" />
        </g>
        <g className={cls(1)} style={{ opacity: op(1), transition: t }}>
          <path d="M50 4v18M50 78v18M4 50h18M78 50h18" stroke="var(--color-accent)" strokeWidth="4" strokeLinecap="round" />
        </g>
        <g className={cls(2)} style={{ opacity: op(2), transition: t }}>
          <circle cx="50" cy="50" r="5" fill="var(--color-text)" />
        </g>
      </svg>
    );
  } else if (def.mark === "soyombo") {
    svg = (
      <svg width={size} height={size * 1.2} viewBox="0 0 100 120" fill="none" aria-hidden="true">
        <g className={cls(0)} style={{ opacity: op(0), transition: t }}>
          <path d="M50 5C46 15 38 18 42 28c2 5 8 7 8 7s6-2 8-7c4-10-4-13-8-23z" fill="var(--color-rank)" />
        </g>
        <g className={cls(1)} style={{ opacity: op(1), transition: t }}>
          <circle cx="50" cy="45" r="8" fill="var(--color-rank)" />
          <path d="M35 62Q50 54 65 62" stroke="var(--color-rank)" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g className={cls(2)} style={{ opacity: op(2), transition: t }}>
          <rect x="22" y="72" width="56" height="5" rx="2" fill="var(--color-rank)" />
          <rect x="18" y="72" width="4" height="40" rx="2" fill="var(--color-rank)" />
          <rect x="78" y="72" width="4" height="40" rx="2" fill="var(--color-rank)" />
          <rect x="22" y="107" width="56" height="5" rx="2" fill="var(--color-rank)" />
        </g>
      </svg>
    );
  } else {
    svg = (
      <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <g className={cls(0)} style={{ opacity: op(0), transition: t }}>
          <circle cx="50" cy="50" r="42" stroke="var(--color-line-strong)" strokeWidth="2" />
          <circle cx="50" cy="50" r="22" stroke="var(--color-line-strong)" strokeWidth="2" />
        </g>
        <g className={cls(1)} style={{ opacity: op(1), transition: t }}>
          <path d="M50 50L92 30A44 44 0 0 0 50 6v44z" fill="var(--color-accent)" opacity="0.85" />
        </g>
        <g className={cls(2)} style={{ opacity: op(2), transition: t }}>
          <circle cx="50" cy="50" r="5" fill="var(--color-text)" />
          <circle cx="68" cy="62" r="4" fill="var(--color-ct)" />
          <circle cx="32" cy="38" r="4" fill="var(--color-t)" />
        </g>
      </svg>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5" role="status" aria-live="polite">
      {svg}
      <ol className="flex items-center gap-4 sm:gap-6" aria-hidden="true">
        {PIPELINE_STAGES.map((label, i) => {
          const state = stage > i ? "done" : stage === i ? "active" : "pending";
          return (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full transition-colors duration-[var(--dur-base)]"
                style={{
                  background:
                    state === "done" ? "var(--color-good)" : state === "active" ? "var(--color-accent)" : "var(--color-line-strong)",
                }}
              />
              <span className="eyebrow" style={{ color: state === "pending" ? "var(--color-text-3)" : "var(--color-text)" }}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
      <span className="sr-only">{announced}</span>
      {detail ? (
        <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}
