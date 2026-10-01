"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CoachingResponse, RoundTelemetry, StratDetail, StratStatus, StratSummary } from "@/lib/api/client";

/**
 * Every read goes through here (TanStack Query); components never hand-roll
 * fetch + useEffect. Server routes under app/api/* attach auth and the shared
 * secret. Shapes follow lib/api/contract.md.
 */

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function messageOf(body: unknown, fallback: string): string {
  const b = body as { error?: unknown; detail?: unknown } | null;
  if (b && typeof b.error === "string") return b.error;
  if (b && typeof b.detail === "string") return b.detail;
  const d = b?.detail as { message?: unknown } | undefined;
  if (d && typeof d.message === "string") return d.message;
  return fallback;
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(messageOf(body, `Request failed (${res.status})`), res.status, body);
  return body as T;
}

export async function sendJson<T>(url: string, body: unknown, method = "POST"): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(messageOf(data, `Request failed (${res.status})`), res.status, data);
  return data as T;
}

// ---------------------------------------------------------------------------
// Billing / entitlements / seasons
// ---------------------------------------------------------------------------

export type Tier = "FREE" | "SOLO_PRO" | "TEAM";
export type Entitlement = "basic_analysis" | "full_coaching" | "team_analysis" | "team_scouting" | "stratbook_sync";

export interface Entitlements {
  user_id: string;
  tier: Tier;
  entitlements: Entitlement[];
  status: string | null;
  current_period_end: string | null;
  season: number | null;
  season_until: string | null;
  source: "none" | "stripe" | "trial" | "season";
}

export function useEntitlements(enabled = true) {
  return useQuery({ queryKey: ["billing", "entitlements"], queryFn: () => getJson<Entitlements>("/api/billing/entitlements"), enabled });
}

export interface SeasonInfo {
  number: number;
  label: string;
  start: string;
  end: string;
  access_until: string;
  projected: boolean;
  price_usd: number;
}

export function useSeasons() {
  return useQuery({
    queryKey: ["billing", "seasons"],
    queryFn: () => getJson<{ purchasable: SeasonInfo; seasons: SeasonInfo[]; price_usd: number }>("/api/billing/seasons"),
    staleTime: 60 * 60 * 1000,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (args: { plan: "basic" | "pro"; interval?: "month" | "year" }) =>
      sendJson<{ url: string }>("/api/billing/checkout", { plan: args.plan, interval: args.interval ?? "month" }),
    onSuccess: (data) => {
      if (data.url) window.location.assign(data.url);
    },
  });
}

export interface Referral {
  code: string;
  uses: number;
  invitee_days: number;
  referrer_days: number;
  tier: string;
  share_url: string;
}

export function useReferral(enabled = true) {
  return useQuery({ queryKey: ["billing", "referral"], queryFn: () => getJson<Referral>("/api/billing/referral"), enabled });
}

export function useRedeem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      sendJson<{ ok: true; tier: Tier; plan: string; days: number; until: string; kind: string }>("/api/billing/redeem", { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

// ---------------------------------------------------------------------------
// Matches (analyses), jobs, coaching
// ---------------------------------------------------------------------------

export type MatchMode = "personal" | "team" | "scouting";

export interface MatchRow {
  match_id: string;
  map: string | null;
  status: string | null;
  created_at: string | null;
  is_recon: boolean;
  team_id: string | null;
  mode: MatchMode;
  /** Scouting rows only: who the dossier is about (matches.match_name). */
  opponent?: string | null;
}

const isActive = (s: string | null | undefined) => !!s && !["complete", "done", "parsed", "failed"].includes(s.toLowerCase());

export function useMatches(scope: "personal" | "team" | "all" = "all", enabled = true) {
  return useQuery({
    queryKey: ["matches", scope],
    queryFn: () => getJson<MatchRow[]>(`/api/analyses?scope=${scope}`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((m) => isActive(m.status)) ? 10_000 : false),
  });
}

export interface TeamMatchRow extends Omit<MatchRow, "team_id" | "mode"> {
  user_id: string | null;
  total_rounds: number;
  mode: "team" | "scouting";
}

export function useTeamMatches(teamId: string | null) {
  return useQuery({
    queryKey: ["teams", teamId, "matches"],
    queryFn: () => getJson<TeamMatchRow[]>(`/api/teams/${teamId}?view=analyses`),
    enabled: Boolean(teamId),
    refetchInterval: (q) => (q.state.data?.some((m) => isActive(m.status)) ? 10_000 : false),
  });
}

export type JobStage = "parse" | "coach" | "done" | "failed";

export interface JobRound {
  round: number;
  winner: "CT" | "T" | string;
  ct_spend: number;
  t_spend: number;
}

export interface JobKill {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
  killer_team: string;
  victim_team: string;
  attacker_x: number;
  attacker_y: number;
  victim_x: number;
  victim_y: number;
  attacker_steamid: string | null;
  victim_steamid: string | null;
  tick: number;
  headshot: boolean;
}

export interface JobPayload {
  status: "queued" | "processing" | "done" | "failed";
  match_id: string;
  stage?: JobStage;
  map?: string;
  created_at?: string | null;
  elapsed_seconds?: number;
  error?: string | null;
  parse_duration_seconds?: number | null;
  is_recon: boolean;
  coach_status?: "pending" | "running" | "done" | "failed";
  coach_error?: string | null;
  coach_attempts?: number;
  total_rounds?: number;
  total_kills?: number;
  total_grenades?: number;
  player_stats?: Record<string, { name: string; team: "CT" | "TERRORIST" | ""; clan: string }>;
  kills?: JobKill[];
  rounds?: JobRound[];
}

/** Light poll while the pipeline runs; full payload once parse is done. */
export function useJob(matchId: string | null) {
  return useQuery({
    queryKey: ["job", matchId],
    queryFn: async () => {
      const light = await getJson<JobPayload>(`/api/jobs/${matchId}?light=1`);
      if (light.status !== "done") return light;
      return getJson<JobPayload>(`/api/jobs/${matchId}`);
    },
    enabled: Boolean(matchId),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return 3_000;
      if (d.status === "failed") return false;
      if (d.status !== "done") return 3_000;
      return d.stage === "done" || d.stage === "failed" ? false : 5_000;
    },
  });
}

export function useCoaching(matchId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["coaching", matchId],
    queryFn: () => getJson<CoachingResponse>(`/api/coaching/${matchId}`),
    enabled: Boolean(matchId) && enabled,
    refetchInterval: (q) => (q.state.data?.status === "ready" ? false : 5_000),
  });
}

export function useRoundTelemetry(matchId: string | null, round: number) {
  return useQuery({
    queryKey: ["telemetry", matchId, round],
    queryFn: () => getJson<RoundTelemetry>(`/api/jobs/${matchId}/rounds/${round}/telemetry`),
    enabled: Boolean(matchId) && round > 0,
    staleTime: Infinity,
  });
}

export function useMatchNotes(matchId: string | null) {
  return useQuery({
    queryKey: ["notes", matchId],
    queryFn: () => getJson<{ notes: string }>(`/api/analyses/${matchId}/notes`),
    enabled: Boolean(matchId),
  });
}

export function useSaveNotes(matchId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (notes: string) => sendJson<{ status: string; notes: string }>(`/api/analyses/${matchId}/notes`, { notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notes", matchId] });
      qc.invalidateQueries({ queryKey: ["coaching", matchId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

export interface TeamListItem {
  team_id: string;
  name: string;
  invite_code: string;
  is_owner: boolean;
  member_count: number;
  created_at: string | null;
  logo_url: string | null;
}

export interface TeamDetail {
  team_id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
  created_at: string | null;
  logo_url: string | null;
  members: { user_id: string; role: "owner" | "member"; joined_at: string | null }[];
}

export function useTeams(enabled = true) {
  return useQuery({ queryKey: ["teams"], queryFn: () => getJson<TeamListItem[]>("/api/teams"), enabled });
}

export function useTeam(teamId: string | null) {
  return useQuery({ queryKey: ["teams", teamId], queryFn: () => getJson<TeamDetail>(`/api/teams/${teamId}`), enabled: Boolean(teamId) });
}

export function useCreateTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => sendJson<{ team_id: string; name: string; invite_code: string }>("/api/teams", { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useJoinTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (invite_code: string) => sendJson<{ team_id: string; name: string; status: string }>("/api/teams/join", { invite_code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useUpdateTeam(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: { name?: string; logo_url?: string }) => sendJson<{ status: string }>(`/api/teams/${teamId}`, patch, "PATCH"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useDeleteTeam(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new HttpError(messageOf(data, "Could not delete the team."), res.status, data);
      return data as { status: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

/** Leave (memberId = own id) or, as captain, remove a member. */
export function useRemoveMember(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (memberId: string) => {
      const res = await fetch(`/api/teams/${teamId}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new HttpError(messageOf(data, "Could not update the roster."), res.status, data);
      return data as { status: "left" | "removed"; user_id: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

export function useUploadTeamLogo(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/teams/${teamId}/logo`, { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new HttpError(messageOf(data, "Could not upload the logo."), res.status, data);
      return data as { logo_url: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams"] }),
  });
}

// ---------------------------------------------------------------------------
// Servers & training
// ---------------------------------------------------------------------------

export interface Server {
  id: string;
  status: string;
  ip_address: string | null;
  rcon_password: string;
  server_password: string;
  mode: string;
  expires_at: string;
}

export interface ServerModes {
  modes: { key: string; description: string; game_mode: string }[];
  update_window_active: boolean;
  update_detail?: string;
}

export function useServerModes() {
  return useQuery({ queryKey: ["server-modes"], queryFn: () => getJson<ServerModes>("/api/servers/modes"), staleTime: 60_000 });
}

export function useTeamServers(teamId: string | null) {
  return useQuery({
    queryKey: ["teams", teamId, "servers"],
    queryFn: () => getJson<Server[]>(`/api/teams/${teamId}/servers`),
    enabled: Boolean(teamId),
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === "booting") ? 5_000 : 30_000),
  });
}

export function useCreateServer(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { mode: string; region: "eu" | "na"; map?: string }) => sendJson<Server>(`/api/teams/${teamId}/servers`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams", teamId, "servers"] }),
  });
}

export function useServerConsole(serverId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["servers", serverId, "console"],
    queryFn: () => getJson<{ lines: string[] }>(`/api/servers/${serverId}/console?lines=80`),
    enabled: Boolean(serverId) && enabled,
    refetchInterval: 10_000,
    retry: false,
  });
}

export function useSendConsole(serverId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (command: string) => sendJson<{ ok: boolean; lines: string[] }>(`/api/servers/${serverId}/console`, { command }),
    onSuccess: (data) => qc.setQueryData(["servers", serverId, "console"], { lines: data.lines }),
  });
}

export function useTerminateServer(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (serverId: string) => {
      const res = await fetch(`/api/servers/${serverId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new HttpError(messageOf(data, "Could not stop the server."), res.status, data);
      return data as { status: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams", teamId, "servers"] }),
  });
}

export interface TrainingSession {
  id: string;
  team_id: string;
  user_id: string;
  server_id: string | null;
  mode: string;
  map_name: string;
  region: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  job_id: string | null;
}

export interface TrainingStats {
  sessions: TrainingSession[];
  total_sessions: number;
  total_seconds: number;
  favourite_mode: string | null;
  sessions_this_week: number;
}

export function useTrainingSessions(teamId: string | null) {
  return useQuery({
    queryKey: ["teams", teamId, "training"],
    queryFn: () => getJson<TrainingStats>(`/api/teams/${teamId}/training-sessions`),
    enabled: Boolean(teamId),
  });
}

export function useCreateTrainingSession(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { server_id?: string | null; mode: string; map_name: string; region: string }) =>
      sendJson<TrainingSession>(`/api/teams/${teamId}/training-sessions`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams", teamId, "training"] }),
  });
}

// ---------------------------------------------------------------------------
// Strats & stratbook
// ---------------------------------------------------------------------------

export function useStrats(teamId: string | null) {
  return useQuery({
    queryKey: ["strats", teamId],
    queryFn: () => getJson<StratSummary[]>(`/api/teams/${teamId}/strats`),
    enabled: Boolean(teamId),
    refetchInterval: 15_000,
  });
}

export function useStratDetail(stratId: string | null) {
  return useQuery({ queryKey: ["strat", stratId], queryFn: () => getJson<StratDetail>(`/api/strats/${stratId}`), enabled: Boolean(stratId) });
}

export function useStratTransition(teamId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ stratId, status }: { stratId: string; status: StratStatus }) =>
      sendJson<StratSummary>(`/api/strats/${stratId}/transition`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["strats", teamId] }),
  });
}

export function useStratBindCode() {
  return useMutation({ mutationFn: (stratId: string) => sendJson<{ team_id: string; code: string }>(`/api/strats/${stratId}/bind-code`, {}) });
}

export interface TeamStrategy {
  id: number;
  content: string;
  created_at: string | null;
  title: string;
  map_name: string;
  side: string;
  author: string;
  summary: string;
  steps: string[];
  raw_content: string;
}

export function useTeamStrategies(teamId: string | null) {
  return useQuery({
    queryKey: ["teams", teamId, "strategies"],
    queryFn: () => getJson<TeamStrategy[]>(`/api/teams/${teamId}/strategies`),
    enabled: Boolean(teamId),
  });
}

export function useAddTeamStrategy(teamId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; map_name: string; side: string; summary: string; steps: string[]; author?: string }) =>
      sendJson<TeamStrategy>(`/api/teams/${teamId}/strategies`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["teams", teamId, "strategies"] }),
  });
}

export function useTeamChat(teamId: string) {
  return useMutation({
    mutationFn: (body: { message: string; history?: { role: string; content: string }[]; map_name?: string | null }) =>
      sendJson<{ response: string }>(`/api/teams/${teamId}/strategies/chat`, body),
  });
}

export interface UserStrategy {
  id: number;
  map_name: string;
  title: string;
  strategy_json: string;
  created_at: string;
}

export function useUserStrategies(enabled = true) {
  return useQuery({
    queryKey: ["stratbook", "user"],
    queryFn: () => getJson<{ strategies: UserStrategy[] }>("/api/stratbook/user"),
    enabled,
  });
}

export function useSaveUserStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { map_name: string; title: string; strategy_json: string }) => sendJson<{ status: string; id: number }>("/api/stratbook/user", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stratbook", "user"] }),
  });
}

export function useCritique() {
  return useMutation({
    mutationFn: (body: { map_name: string; strategy_json: string }) => sendJson<{ critique: string }>("/api/stratbook/critique", body),
  });
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

export interface SteamProfile {
  steamid: string;
  personaname: string;
  avatarfull: string;
  avatarmedium: string;
  profileurl: string;
  playtime_forever: number;
  playtime_private: boolean;
}

export function useSteamProfile(steamId: string | null | undefined) {
  return useQuery({
    queryKey: ["steam", "profile", steamId],
    queryFn: () => getJson<SteamProfile>(`/api/steam/profile?steamid=${encodeURIComponent(steamId!)}`),
    enabled: Boolean(steamId),
    staleTime: 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export function useAdminConfigs() {
  return useQuery({ queryKey: ["admin", "configs"], queryFn: () => getJson<Record<string, string>>("/api/admin/configs"), retry: false });
}

export function useSaveAdminConfigs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (configs: Record<string, string>) => sendJson<{ status: string }>("/api/admin/configs", { configs }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "configs"] }),
  });
}

export interface PromoCode {
  code: string;
  kind: string;
  tier: string;
  days: number;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  active: boolean;
  note: string | null;
  created_at: string | null;
}

export function usePromoCodes() {
  return useQuery({ queryKey: ["admin", "promo-codes"], queryFn: () => getJson<{ codes: PromoCode[] }>("/api/admin/promo-codes"), retry: false });
}

export function useMintPromoCodes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { count: number; tier: "SOLO_PRO" | "TEAM"; days: number; max_uses: number | null; valid_days: number; note?: string | null }) =>
      sendJson<{ codes: PromoCode[] }>("/api/admin/promo-codes", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "promo-codes"] }),
  });
}

export interface TeamMeteringRow {
  team_id: string;
  name: string;
  owner_user_id: string;
  members: number;
  season: number | null;
  season_until: string | null;
  season_active: boolean;
  matches: number;
  llm_calls: number;
  input_tokens: number;
  output_tokens: number;
  llm_cost_usd: number;
  server_sessions: number;
  server_hours: number;
  server_cost_usd: number;
  revenue_usd: number;
  total_cost_usd: number;
  margin_usd: number;
}

export interface TeamMetering {
  window: string;
  since: string | null;
  server_hourly_cost_usd: number;
  teams: TeamMeteringRow[];
  unattributed_llm: { calls: number; cost_usd: number };
  totals: { llm_cost_usd: number; server_cost_usd: number; revenue_usd: number; margin_usd: number };
}

export function useTeamMetering(window: "season" | "30d" | "90d" | "all") {
  return useQuery({
    queryKey: ["admin", "team-metering", window],
    queryFn: () => getJson<TeamMetering>(`/api/admin/team-metering?window=${window}`),
    refetchInterval: 60_000,
    retry: false,
  });
}

export interface DatHostAccount {
  available: boolean;
  reason?: string;
  credits?: number | null;
  currency?: string | null;
  servers_on?: number | null;
}

export function useDatHostAccount() {
  return useQuery({ queryKey: ["admin", "dathost"], queryFn: () => getJson<DatHostAccount>("/api/admin/dathost-account"), refetchInterval: 5 * 60_000, retry: false });
}
