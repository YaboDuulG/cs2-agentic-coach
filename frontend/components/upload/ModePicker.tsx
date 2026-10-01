"use client";

import { useUser } from "@clerk/nextjs";
import { Crosshair, Lock, User, Users } from "lucide-react";
import Link from "next/link";
import { Badge, Select } from "@/components/ui";
import { useEntitlements, useTeams } from "@/lib/api/hooks";
import { cn } from "@/lib/utils";

export type UploadMode = "personal" | "team" | "scouting";

export interface ModeChoice {
  mode: UploadMode;
  teamId: string | null;
}

/**
 * Step 1 of every upload: who is this analysis for? Three cards, always
 * visible. Locked cards name the plan and link to it; they never disappear.
 * Personal needs a linked Steam ID; Team and Scouting need a team and the
 * Team plan (or a seat on a team whose owner has one).
 */
export function ModePicker({ value, onChange, onUpgrade }: { value: ModeChoice; onChange: (next: ModeChoice) => void; onUpgrade: () => void }) {
  const { user } = useUser();
  const steamId = (user?.unsafeMetadata?.steam_id as string | undefined) ?? "";
  const ents = useEntitlements();
  const teams = useTeams();

  const canTeam = ents.data?.entitlements.includes("team_analysis") ?? false;
  const canScout = ents.data?.entitlements.includes("team_scouting") ?? false;
  const teamList = teams.data ?? [];
  // Seats: a member of any team may upload to it even without their own plan;
  // the server enforces the owner's season. Offer the selector when teams exist.
  const hasTeams = teamList.length > 0;

  const cards: {
    mode: UploadMode;
    title: string;
    body: string;
    icon: React.ReactNode;
    locked: boolean;
    lockReason?: React.ReactNode;
  }[] = [
    {
      mode: "personal",
      title: "Coach me",
      body: "Every finding about your duels, utility and positioning, cited to the round.",
      icon: <User size={18} />,
      locked: !steamId,
      lockReason: (
        <>
          Needs your Steam ID so the coach knows which player is you.{" "}
          <Link href="/settings" className="link">
            Link Steam
          </Link>
        </>
      ),
    },
    {
      mode: "team",
      title: "Coach my team",
      body: "Macro: trades, defaults, retakes, utility stacks. Every player gets a report.",
      icon: <Users size={18} />,
      locked: !hasTeams && !canTeam,
      lockReason: !canTeam && !hasTeams ? "Team plan · $300 per ESEA season" : hasTeams ? undefined : "Create a team first",
    },
    {
      mode: "scouting",
      title: "Scout an opponent",
      body: "Their buys, defaults and habits, filed under your team as a dossier.",
      icon: <Crosshair size={18} />,
      locked: !hasTeams && !canScout,
      lockReason: !canScout && !hasTeams ? "Team plan · $300 per ESEA season" : hasTeams ? undefined : "Create a team first",
    },
  ];

  const needsTeam = value.mode === "team" || value.mode === "scouting";

  return (
    <div>
      <p className="eyebrow mb-2">Who is this analysis for?</p>
      <div role="radiogroup" aria-label="Analysis mode" className="grid gap-2 sm:grid-cols-3">
        {cards.map((c) => {
          const active = value.mode === c.mode;
          return (
            <button
              key={c.mode}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => {
                if (c.locked) {
                  if (c.lockReason && typeof c.lockReason === "string" && c.lockReason.startsWith("Team plan")) onUpgrade();
                  return;
                }
                onChange({ mode: c.mode, teamId: c.mode === "personal" ? null : (value.teamId ?? teamList[0]?.team_id ?? null) });
              }}
              className={cn(
                "surface-2 flex flex-col items-start gap-2 p-3 text-left transition-[border-color] duration-[var(--dur-fast)]",
                c.locked && "opacity-80",
              )}
              style={{ borderColor: active ? "var(--color-accent)" : undefined }}
            >
              <span className="flex w-full items-center justify-between">
                <span style={{ color: active ? "var(--color-accent)" : "var(--color-text-2)" }}>{c.icon}</span>
                {c.locked ? <Lock size={13} style={{ color: "var(--color-text-3)" }} aria-hidden="true" /> : null}
              </span>
              <span className="text-sm font-semibold">{c.title}</span>
              <span className="text-[12px] leading-snug" style={{ color: "var(--color-text-2)" }}>
                {c.body}
              </span>
              {c.locked && c.lockReason ? (
                <span className="text-[12px]" style={{ color: "var(--color-warning)" }}>
                  {c.lockReason}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {needsTeam ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label htmlFor="upload-team" className="text-[13px] font-semibold">
            Team
          </label>
          {hasTeams ? (
            <Select
              id="upload-team"
              className="w-auto min-w-48"
              value={value.teamId ?? ""}
              onChange={(e) => onChange({ ...value, teamId: e.target.value || null })}
            >
              {teamList.map((t) => (
                <option key={t.team_id} value={t.team_id}>
                  {t.name}
                </option>
              ))}
            </Select>
          ) : (
            <Link href="/teams" className="link text-sm">
              Create a team →
            </Link>
          )}
          {value.mode === "scouting" ? <Badge tone="neutral">Filed as an opponent dossier</Badge> : null}
        </div>
      ) : null}
    </div>
  );
}
