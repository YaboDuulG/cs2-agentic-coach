// Plan display table + quota limits. Capability gating is server-driven
// (services/billing); this file only carries what the UI prints and what the
// upload route enforces as a quota.
//
// Pricing (owner decision 2026-09-29):
//   Solo Pro  $10 / month, or $96 / year (20% off)      — Stripe subscription
//   Team      $300 flat per ESEA season                  — Stripe one-time payment;
//             access runs until the next season starts (services/billing/seasons.py)
//
// Stripe price ids come from env so test and live modes differ without a code
// change. No fallbacks: the ids that used to be hard-coded here belonged to a
// Stripe account this project no longer uses (verified 2026-09-29).

export const STRIPE_PRICES = {
  soloMonthly: process.env.STRIPE_PRICE_SOLO_MONTHLY ?? "",
  soloYearly: process.env.STRIPE_PRICE_SOLO_YEARLY ?? "",
  teamSeason: process.env.STRIPE_PRICE_TEAM_SEASON ?? "",
} as const;

export const PLAN_LIMITS = {
  free: {
    uploadsPerMonth: 2,
    maxFileSizeMB: 1024,
    historyDays: 7,
    aiCoaching: false,
    audioAnalysis: false,
    billing: "none" as const,
    displayPrice: "Free",
    displayPriceYearly: null,
  },
  basic: {
    uploadsPerMonth: 10,
    maxFileSizeMB: 1024,
    historyDays: 30,
    aiCoaching: true,
    audioAnalysis: false,
    billing: "subscription" as const,
    displayPrice: "$10 / month",
    displayPriceYearly: "$96 / year",
  },
  pro: {
    uploadsPerMonth: Infinity,
    maxFileSizeMB: 2048,
    historyDays: 365,
    aiCoaching: true,
    audioAnalysis: true,
    billing: "season" as const,
    displayPrice: "$300 / season",
    displayPriceYearly: null,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
export type BillingInterval = "month" | "year";

export const SOLO_PRICE_USD = { month: 10, year: 96 } as const;
export const TEAM_SEASON_PRICE_USD = 300;

export function getPlanLimits(plan: Plan = "free") {
  return PLAN_LIMITS[plan];
}

export function isFeatureEnabled(feature: keyof (typeof PLAN_LIMITS)["pro"], plan: Plan = "free"): boolean {
  return PLAN_LIMITS[plan][feature] as boolean;
}
