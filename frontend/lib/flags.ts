// Feature flags — every gated feature checked here from day one.
// When billing launches, swap free limits for plan-based limits.

export const PLAN_LIMITS = {
  free: {
    uploadsPerMonth: 2,
    maxFileSizeMB: 1024,
    historyDays: 7,
    aiCoaching: false,
    audioAnalysis: false,
    stripePriceId: null,
    displayPrice: "Free",
  },
  basic: {
    uploadsPerMonth: 10,
    maxFileSizeMB: 1024,
    historyDays: 30,
    aiCoaching: false,
    audioAnalysis: false,
    stripePriceId: "price_1TZdccK81lqFuAqaUpBtDmvt",
    displayPrice: "$5 / month",
  },
  pro: {
    uploadsPerMonth: Infinity,
    maxFileSizeMB: 2048,
    historyDays: 365,
    aiCoaching: true,
    audioAnalysis: true,
    stripePriceId: "price_1TZdcdK81lqFuAqa5aXKj8F6",
    displayPrice: "$20 / month",
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: Plan = "free") {
  return PLAN_LIMITS[plan];
}

export function isFeatureEnabled(feature: keyof (typeof PLAN_LIMITS)["pro"], plan: Plan = "free"): boolean {
  return PLAN_LIMITS[plan][feature] as boolean;
}
