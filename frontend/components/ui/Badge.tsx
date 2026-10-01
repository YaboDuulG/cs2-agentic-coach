import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "neutral" | "accent" | "rank" | "good" | "warning" | "danger" | "ct" | "t";

const tones: Record<BadgeTone, { fg: string; bg: string; line: string }> = {
  neutral: { fg: "var(--color-text-2)", bg: "var(--color-surface-2)", line: "var(--color-line)" },
  accent: { fg: "var(--color-accent)", bg: "var(--color-accent-soft)", line: "transparent" },
  rank: { fg: "var(--color-rank)", bg: "color-mix(in srgb, var(--color-rank) 14%, transparent)", line: "transparent" },
  good: { fg: "var(--color-good)", bg: "color-mix(in srgb, var(--color-good) 14%, transparent)", line: "transparent" },
  warning: { fg: "var(--color-warning)", bg: "color-mix(in srgb, var(--color-warning) 14%, transparent)", line: "transparent" },
  danger: { fg: "var(--color-danger)", bg: "color-mix(in srgb, var(--color-danger) 14%, transparent)", line: "transparent" },
  ct: { fg: "var(--color-ct)", bg: "color-mix(in srgb, var(--color-ct) 14%, transparent)", line: "transparent" },
  t: { fg: "var(--color-t)", bg: "color-mix(in srgb, var(--color-t) 14%, transparent)", line: "transparent" },
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
  mono?: boolean;
}

export function Badge({ tone = "neutral", icon, mono, className, children, style, ...props }: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5",
        mono && "num tracking-wide",
        className,
      )}
      style={{ color: t.fg, background: t.bg, border: `1px solid ${t.line}`, ...style }}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/** Analysis mode, from the server's enum. Never derived client-side. */
export type Mode = "PERSONAL_IMPROVEMENT" | "TEAM_ANALYSIS" | "OPPOSITION_RESEARCH" | "personal" | "team" | "scouting";

export function modeLabel(mode: Mode | string | null | undefined): "Personal" | "Team" | "Scouting" | "—" {
  switch (mode) {
    case "PERSONAL_IMPROVEMENT":
    case "personal":
      return "Personal";
    case "TEAM_ANALYSIS":
    case "team":
      return "Team";
    case "OPPOSITION_RESEARCH":
    case "scouting":
      return "Scouting";
    default:
      return "—";
  }
}

export function ModeBadge({ mode, className }: { mode: Mode | string | null | undefined; className?: string }) {
  const label = modeLabel(mode);
  if (label === "—") return null;
  return (
    <Badge tone="neutral" className={className} aria-label={`${label} analysis`}>
      {label}
    </Badge>
  );
}

/** Letter grade with its score; colour by band, never by brand. */
export function GradeChip({ grade, score, className }: { grade?: string | null; score?: number | null; className?: string }) {
  if (!grade) return null;
  const tone: BadgeTone = /^A/.test(grade) ? "good" : /^B/.test(grade) ? "rank" : /^C/.test(grade) ? "warning" : "danger";
  return (
    <Badge tone={tone} mono className={cn("px-2.5", className)} title={score != null ? `Score ${score}` : undefined}>
      {grade}
      {score != null ? <span className="opacity-70">· {score}</span> : null}
    </Badge>
  );
}
