"use client";

import { useTheme } from "@/lib/theme/useTheme";

/** Static page background per theme. No continuous animation, no GPU cost. */
export function Ambience() {
  const { def } = useTheme();
  const cls = { grid: "ambience-grid", scanlines: "ambience-scanlines", cloud: "ambience-cloud" }[def.ambience];
  return <div aria-hidden="true" className={`pointer-events-none fixed inset-0 -z-10 ${cls}`} />;
}
