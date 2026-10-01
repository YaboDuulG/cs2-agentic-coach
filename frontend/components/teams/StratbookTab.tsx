"use client";

import { BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { DiscordCard } from "@/components/teams/DiscordCard";
import { IngestedStrategies } from "@/components/teams/IngestedStrategies";
import { StratDetailPanel } from "@/components/teams/StratDetailPanel";
import { STATUS_LABEL, STATUS_TONE } from "@/components/teams/util";
import { Badge, Card, CardHeader, EmptyState, Input, Select, SkeletonRows } from "@/components/ui";
import type { StratSummary } from "@/lib/api/client";
import { useStrats } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

/** Stratbook: the strategy library, the selected strat, Discord, and the ingested notes. */
export function StratbookTab({ teamId, isOwner }: { teamId: string; isOwner: boolean }) {
  const strats = useStrats(teamId);
  const [map, setMap] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (strats.data ?? [])
      .filter((s) => (!map || s.map_name === map) && (!q || s.title.toLowerCase().includes(q) || s.map_name.toLowerCase().includes(q)))
      .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  }, [strats.data, map, query]);

  const maps = useMemo(() => Array.from(new Set((strats.data ?? []).map((s) => s.map_name).filter(Boolean))).sort(), [strats.data]);
  const selected: StratSummary | null = (strats.data ?? []).find((s) => s.id === selectedId) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="Strategy library" description="Drafts move to review, get approved in Discord, and become active." />
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <Input placeholder="Search by title or map" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search strats" />
            <Select value={map} onChange={(e) => setMap(e.target.value)} aria-label="Filter by map" className="sm:w-44">
              <option value="">All maps</option>
              {maps.map((m) => (
                <option key={m} value={m}>
                  {mapLabel(m)}
                </option>
              ))}
            </Select>
          </div>
          {strats.isLoading ? (
            <SkeletonRows rows={4} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<BookOpen size={28} />}
              title={strats.data?.length ? "No strats match" : "No strats yet"}
              description={strats.data?.length ? "Clear the search or pick another map." : "Strats are created from Discord with /strat new, then drafted and approved here."}
            />
          ) : (
            <ul className="space-y-2" role="list">
              {list.map((s) => {
                const active = s.id === selectedId;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(active ? null : s.id)}
                      aria-pressed={active}
                      className="surface-2 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-[border-color] duration-(--dur-fast) hover:border-(--color-line-strong)"
                      style={active ? { borderColor: "var(--color-focus)" } : undefined}
                    >
                      <Badge tone={s.side === "CT" ? "ct" : "t"}>{s.side}</Badge>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{s.title}</span>
                        <span className="block text-[12px]" style={{ color: "var(--color-text-3)" }}>
                          {mapLabel(s.map_name)}
                          {s.buy_type ? ` · ${s.buy_type}` : ""} · <span className="num">{relativeTime(s.updated_at)}</span>
                        </span>
                      </span>
                      <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <IngestedStrategies teamId={teamId} />
      </div>

      <div className="space-y-6">
        <StratDetailPanel teamId={teamId} strat={selected} />
        <DiscordCard strat={selected} isOwner={isOwner} />
      </div>
    </div>
  );
}
