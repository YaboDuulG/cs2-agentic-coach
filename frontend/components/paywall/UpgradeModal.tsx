"use client";

import { Check } from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import { useCheckout, useSeasons } from "@/lib/api/hooks";
import { shortDate } from "@/lib/format";

type TierKey = "SOLO_PRO" | "TEAM";

const CARDS: { tier: TierKey; plan: "basic" | "pro"; name: string; price: string; period: string; features: string[] }[] = [
  {
    tier: "SOLO_PRO",
    plan: "basic",
    name: "Solo Pro",
    price: "$10",
    period: "/ month · or $96 / year",
    features: ["Every finding with round + tick references", "Pro benchmarks on each finding", "Corrective drills", "30-day history"],
  },
  {
    tier: "TEAM",
    plan: "pro",
    name: "Team",
    price: "$300",
    period: "/ ESEA season · one payment",
    features: ["Team analysis and opponent scouting", "Seats for the whole roster", "Practice servers and training modes", "Stratbook with Discord sync"],
  },
];

/**
 * The upsell, server-shaped: the caller says which tier the locked thing
 * needs; that card is highlighted. Checkout goes through the same route as
 * the pricing page.
 */
export function UpgradeModal({ open, onClose, tierNeeded }: { open: boolean; onClose: () => void; tierNeeded?: TierKey | string | null }) {
  const checkout = useCheckout();
  const seasons = useSeasons();
  const season = seasons.data?.purchasable;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tierNeeded === "TEAM" ? "Team is a season pass" : "Unlock the full report"}
      description={tierNeeded === "TEAM" ? "One payment covers the whole roster until the next ESEA season starts." : "Pick the plan that fits how you play."}
      size="lg"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {CARDS.map((card) => {
          const highlighted = (tierNeeded ?? "SOLO_PRO") === card.tier;
          const pending = checkout.isPending && checkout.variables?.plan === card.plan;
          return (
            <div key={card.tier} className="surface-2 flex flex-col p-4" style={{ borderColor: highlighted ? "var(--color-accent)" : undefined }}>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base">{card.name}</h3>
                {highlighted ? <Badge tone="accent">Unlocks this</Badge> : null}
              </div>
              <p className="mb-1">
                <span className="num text-2xl font-semibold">{card.price}</span>
                <span className="ml-1 text-[12px]" style={{ color: "var(--color-text-2)" }}>
                  {card.period}
                </span>
              </p>
              {card.tier === "TEAM" && season ? (
                <p className="mb-3 text-[12px]" style={{ color: "var(--color-text-2)" }}>
                  {season.label} · {shortDate(season.start)} – {shortDate(season.end)}
                  {season.projected ? " (dates to be confirmed)" : ""}
                </p>
              ) : (
                <p className="mb-3" />
              )}
              <ul className="mb-4 space-y-1.5 text-[13px]">
                {card.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-good)" }} aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-auto"
                variant={highlighted ? "primary" : "secondary"}
                loading={pending}
                disabled={checkout.isPending}
                onClick={() => checkout.mutate({ plan: card.plan })}
              >
                {card.tier === "TEAM" ? (season ? `Buy ${season.label}` : "Buy this season") : "Upgrade to Solo Pro"}
              </Button>
            </div>
          );
        })}
      </div>
      {checkout.isError ? (
        <p className="mt-3 text-[13px]" style={{ color: "var(--color-danger)" }} role="alert">
          {(checkout.error as Error).message}
        </p>
      ) : null}
    </Modal>
  );
}
