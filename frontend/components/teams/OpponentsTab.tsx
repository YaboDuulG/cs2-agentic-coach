"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { MatchRow } from "@/components/matches/MatchRow";
import { shortUserId } from "@/components/teams/util";
import { Button, Card, CardHeader, EmptyState, SkeletonRows } from "@/components/ui";
import { UploadModal } from "@/components/upload/UploadModal";
import { useTeamMatches, type TeamMatchRow } from "@/lib/api/hooks";
import { mapLabel, shortDate } from "@/lib/format";

/**
 * Opponents: scouting dossiers, one group per opponent (the name given at
 * upload). Demos uploaded without a name group by map instead.
 */
export function OpponentsTab({ teamId, locked }: { teamId: string; locked: boolean }) {
  const matches = useTeamMatches(teamId);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Stable identity: UploadModal resets its steps whenever `preset` changes.
  const preset = useMemo(() => ({ mode: "scouting" as const, teamId }), [teamId]);

  const groups = useMemo(() => {
    const byKey = new Map<string, { label: string; named: boolean; rows: TeamMatchRow[] }>();
    for (const m of matches.data ?? []) {
      if (m.mode !== "scouting") continue;
      const named = Boolean(m.opponent);
      const key = named ? `opp:${m.opponent!.toLowerCase()}` : `map:${m.map ?? ""}`;
      const g = byKey.get(key) ?? { label: named ? m.opponent! : mapLabel(m.map), named, rows: [] };
      g.rows.push(m);
      byKey.set(key, g);
    }
    return Array.from(byKey.values())
      .map((g) => ({ ...g, rows: g.rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")) }))
      .sort((a, b) => (b.rows[0]?.created_at ?? "").localeCompare(a.rows[0]?.created_at ?? ""));
  }, [matches.data]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const named = groups.filter((g) => g.named).length;

  return (
    <div>
      <Card>
        <CardHeader
          title="Opponent dossiers"
          description={
            total
              ? `${total} ${total === 1 ? "demo" : "demos"} on ${named} ${named === 1 ? "opponent" : "opponents"}${groups.length > named ? `, ${groups.length - named} unnamed` : ""}.`
              : "Profile the teams you are about to face."
          }
          actions={
            <Button size="sm" onClick={() => setUploadOpen(true)} disabled={locked} title={locked ? "Renew the Team plan to scout" : undefined}>
              Scout an opponent
            </Button>
          }
        />
        {matches.isLoading ? (
          <SkeletonRows rows={3} />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Search size={28} />}
            title="No dossiers yet"
            description="Upload an opponent's demo and we'll profile their buys, defaults and habits."
            action={
              <Button size="sm" onClick={() => setUploadOpen(true)} disabled={locked}>
                Scout an opponent
              </Button>
            }
          />
        ) : (
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm">
                    {g.label}
                    {!g.named ? (
                      <span className="ml-2 text-[12px] font-normal" style={{ color: "var(--color-text-3)" }}>
                        no opponent named
                      </span>
                    ) : null}
                  </h3>
                  <span className="num text-[12px]" style={{ color: "var(--color-text-3)" }}>
                    {g.rows.length} {g.rows.length === 1 ? "demo" : "demos"} · latest {shortDate(g.rows[0]?.created_at)}
                  </span>
                </div>
                <div className="space-y-2">
                  {g.rows.map((m) => (
                    <MatchRow key={m.match_id} m={{ ...m, uploader: `${shortDate(m.created_at)} · ${shortUserId(m.user_id)}` }} showUploader />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </Card>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} preset={preset} />
    </div>
  );
}
