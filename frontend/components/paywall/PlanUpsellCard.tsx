"use client";

// Plan-aware upsell for the Command Center — renders nothing for Team-tier
// users. Enticement, not obstruction: it names what the next tier actually
// unlocks (mirroring services/billing/entitlements.py) and opens the same
// UpgradeModal used by locked report cards. Gold accent — gold is rank.

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { ChevronRight, Lock } from "lucide-react";

import { UpgradeModal } from "./UpgradeModal";

const PITCH: Record<string, { title: string; bullets: string[]; tierNeeded: string }> = {
  free: {
    title: "Your reports end at the headline",
    bullets: [
      "Every finding with round + tick references and pro benchmarks",
      "Step-by-step corrective drills after every match",
      "Per-player deep dives",
    ],
    tierNeeded: "SOLO_PRO",
  },
  basic: {
    title: "Bring the whole team",
    bullets: [
      "Team macro analysis: trades, executes, retakes",
      "Opposition scouting dossiers",
      "Stratbook with Discord sync and practice servers",
    ],
    tierNeeded: "TEAM",
  },
};

export function PlanUpsellCard() {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const plan = ((user?.publicMetadata?.plan as string) ?? "free").toLowerCase();
  const pitch = PITCH[plan];
  if (!pitch) return null; // pro/team — nothing to sell

  return (
    <>
      <div
        className="card flex flex-col sm:flex-row sm:items-center gap-4 p-5"
        style={{ borderColor: "var(--color-border-secondary)" }}
      >
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border"
          style={{
            background: "var(--color-secondary-soft)",
            borderColor: "var(--color-border-secondary)",
          }}
        >
          <Lock size={16} style={{ color: "var(--color-accent-secondary)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            {pitch.title}
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
            {pitch.bullets.join(" · ")}
          </p>
        </div>
        <button
          className="ds-btn ds-btn-secondary ds-btn-sm flex-shrink-0"
          style={{
            borderColor: "var(--color-border-secondary)",
            color: "var(--color-accent-secondary)",
          }}
          onClick={() => setOpen(true)}
        >
          See plans <ChevronRight size={14} />
        </button>
      </div>
      <UpgradeModal open={open} onClose={() => setOpen(false)} tierNeeded={pitch.tierNeeded} />
    </>
  );
}
