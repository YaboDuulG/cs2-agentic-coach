/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import {
  User, Shield, Zap, ChevronRight, Users, MapPin,
  Crosshair, Clock, BarChart3, ArrowRight
} from "lucide-react";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { PageSection, PageTransition } from "@/components/ui";
import { PLAN_LIMITS } from "@/lib/flags";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { UploadModal } from "@/components/UploadModal";
interface Analysis {
  match_id: string;
  map: string;
  status: string;
  created_at: string;
  total_rounds: number;
  total_kills: number;
  source?: string;
  is_recon?: boolean;
}

function getSourceBadge(source?: string) {
  if (!source) return null;
  const s = source.toLowerCase();
  if (s.includes("faceit")) return <span className="bg-[#FF5500]/10 text-[#FF5500] px-2 py-0.5 rounded-full text-[10px] font-bold border border-[#FF5500]/30 ml-2 whitespace-nowrap">⚡ FACEIT</span>;
  if (s.includes("steam") || s.includes("mm") || s.includes("matchmaking")) return <span className="bg-[#00adee]/10 text-[#00adee] px-2 py-0.5 rounded-full text-[10px] font-bold border border-[#00adee]/30 ml-2 whitespace-nowrap">⚡ Steam MM</span>;
  return <span className="bg-slate-700/30 text-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold border border-slate-600/50 ml-2 whitespace-nowrap">📤 {source}</span>;
}

interface Team {
  team_id: string;
  name: string;
  invite_code: string;
  member_count: number;
}

/** Subset of the Steam Web API player summary this page renders. */
interface SteamProfile {
  avatarfull?: string;
  personaname?: string;
  profileurl?: string;
  playtime_private?: boolean;
  playtime_forever?: number;
}

const STATUS_COLORS: Record<string, string> = {
  done: "var(--color-success)",
  processing: "var(--color-accent-primary)",
  queued: "var(--color-text-secondary)",
  failed: "var(--color-danger)",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "Just now";
}

/** Returns "VANITY" if the input is a Steam vanity URL (cannot be resolved client-side). */
function isSteamVanityUrl(input: string): boolean {
  return /steamcommunity\.com\/id\//i.test(input.trim());
}

function normalizeSteamId(input: string): string {
  // Strip trailing slashes/spaces
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  // 1. Check if it's already a 64-bit SteamID (17 digits starting with 7656)
  if (/^7656\d{13}$/.test(trimmed)) {
    return trimmed;
  }

  // 2. Check if it's a Steam Community profile URL with 64-bit ID
  //    Handles: https://steamcommunity.com/profiles/76561198012345678[/]
  const profileMatch = trimmed.match(/steamcommunity\.com\/profiles\/(7656\d{13})/i);
  if (profileMatch) {
    return profileMatch[1];
  }

  // 3. Steam ID 3: [U:1:ACCOUNT_ID] or U:1:ACCOUNT_ID
  const id3Match = trimmed.match(/\[?U:1:(\d+)\]?/i);
  if (id3Match) {
    try {
      const accountId = BigInt(id3Match[1]);
      return (accountId + BigInt("76561197960265728")).toString();
    } catch {
      return trimmed;
    }
  }

  // 4. Steam ID 2: STEAM_X:Y:Z
  const id2Match = trimmed.match(/^STEAM_\d+:([01]):(\d+)$/i);
  if (id2Match) {
    try {
      const y = BigInt(id2Match[1]);
      const z = BigInt(id2Match[2]);
      return (z * BigInt(2) + y + BigInt("76561197960265728")).toString();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

export default function ProfilePage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Steam ID settings states
  const [steamInput, setSteamInput] = useState("");
  const [steamEdit, setSteamEdit] = useState(false);
  const [steamSaving, setSteamSaving] = useState(false);
  const [steamError, setSteamError] = useState("");

  const currentSteamId = (user?.unsafeMetadata?.steam_id as string) ?? "";

  async function saveSteamId() {
    if (!user) return;
    setSteamSaving(true);
    setSteamError("");

    let finalId = "";

    // Auto-resolve Steam vanity URLs (steamcommunity.com/id/username) via server API
    if (steamInput.trim() && isSteamVanityUrl(steamInput)) {
      try {
        const res = await fetch(`/api/steam/resolve?url=${encodeURIComponent(steamInput.trim())}`);
        const data = await res.json();
        if (!res.ok || !data.steamid) {
          setSteamError(data.error ?? "Could not resolve this Steam vanity URL. Try using your numeric profile URL: steamcommunity.com/profiles/76561198XXXXXXXXX");
          setSteamSaving(false);
          return;
        }
        finalId = data.steamid;
      } catch {
        setSteamError("Network error resolving vanity URL. Try again or use your numeric profile URL.");
        setSteamSaving(false);
        return;
      }
    } else {
      finalId = normalizeSteamId(steamInput);
      if (steamInput.trim() && !/^7656\d{13}$/.test(finalId)) {
        setSteamError(
          "Invalid Steam ID format. Accepted formats: SteamID64 (76561198...), " +
          "steamcommunity.com/profiles/76561198..., steamcommunity.com/id/username, [U:1:XXXXXXXX], or STEAM_0:X:XXXXXXXX"
        );
        setSteamSaving(false);
        return;
      }
    }

    try {
      await user.update({
        unsafeMetadata: {
          ...user.unsafeMetadata,
          steam_id: finalId,
        },
      });
      setSteamEdit(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to update profile.";
      setSteamError(errorMsg);
    }
    setSteamSaving(false);
  }

  const plan = (user?.publicMetadata?.plan as string) ?? "free";
  const uploads = (user?.publicMetadata?.uploadsThisMonth as number) ?? 0;
  const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  const maxUploads = limits.uploadsPerMonth === Infinity ? null : limits.uploadsPerMonth;

  const [steamProfile, setSteamProfile] = useState<SteamProfile | null>(null);
  const [steamProfileLoading, setSteamProfileLoading] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { router.push("/sign-in"); return; }

    // `loading` initialises to true, so no need to set it here on mount.
    const promises: Promise<unknown>[] = [
      fetch("/api/analyses").then(r => r.json()).catch(() => []),
      fetch("/api/teams").then(r => r.json()).catch(() => []),
    ];

    if (currentSteamId) {
      // TODO(frontend-refactor): this effect kicks off fetches and flips loading
      // flags synchronously. Move to a proper data-fetching hook (SWR/React Query)
      // so the loading state is derived rather than set from inside the effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSteamProfileLoading(true);
      promises.push(
        fetch(`/api/steam/profile?steamid=${currentSteamId}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            setSteamProfile(data);
            setSteamProfileLoading(false);
            return data;
          })
          .catch(() => {
            setSteamProfileLoading(false);
            return null;
          })
      );
    } else {
      setSteamProfile(null);
    }

    Promise.all(promises).then(([a, t]) => {
      setAnalyses(Array.isArray(a) ? a : []);
      setTeams(Array.isArray(t) ? t : []);
      setLoading(false);
    });
  }, [user, isLoaded, router, currentSteamId]);

  if (!isLoaded || !user) return null;

  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : "Free";
  const planColor = plan === "pro" ? "var(--color-accent-secondary)" : plan === "basic" ? "var(--color-accent-primary)" : "#4A6A8A";
  const planBg = plan === "pro" ? "rgba(201,162,39,0.1)" : plan === "basic" ? "rgba(45,125,210,0.1)" : "rgba(74,106,138,0.08)";
  const planBorder = plan === "pro" ? "rgba(201,162,39,0.25)" : plan === "basic" ? "rgba(45,125,210,0.25)" : "var(--color-border-primary)";

  return (
    <div className="min-h-screen px-6 py-20" style={{ background: "var(--color-bg-primary)" }}>
      <CloudMotifBg />
      <PageTransition className="relative max-w-5xl mx-auto">

        {/* ── Profile Header ── */}
        <PageSection className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-10">
          {/* Avatar */}
          <div className="relative">
            {steamProfile?.avatarfull ? (
              <img src={steamProfile.avatarfull} alt="avatar" className="w-20 h-20 rounded-2xl object-cover"
                style={{ border: "2px solid var(--color-accent-secondary)" }} />
            ) : user.imageUrl ? (
              <img src={user.imageUrl} alt="avatar" className="w-20 h-20 rounded-2xl object-cover"
                style={{ border: "2px solid var(--color-border-primary)" }} />
            ) : (
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(45,125,210,0.1)", border: "2px solid var(--color-border-primary)" }}>
                <User size={32} color="var(--color-accent-primary)" />
              </div>
            )}
            {steamProfile && (
              <div className="absolute -bottom-1 -right-1 bg-slate-950 p-1.5 rounded-lg border border-[var(--color-accent-secondary)]">
                <svg className="w-3.5 h-3.5 text-[var(--color-accent-secondary)]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .007c-.43 0-.85.04-1.28.11L5.94 4.88a10.983 10.983 0 00-4.66 9.61c0 5.48 4.02 10.02 9.33 10.84l4.57-2.64c.24.1.51.15.79.15.82 0 1.54-.5 1.87-1.22l5.03-2.9c1.97-2.12 3.13-4.94 3.13-8.02A11.026 11.026 0 0012 .007zM7.22 13.99c.35 0 .69.06 1.01.17l.01-.01.55-.32a3.868 3.868 0 013.78.14c.73.42 1.25 1.1 1.48 1.88l1.45-.84c-.03-.23-.05-.46-.05-.7 0-2.22 1.8-4.02 4.02-4.02a4.02 4.02 0 012.39.79l.01-.01 2.05-1.18c-.46-3.83-3.79-6.79-7.87-6.79a7.994 7.994 0 00-7.99 7.99c0 .32.03.63.08.94zm11.23-1.89c1.23 0 2.22.99 2.22 2.22 0 1.23-.99 2.22-2.22 2.22-1.23 0-2.22-.99-2.22-2.22 0-1.23.99-2.22 2.22-2.22zm-7.79 3.65c.34.2.57.56.57.97 0 .61-.5 1.11-1.11 1.11-.42 0-.78-.23-.97-.57l-.36.21c-.01.27-.12.53-.33.74-.35.35-.92.35-1.27 0-.35-.35-.35-.92 0-1.27.21-.21.47-.32.74-.33l.21-.36a1.114 1.114 0 012.08-.29l.44-.21z"/>
                </svg>
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="flex-1">
            <h1 className="heading-display" style={{ fontSize: "1.6rem" }}>
              {user.fullName ?? user.username ?? "Player"}
            </h1>
            <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginTop: 2 }}>
              {user.primaryEmailAddress?.emailAddress}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <span className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: planBg, color: planColor, border: `1px solid ${planBorder}` }}>
                {planLabel} Plan
              </span>
              {plan !== "pro" && (
                <Link href="/billing" className="flex items-center gap-1 text-xs font-semibold transition-all hover:text-white"
                  style={{ color: "var(--color-accent-primary)" }}>
                  Upgrade <ArrowRight size={11} />
                </Link>
              )}
            </div>
          </div>

          {/* Usage meter */}
          <div className="rounded-2xl p-5 min-w-[220px]"
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: "var(--color-text-secondary)", fontSize: "0.75rem", fontWeight: 500 }}>Monthly Analyses</span>
              <span style={{ color: "var(--color-text-primary)", fontFamily: "JetBrains Mono", fontSize: "0.875rem", fontWeight: 700 }}>
                {uploads}{maxUploads ? `/${maxUploads}` : " / ∞"}
              </span>
            </div>
            {maxUploads && (
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "#0D1825" }}>
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min((uploads / maxUploads) * 100, 100)}%`,
                    background: uploads >= maxUploads ? "var(--color-danger)" : "linear-gradient(90deg, #1B4F8A, var(--color-accent-primary))",
                  }}
                />
              </div>
            )}
            <p style={{ color: "#4A6A8A", fontSize: "0.68rem", marginTop: 6 }}>
              Resets on the 1st of each month
            </p>
          </div>
        </PageSection>

        <PageSection>
          <UlziiBorder className="mb-10" />
        </PageSection>

        {/* ── Steam CS2 Player Dossier Card ── */}
        <PageSection>
        {steamProfileLoading ? (
          <div className="card p-6 mb-8 flex items-center justify-center gap-3"
            style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
            <div className="w-5 h-5 rounded-full border-2 border-[var(--color-accent-secondary)] border-t-transparent animate-spin" />
            <span className="text-xs text-slate-400 font-mono">Loading Steam Profile Dossier...</span>
          </div>
        ) : steamProfile ? (
          <div className="card p-6 mb-8 relative overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(13,24,37,0.85) 0%, rgba(8,14,26,0.95) 100%)",
              border: "1px solid rgba(201, 162, 39, 0.2)",
              boxShadow: "0 16px 36px rgba(0,0,0,0.5), 0 0 30px rgba(201, 162, 39, 0.05)"
            }}>
            {/* Top gold/blue accent bar */}
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[var(--color-accent-secondary)] to-transparent" />
            
            <div className="flex flex-col lg:flex-row gap-8 items-center">
              {/* Profile details & avatar */}
              <div className="flex items-center gap-5 w-full lg:w-1/3 border-b lg:border-b-0 lg:border-r border-slate-800/60 pb-6 lg:pb-0 lg:pr-8">
                <img
                  src={steamProfile.avatarfull}
                  alt="Steam avatar"
                  className="w-16 h-16 rounded-xl border border-[var(--color-accent-secondary)]/40 shadow-lg object-cover"
                />
                <div className="text-left min-w-0 flex-1">
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Steam Persona</p>
                  <h3 className="font-bold text-[var(--color-text-primary)] text-base truncate">{steamProfile.personaname}</h3>
                  <a
                    href={steamProfile.profileurl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[10px] text-[var(--color-accent-primary)] hover:text-[#5BA3E8] transition-colors mt-1 font-mono"
                  >
                    View Steam Profile ↗
                  </a>
                </div>
              </div>

              {/* Stats column: Playtime & Analyses */}
              <div className="grid grid-cols-2 gap-6 w-full lg:w-1/3 border-b lg:border-b-0 lg:border-r border-slate-800/60 pb-6 lg:pb-0 lg:pr-8">
                <div className="text-left">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Clock size={12} className="text-[var(--color-accent-primary)]" />
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">CS2 Playtime</span>
                  </div>
                  {steamProfile.playtime_private ? (
                    <div>
                      <p className="text-sm font-bold text-slate-400 font-mono flex items-center gap-1">
                        <span>🔒</span> Private
                      </p>
                      <p className="text-[9px] text-slate-500 leading-normal">Set Steam Game details to public to sync hours.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xl font-extrabold text-[var(--color-text-primary)] font-mono">
                        {Math.round((steamProfile.playtime_forever ?? 0) / 60).toLocaleString()} <span className="text-[11px] text-slate-500 font-normal">hrs</span>
                      </p>
                      <p className="text-[9px] text-[#22D3A0] font-semibold font-mono">Synced via Steam</p>
                    </div>
                  )}
                </div>

                <div className="text-left">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Crosshair size={12} className="text-[var(--color-accent-primary)]" />
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Last Match</span>
                  </div>
                  {analyses.length > 0 ? (
                    <div>
                      <p className="text-sm font-bold text-[var(--color-text-primary)] truncate">{analyses[0].map || "Unknown Map"}</p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{timeAgo(analyses[0].created_at)}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-bold text-slate-500">—</p>
                      <p className="text-[9px] text-slate-500">No matches analyzed</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Career assessment & rank badge */}
              <div className="flex items-center gap-6 w-full lg:w-1/3">
                {/* Custom Rank badge */}
                <div className="relative w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "rgba(201, 162, 39, 0.05)",
                    border: "1px solid rgba(201, 162, 39, 0.2)",
                    boxShadow: "inset 0 0 12px rgba(201, 162, 39, 0.1)"
                  }}>
                  <div className="text-center">
                    <p className="text-[8px] text-[var(--color-accent-secondary)] font-bold uppercase tracking-wider font-mono">Tier</p>
                    <p className="text-2xl font-extrabold text-[var(--color-accent-secondary)] leading-none" style={{ fontFamily: "Cinzel, serif" }}>
                      {analyses.length > 10 ? "S" : analyses.length > 5 ? "A" : analyses.length > 0 ? "B" : "N/A"}
                    </p>
                  </div>
                  {/* Subtle outer pulse effect */}
                  <div className="absolute inset-0 rounded-xl border border-[var(--color-accent-secondary)]/10 animate-ping pointer-events-none" style={{ animationDuration: '4s' }} />
                </div>

                <div className="text-left flex-1 min-w-0">
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Scout Assessment</p>
                  <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wide">
                    {analyses.length > 10 ? "Elite Legionnaire" : analyses.length > 5 ? "Experienced Scout" : analyses.length > 0 ? "Tactical Recruit" : "Awaiting Evaluation"}
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                    {analyses.length > 0 
                      ? `Based on ${analyses.length} match analyses, your tactical rotation indexes are synchronized with team strategies.`
                      : "Upload CS2 demos to allow the Great Khan AI to build your career tactical dossier."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        </PageSection>

        <PageSection className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* ── Teams panel ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="heading-display" style={{ fontSize: "0.95rem" }}>
                <Users size={14} className="inline mr-2" />Teams
              </h2>
              <Link href="/teams" className="text-xs font-semibold transition-colors hover:text-white" style={{ color: "var(--color-accent-primary)" }}>
                Manage <ChevronRight size={11} className="inline" />
              </Link>
            </div>
            {teams.length === 0 ? (
              <div className="rounded-2xl p-5 text-center"
                style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
                <Users size={24} color="var(--color-border-primary)" className="mx-auto mb-2" />
                <p style={{ color: "#4A6A8A", fontSize: "0.8rem" }}>No teams yet</p>
                <Link href="/teams" className="text-xs font-semibold mt-2 inline-block" style={{ color: "var(--color-accent-primary)" }}>
                  Create one →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {teams.slice(0, 5).map(t => (
                  <Link key={t.team_id} href={`/teams/${t.team_id}`}
                    className="rounded-xl p-3.5 flex items-center gap-3 group hover:border-[var(--color-accent-primary)]/30 transition-colors"
                    style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)", display: "flex" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(45,125,210,0.1)" }}>
                      <Users size={14} color="var(--color-accent-primary)" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ color: "var(--color-text-primary)", fontSize: "0.85rem", fontWeight: 500 }} className="truncate">{t.name}</p>
                      <p style={{ color: "#4A6A8A", fontSize: "0.7rem" }}>{t.member_count} member{t.member_count !== 1 ? "s" : ""}</p>
                    </div>
                    <ChevronRight size={14} color="#4A6A8A" />
                  </Link>
                ))}
              </div>
            )}

            {/* Quick stats */}
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} color="var(--color-accent-primary)" />
                  <span style={{ color: "var(--color-text-secondary)", fontSize: "0.8rem" }}>Total Analyses</span>
                </div>
                <span style={{ color: "var(--color-text-primary)", fontFamily: "JetBrains Mono", fontWeight: 700 }}>{analyses.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
                <div className="flex items-center gap-2">
                  <Shield size={14} color={planColor} />
                  <span style={{ color: "var(--color-text-secondary)", fontSize: "0.8rem" }}>Current Plan</span>
                </div>
                <span style={{ color: planColor, fontWeight: 600, fontSize: "0.85rem" }}>{planLabel}</span>
              </div>
            </div>

            {/* Steam Link Card */}
            <div className="card p-5 mt-6" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-[var(--color-accent-primary)]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 .007c-.43 0-.85.04-1.28.11L5.94 4.88a10.983 10.983 0 00-4.66 9.61c0 5.48 4.02 10.02 9.33 10.84l4.57-2.64c.24.1.51.15.79.15.82 0 1.54-.5 1.87-1.22l5.03-2.9c1.97-2.12 3.13-4.94 3.13-8.02A11.026 11.026 0 0012 .007zM7.22 13.99c.35 0 .69.06 1.01.17l.01-.01.55-.32a3.868 3.868 0 013.78.14c.73.42 1.25 1.1 1.48 1.88l1.45-.84c-.03-.23-.05-.46-.05-.7 0-2.22 1.8-4.02 4.02-4.02a4.02 4.02 0 012.39.79l.01-.01 2.05-1.18c-.46-3.83-3.79-6.79-7.87-6.79a7.994 7.994 0 00-7.99 7.99c0 .32.03.63.08.94zm11.23-1.89c1.23 0 2.22.99 2.22 2.22 0 1.23-.99 2.22-2.22 2.22-1.23 0-2.22-.99-2.22-2.22 0-1.23.99-2.22 2.22-2.22zm-7.79 3.65c.34.2.57.56.57.97 0 .61-.5 1.11-1.11 1.11-.42 0-.78-.23-.97-.57l-.36.21c-.01.27-.12.53-.33.74-.35.35-.92.35-1.27 0-.35-.35-.35-.92 0-1.27.21-.21.47-.32.74-.33l.21-.36a1.114 1.114 0 012.08-.29l.44-.21z"/>
                </svg>
                <h3 className="font-semibold text-white" style={{ fontSize: "0.85rem" }}>Steam Profile Link</h3>
              </div>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Provide your Steam ID to personalize your AI reports and isolate coaching specifically to your team.
              </p>
              
              {steamEdit ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={steamInput}
                    onChange={(e) => setSteamInput(e.target.value)}
                    placeholder="SteamID64, profile URL, or SteamID3"
                    className="w-full bg-slate-950 border border-[var(--color-border-primary)] rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[var(--color-accent-primary)] text-slate-200 transition-colors"
                  />
                  {steamError && (
                    <p className="text-[10px] text-[var(--color-danger)] font-medium">{steamError}</p>
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setSteamEdit(false)}
                      className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 text-xs font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveSteamId}
                      disabled={steamSaving}
                      className="px-3 py-1.5 rounded bg-[var(--color-accent-primary)] text-white hover:bg-[#1B4F8A] text-xs font-semibold transition-colors flex items-center gap-1.5"
                    >
                      {steamSaving ? "Saving..." : "Save ID"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {currentSteamId ? (
                    <div className="flex flex-col gap-2 rounded-lg bg-slate-950/60 border border-slate-900 px-3 py-2.5">
                      <div>
                        <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Linked Steam ID</p>
                        <p className="text-xs font-bold text-[var(--color-accent-secondary)] font-mono truncate">{currentSteamId}</p>
                      </div>
                      <button
                        onClick={() => { setSteamInput(currentSteamId); setSteamEdit(true); setSteamError(""); }}
                        className="text-xs font-semibold text-[var(--color-accent-primary)] hover:text-[#5BA3E8] transition-colors text-left"
                      >
                        Change Steam ID
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setSteamInput(""); setSteamEdit(true); setSteamError(""); }}
                      className="w-full py-2.5 rounded-lg bg-[var(--color-accent-primary)]/10 border border-[var(--color-accent-primary)]/30 text-[var(--color-accent-primary)] hover:bg-[var(--color-accent-primary)]/20 text-xs font-semibold transition-all text-center"
                    >
                      + Link Steam Account
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Theme Switcher Card */}
            <div className="card p-5 mt-6" style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
              <ThemeSwitcher />
            </div>
          </div>

          {/* ── Analyses feed ── */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="heading-display" style={{ fontSize: "0.95rem" }}>
                <Crosshair size={14} className="inline mr-2" />Recent Analyses
              </h2>
              <button
                onClick={() => setIsUploadOpen(true)}
                className="text-xs font-semibold transition-colors hover:text-white text-[var(--color-accent-primary)] cursor-pointer focus:outline-none"
              >
                + New Upload
              </button>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 py-8">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--color-accent-primary)", borderTopColor: "transparent" }} />
                <span style={{ color: "var(--color-text-secondary)" }}>Loading analyses…</span>
              </div>
            ) : analyses.length === 0 ? (
              <div className="rounded-2xl p-10 text-center"
                style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
                <SoyomboIcon size={40} color="var(--color-border-primary)" className="mx-auto mb-4" />
                <h3 className="heading-display mb-2" style={{ fontSize: "1.1rem" }}>No analyses yet</h3>
                <p style={{ color: "var(--color-text-secondary)", fontSize: "0.875rem", marginBottom: 20 }}>
                  Upload your first CS2 demo to see the Khan&apos;s verdict.
                </p>
                <Link href="/" className="ds-btn ds-btn-primary ds-btn-md">
                  Upload your first demo <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {analyses.map(a => {
                  const statusColor = STATUS_COLORS[a.status] ?? "var(--color-text-secondary)";
                  return (
                    <div key={a.match_id}
                      className="relative rounded-2xl p-4 flex items-center justify-between group hover:border-[var(--color-accent-primary)]/40 transition-colors"
                      style={{ background: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)" }}>
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: "var(--color-accent-soft)", border: "1px solid var(--color-border-primary)" }}>
                          <MapPin size={18} color="var(--color-accent-primary)" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center flex-wrap gap-y-1">
                            {/* Stretched link: the whole row opens the analysis. */}
                            <Link href={`/analysis/${a.match_id}`}
                              className="font-semibold text-[var(--color-text-primary)] after:absolute after:inset-0 after:rounded-2xl">
                              {a.map || "Unknown Map"}
                            </Link>
                            {a.is_recon && (
                              <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  color: "var(--color-accent-secondary)",
                                  border: "1px solid var(--color-accent-secondary)",
                                }}>
                                Recon
                              </span>
                            )}
                            {getSourceBadge(a.source)}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            {a.total_rounds > 0 && (
                              <span style={{ color: "var(--color-text-muted)", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>{a.total_rounds} rounds</span>
                            )}
                            {a.total_kills > 0 && (
                              <span style={{ color: "var(--color-text-muted)", fontSize: "0.72rem", fontFamily: "var(--font-mono)" }}>{a.total_kills} kills</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 flex-shrink-0">
                        {a.is_recon && (
                          <Link href="/scouting"
                            className="relative z-10 text-xs font-semibold text-[var(--color-accent-secondary)] hover:text-[var(--color-text-primary)] transition-colors whitespace-nowrap">
                            Dossier →
                          </Link>
                        )}
                        <div className="text-right">
                          <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              color: statusColor,
                              background: `color-mix(in srgb, ${statusColor} 10%, transparent)`,
                              border: `1px solid color-mix(in srgb, ${statusColor} 35%, transparent)`,
                            }}>
                            {a.status}
                          </span>
                          <span className="mt-1" style={{ color: "var(--color-text-muted)", fontSize: "0.7rem", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                            <Clock size={9} /> {a.created_at ? timeAgo(a.created_at) : "—"}
                          </span>
                        </div>
                        <ChevronRight size={16} color="var(--color-text-muted)" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </PageSection>
      </PageTransition>
      <UploadModal isOpen={isUploadOpen} onClose={() => setIsUploadOpen(false)} />
    </div>
  );
}
