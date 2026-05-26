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
import { PLAN_LIMITS } from "@/lib/flags";

interface Analysis {
  match_id: string;
  map: string;
  status: string;
  created_at: string;
  total_rounds: number;
  total_kills: number;
}

interface Team {
  team_id: string;
  name: string;
  invite_code: string;
  member_count: number;
}

const STATUS_COLORS: Record<string, string> = {
  done: "#22D3A0", processing: "#2D7DD2", queued: "#8BA7CC", failed: "#FF4D6D",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  const h = Math.floor(diff / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "Just now";
}

export default function ProfilePage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  const plan = (user?.publicMetadata?.plan as string) ?? "free";
  const uploads = (user?.publicMetadata?.uploadsThisMonth as number) ?? 0;
  const limits = PLAN_LIMITS[plan as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free;
  const maxUploads = limits.uploadsPerMonth === Infinity ? null : limits.uploadsPerMonth;

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) { router.push("/sign-in"); return; }

    Promise.all([
      fetch("/api/analyses").then(r => r.json()).catch(() => []),
      fetch("/api/teams").then(r => r.json()).catch(() => []),
    ]).then(([a, t]) => {
      setAnalyses(Array.isArray(a) ? a : []);
      setTeams(Array.isArray(t) ? t : []);
      setLoading(false);
    });
  }, [user, isLoaded, router]);

  if (!isLoaded || !user) return null;

  const planLabel = plan === "pro" ? "Pro" : plan === "basic" ? "Basic" : "Free";
  const planColor = plan === "pro" ? "#C9A227" : plan === "basic" ? "#2D7DD2" : "#4A6A8A";
  const planBg = plan === "pro" ? "rgba(201,162,39,0.1)" : plan === "basic" ? "rgba(45,125,210,0.1)" : "rgba(74,106,138,0.08)";
  const planBorder = plan === "pro" ? "rgba(201,162,39,0.25)" : plan === "basic" ? "rgba(45,125,210,0.25)" : "#1E3A5F";

  return (
    <div className="min-h-screen px-6 py-20" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-5xl mx-auto">

        {/* ── Profile Header ── */}
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6 mb-10">
          {/* Avatar */}
          <div className="relative">
            {user.imageUrl ? (
              <img src={user.imageUrl} alt="avatar" className="w-20 h-20 rounded-2xl object-cover"
                style={{ border: "2px solid #1E3A5F" }} />
            ) : (
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(45,125,210,0.1)", border: "2px solid #1E3A5F" }}>
                <User size={32} color="#2D7DD2" />
              </div>
            )}
          </div>

          {/* Identity */}
          <div className="flex-1">
            <h1 className="heading-display" style={{ fontSize: "1.6rem" }}>
              {user.fullName ?? user.username ?? "Player"}
            </h1>
            <p style={{ color: "#8BA7CC", fontSize: "0.875rem", marginTop: 2 }}>
              {user.primaryEmailAddress?.emailAddress}
            </p>
            <div className="flex items-center gap-3 mt-3">
              <span className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ background: planBg, color: planColor, border: `1px solid ${planBorder}` }}>
                {planLabel} Plan
              </span>
              {plan !== "pro" && (
                <Link href="/billing" className="flex items-center gap-1 text-xs font-semibold transition-all hover:text-white"
                  style={{ color: "#2D7DD2" }}>
                  Upgrade <ArrowRight size={11} />
                </Link>
              )}
            </div>
          </div>

          {/* Usage meter */}
          <div className="rounded-2xl p-5 min-w-[220px]"
            style={{ background: "rgba(13,24,37,0.8)", border: "1px solid #1E3A5F" }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ color: "#8BA7CC", fontSize: "0.75rem", fontWeight: 500 }}>Monthly Analyses</span>
              <span style={{ color: "#F0F4FF", fontFamily: "JetBrains Mono", fontSize: "0.875rem", fontWeight: 700 }}>
                {uploads}{maxUploads ? `/${maxUploads}` : " / ∞"}
              </span>
            </div>
            {maxUploads && (
              <div className="h-2 rounded-full overflow-hidden" style={{ background: "#0D1825" }}>
                <div
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: `${Math.min((uploads / maxUploads) * 100, 100)}%`,
                    background: uploads >= maxUploads ? "#FF4D6D" : "linear-gradient(90deg, #1B4F8A, #2D7DD2)",
                  }}
                />
              </div>
            )}
            <p style={{ color: "#4A6A8A", fontSize: "0.68rem", marginTop: 6 }}>
              Resets on the 1st of each month
            </p>
          </div>
        </div>

        <UlziiBorder className="mb-10" />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* ── Teams panel ── */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="heading-display" style={{ fontSize: "0.95rem" }}>
                <Users size={14} className="inline mr-2" />Teams
              </h2>
              <Link href="/teams" className="text-xs font-semibold transition-colors hover:text-white" style={{ color: "#2D7DD2" }}>
                Manage <ChevronRight size={11} className="inline" />
              </Link>
            </div>
            {teams.length === 0 ? (
              <div className="rounded-2xl p-5 text-center"
                style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                <Users size={24} color="#1E3A5F" className="mx-auto mb-2" />
                <p style={{ color: "#4A6A8A", fontSize: "0.8rem" }}>No teams yet</p>
                <Link href="/teams" className="text-xs font-semibold mt-2 inline-block" style={{ color: "#2D7DD2" }}>
                  Create one →
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {teams.slice(0, 5).map(t => (
                  <Link key={t.team_id} href={`/teams/${t.team_id}`}
                    className="rounded-xl p-3.5 flex items-center gap-3 group hover:border-[#2D7DD2]/30 transition-colors"
                    style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F", display: "flex" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(45,125,210,0.1)" }}>
                      <Users size={14} color="#2D7DD2" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ color: "#F0F4FF", fontSize: "0.85rem", fontWeight: 500 }} className="truncate">{t.name}</p>
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
                style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                <div className="flex items-center gap-2">
                  <BarChart3 size={14} color="#2D7DD2" />
                  <span style={{ color: "#8BA7CC", fontSize: "0.8rem" }}>Total Analyses</span>
                </div>
                <span style={{ color: "#F0F4FF", fontFamily: "JetBrains Mono", fontWeight: 700 }}>{analyses.length}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                <div className="flex items-center gap-2">
                  <Shield size={14} color={planColor} />
                  <span style={{ color: "#8BA7CC", fontSize: "0.8rem" }}>Current Plan</span>
                </div>
                <span style={{ color: planColor, fontWeight: 600, fontSize: "0.85rem" }}>{planLabel}</span>
              </div>
            </div>
          </div>

          {/* ── Analyses feed ── */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="heading-display" style={{ fontSize: "0.95rem" }}>
                <Crosshair size={14} className="inline mr-2" />Recent Analyses
              </h2>
              <Link href="/" className="text-xs font-semibold transition-colors hover:text-white" style={{ color: "#2D7DD2" }}>
                + New Upload
              </Link>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 py-8">
                <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
                <span style={{ color: "#8BA7CC" }}>Loading analyses…</span>
              </div>
            ) : analyses.length === 0 ? (
              <div className="rounded-2xl p-10 text-center"
                style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                <SoyomboIcon size={40} color="#1E3A5F" className="mx-auto mb-4" />
                <h3 className="heading-display mb-2" style={{ fontSize: "1.1rem" }}>No analyses yet</h3>
                <p style={{ color: "#8BA7CC", fontSize: "0.875rem", marginBottom: 20 }}>
                  Upload your first CS2 demo to see the Khan&apos;s verdict.
                </p>
                <Link href="/"
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold"
                  style={{ background: "linear-gradient(135deg,#1B4F8A,#2D7DD2)", color: "#fff" }}>
                  Upload a Demo <ArrowRight size={14} />
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {analyses.map(a => (
                  <Link key={a.match_id} href={`/analysis/${a.match_id}`}
                    className="rounded-2xl p-4 flex items-center justify-between group hover:border-[#2D7DD2]/40 transition-all hover:scale-[1.01]"
                    style={{ background: "rgba(13,24,37,0.7)", border: "1px solid #1E3A5F", display: "flex" }}>
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: "rgba(45,125,210,0.1)", border: "1px solid rgba(45,125,210,0.15)" }}>
                        <MapPin size={18} color="#2D7DD2" />
                      </div>
                      <div>
                        <p style={{ color: "#F0F4FF", fontWeight: 600 }}>{a.map || "Unknown Map"}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {a.total_rounds > 0 && (
                            <span style={{ color: "#4A6A8A", fontSize: "0.72rem" }}>{a.total_rounds} rounds</span>
                          )}
                          {a.total_kills > 0 && (
                            <span style={{ color: "#4A6A8A", fontSize: "0.72rem" }}>{a.total_kills} kills</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[a.status] ?? "#8BA7CC" }} />
                          <span style={{ fontSize: "0.75rem", color: STATUS_COLORS[a.status] ?? "#8BA7CC", fontWeight: 500 }}>{a.status}</span>
                        </div>
                        <span style={{ color: "#4A6A8A", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                          <Clock size={9} /> {a.created_at ? timeAgo(a.created_at) : "—"}
                        </span>
                      </div>
                      <ChevronRight size={16} color="#4A6A8A" className="group-hover:text-white transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
