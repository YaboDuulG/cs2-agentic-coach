"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { UpgradeModal } from "@/components/paywall/UpgradeModal";
import { CoachTab } from "@/components/teams/CoachTab";
import { OpponentsTab } from "@/components/teams/OpponentsTab";
import { OverviewTab } from "@/components/teams/OverviewTab";
import { SettingsTab } from "@/components/teams/SettingsTab";
import { StratbookTab } from "@/components/teams/StratbookTab";
import { TeamMark } from "@/components/teams/TeamMark";
import { Badge, Button, EmptyState, Notice, PageHeader, Skeleton, SkeletonRows, Tabs, type TabItem } from "@/components/ui";
import { HttpError, useEntitlements, useTeam } from "@/lib/api/hooks";
import { longDate } from "@/lib/format";

export type HubTab = "overview" | "opponents" | "stratbook" | "coach" | "settings";

const TABS: TabItem<HubTab>[] = [
  { key: "overview", label: "Overview" },
  { key: "opponents", label: "Opponents" },
  { key: "stratbook", label: "Stratbook" },
  { key: "coach", label: "Coach" },
  { key: "settings", label: "Settings" },
];

const isTab = (v: string | null): v is HubTab => TABS.some((t) => t.key === v);

/** Team Hub: one team, five sections. The tab lives in `?tab=` so links deep-link. */
export function TeamHub({ teamId }: { teamId: string }) {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <TeamHubInner teamId={teamId} />
    </Suspense>
  );
}

function TeamHubInner({ teamId }: { teamId: string }) {
  const { user } = useUser();
  const team = useTeam(teamId);
  const ents = useEntitlements();
  const pathname = usePathname();
  const search = useSearchParams();
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const tabParam = search.get("tab");
  const tab: HubTab = isTab(tabParam) ? tabParam : "overview";
  const setTab = (next: HubTab) => {
    const q = new URLSearchParams(search.toString());
    if (next === "overview") q.delete("tab");
    else q.set("tab", next);
    const qs = q.toString();
    // Native history keeps the switch instant: the App Router syncs
    // useSearchParams from replaceState without a server round trip.
    window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  if (team.isLoading) {
    return (
      <div>
        <div className="mb-6 flex items-center gap-4">
          <Skeleton className="h-14 w-14" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <SkeletonRows rows={4} />
      </div>
    );
  }

  if (team.isError || !team.data) {
    const status = team.error instanceof HttpError ? team.error.status : 0;
    return (
      <EmptyState
        title={status === 403 ? "You are not on this team" : "Team not found"}
        description={status === 403 ? "Ask the captain for the invite code to join." : "It may have been deleted, or the link is wrong."}
        action={
          <Button asChild variant="secondary">
            <Link href="/teams">Back to Teams</Link>
          </Button>
        }
      />
    );
  }

  const t = team.data;
  const isOwner = Boolean(user?.id) && user?.id === t.owner_user_id;
  // Members inherit the owner's plan server-side; only a lapsed owner sees the banner.
  const ownerLapsed = isOwner && ents.isSuccess && !ents.data.entitlements.includes("team_analysis");
  const locked = ownerLapsed;
  const memberCount = t.members.length;
  const endedOn = ents.data?.current_period_end ?? ents.data?.season_until ?? null;

  return (
    <div>
      <PageHeader
        leading={<TeamMark name={t.name} logoUrl={t.logo_url} size={56} />}
        back={
          <Link href="/teams" className="link">
            ← Teams
          </Link>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            {t.name}
            {isOwner ? <Badge tone="rank">Captain</Badge> : <Badge>Player</Badge>}
          </span>
        }
        description={
          <span className="num">
            {memberCount} {memberCount === 1 ? "member" : "members"}
          </span>
        }
      />

      {ownerLapsed ? (
        <Notice
          tone="warning"
          title={endedOn ? `Your Team plan ended on ${longDate(endedOn)}.` : "Your Team plan is not active."}
          action={
            <Button variant="rank" size="sm" onClick={() => setUpgradeOpen(true)}>
              Renew Team
            </Button>
          }
          className="mb-6"
        >
          Renew to upload, scout or run servers. Everything here stays readable meanwhile.
        </Notice>
      ) : null}

      <Tabs items={TABS} value={tab} onChange={setTab} label="Team hub sections" className="mb-6" />

      {tab === "overview" ? <OverviewTab team={t} viewerId={user?.id ?? null} locked={locked} onTab={setTab} /> : null}
      {tab === "opponents" ? <OpponentsTab teamId={t.team_id} locked={locked} /> : null}
      {tab === "stratbook" ? <StratbookTab teamId={t.team_id} isOwner={isOwner} /> : null}
      {tab === "coach" ? <CoachTab teamId={t.team_id} /> : null}
      {tab === "settings" ? <SettingsTab team={t} viewerId={user?.id ?? null} isOwner={isOwner} /> : null}

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} tierNeeded="TEAM" />
    </div>
  );
}
