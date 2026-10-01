"use client";

import { Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { UpgradeModal } from "@/components/paywall/UpgradeModal";
import { TeamMark } from "@/components/teams/TeamMark";
import { Badge, Button, Card, EmptyState, FieldError, Input, Label, PageHeader, SkeletonRows, toast } from "@/components/ui";
import { useCreateTeam, useEntitlements, useJoinTeam, useTeams } from "@/lib/api/hooks";
import { relativeTime } from "@/lib/format";

/** Teams: pick or create one. Without the Team plan this page is the paywall. */
export default function TeamsPage() {
  const router = useRouter();
  const teams = useTeams();
  const ents = useEntitlements();
  const create = useCreateTeam();
  const join = useJoinTeam();
  const [mode, setMode] = useState<"none" | "create" | "join">("none");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const canCreate = ents.data?.entitlements.includes("team_analysis") ?? false;
  const list = teams.data ?? [];

  async function onCreate() {
    try {
      const t = await create.mutateAsync(name.trim());
      toast.success(`${t.name} created. Invite code ${t.invite_code}.`);
      router.push(`/teams/${t.team_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create the team.");
    }
  }

  async function onJoin() {
    try {
      const t = await join.mutateAsync(code.trim().toUpperCase());
      toast.success(`Joined ${t.name}.`);
      router.push(`/teams/${t.team_id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That invite code didn't work.");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Teams"
        title="Teams"
        description="Shared demos, scouting dossiers, practice servers and a stratbook with Discord approval."
        actions={
          <>
            <Button variant="secondary" onClick={() => setMode(mode === "join" ? "none" : "join")}>
              Join with code
            </Button>
            <Button onClick={() => (canCreate ? setMode(mode === "create" ? "none" : "create") : setUpgradeOpen(true))}>
              Create team
            </Button>
          </>
        }
      />

      {mode === "create" && canCreate ? (
        <Card className="mb-6">
          <Label htmlFor="team-name">Team name</Label>
          <div className="flex gap-2">
            <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Night Shift" maxLength={64} onKeyDown={(e) => e.key === "Enter" && name.trim() && onCreate()} />
            <Button onClick={onCreate} loading={create.isPending} disabled={!name.trim()}>
              Create
            </Button>
            <Button variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
          <FieldError>{create.isError ? (create.error as Error).message : null}</FieldError>
        </Card>
      ) : null}

      {mode === "join" ? (
        <Card className="mb-6">
          <Label htmlFor="invite-code" hint="8 characters, from your captain">
            Invite code
          </Label>
          <div className="flex gap-2">
            <Input id="invite-code" mono value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A3F9BC12" maxLength={8} onKeyDown={(e) => e.key === "Enter" && code.length === 8 && onJoin()} />
            <Button onClick={onJoin} loading={join.isPending} disabled={code.length < 8}>
              Join
            </Button>
            <Button variant="ghost" onClick={() => setMode("none")}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
            Joining a team whose captain holds the Team plan gives you its features on any tier.
          </p>
        </Card>
      ) : null}

      {teams.isLoading ? (
        <SkeletonRows rows={3} />
      ) : list.length === 0 ? (
        canCreate ? (
          <EmptyState
            icon={<Users size={28} />}
            title="No teams yet"
            description="Create a team and invite your roster with the code."
            action={<Button onClick={() => setMode("create")}>Create your first team</Button>}
          />
        ) : (
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl">Team plan · $300 per ESEA season</h2>
                <p className="mt-1 text-sm" style={{ color: "var(--color-text-2)" }}>
                  One payment for the whole roster: team analysis on every demo, opponent scouting dossiers, practice servers with ten
                  training modes, and a stratbook your team approves from Discord. Access runs until the next season starts.
                </p>
                <p className="mt-2 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                  Already on a team? Use the invite code from your captain.
                </p>
              </div>
              <Button variant="rank" onClick={() => setUpgradeOpen(true)}>
                Choose Team
              </Button>
            </div>
          </Card>
        )
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((t) => (
            <Link key={t.team_id} href={`/teams/${t.team_id}`} className="surface flex items-center gap-4 p-4 transition-[border-color] duration-[var(--dur-fast)] hover:border-(--color-line-strong)">
              <TeamMark name={t.name} logoUrl={t.logo_url} size={44} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{t.name}</span>
                  {t.is_owner ? <Badge tone="rank">Captain</Badge> : <Badge>Player</Badge>}
                </div>
                <p className="num mt-0.5 text-[12px]" style={{ color: "var(--color-text-3)" }}>
                  {t.member_count} {t.member_count === 1 ? "member" : "members"} · created {relativeTime(t.created_at)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} tierNeeded="TEAM" />
    </div>
  );
}
