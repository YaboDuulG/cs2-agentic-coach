"use client";

import { useQuery } from "@tanstack/react-query";
import { Coins } from "lucide-react";
import { useState } from "react";

interface TeamRow {
  team_id: string;
  name: string;
  owner_user_id: string;
  members: number;
  season: number | null;
  season_until: string | null;
  season_active: boolean;
  matches: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  llm_cost_usd: number;
  server_sessions: number;
  server_hours: number;
  server_cost_usd: number;
  revenue_usd: number;
  total_cost_usd: number;
  margin_usd: number;
}

interface DatHostAccount {
  available: boolean;
  reason?: string;
  credits?: number | null;
  currency?: string | null;
  servers_on?: number | null;
}

interface Metering {
  window: string;
  since: string | null;
  server_hourly_cost_usd: number;
  teams: TeamRow[];
  unattributed_llm: { calls: number; cost_usd: number };
  totals: { llm_cost_usd: number; server_cost_usd: number; revenue_usd: number; margin_usd: number };
}

const WINDOWS = [
  { key: "season", label: "This season" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
] as const;

const usd = (n: number, digits = 2) =>
  n.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n));

// Admin: what each team costs us (Gemini + servers) against the $300 season.
// Prices per token and the server hourly rate are SystemConfig keys edited in
// the LLM Parameters card below; this table reads them through the backend.
export function TeamMeteringPanel() {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]["key"]>("season");
  const { data, isLoading, isError } = useQuery<Metering>({
    queryKey: ["admin", "team-metering", window],
    queryFn: async () => {
      const res = await fetch(`/api/admin/team-metering?window=${window}`, { cache: "no-store" });
      if (!res.ok) throw new Error("metering unavailable");
      return res.json();
    },
    refetchInterval: 60_000,
  });
  const { data: dathost } = useQuery<DatHostAccount>({
    queryKey: ["admin", "dathost-account"],
    queryFn: async () => {
      const res = await fetch("/api/admin/dathost-account", { cache: "no-store" });
      if (!res.ok) throw new Error("dathost unavailable");
      return res.json();
    },
    refetchInterval: 5 * 60_000,
  });
  const hourly = data?.server_hourly_cost_usd ?? 0;
  const creditHours =
    dathost?.available && typeof dathost.credits === "number" && hourly > 0
      ? dathost.credits / hourly
      : null;

  return (
    <div className="card p-6 mb-8 text-left space-y-4" style={{ background: "rgba(13,24,37,0.5)", border: "1px solid #1E3A5F" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Coins size={16} style={{ color: "#2D7DD2" }} aria-hidden="true" />
          <h2 className="heading-display text-sm font-bold uppercase tracking-wider" style={{ color: "#2D7DD2" }}>
            Team metering
          </h2>
        </div>
        <div className="flex gap-1" role="group" aria-label="Metering window">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              aria-pressed={window === w.key}
              onClick={() => setWindow(w.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${
                window === w.key ? "bg-[#2D7DD2] border-[#2D7DD2] text-white" : "border-slate-800 text-slate-400 hover:text-white"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed max-w-2xl">
        Gemini spend is metered per call and attributed through the match; server hours come from
        training sessions at the configured hourly rate. Revenue is the $300 season if the owner
        holds one that overlaps the window.
        {data?.since ? ` Window starts ${new Date(data.since).toLocaleDateString()}.` : ""}
      </p>

      {isLoading && <p className="text-xs text-slate-500 font-mono">Loading…</p>}
      {isError && <p className="text-xs text-rose-400">Could not load metering.</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ["Gemini", data.totals.llm_cost_usd],
              ["Servers", data.totals.server_cost_usd],
              ["Revenue", data.totals.revenue_usd],
              ["Margin", data.totals.margin_usd],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl p-3 bg-slate-950/60 border border-slate-900">
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{label as string}</p>
                <p
                  className="text-lg font-bold font-mono mt-1"
                  style={{ color: label === "Margin" ? ((value as number) >= 0 ? "#22D3A0" : "#FF4D6D") : "#E8EDF5" }}
                >
                  {usd(value as number)}
                </p>
              </div>
            ))}
          </div>

          {data.teams.length === 0 ? (
            <p className="text-xs text-slate-500">No teams yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] font-mono">
                <thead>
                  <tr className="text-slate-500 uppercase tracking-wider text-left">
                    <th className="py-1.5 pr-3">Team</th>
                    <th className="py-1.5 pr-3">Season</th>
                    <th className="py-1.5 pr-3 text-right">Matches</th>
                    <th className="py-1.5 pr-3 text-right">Gemini calls</th>
                    <th className="py-1.5 pr-3 text-right">Tokens in / out</th>
                    <th className="py-1.5 pr-3 text-right">Gemini $</th>
                    <th className="py-1.5 pr-3 text-right">Server h</th>
                    <th className="py-1.5 pr-3 text-right">Server $</th>
                    <th className="py-1.5 pr-3 text-right">Cost</th>
                    <th className="py-1.5 pr-3 text-right">Revenue</th>
                    <th className="py-1.5 text-right">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {data.teams.map((t) => (
                    <tr key={t.team_id} className="border-t border-slate-900">
                      <td className="py-1.5 pr-3 text-slate-200">
                        {t.name}
                        <span className="text-slate-500"> · {t.members} {t.members === 1 ? "member" : "members"}</span>
                      </td>
                      <td className="py-1.5 pr-3">
                        {t.season ? (
                          <span style={{ color: t.season_active ? "#22D3A0" : "#8BA7CC" }}>
                            S{t.season}{t.season_active ? "" : " (ended)"}
                          </span>
                        ) : (
                          <span className="text-slate-600">none</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{t.matches}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{t.llm_calls}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-400">
                        {tokens(t.input_tokens)} / {tokens(t.output_tokens)}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{usd(t.llm_cost_usd, 3)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{t.server_hours.toFixed(1)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{usd(t.server_cost_usd)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-200">{usd(t.total_cost_usd)}</td>
                      <td className="py-1.5 pr-3 text-right text-slate-300">{usd(t.revenue_usd)}</td>
                      <td className="py-1.5 text-right font-bold" style={{ color: t.margin_usd >= 0 ? "#22D3A0" : "#FF4D6D" }}>
                        {usd(t.margin_usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-[10px] text-slate-500 font-mono">
            Server rate {usd(data.server_hourly_cost_usd)}/h · unattributed Gemini (no team):{" "}
            {data.unattributed_llm.calls} calls, {usd(data.unattributed_llm.cost_usd, 3)}
          </p>
          <p className="text-[10px] font-mono" style={{ color: dathost?.available ? "#8BA7CC" : "#F59E0B" }}>
            DatHost:{" "}
            {dathost === undefined
              ? "checking…"
              : !dathost.available
                ? `unavailable (${dathost.reason ?? "no response"})`
                : `${typeof dathost.credits === "number" ? `${dathost.credits.toFixed(2)} ${dathost.currency ?? ""} credits` : "credits not reported"}` +
                  (creditHours !== null ? ` ≈ ${Math.floor(creditHours)} server-hours at the configured rate` : "") +
                  (typeof dathost.servers_on === "number" ? ` · ${dathost.servers_on} server${dathost.servers_on === 1 ? "" : "s"} on now` : "")}
            . Out of credits now fails the spin-up with a clear message instead of a mock server.
          </p>
        </>
      )}
    </div>
  );
}
