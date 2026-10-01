"use client";

import { useTheme } from "@/lib/theme/useTheme";

/**
 * The logo mark, per theme: a radar sweep (CS2), a crosshair (CS:GO), the
 * Soyombo (Khan). All original vector work; no Valve assets.
 */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  const { def } = useTheme();
  const common = { width: size, height: size, viewBox: "0 0 32 32", fill: "none", className, "aria-hidden": true as const };

  if (def.mark === "crosshair") {
    return (
      <svg {...common}>
        <circle cx="16" cy="16" r="10" stroke="var(--color-accent)" strokeWidth="2.5" />
        <path d="M16 2v7M16 23v7M2 16h7M23 16h7" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="16" cy="16" r="2" fill="var(--color-text)" />
      </svg>
    );
  }
  if (def.mark === "soyombo") {
    return (
      <svg {...common}>
        <path d="M16 2c-1.6 3.2-4 4.4-3 7.3.6 1.6 3 2.4 3 2.4s2.4-.8 3-2.4c1-2.9-1.4-4.1-3-7.3z" fill="var(--color-rank)" />
        <circle cx="16" cy="15.5" r="2.6" fill="var(--color-rank)" />
        <path d="M11 20.5q5-2.6 10 0" stroke="var(--color-rank)" strokeWidth="1.8" strokeLinecap="round" />
        <rect x="9" y="23" width="14" height="1.8" rx=".9" fill="var(--color-rank)" />
        <rect x="9" y="27" width="14" height="1.8" rx=".9" fill="var(--color-rank)" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="16" cy="16" r="13" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="7" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <path d="M16 16L28 9.5A13 13 0 0 0 16 3v13z" fill="var(--color-accent)" opacity="0.9" />
      <circle cx="16" cy="16" r="2" fill="var(--color-text)" />
      <circle cx="22.5" cy="19.5" r="1.6" fill="var(--color-ct)" />
      <circle cx="9.5" cy="12" r="1.6" fill="var(--color-t)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className} style={{ fontFamily: "var(--font-heading)", fontWeight: 700, letterSpacing: "var(--heading-tracking)" }}>
      Demo<span style={{ color: "var(--color-accent)" }}>Sage</span>
    </span>
  );
}
