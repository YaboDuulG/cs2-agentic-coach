"use client";

import { toast } from "@/components/ui";
import { useUser } from "@clerk/nextjs";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type BillingInterval, SOLO_PRICE_USD, TEAM_SEASON_PRICE_USD } from "@/lib/flags";

interface SeasonInfo {
  number: number;
  label: string;
  start: string;
  end: string;
  access_until: string;
  projected: boolean;
}

// Display names follow the entitlement tiers (services/billing): the keys
// stay "basic"/"pro" — Stripe checkout and plan metadata depend on them.
//
// Pricing (owner decision 2026-09-29): Solo Pro $10 / month or $96 / year;
// Team is a flat $300 per ESEA season, bought once, not a subscription.
const FREE_FEATURES = ["2 demo uploads / month", "Headline + one finding per match", "7-day history"];
const SOLO_FEATURES = [
  "10 demo uploads / month",
  "Full AI coaching, built around you",
  "Pro-benchmark comparisons",
  "30-day history",
];
const TEAM_FEATURES = [
  "Create a team, seats for the whole roster",
  "Team analysis and opponent scouting",
  "Practice servers and training modes",
  "Stratbook with Discord sync",
  "Unlimited uploads, 365-day history",
];

function fmtDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function BillingPage() {
  const { user } = useUser();
  const meta = (user?.publicMetadata ?? {}) as { plan?: string; plan_season?: number };
  const currentPlan = meta.plan ?? "free";
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [loading, setLoading] = useState<string | null>(null);

  const { data: seasons } = useQuery<{ purchasable: SeasonInfo }>({
    queryKey: ["billing", "seasons"],
    queryFn: async () => {
      const r = await fetch("/api/billing/seasons");
      if (!r.ok) throw new Error("seasons unavailable");
      return r.json();
    },
    staleTime: 60 * 60 * 1000,
  });
  const season = seasons?.purchasable;
  const ownsThisSeason = currentPlan === "pro" && season !== undefined && meta.plan_season === season.number;

  const handleCheckout = async (planKey: "basic" | "pro") => {
    setLoading(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey, interval }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Checkout couldn't start. Try again in a moment.");
        return;
      }
      if (data.url) window.location.assign(data.url);
    } catch {
      toast.error("Checkout couldn't start. Try again in a moment.");
    } finally {
      setLoading(null);
    }
  };

  const soloPrice = interval === "year" ? `$${SOLO_PRICE_USD.year / 12}` : `$${SOLO_PRICE_USD.month}`;
  const soloPeriod = interval === "year" ? `/ month · $${SOLO_PRICE_USD.year} billed yearly` : "/ month";

  const plans = [
    {
      key: "free" as const,
      name: "Free",
      price: "$0",
      period: "forever",
      sub: "2 demos / month",
      color: "border-white/10",
      highlight: false,
      features: FREE_FEATURES,
      cta: null as string | null,
    },
    {
      key: "basic" as const,
      name: "Solo Pro",
      price: soloPrice,
      period: soloPeriod,
      sub: interval === "year" ? "20% off — two months free" : "Cancel anytime",
      color: "border-[#2D7DD2]/60",
      highlight: false,
      features: SOLO_FEATURES,
      cta: "Upgrade to Solo Pro",
    },
    {
      key: "pro" as const,
      name: "Team",
      price: `$${TEAM_SEASON_PRICE_USD}`,
      period: "/ season · one payment",
      sub: season
        ? `${season.label} · ${fmtDate(season.start)} – ${fmtDate(season.end)}${season.projected ? " (dates to be confirmed)" : ""}`
        : "Runs season to season with ESEA",
      color: "border-[#FFE135]/60",
      highlight: true,
      features: TEAM_FEATURES,
      cta: season ? `Buy ${season.label}` : "Buy this season",
    },
  ];

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#080E1A] px-6 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <h1 className="font-cinzel text-4xl font-bold text-white md:text-5xl">
            Choose Your Plan
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Start free. Upgrade when you need more.
          </p>
        </div>

        {/* Monthly / yearly applies to Solo Pro only; Team is per season. */}
        <div className="mb-10 flex justify-center" role="group" aria-label="Solo Pro billing interval">
          {(["month", "year"] as const).map((opt) => {
            const active = interval === opt;
            return (
              <button
                key={opt}
                type="button"
                aria-pressed={active}
                onClick={() => setInterval(opt)}
                className={`px-4 py-2 text-sm font-semibold first:rounded-l-lg last:rounded-r-lg border ${
                  active
                    ? "bg-[#2D7DD2] border-[#2D7DD2] text-white"
                    : "border-white/10 text-slate-400 hover:text-white"
                }`}
              >
                {opt === "month" ? "Monthly" : "Yearly · save 20%"}
              </button>
            );
          })}
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {plans.map((plan) => {
            const isCurrent =
              plan.key === "pro" ? ownsThisSeason : currentPlan === plan.key;
            const canBuy =
              plan.key === "basic"
                ? currentPlan === "free"
                : plan.key === "pro"
                  ? !ownsThisSeason
                  : false;

            return (
              <div
                key={plan.key}
                className={`relative rounded-2xl border p-8 transition-all ${plan.color} ${
                  plan.highlight
                    ? "bg-gradient-to-b from-[#FFE135]/5 to-transparent shadow-[0_0_40px_rgba(255,225,53,0.08)]"
                    : "bg-white/[0.02]"
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="rounded-full bg-[#FFE135] px-4 py-1 text-xs font-bold text-black">
                      FOR ROSTERS
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h2 className={`font-cinzel text-2xl font-bold ${plan.highlight ? "text-[#FFE135]" : "text-white"}`}>
                    {plan.name}
                  </h2>
                  <div className="mt-3 flex items-baseline gap-1 flex-wrap">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-slate-400 text-sm">{plan.period}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#2D7DD2]">{plan.sub}</p>
                </div>

                <ul className="mb-8 space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-slate-300">
                      <span className="text-[#2D7DD2]">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div className="w-full rounded-xl border border-white/10 py-3 text-center text-sm font-semibold text-slate-400">
                    {plan.key === "pro" && season ? `You have ${season.label}` : "Current plan"}
                  </div>
                ) : canBuy && plan.cta ? (
                  <button
                    onClick={() => handleCheckout(plan.key as "basic" | "pro")}
                    disabled={loading === plan.key}
                    className={`w-full rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-60 ${
                      plan.highlight
                        ? "bg-[#FFE135] text-black hover:bg-[#FFE135]/90"
                        : "bg-[#2D7DD2] text-white hover:bg-[#2D7DD2]/80"
                    }`}
                  >
                    {loading === plan.key ? "Redirecting…" : plan.cta}
                  </button>
                ) : plan.key === "free" ? (
                  <div className="w-full rounded-xl border border-white/5 py-3 text-center text-sm font-semibold text-slate-600">
                    {currentPlan === "free" ? "Current plan" : "Included"}
                  </div>
                ) : (
                  <div className="w-full rounded-xl border border-white/5 py-3 text-center text-sm font-semibold text-slate-600">
                    Included in your plan
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-slate-500">
          Solo Pro renews monthly or yearly and can be cancelled anytime. Team is one payment per
          ESEA season; access runs until the next season starts, so renewing is seamless.
        </p>
      </div>
    </main>
  );
}
