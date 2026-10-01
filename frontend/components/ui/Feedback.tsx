import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Skeleton block: holds layout while data loads. Never a spinner sentence. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      data-skeleton=""
      className={cn("animate-pulse rounded-(--radius-sm)", className)}
      style={{ background: "var(--color-surface-2)" }}
    />
  );
}

export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** Empty state that names the next action. Icon optional, action required. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("surface-2 flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon ? (
        <div className="mb-3" style={{ color: "var(--color-text-3)" }}>
          {icon}
        </div>
      ) : null}
      <h3 className="text-base">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm" style={{ color: "var(--color-text-2)" }}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Inline problem with a way out. Not for toasts; for page sections. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: "info" | "warning" | "danger" | "good";
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const color = {
    info: "var(--color-focus)",
    warning: "var(--color-warning)",
    danger: "var(--color-danger)",
    good: "var(--color-good)",
  }[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : undefined}
      className={cn("surface-2 flex flex-col gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center", className)}
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? (
          <p style={{ color: title ? "var(--color-text-2)" : "var(--color-text)" }}>{children}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Stat tile: label, a mono figure, optional delta or hint. */
export function Stat({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "good" | "warning" | "danger";
  className?: string;
}) {
  const color = tone ? `var(--color-${tone})` : "var(--color-text)";
  return (
    <div className={cn("surface-2 px-4 py-3", className)}>
      <p className="eyebrow">{label}</p>
      <p className="num mt-1 text-xl font-semibold" style={{ color }}>
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[12px]" style={{ color: "var(--color-text-3)" }}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ProgressBar({ value, max = 100, label, className }: { value: number; max?: number; label: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn("h-1.5 w-full overflow-hidden rounded-full", className)}
      style={{ background: "var(--color-surface-2)" }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out)]"
        style={{ width: `${pct}%`, background: "var(--color-accent)" }}
      />
    </div>
  );
}
