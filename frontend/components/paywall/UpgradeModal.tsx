"use client";

import { Check } from "lucide-react";
import { Button, Modal, Spinner } from "@/components/ui";
import { useCheckout } from "@/lib/api/hooks";

export interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** Tier the locked content needs (PaywalledPreview.tier_needed) — highlights that card. */
  tierNeeded?: string;
}

// Mirrors the tier matrix in services/billing/entitlements.py (plan keys from
// app/billing/page.tsx: "basic" → SOLO_PRO, "pro" → TEAM).
const PLAN_CARDS = [
  {
    plan: "basic",
    tier: "SOLO_PRO",
    name: "Solo Pro",
    price: "$5",
    period: "/ month",
    features: [
      "Deep individual coaching",
      "Corrective drills with tick references",
      "Pro benchmarks on every finding",
      "Positioning heatmaps",
    ],
  },
  {
    plan: "pro",
    tier: "TEAM",
    name: "Team",
    price: "$20",
    period: "/ month",
    features: [
      "Everything in Solo Pro",
      "Team macro analysis",
      "Opposition research & scouting dossiers",
      "Stratbook with Discord sync",
    ],
  },
] as const;

export function UpgradeModal({ open, onClose, tierNeeded }: UpgradeModalProps) {
  const checkout = useCheckout();

  return (
    <Modal open={open} onClose={onClose} label="Upgrade your plan" panelClassName="max-w-[640px]">
      <h2 className="text-xl font-bold" style={{ fontFamily: "var(--font-heading)" }}>
        Unlock the full report
      </h2>
      <p className="mt-1 text-sm" style={{ color: "var(--color-text-secondary)" }}>
        Every finding, drill, and pro benchmark — pick the tier that fits.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {PLAN_CARDS.map((card) => {
          const highlighted = card.tier === (tierNeeded ?? "").toUpperCase();
          const pending = checkout.isPending && checkout.variables === card.plan;
          return (
            <div
              key={card.plan}
              className="flex flex-col rounded-lg p-4"
              style={{
                background: highlighted ? "var(--color-accent-soft)" : "var(--color-bg-secondary)",
                border: `1px solid ${
                  highlighted ? "var(--color-border-strong)" : "var(--color-border-primary)"
                }`,
              }}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-base font-bold" style={{ color: "var(--color-text-primary)" }}>
                  {card.name}
                </h3>
                {highlighted && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                    style={{
                      color: "var(--color-accent-secondary)",
                      border: "1px solid var(--color-border-secondary)",
                      background: "var(--color-secondary-soft)",
                    }}
                  >
                    Required
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-1">
                <span className="text-2xl font-bold" style={{ color: "var(--color-text-primary)" }}>
                  {card.price}
                </span>
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                  {card.period}
                </span>
              </div>
              <ul className="mt-3 mb-4 flex-1 space-y-2">
                {card.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-xs"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    <Check
                      size={12}
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--color-success)" }}
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button
                variant={highlighted ? "primary" : "secondary"}
                size="sm"
                disabled={checkout.isPending}
                onClick={() => checkout.mutate(card.plan)}
              >
                {pending ? (
                  <>
                    <Spinner size={14} /> Redirecting…
                  </>
                ) : (
                  `Upgrade to ${card.name}`
                )}
              </Button>
            </div>
          );
        })}
      </div>

      {checkout.isError && (
        <p className="mt-3 text-xs" style={{ color: "var(--color-danger)" }}>
          Checkout failed to start. Please try again.
        </p>
      )}
    </Modal>
  );
}
