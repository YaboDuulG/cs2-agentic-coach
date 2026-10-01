"use client";

import { useState } from "react";
import { Card, CardHeader, Skeleton, Stat } from "@/components/ui";
import { useDatHostAccount, useTeamMetering } from "@/lib/api/hooks";
import { usd } from "@/lib/format";

const WINDOWS = [
  ["season", "This season"],
  ["30d", "30 days"],
  ["90d", "90 days"],
  ["all", "All time"],
] as const;

const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

/** What each team costs (Gemini + servers) against its $300 season. */
export function MeteringPanel() {
  const [window, setWindow] = useState<(typeof WINDOWS)[number][0]>("season");
  const metering = useTeamMetering(window);
  const dathost = useDatHostAccount();
  const data = metering.data;
  const hourly = data?.server_hourly_cost_usd ?? 0;
  const creditHours = dathost.data?.available && typeof dathost.data.credits === "number" && hourly > 0 ? Math.floor(dathost.data.credits / hourly) : null;

  return (
    <Card className="mb-6">
      <CardHeader
        title="Team metering"
        description="Gemini spend is metered per call and attributed through the match; server hours come from training sessions at the configured rate."
        actions={
          <div className="flex gap-1" role="group" aria-label="Window">
            {WINDOWS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={window === k}
                onClick={() => setWindow(k)}
                className="rounded-full px-2.5 py-1 text-[12px] font-semibold"
                style={{
                  background: window === k ? "var(--color-accent-soft)" : "var(--color-surface-2)",
                  color: window === k ? "var(--color-accent)" : "var(--color-text-2)",
                  border: "1px solid var(--color-line)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />
      {metering.isLoading ? (
        <Skeleton className="h-40" />
      ) : data ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Gemini" value={usd(data.totals.llm_cost_usd, 2)} />
            <Stat label="Servers" value={usd(data.totals.server_cost_usd, 2)} />
            <Stat label="Revenue" value={usd(data.totals.revenue_usd, 2)} />
            <Stat label="Margin" value={usd(data.totals.margin_usd, 2)} tone={data.totals.margin_usd >= 0 ? "good" : "danger"} />
          </div>
          {data.teams.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
              No teams yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="num w-full text-[12px]">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="py-1.5 pr-3 font-medium">Team</th>
                    <th className="py-1.5 pr-3 font-medium">Season</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Matches</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Tokens in/out</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Gemini</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Server h</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Servers</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Cost</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Revenue</th>
                    <th className="py-1.5 text-right font-medium">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map((t) => (
                    <tr key={t.team_id} className="border-t hairline">
                      <td className="py-1.5 pr-3" style={{ fontFamily: "var(--font-body)" }}>
                        {t.name} <span style={{ color: "var(--color-text-3)" }}>· {t.members}</span>
                      </td>
                      <td className="py-1.5 pr-3" style={{ color: t.season_active ? "var(--color-good)" : "var(--color-text-3)" }}>
                        {t.season ? `S${t.season}${t.season_active ? "" : " ended"}` : "none"}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{t.matches}</td>
                      <td className="py-1.5 pr-3 text-right">{t.llm_calls}</td>
                      <td className="py-1.5 pr-3 text-right" style={{ color: "var(--color-text-2)" }}>
                        {tokens(t.input_tokens)} / {tokens(t.output_tokens)}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{usd(t.llm_cost_usd, 3)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.server_hours.toFixed(1)}</td>
                      <td className="py-1.5 pr-3 text-right">{usd(t.server_cost_usd, 2)}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold">{usd(t.total_cost_usd, 2)}</td>
                      <td className="py-1.5 pr-3 text-right">{usd(t.revenue_usd, 2)}</td>
                      <td className="py-1.5 text-right font-semibold" style={{ color: t.margin_usd >= 0 ? "var(--color-good)" : "var(--color-danger)" }}>
                        {usd(t.margin_usd, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="num mt-3 text-[12px]" style={{ color: "var(--color-text-3)" }}>
            Server rate {usd(hourly, 2)}/h · unattributed Gemini: {data.unattributed_llm.calls} calls, {usd(data.unattributed_llm.cost_usd, 3)} · DatHost:{" "}
            {dathost.data === undefined
              ? "checking…"
              : !dathost.data.available
                ? `unavailable (${dathost.data.reason ?? "no response"})`
                : `${typeof dathost.data.credits === "number" ? `${dathost.data.credits.toFixed(2)} ${dathost.data.currency ?? ""} credits` : "credits not reported"}${creditHours !== null ? ` ≈ ${creditHours} server-hours` : ""}${typeof dathost.data.servers_on === "number" ? ` · ${dathost.data.servers_on} on now` : ""}`}
          </p>
        </>
      ) : null}
    </Card>
  );
}
