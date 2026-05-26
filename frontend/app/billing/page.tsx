/* eslint-disable react-hooks/immutability */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useUser } from "@clerk/nextjs";
import { useState } from "react";
import { PLAN_LIMITS } from "@/lib/flags";

const PLANS = [
  {
    key: "free" as const,
    name: "Free",
    price: "$0",
    period: "forever",
    demos: "2 demos",
    color: "border-white/10",
    highlight: false,
    features: ["2 demo uploads total", "Kill feed + economy view", "7-day history"],
  },
  {
    key: "basic" as const,
    name: "Basic",
    price: "$5",
    period: "/ month",
    demos: "10 demos/mo",
    color: "border-[#2D7DD2]/60",
    highlight: false,
    features: ["10 demo uploads / month", "Kill feed + economy view", "30-day history"],
  },
  {
    key: "pro" as const,
    name: "Pro",
    price: "$20",
    period: "/ month",
    demos: "Unlimited",
    color: "border-[#FFE135]/60",
    highlight: true,
    features: [
      "Unlimited demo uploads",
      "AI tactical coaching",
      "Audio comms analysis",
      "365-day history",
      "Priority processing",
    ],
  },
];

export default function BillingPage() {
  const { user } = useUser();
  const currentPlan = (user?.publicMetadata?.plan as string) ?? "free";
  const [loading, setLoading] = useState<string | null>(null);

  const handleUpgrade = async (planKey: string) => {
    if (planKey === "free") return;
    setLoading(planKey);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      alert("Something went wrong. Please try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#080E1A] px-6 py-20">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <h1 className="font-cinzel text-4xl font-bold text-white md:text-5xl">
            Choose Your Plan
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Start free. Upgrade when you need more.
          </p>
        </div>

        {/* Plans grid */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.key;
            const isHigher =
              (plan.key === "basic" && currentPlan === "free") ||
              (plan.key === "pro" && currentPlan !== "pro");

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
                      MOST POPULAR
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h2 className={`font-cinzel text-2xl font-bold ${plan.highlight ? "text-[#FFE135]" : "text-white"}`}>
                    {plan.name}
                  </h2>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-bold text-white">{plan.price}</span>
                    <span className="text-slate-400">{plan.period}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#2D7DD2]">{plan.demos}</p>
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
                    Current Plan
                  </div>
                ) : isHigher ? (
                  <button
                    onClick={() => handleUpgrade(plan.key)}
                    disabled={loading === plan.key}
                    className={`w-full rounded-xl py-3 text-sm font-bold transition-all disabled:opacity-60 ${
                      plan.highlight
                        ? "bg-[#FFE135] text-black hover:bg-[#FFE135]/90"
                        : "bg-[#2D7DD2] text-white hover:bg-[#2D7DD2]/80"
                    }`}
                  >
                    {loading === plan.key ? "Redirecting…" : `Upgrade to ${plan.name}`}
                  </button>
                ) : (
                  <div className="w-full rounded-xl border border-white/5 py-3 text-center text-sm font-semibold text-slate-600">
                    Downgrade
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-10 text-center text-sm text-slate-500">
          All plans are month-to-month. Cancel anytime. Test card: 4242 4242 4242 4242.
        </p>
      </div>
    </main>
  );
}
