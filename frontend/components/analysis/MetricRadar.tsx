"use client";

import { useEffect, useState } from "react";
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer } from "recharts";

export interface MetricRadarProps {
  /** Finding count per category — either computed from key_findings or the
   * server's finding_categories histogram (teaser mode). */
  categories: Record<string, number>;
  height?: number;
}

const FALLBACK = {
  stroke: "#2D7DD2",
  grid: "rgba(45, 125, 210, 0.2)",
  text: "#8BA7CC",
};

/**
 * Radar of finding counts per category. Recharts needs concrete color values,
 * so the design tokens are resolved with getComputedStyle on mount (SSR pass
 * renders with the default-theme fallbacks, then adopts the active theme).
 */
export function MetricRadar({ categories, height = 260 }: MetricRadarProps) {
  const [colors, setColors] = useState(FALLBACK);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const read = (token: string, fallback: string) =>
      styles.getPropertyValue(token).trim() || fallback;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- token values only exist in the browser; one-time read on mount
    setColors({
      stroke: read("--color-accent-primary", FALLBACK.stroke),
      grid: read("--color-border-primary", FALLBACK.grid),
      text: read("--color-text-secondary", FALLBACK.text),
    });
  }, []);

  const data = Object.entries(categories).map(([category, count]) => ({
    category: category.replace(/_/g, " "),
    count,
  }));

  if (data.length === 0) return null;

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke={colors.grid} />
          <PolarAngleAxis dataKey="category" tick={{ fill: colors.text, fontSize: 11 }} />
          <Radar
            dataKey="count"
            stroke={colors.stroke}
            fill={colors.stroke}
            fillOpacity={0.25}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
