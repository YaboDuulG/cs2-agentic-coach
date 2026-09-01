// Type-safe API client — every call goes through the Next.js server routes
// (which attach auth + the shared secret); nothing here talks to the
// FastAPI backend directly.

export interface RoundTelemetryPoint {
  tick: number;
  x: number;
  y: number;
  z: number;
}

export interface RoundTelemetry {
  match_id: string;
  round: number;
  map: string;
  tickrate: number;
  players: { player: string; team: string; points: RoundTelemetryPoint[] }[];
  kills: {
    attacker: string;
    victim: string;
    weapon: string;
    tick: number;
    headshot: boolean;
    attacker_x: number;
    attacker_y: number;
    victim_x: number;
    victim_y: number;
    attacker_steamid: string | null;
    victim_steamid: string | null;
  }[];
  grenades: { thrower: string; type: string; tick: number; x: number; y: number }[];
}

export interface KeyFinding {
  round: number | null;
  rounds: number[];
  tick: number | null;
  category: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  observation: string;
  evidence_ids: string[];
  grounded_pro_benchmark: string;
  actionable_drill: string;
  audience: string;
}

export interface PaywalledPreview {
  hidden_insights_count: number;
  upgrade_cta: string;
  locked?: boolean;
  tier_needed?: string;
}

export interface ReportV2 {
  mode: "PERSONAL_IMPROVEMENT" | "TEAM_ANALYSIS" | "OPPOSITION_RESEARCH";
  summary: { score?: number; grade: string; headline?: string };
  key_findings: Partial<KeyFinding>[];
  finding_categories?: Record<string, number>;
  paywalled_preview: PaywalledPreview | null;
}

export interface CoachingResponse {
  status: "ready" | "pending" | "locked";
  match_id: string;
  tier?: string;
  coaching?: {
    report_v2?: ReportV2 | null;
    individual_report?: string;
    team_report?: string;
    player_reports?: Record<string, string>;
    coach_report?: string;
    summary?: string;
    paywalled_preview?: PaywalledPreview;
  };
}

export type StratStatus = "DRAFT" | "IN_REVIEW" | "ACTIVE" | "ARCHIVED";

// Stratbook canvas schema (canvas_json) — mirrors services/stratbook/service.py.
export interface CanvasUtility {
  type: string; // smoke | flash | molotov | he
  from: { x: number; y: number };
  to: { x: number; y: number };
  callout: string;
}

export interface CanvasStep {
  t: number;
  label: string;
  positions: Record<string, { x: number; y: number }>;
  utility: CanvasUtility[];
}

export interface StratCanvasJson {
  steps?: CanvasStep[];
  callouts?: { name: string; x: number; y: number }[];
}

export interface StratSummary {
  id: string;
  team_id: string;
  title: string;
  map_name: string;
  side: string;
  buy_type: string;
  status: StratStatus;
  discord_thread_id: string | null;
  updated_at: string;
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return res.json() as Promise<T>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new ApiError(res.status, await res.text());
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    body: string,
  ) {
    super(`API ${status}: ${body.slice(0, 200)}`);
  }
}

export const api = {
  roundTelemetry: (matchId: string, round: number) =>
    get<RoundTelemetry>(`/api/jobs/${matchId}/rounds/${round}/telemetry`),
  coaching: (matchId: string) => get<CoachingResponse>(`/api/coaching/${matchId}`),
  strats: (teamId: string) => get<StratSummary[]>(`/api/teams/${teamId}/strats`),
  stratTransition: (stratId: string, status: StratStatus) =>
    post<StratSummary>(`/api/strats/${stratId}/transition`, { status }),
  stratBindCode: (stratId: string) =>
    post<{ code: string }>(`/api/strats/${stratId}/bind-code`, {}),
  checkout: (plan: string) => post<{ url: string }>(`/api/billing/checkout`, { plan }),
};
