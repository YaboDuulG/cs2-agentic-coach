"use client";

import { cn } from "@/lib/utils";

export interface ProgressProps {
  /** 0–100 */
  value: number;
  className?: string;
  label?: string;
}

// The fill animates scaleX, not width — transform skips layout and paint.
export function Progress({ value, className, label }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn("ds-progress", className)}
    >
      <div className="ds-progress-fill" style={{ transform: `scaleX(${clamped / 100})` }} />
    </div>
  );
}
