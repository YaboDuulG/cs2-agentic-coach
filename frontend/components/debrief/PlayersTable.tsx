"use client";

import { useUser } from "@clerk/nextjs";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui";
import { pct } from "@/lib/format";
import type { PlayerRow } from "./derive";

type SortKey = keyof Pick<PlayerRow, "name" | "side" | "kills" | "deaths" | "kd" | "hsRate" | "openingKills" | "trades">;

const COLUMNS: { key: SortKey; label: string; numeric: boolean; title?: string }[] = [
  { key: "name", label: "Player", numeric: false },
  { key: "side", label: "Side", numeric: false, title: "Starting side" },
  { key: "kills", label: "K", numeric: true, title: "Kills" },
  { key: "deaths", label: "D", numeric: true, title: "Deaths" },
  { key: "kd", label: "K/D", numeric: true },
  { key: "hsRate", label: "HS%", numeric: true, title: "Headshot rate" },
  { key: "openingKills", label: "Opening", numeric: true, title: "Opening kills" },
  { key: "trades", label: "Trades", numeric: true, title: "Trade kills within five seconds" },
];

/** Scoreboard; click a header to sort. The uploader's row is marked. */
export function PlayersTable({ rows }: { rows: PlayerRow[] }) {
  const { user } = useUser();
  const mySteamId = (user?.unsafeMetadata?.steam_id as string | undefined) ?? "";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "kills", dir: "desc" });

  const sorted = useMemo(() => {
    const list = [...rows];
    const sign = sort.dir === "asc" ? 1 : -1;
    list.sort((x, y) => {
      const a = x[sort.key];
      const b = y[sort.key];
      if (typeof a === "number" && typeof b === "number") return (a - b) * sign;
      return String(a ?? "").localeCompare(String(b ?? "")) * sign;
    });
    return list;
  }, [rows, sort]);

  const toggle = (key: SortKey, numeric: boolean) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: numeric ? "desc" : "asc" }));

  return (
    <Card>
      <CardHeader title="Players" description="Kills, deaths and openings from the parsed demo. Sides are first-half sides." />
      {rows.length === 0 ? (
        <EmptyState title="No player stats" description="The parser recorded no kills for this match." />
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[560px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b hairline">
                {COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th key={c.key} scope="col" className={c.numeric ? "text-right" : "text-left"} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button
                        type="button"
                        onClick={() => toggle(c.key, c.numeric)}
                        title={c.title}
                        className="eyebrow inline-flex items-center gap-1 py-2 pr-2 normal-case tracking-normal"
                        style={{ color: active ? "var(--color-text)" : "var(--color-text-3)", fontSize: 12 }}
                      >
                        {c.label}
                        {active ? sort.dir === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" /> : null}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => {
                const me = Boolean(mySteamId) && p.key === mySteamId;
                return (
                  <tr key={p.key} className="border-b hairline last:border-b-0" style={{ background: me ? "var(--color-accent-soft)" : undefined }}>
                    <td className="py-2 pr-2">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-semibold">{p.name}</span>
                        {me ? <Badge tone="accent">you</Badge> : null}
                      </span>
                    </td>
                    <td className="py-2 pr-2">{p.side ? <Badge tone={p.side === "CT" ? "ct" : "t"}>{p.side}</Badge> : <span style={{ color: "var(--color-text-3)" }}>—</span>}</td>
                    <td className="num py-2 pr-2 text-right">{p.kills}</td>
                    <td className="num py-2 pr-2 text-right">{p.deaths}</td>
                    <td className="num py-2 pr-2 text-right">{p.kd.toFixed(2)}</td>
                    <td className="num py-2 pr-2 text-right">{pct(p.hsRate)}</td>
                    <td className="num py-2 pr-2 text-right">{p.openingKills}</td>
                    <td className="num py-2 text-right">{p.trades}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
