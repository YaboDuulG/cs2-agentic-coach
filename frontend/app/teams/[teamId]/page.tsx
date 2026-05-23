"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Users, Copy, Check, ArrowLeft, MapPin, Crosshair, Clock } from "lucide-react";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";

interface TeamDetail {
  team_id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
  members: { user_id: string; role: string; joined_at: string }[];
}

interface Analysis {
  match_id: string;
  map: string;
  status: string;
  created_at: string;
  user_id: string;
  total_rounds: number;
  total_kills: number;
}

interface PracticeServer {
  id: string;
  status: string;
  ip_address: string | null;
  rcon_password: string;
  server_password: string;
  mode: string;
}


const STATUS_COLORS: Record<string, string> = {
  done: "#22D3A0", processing: "#2D7DD2", queued: "#8BA7CC", failed: "#FF4D6D",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return "Just now";
}

export default function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [servers, setServers] = useState<PracticeServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinningUp, setSpinningUp] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isLoaded || !user) return;
    Promise.all([
      fetch(`/api/teams/${teamId}`).then(r => r.json()),
      fetch(`/api/teams/${teamId}?view=analyses`).then(r => r.json()),
      fetch(`/api/teams/${teamId}/servers`).then(r => r.json()),
    ]).then(([teamData, analysisData, serverData]) => {
      setTeam(teamData);
      setAnalyses(Array.isArray(analysisData) ? analysisData : []);
      setServers(Array.isArray(serverData) ? serverData : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [teamId, user, isLoaded]);

  async function spinUpServer() {
    setSpinningUp(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "practice", region: "eu" }),
      });
      const data = await res.json();
      if (res.ok) setServers([...servers, data]);
    } catch (e) { console.error(e); }
    setSpinningUp(false);
  }


  function copyInvite() {
    if (!team) return;
    navigator.clipboard.writeText(team.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isLoaded) return null;
  if (!user) { router.push("/sign-in"); return null; }

  return (
    <div className="min-h-screen px-6 py-16" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-4xl mx-auto">
        {/* Back */}
        <Link href="/teams" className="inline-flex items-center gap-2 mb-8 text-sm hover:text-white transition-colors" style={{ color: "#4A6A8A" }}>
          <ArrowLeft size={14} /> All Teams
        </Link>

        {loading ? (
          <div className="flex items-center gap-3 py-12">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
            <span style={{ color: "#8BA7CC" }}>Loading team…</span>
          </div>
        ) : !team ? (
          <div className="card p-10 text-center">
            <p style={{ color: "#FF4D6D" }}>Team not found or you are not a member.</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div className="flex items-center gap-4">
                <SoyomboIcon size={36} color="#C9A227" />
                <div>
                  <h1 className="heading-display" style={{ fontSize: "1.8rem" }}>{team.name}</h1>
                  <p style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>{team.members.length} member{team.members.length !== 1 ? "s" : ""}</p>
                </div>
              </div>

              {/* Invite Code */}
              <button
                onClick={copyInvite}
                className="card flex items-center gap-3 px-4 py-3 hover:border-[#2D7DD2]/40 transition-colors group"
              >
                <div>
                  <p style={{ color: "#4A6A8A", fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Invite Code</p>
                  <p style={{ color: "#F0F4FF", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: "1rem", letterSpacing: "0.15em" }}>{team.invite_code}</p>
                </div>
                {copied ? <Check size={16} color="#22D3A0" /> : <Copy size={16} color="#4A6A8A" className="group-hover:text-white" />}
              </button>
            </div>

            <UlziiBorder className="mb-8" />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Members panel */}
              <div className="card p-5">
                <h2 className="heading-display mb-4" style={{ fontSize: "0.95rem" }}>
                  <Users size={14} className="inline mr-2" />Members
                </h2>
                <div className="space-y-3">
                  {team.members.map(m => (
                    <div key={m.user_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(45,125,210,0.15)", color: "#2D7DD2" }}>
                          {m.user_id.slice(-2).toUpperCase()}
                        </div>
                        <span style={{ color: "#C4CEDD", fontSize: "0.8rem", fontFamily: "JetBrains Mono" }}>
                          {m.user_id === user.id ? "You" : `···${m.user_id.slice(-6)}`}
                        </span>
                      </div>
                      <span className="rounded px-1.5 py-0.5 text-xs" style={{
                        background: m.role === "owner" ? "rgba(201,162,39,0.1)" : "rgba(45,125,210,0.08)",
                        color: m.role === "owner" ? "#C9A227" : "#4A6A8A",
                        border: `1px solid ${m.role === "owner" ? "rgba(201,162,39,0.2)" : "#1E3A5F"}`,
                      }}>{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Practice Servers panel */}
              <div className="card p-5 mt-6">
                <h2 className="heading-display mb-4" style={{ fontSize: "0.95rem" }}>
                  <CloudMotifBg /> Practice Server
                </h2>
                
                {servers.length > 0 ? (
                  <div className="space-y-3">
                    {servers.map(s => (
                      <div key={s.id} className="rounded-lg bg-white/5 p-3 border border-white/10">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-bold uppercase text-[#2D7DD2]">{s.mode} Mode</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-[#22D3A0]/20 text-[#22D3A0]' : 'bg-yellow-500/20 text-yellow-500'}`}>
                            {s.status}
                          </span>
                        </div>
                        {s.ip_address ? (
                          <div className="bg-black/40 p-2 rounded text-xs font-mono text-[#C4CEDD] break-all select-all">
                            connect {s.ip_address}; password {s.server_password}
                          </div>
                        ) : (
                          <div className="text-xs text-[#8BA7CC]">Provisioning IP...</div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <p className="text-sm text-[#8BA7CC] mb-3">No active practice servers.</p>
                    <button
                      onClick={spinUpServer}
                      disabled={spinningUp}
                      className="w-full rounded bg-[#2D7DD2] py-2 text-sm font-bold text-white transition hover:bg-[#2D7DD2]/80 disabled:opacity-50"
                    >
                      {spinningUp ? "Starting..." : "Spin Up Server"}
                    </button>
                  </div>
                )}
              </div>


              {/* Analyses feed */}
              <div className="md:col-span-2">
                <h2 className="heading-display mb-4" style={{ fontSize: "0.95rem" }}>Team Analyses</h2>
                {analyses.length === 0 ? (
                  <div className="card p-8 text-center">
                    <MapPin size={32} color="#1E3A5F" className="mx-auto mb-3" />
                    <p style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>No analyses yet. Have a teammate upload a demo!</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {analyses.map(a => (
                      <Link
                        key={a.match_id}
                        href={`/analysis/${a.match_id}`}
                        className="card p-4 flex items-center justify-between group hover:border-[#2D7DD2]/40 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "rgba(45,125,210,0.1)", border: "1px solid rgba(45,125,210,0.15)" }}>
                            <MapPin size={16} color="#2D7DD2" />
                          </div>
                          <div>
                            <p style={{ color: "#F0F4FF", fontWeight: 600, fontSize: "0.9rem" }}>{a.map || "Unknown Map"}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {a.total_rounds > 0 && (
                                <span style={{ color: "#4A6A8A", fontSize: "0.72rem" }}>{a.total_rounds} rounds</span>
                              )}
                              {a.total_kills > 0 && (
                                <span style={{ color: "#4A6A8A", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 3 }}>
                                  <Crosshair size={10} /> {a.total_kills} kills
                                </span>
                              )}
                              <span style={{ color: "#4A6A8A", fontSize: "0.72rem", fontFamily: "JetBrains Mono" }}>
                                ···{a.user_id?.slice(-6) ?? "?"}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="flex items-center gap-1.5 justify-end">
                              <div className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[a.status] ?? "#8BA7CC" }} />
                              <span style={{ fontSize: "0.75rem", color: STATUS_COLORS[a.status] ?? "#8BA7CC", fontWeight: 500 }}>{a.status}</span>
                            </div>
                            <span style={{ color: "#4A6A8A", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
                              <Clock size={9} /> {a.created_at ? timeAgo(a.created_at) : "–"}
                            </span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
