"use client";

import { Copy } from "lucide-react";
import { useState } from "react";
import { Button, Card, CardHeader, Input, Label, Select, toast } from "@/components/ui";
import { useMintPromoCodes, usePromoCodes } from "@/lib/api/hooks";

/** Mint a weekly batch of single-use trial codes and see what has been used. */
export function TrialCodesPanel() {
  const codes = usePromoCodes();
  const mint = useMintPromoCodes();
  const [count, setCount] = useState(5);
  const [tier, setTier] = useState<"SOLO_PRO" | "TEAM">("SOLO_PRO");
  const [days, setDays] = useState(7);
  const [validDays, setValidDays] = useState(14);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<string[]>([]);

  async function onMint() {
    try {
      const r = await mint.mutateAsync({ count, tier, days, max_uses: 1, valid_days: validDays, note: note || null });
      setFresh(r.codes.map((c) => c.code));
      toast.success(`${r.codes.length} code${r.codes.length === 1 ? "" : "s"} minted.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not mint codes.");
    }
  }

  async function copyFresh() {
    try {
      await navigator.clipboard.writeText(fresh.join("\n"));
      toast.success("Codes copied, one per line.");
    } catch {
      toast.error("Copy was blocked. Select the list and copy manually.");
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Trial codes" description="Single-use. Each grants the tier for the number of days below; unused codes expire after the validity window." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div>
          <Label htmlFor="trial-count">Count</Label>
          <Input id="trial-count" mono type="number" min={1} max={200} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="trial-tier">Tier</Label>
          <Select id="trial-tier" value={tier} onChange={(e) => setTier(e.target.value as "SOLO_PRO" | "TEAM")}>
            <option value="SOLO_PRO">Solo Pro</option>
            <option value="TEAM">Team</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="trial-days">Days</Label>
          <Input id="trial-days" mono type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="trial-valid">Valid for (days)</Label>
          <Input id="trial-valid" mono type="number" min={1} max={365} value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} />
        </div>
        <div>
          <Label htmlFor="trial-note">Note</Label>
          <Input id="trial-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="week 40 giveaway" maxLength={120} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button onClick={onMint} loading={mint.isPending}>
          Mint {count} code{count === 1 ? "" : "s"}
        </Button>
        {fresh.length ? (
          <Button variant="secondary" onClick={copyFresh}>
            <Copy size={14} aria-hidden="true" /> Copy the new batch
          </Button>
        ) : null}
      </div>
      {fresh.length ? (
        <pre className="num surface-2 mt-3 select-all whitespace-pre-wrap p-3 text-[12px]" style={{ color: "var(--color-good)" }}>
          {fresh.join("\n")}
        </pre>
      ) : null}
      {codes.data?.codes.length ? (
        <div className="mt-4 overflow-x-auto">
          <table className="num w-full text-[12px]">
            <thead>
              <tr className="eyebrow text-left">
                <th className="py-1.5 pr-3 font-medium">Code</th>
                <th className="py-1.5 pr-3 font-medium">Tier</th>
                <th className="py-1.5 pr-3 font-medium">Days</th>
                <th className="py-1.5 pr-3 font-medium">Used</th>
                <th className="py-1.5 pr-3 font-medium">Expires</th>
                <th className="py-1.5 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {codes.data.codes.map((c) => {
                const spent = c.max_uses !== null && c.uses >= c.max_uses;
                const expired = c.expires_at ? new Date(c.expires_at) < new Date() : false;
                return (
                  <tr key={c.code} className="border-t hairline" style={{ opacity: spent || expired ? 0.5 : 1 }}>
                    <td className="py-1.5 pr-3">{c.code}</td>
                    <td className="py-1.5 pr-3">{c.tier === "TEAM" ? "Team" : "Solo Pro"}</td>
                    <td className="py-1.5 pr-3">{c.days}</td>
                    <td className="py-1.5 pr-3">
                      {c.uses}/{c.max_uses ?? "∞"}
                    </td>
                    <td className="py-1.5 pr-3">{c.expires_at ? new Date(c.expires_at).toLocaleDateString() : "—"}</td>
                    <td className="py-1.5" style={{ color: "var(--color-text-3)", fontFamily: "var(--font-body)" }}>
                      {c.note ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}
