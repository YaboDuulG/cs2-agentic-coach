"use client";

import { CanvasStep } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export interface PhaseTimelineProps {
  steps: CanvasStep[];
  /** Controlled selection — index into steps. */
  selectedStep: number;
  onSelect: (index: number) => void;
}

function formatT(t: number): string {
  const seconds = Math.max(0, Math.round(t));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Horizontal chips over a strat revision's canvas steps. */
export function PhaseTimeline({ steps, selectedStep, onSelect }: PhaseTimelineProps) {
  if (steps.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        This revision has no timed steps.
      </p>
    );
  }

  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Strat phases">
      {steps.map((step, i) => {
        const selected = i === selectedStep;
        return (
          <button
            key={i}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(i)}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors",
            )}
            style={{
              background: selected ? "var(--color-accent-soft)" : "var(--color-bg-secondary)",
              borderColor: selected
                ? "var(--color-border-strong)"
                : "var(--color-border-primary)",
              color: selected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            }}
          >
            <span
              className="text-[10px] font-bold"
              style={{
                fontFamily: "var(--font-mono)",
                color: selected ? "var(--color-accent-primary)" : "var(--color-text-muted)",
              }}
            >
              {formatT(step.t)}
            </span>
            <span className="whitespace-nowrap font-medium">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}
