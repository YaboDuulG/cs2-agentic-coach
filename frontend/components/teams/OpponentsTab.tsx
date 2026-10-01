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
 * Opponents: scouting dossiers. The API carries no opponent name, so dossiers
 * group by map with the date on each row.
 */
export function OpponentsTab({ teamId, locked }: { teamId: string; locked: boolean }) {
  const matches = useTeamMatches(teamId);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Stable identity: UploadModal resets its steps whenever `preset` changes.
  const preset = useMemo(() => ({ mode: "scouting" as const, teamId }), [teamId]);

  const groups = useMemo(() => {
    const byMap = new Map<string, TeamMatchRow[]>();
    for (const m of matches.data ?? []) {
      if (m.mode !== "scouting") continue;
      const key = m.map ?? "";
      byMap.set(key, [...(byMap.get(key) ?? []), m]);
    }
    return Array.from(byMap.entries())
      .map(([map, rows]) => ({
        map,
        rows: rows.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "")),
      }))
      .sort((a, b) => (b.rows[0]?.created_at ?? "").localeCompare(a.rows[0]?.created_at ?? ""));
  }, [matches.data]);

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <div>
      <Card>
        <CardHeader
          title="Opponent dossiers"
          description={total ? `${total} ${total === 1 ? "dossier" : "dossiers"} across ${groups.length} ${groups.length === 1 ? "map" : "maps"}.` : "Profile the teams you are about to face."}
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
              <section key={g.map || "unknown"} aria-label={mapLabel(g.map)}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className="text-sm">{mapLabel(g.map)}</h3>
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
