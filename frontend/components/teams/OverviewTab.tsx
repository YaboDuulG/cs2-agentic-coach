"use client";

import { ArrowRight, Server as ServerIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { MatchRow } from "@/components/matches/MatchRow";
import { CopyButton } from "@/components/teams/CopyButton";
import { expiresIn, isServerRunning, shortUserId } from "@/components/teams/util";
import type { HubTab } from "@/components/teams/TeamHub";
import { Badge, Button, Card, CardHeader, EmptyState, SkeletonRows } from "@/components/ui";
import { UploadModal } from "@/components/upload/UploadModal";
import { useStrats, useTeamMatches, useTeamServers, type TeamDetail } from "@/lib/api/hooks";
import { mapLabel, relativeTime } from "@/lib/format";

/** Overview: who is on the team, what they played, what is running, what is approved. */
export function OverviewTab({
  team,
  viewerId,
  locked,
  onTab,
}: {
  team: TeamDetail;
  viewerId: string | null;
  locked: boolean;
  onTab: (tab: HubTab) => void;
}) {
  const matches = useTeamMatches(team.team_id);
  const servers = useTeamServers(team.team_id);
  const strats = useStrats(team.team_id);
  const [uploadOpen, setUploadOpen] = useState(false);
  const codeRef = useRef<HTMLSpanElement>(null);
  // Stable identity: UploadModal resets its steps whenever `preset` changes.
  const preset = useMemo(() => ({ mode: "team" as const, teamId: team.team_id }), [team.team_id]);

  const teamMatches = (matches.data ?? []).filter((m) => m.mode === "team").slice(0, 5);
  const running = (servers.data ?? []).filter((s) => isServerRunning(s.status));
  const active = (strats.data ?? [])
    .filter((s) => s.status === "ACTIVE")
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
    .slice(0, 3);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Members" description="Invite with the code; anyone who joins inherits the captain's plan." />
        <ul className="space-y-2">
          {team.members.map((m) => {
            const isOwner = m.role === "owner";
            const isYou = viewerId !== null && m.user_id === viewerId;
            return (
              <li key={m.user_id} className="surface-2 flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate text-sm font-semibold">
                  {isYou ? "You" : isOwner ? "Captain" : <span className="num">{shortUserId(m.user_id)}</span>}
                  {isYou && isOwner ? (
                    <span className="ml-1 font-normal" style={{ color: "var(--color-text-3)" }}>
                      · Captain
                    </span>
                  ) : null}
                </span>
                {isOwner ? <Badge tone="rank">Captain</Badge> : <Badge>Player</Badge>}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 hairline">
          <div>
            <p className="eyebrow">Invite code</p>
            <span ref={codeRef} className="num text-lg font-semibold tracking-wider">
              {team.invite_code}
            </span>
          </div>
          <CopyButton text={team.invite_code} selectRef={codeRef} label="Copy code" />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Team matches"
          description="Demos analysed for the whole roster."
          actions={
            <Button size="sm" onClick={() => setUploadOpen(true)} disabled={locked} title={locked ? "Renew the Team plan to upload" : undefined}>
              Upload a demo
            </Button>
          }
        />
        {matches.isLoading ? (
          <SkeletonRows rows={3} />
        ) : teamMatches.length === 0 ? (
          <EmptyState
            title="No team matches yet"
            description="Upload a scrim or match demo and the coach will debrief the whole roster."
            action={
              <Button size="sm" onClick={() => setUploadOpen(true)} disabled={locked}>
                Upload a demo
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {teamMatches.map((m) => (
              <MatchRow key={m.match_id} m={{ ...m, uploader: shortUserId(m.user_id) }} showUploader />
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Practice servers"
          description="Ten training modes on a private server."
          actions={
            locked ? (
              <Button size="sm" variant="secondary" disabled title="Renew the Team plan to run servers">
                Spin up a server
              </Button>
            ) : (
              <Button asChild size="sm" variant="secondary">
                <Link href={`/teams/${team.team_id}/training`}>Spin up a server</Link>
              </Button>
            )
          }
        />
        {servers.isLoading ? (
          <SkeletonRows rows={1} />
        ) : running.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text-2)" }}>
            Nothing running. Start a session from the training page.
          </p>
        ) : (
          <ul className="space-y-2">
            {running.map((s) => (
              <li key={s.id} className="surface-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <ServerIcon size={14} aria-hidden="true" style={{ color: "var(--color-text-3)" }} />
                  <Badge tone={s.status === "active" ? "good" : "accent"}>{s.status === "active" ? "Running" : "Booting"}</Badge>
                  <span className="text-sm font-semibold">{s.mode}</span>
                  <span className="num text-[12px]" style={{ color: "var(--color-text-3)" }}>
                    expires in {expiresIn(s.expires_at)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="num text-sm">{s.ip_address ?? "assigning address…"}</span>
                  {s.ip_address ? <CopyButton text={s.ip_address} label="Copy" variant="ghost" /> : null}
                  <Link href={`/teams/${team.team_id}/servers/${s.id}`} className="link ml-auto text-sm">
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link href={`/teams/${team.team_id}/training`} className="link mt-4 inline-flex items-center gap-1 text-sm">
          Open training modes <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </Card>

      <Card>
        <CardHeader
          title="Latest strats"
          description="The three most recently approved."
          actions={
            <Button size="sm" variant="ghost" onClick={() => onTab("stratbook")}>
              Open stratbook
            </Button>
          }
        />
        {strats.isLoading ? (
          <SkeletonRows rows={3} />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active strats yet"
            description="Draft one in the stratbook and approve it from Discord."
            action={
              <Button size="sm" variant="secondary" onClick={() => onTab("stratbook")}>
                Open stratbook
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {active.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onTab("stratbook")}
                  className="surface-2 flex w-full items-center gap-3 px-3 py-2 text-left transition-[border-color] duration-[var(--dur-fast)] hover:border-(--color-line-strong)"
                >
                  <Badge tone={s.side === "CT" ? "ct" : "t"}>{s.side}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{s.title}</span>
                  <span className="text-[12px]" style={{ color: "var(--color-text-3)" }}>
                    {mapLabel(s.map_name)} · <span className="num">{relativeTime(s.updated_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} preset={preset} />
    </div>
  );
}
