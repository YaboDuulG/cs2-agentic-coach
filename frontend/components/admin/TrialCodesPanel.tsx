"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Ticket } from "lucide-react";
import { useState } from "react";
import { toast } from "@/components/ui";

interface PromoCode {
  code: string;
  tier: string;
  days: number;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string | null;
}

// Admin: mint a batch of trial codes (the weekly giveaway) and see what has
// been used. Each code grants `days` of `tier`; single-use by default.
export function TrialCodesPanel() {
  const queryClient = useQueryClient();
  const [count, setCount] = useState(5);
  const [tier, setTier] = useState<"SOLO_PRO" | "TEAM">("SOLO_PRO");
  const [days, setDays] = useState(7);
  const [validDays, setValidDays] = useState(14);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string[]>([]);

  // The list is informational; the mint form works even if it fails.
  const { data: codes = [] } = useQuery<PromoCode[]>({
    queryKey: ["admin", "promo-codes"],
    queryFn: async () => {
      const res = await fetch("/api/admin/promo-codes", { cache: "no-store" });
      if (!res.ok) throw new Error("Could not load trial codes");
      return ((await res.json()).codes ?? []) as PromoCode[];
    },
  });

  async function mint() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/promo-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, tier, days, valid_days: validDays, max_uses: 1, note: note || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(typeof data.detail === "string" ? data.detail : "Could not mint codes.");
        return;
      }
      const minted = (data.codes as PromoCode[]).map((c) => c.code);
      setFresh(minted);
      toast.success(`${minted.length} code${minted.length === 1 ? "" : "s"} minted.`);
      await queryClient.invalidateQueries({ queryKey: ["admin", "promo-codes"] });
    } catch {
      toast.error("Network error while minting.");
    } finally {
      setBusy(false);
    }
  }

  async function copyFresh() {
    try {
      await navigator.clipboard.writeText(fresh.join("\n"));
      toast.success("Codes copied, one per line.");
    } catch {
      toast.error("Copy blocked by the browser — select the list and copy manually.");
    }
  }

  const inputCls =
    "w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#C9A227] transition-colors font-mono";

  return (
    <div className="card p-6 mb-8 text-left space-y-5" style={{ background: "rgba(13,24,37,0.5)", border: "1px solid #1E3A5F" }}>
      <div className="flex items-center gap-2">
        <Ticket size={16} style={{ color: "#2D7DD2" }} aria-hidden="true" />
        <h2 className="heading-display text-sm font-bold uppercase tracking-wider" style={{ color: "#2D7DD2" }}>
          Trial codes
        </h2>
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
        Mint a batch for the weekly giveaway. Each code is single-use and grants the tier for the
        number of days below; unused codes expire after the validity window.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <label className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Count</span>
          <input id="trial-count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tier</span>
          <select id="trial-tier" value={tier} onChange={(e) => setTier(e.target.value as "SOLO_PRO" | "TEAM")} className={inputCls}>
            <option value="SOLO_PRO">Solo Pro</option>
            <option value="TEAM">Team</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Days</span>
          <input id="trial-days" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Valid for (days)</span>
          <input id="trial-valid" type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="space-y-1">
          <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Note</span>
          <input id="trial-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="week 40 giveaway" maxLength={120} className={inputCls} />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={mint}
          disabled={busy}
          className="px-4 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ background: "#2D7DD2", color: "#fff" }}
        >
          {busy ? "Minting…" : `Mint ${count} code${count === 1 ? "" : "s"}`}
        </button>
        {fresh.length > 0 && (
          <button
            type="button"
            onClick={copyFresh}
            className="px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
          >
            <Copy size={13} aria-hidden="true" /> Copy the new batch
          </button>
        )}
      </div>

      {fresh.length > 0 && (
        <pre className="text-xs font-mono rounded-lg p-3 bg-slate-950/70 border border-slate-900 text-[#22D3A0] select-all whitespace-pre-wrap">
          {fresh.join("\n")}
        </pre>
      )}

      {codes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-slate-500 uppercase tracking-wider text-left">
                <th className="py-1.5 pr-3">Code</th>
                <th className="py-1.5 pr-3">Tier</th>
                <th className="py-1.5 pr-3">Days</th>
                <th className="py-1.5 pr-3">Used</th>
                <th className="py-1.5 pr-3">Expires</th>
                <th className="py-1.5">Note</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const spent = c.max_uses !== null && c.uses >= c.max_uses;
                const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
                return (
                  <tr key={c.code} className="border-t border-slate-900" style={{ opacity: spent || expired ? 0.5 : 1 }}>
                    <td className="py-1.5 pr-3 text-slate-200">{c.code}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{c.tier === "TEAM" ? "Team" : "Solo Pro"}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{c.days}</td>
                    <td className="py-1.5 pr-3 text-slate-400">
                      {c.uses}/{c.max_uses ?? "∞"}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-400">
                      {c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-1.5 text-slate-500">{c.note ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
