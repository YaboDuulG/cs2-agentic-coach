// Feature flags — every gated feature checked here from day one.
// When billing launches, swap free limits for plan-based limits.

export const PLAN_LIMITS = {
  free: {
    uploadsPerDay: 3,
    maxFileSizeMB: 1024,   // CS2 demos are 200–800MB — 150MB was too small
    historyDays: 7,
    aiCoaching: false,
    audioAnalysis: false,
  },
  pro: {
    uploadsPerDay: Infinity,
    maxFileSizeMB: 2048,
    historyDays: 90,
    aiCoaching: true,
    audioAnalysis: true,
  },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: Plan = "free") {
  return PLAN_LIMITS[plan];
}

export function isFeatureEnabled(feature: keyof (typeof PLAN_LIMITS)["pro"], plan: Plan = "free"): boolean {
  return PLAN_LIMITS[plan][feature] as boolean;
}
