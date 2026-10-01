"use client";

import { useMemo } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Card, CardHeader } from "@/components/ui";
import type { JobRound } from "@/lib/api/hooks";
import { economySeries, sideSwitchAfter, type EconomyPoint } from "./derive";
import { Legend } from "./RoundTimeline";
import { useDebriefFilter } from "./useDebriefFilter";

const k = (n: number) => `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;

/**
 * Spend per round, one 2px line per team, no fills, a dashed rule at every
 * side switch. The selected round gets a solid rule. Peaks are written out
 * under the chart so the extremes read without hovering.
 */
export function EconomyChart({ rounds, names }: { rounds: JobRound[]; names: { a: string; b: string } }) {
  const { round: selected, setRound } = useDebriefFilter();
  const data = useMemo(() => economySeries(rounds), [rounds]);
  const switches = data.filter((p, i) => i < data.length - 1 && sideSwitchAfter(p.round)).map((p) => p.round + 0.5);
  const peak = (key: "a" | "b") => data.reduce<EconomyPoint | null>((best, p) => (best == null || p[key] > best[key] ? p : best), null);
  const peakA = peak("a");
  const peakB = peak("b");
  const last = data[data.length - 1]?.round ?? 1;

  return (
    <Card>
      <CardHeader title="Economy" description="Equipment value bought at the start of each round." actions={<Legend names={names} />} />
      <div className="h-56 w-full" role="img" aria-label={`Spend per round for ${names.a} and ${names.b}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            onClick={(state) => {
              const r = state?.activeLabel;
              const n = typeof r === "number" ? r : Number(r);
              if (Number.isFinite(n) && n > 0) setRound(selected === n ? null : n);
            }}
          >
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="round"
              type="number"
              domain={[1, last]}
              ticks={data.filter((p) => p.round === 1 || p.round % 4 === 0).map((p) => p.round)}
              tick={{ fill: "var(--color-text-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "var(--color-line)" }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={k}
              width={44}
              tick={{ fill: "var(--color-text-3)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
            />
            {switches.map((x) => (
              <ReferenceLine key={x} x={x} stroke="var(--color-line-strong)" strokeDasharray="3 3" />
            ))}
            {selected != null ? <ReferenceLine x={selected} stroke="var(--color-text-2)" /> : null}
            <Tooltip
              content={({ active, payload, label }) => <EconomyTooltip active={active} payload={payload} label={label} names={names} />}
              cursor={{ stroke: "var(--color-line-strong)" }}
            />
            <Line type="linear" dataKey="a" name={names.a} stroke="var(--color-ct)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
            <Line type="linear" dataKey="b" name={names.b} stroke="var(--color-t)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "var(--color-bg)", strokeWidth: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
        Peak buys: {names.a} <span className="num">{peakA ? `${k(peakA.a)} in R${peakA.round}` : "—"}</span> · {names.b}{" "}
        <span className="num">{peakB ? `${k(peakB.b)} in R${peakB.round}` : "—"}</span>. Click a round to select it.
      </p>
    </Card>
  );
}

type TooltipBits = Pick<TooltipContentProps<number, string>, "active" | "payload" | "label">;

function EconomyTooltip({ active, payload, label, names }: TooltipBits & { names: { a: string; b: string } }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as EconomyPoint | undefined;
  return (
    <div className="surface px-3 py-2 text-[12px]" style={{ boxShadow: "var(--shadow-pop)" }}>
      <p className="num font-semibold">Round {String(label)}</p>
      {(["a", "b"] as const).map((t) => (
        <p key={t} className="flex items-center gap-2" style={{ color: "var(--color-text-2)" }}>
          <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ background: t === "a" ? "var(--color-ct)" : "var(--color-t)" }} />
          {names[t]} <span className="num ml-auto" style={{ color: "var(--color-text)" }}>${(point?.[t] ?? 0).toLocaleString()}</span>
        </p>
      ))}
      {point?.winner ? (
        <p className="mt-1" style={{ color: "var(--color-text-3)" }}>
          Won by {names[point.winner]}
        </p>
      ) : null}
    </div>
  );
}
