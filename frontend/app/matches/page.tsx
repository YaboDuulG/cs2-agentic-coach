"use client";

import { useMemo, useState } from "react";
import { MatchRow } from "@/components/matches/MatchRow";
import { Button, EmptyState, PageHeader, Select, SkeletonRows } from "@/components/ui";
import { UploadModal } from "@/components/upload/UploadModal";
import { useMatches, useTeams } from "@/lib/api/hooks";
import { mapLabel } from "@/lib/format";

type Filter = "all" | "personal" | "team";

/** Matches: find one among many. Scouting dossiers live in the Team Hub. */
export default function MatchesPage() {
  const matches = useMatches("all");
  const teams = useTeams();
  const [filter, setFilter] = useState<Filter>("all");
  const [teamId, setTeamId] = useState<string>("");
  const [map, setMap] = useState<string>("");
  const [uploadOpen, setUploadOpen] = useState(false);

  const rows = useMemo(() => {
    const all = (matches.data ?? []).filter((m) => m.mode !== "scouting");
    return all.filter((m) => {
      if (filter === "personal" && m.mode !== "personal") return false;
      if (filter === "team" && m.mode !== "team") return false;
      if (teamId && m.team_id !== teamId) return false;
      if (map && (m.map ?? "") !== map) return false;
      return true;
    });
  }, [matches.data, filter, teamId, map]);

  const maps = useMemo(() => Array.from(new Set((matches.data ?? []).map((m) => m.map).filter(Boolean))) as string[], [matches.data]);
  const count = matches.data?.length ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Matches"
        title="Matches"
        description={count ? `${count} ${count === 1 ? "match" : "matches"} analysed` : "Every demo you or your teams have uploaded."}
        actions={<Button onClick={() => setUploadOpen(true)}>Upload a demo</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
        {(["all", "personal", "team"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className="rounded-full px-3 py-1 text-[13px] font-semibold transition-colors duration-[var(--dur-fast)]"
            style={{
              background: filter === f ? "var(--color-accent-soft)" : "var(--color-surface-2)",
              color: filter === f ? "var(--color-accent)" : "var(--color-text-2)",
              border: "1px solid var(--color-line)",
            }}
          >
            {f === "all" ? "All" : f === "personal" ? "Personal" : "Team"}
          </button>
        ))}
        {(teams.data?.length ?? 0) > 1 ? (
          <Select aria-label="Team" className="w-auto" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Any team</option>
            {teams.data!.map((t) => (
              <option key={t.team_id} value={t.team_id}>
                {t.name}
              </option>
            ))}
          </Select>
        ) : null}
        {maps.length > 1 ? (
          <Select aria-label="Map" className="w-auto" value={map} onChange={(e) => setMap(e.target.value)}>
            <option value="">Any map</option>
            {maps.map((m) => (
              <option key={m} value={m}>
                {mapLabel(m)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>

      {matches.isLoading ? (
        <SkeletonRows rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === "team" ? "No team matches yet" : "No matches yet"}
          description={
            filter === "team"
              ? "Upload one from your Team Hub, or choose Coach my team when you upload."
              : "Upload a demo and the debrief lands here in a few minutes."
          }
          action={
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              Upload a demo
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {rows.map((m) => (
            <MatchRow key={m.match_id} m={m} />
          ))}
        </div>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
