"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { PaywalledPreview } from "@/lib/api/client";
import { Button, Card } from "@/components/ui";
import { cn } from "@/lib/utils";
import { UpgradeModal } from "./UpgradeModal";

// The PaywalledPreview is SERVER-provided — gating is validated server-side;
// this component only visualizes what the server already omitted, per the
// never-client-side-gating constraint. The blurred block below is decorative
// faux content (fixed-width bars), never real data hidden with CSS.
export interface GatedInsightCardProps {
  preview: PaywalledPreview;
  className?: string;
}

const FAUX_ROWS = [
  ["18%", "62%"],
  ["24%", "78%"],
  ["14%", "54%"],
] as const;

export function GatedInsightCard({ preview, className }: GatedInsightCardProps) {
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const count = preview.hidden_insights_count;

  return (
    <Card className={cn("relative overflow-hidden p-4", className)}>
      {/* Decorative faux content — clearly fake bars behind the blur. */}
      <div aria-hidden="true" className="min-h-[150px] select-none blur-[7px]" style={{ opacity: 0.55 }}>
        {FAUX_ROWS.map(([label, body], i) => (
          <div key={i} className="mb-3">
            <div
              className="h-2.5 rounded-full"
              style={{ width: label, background: "var(--color-accent-primary)" }}
            />
            <div
              className="mt-1.5 h-2 rounded-full"
              style={{ width: body, background: "var(--color-text-muted)" }}
            />
          </div>
        ))}
      </div>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
        <div className="flex items-center gap-2">
          <Lock size={14} style={{ color: "var(--color-accent-secondary)" }} />
          <span className="text-sm font-bold" style={{ color: "var(--color-text-primary)" }}>
            {count === 1 ? "1 insight locked" : `${count} insights locked`}
          </span>
          {preview.tier_needed && (
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                color: "var(--color-accent-secondary)",
                border: "1px solid var(--color-border-secondary)",
                background: "var(--color-secondary-soft)",
              }}
            >
              {preview.tier_needed.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <p
          className="max-w-md text-xs leading-relaxed"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {preview.upgrade_cta}
        </p>
        <Button size="sm" className="mt-1" onClick={() => setUpgradeOpen(true)}>
          Upgrade
        </Button>
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        tierNeeded={preview.tier_needed}
      />
    </Card>
  );
}
