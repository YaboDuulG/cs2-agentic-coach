"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { 
  Users, Copy, Check, ArrowLeft, MapPin, Crosshair, Clock, MessageSquare, BookOpen, Search, ChevronDown, ChevronUp, Send,
  Settings, LayoutDashboard, Lock, Shield, Key, CreditCard, AlertTriangle, Trash2, Camera, Upload
} from "lucide-react";
import { CloudMotifBg } from "@/components/patterns/mongolian";
import { TeamIcon, getDevilFruit } from "@/components/TeamIcon";
import { UploadModal } from "@/components/UploadModal";

interface TeamDetail {
  team_id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
  logo_url?: string | null;
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
  const [region, setRegion] = useState("dfw"); // dfw = Dallas (default)
  const [copied, setCopied] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const [showInviteBox, setShowInviteBox] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  // Tabs
  const [activeTab, setActiveTab] = useState<"overview" | "tactics" | "settings">("overview");
  const [settingsTab, setSettingsTab] = useState<"profile" | "password" | "members" | "subscription" | "danger">("profile");

  const [strategies, setStrategies] = useState<any[]>([]);
  const [strategiesLoading, setStrategiesLoading] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [stratSearch, setStratSearch] = useState("");
  const [expandedStrats, setExpandedStrats] = useState<Record<string, boolean>>({});

  const fetchStrategies = useCallback(() => {
    setStrategiesLoading(true);
    fetch(`/api/teams/${teamId}/strategies`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setStrategies(data);
        setStrategiesLoading(false);
      })
      .catch(() => setStrategiesLoading(false));
  }, [teamId]);

  useEffect(() => {
    if (activeTab === "tactics") {
      fetchStrategies();
    }
  }, [activeTab, fetchStrategies]);

  const handleInviteClick = () => {
    if (!team) return;
    navigator.clipboard.writeText(team.invite_code);
    setInviteCopied(true);
    setShowInviteBox(true);
    setTimeout(() => setInviteCopied(false), 3000);
  };

  // Profile Edit fields
  const [editName, setEditName] = useState("");
  const [updatingName, setUpdatingName] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTeamDetails = useCallback(() => {
    if (!isLoaded || !user) return;
    Promise.all([
      fetch(`/api/teams/${teamId}`).then(r => r.json().catch(() => null)),
      fetch(`/api/teams/${teamId}?view=analyses`).then(r => r.json().catch(() => [])),
      fetch(`/api/teams/${teamId}/servers`).then(r => r.json().catch(() => [])),
    ]).then(([teamData, analysisData, serverData]) => {
      setTeam(teamData);
      if (teamData) {
        setEditName(teamData.name);
      }
      setAnalyses(Array.isArray(analysisData) ? analysisData : []);
      setServers(Array.isArray(serverData) ? serverData : []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [teamId, user, isLoaded]);

  useEffect(() => {
    fetchTeamDetails();
  }, [fetchTeamDetails]);

  // Poll for server status if any server is booting
  useEffect(() => {
    if (!user || servers.length === 0) return;
    const isBooting = servers.some(s => s.status === "booting");
    if (!isBooting) return;

    const interval = setInterval(() => {
      fetch(`/api/teams/${teamId}/servers`)
        .then(r => r.json().catch(() => []))
        .then(data => {
          if (Array.isArray(data)) setServers(data);
        })
        .catch(console.error);
    }, 5000);

    return () => clearInterval(interval);
  }, [teamId, user, servers]);

  async function spinUpServer() {
    setSpinningUp(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "practice", region }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: "Failed to parse API response", detail: res.statusText || "Internal Server Error" };
      }

      if (res.ok) {
        setServers([...servers, data]);
        router.push(`/teams/${teamId}/servers/${data.id}`);
      } else {
        const errorDetail = data.detail || data.error || "";
        if (errorDetail.includes("401") || errorDetail.toLowerCase().includes("unauthorized")) {
          setServerError("Vultr API returned 401 Unauthorized. Please ensure your Vultr API Key has Access Control set to allow all IPs (0.0.0.0/0) in your Vultr Developer portal settings.");
        } else {
          setServerError(errorDetail || "Failed to spin up practice server.");
        }
      }
    } catch (e) {
      console.error(e);
      setServerError("An error occurred during server startup.");
    }
    setSpinningUp(false);
  }

  function copyInvite() {
    if (!team) return;
    navigator.clipboard.writeText(team.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleUpdateName() {
    if (!team || !editName.trim() || editName.trim() === team.name) return;
    setUpdatingName(true);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        fetchTeamDetails();
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        alert("Failed to update team name.");
      }
    } catch (e) {
      console.error("Failed to update team name:", e);
    }
    setUpdatingName(false);
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !team) return;

    setLogoUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/teams/${teamId}/logo`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        fetchTeamDetails();
      } else {
        const data = await res.json();
        alert(data.detail || "Failed to upload logo image");
      }
    } catch (err) {
      console.error("Failed to upload logo:", err);
      alert("An error occurred while uploading the logo.");
    }
    setLogoUploading(false);
  }

  async function handleDeleteTeam() {
    if (!team || deleteConfirm !== team.name) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push("/teams");
      } else {
        alert("Failed to delete team");
      }
    } catch (e) {
      console.error("Failed to delete team:", e);
      alert("Error deleting team");
    }
    setDeleting(false);
  }

  if (!isLoaded) return null;
  if (!user) { router.push("/sign-in"); return null; }

  const isOwner = team ? team.owner_user_id === user.id : false;
  const fruit = team ? getDevilFruit(team.team_id) : null;

  return (
    <div className="min-h-screen px-6 py-20 relative" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-5xl mx-auto z-10">
        {/* Back */}
        <Link href="/teams" className="inline-flex items-center gap-2 mb-6 text-sm hover:text-white transition-colors" style={{ color: "#4A6A8A" }}>
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <TeamIcon teamId={team.team_id} name={team.name} logoUrl={team.logo_url} size="lg" />
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="heading-display text-white" style={{ fontSize: "1.8rem" }}>{team.name}</h1>
                    {isOwner && (
                      <span className="rounded px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase border bg-yellow-500/10 border-yellow-500/20 text-[#C9A227]">
                        Captain
                      </span>
                    )}
                  </div>
                  <p className="mt-1" style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>
                    {team.members.length} member{team.members.length !== 1 ? "s" : ""}
                  </p>
                </div>
              </div>
            </div>

            {/* Tab switchers */}
            <div className="flex gap-6 border-b border-[#1E3A5F] mb-8">
              <button
                onClick={() => setActiveTab("overview")}
                className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 select-none ${
                  activeTab === "overview"
                    ? "border-[#2D7DD2] text-white"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <LayoutDashboard size={14} /> Overview
              </button>
              <button
                onClick={() => setActiveTab("tactics")}
                className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 select-none ${
                  activeTab === "tactics"
                    ? "border-[#2D7DD2] text-white"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <MessageSquare size={14} /> Tactics & AI Chat
              </button>
              <button
                onClick={() => setActiveTab("settings")}
                className={`pb-3 text-sm font-semibold border-b-2 transition-all flex items-center gap-2 select-none ${
                  activeTab === "settings"
                    ? "border-[#2D7DD2] text-white"
                    : "border-transparent text-slate-400 hover:text-slate-200"
                }`}
              >
                <Settings size={14} /> Settings
              </button>
            </div>

            {activeTab === "overview" && (
              /* ── OVERVIEW VIEW ── */
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Members panel */}
                <div className="card p-5 h-fit" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                  <h2 className="heading-display mb-4" style={{ fontSize: "0.95rem" }}>
                    <Users size={14} className="inline mr-2" />Members
                  </h2>
                  <div className="space-y-3">
                    {team.members.map(m => (
                      <div key={m.user_id} className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono" style={{ background: "rgba(45,125,210,0.15)", color: "#2D7DD2", border: "1px solid rgba(45,125,210,0.2)" }}>
                            {m.user_id.slice(-2).toUpperCase()}
                          </div>
                          <span style={{ color: "#C4CEDD", fontSize: "0.8rem", fontFamily: "JetBrains Mono" }}>
                            {m.user_id === user.id ? "You" : `···${m.user_id.slice(-6)}`}
                          </span>
                        </div>
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{
                          background: m.role === "owner" ? "rgba(201,162,39,0.1)" : "rgba(45,125,210,0.08)",
                          color: m.role === "owner" ? "#C9A227" : "#4A6A8A",
                          border: `1px solid ${m.role === "owner" ? "rgba(201,162,39,0.2)" : "#1E3A5F"}`,
                        }}>{m.role === "owner" ? "captain" : m.role}</span>
                      </div>
                    ))}

                    <div className="border-t border-[#1E3A5F]/40 mt-4 pt-3 flex flex-col">
                      <button
                        onClick={handleInviteClick}
                        className="text-[11px] text-[#2D7DD2] hover:text-[#2D7DD2]/80 font-bold uppercase tracking-wider text-left flex items-center gap-1.5 transition-colors"
                      >
                        + Invite a team member
                      </button>
                      
                      {showInviteBox && (
                        <div className="mt-2.5 p-3 rounded-lg border border-[#1E3A5F] bg-[#090F1B]/90 text-[11px] flex flex-col gap-1.5 animate-fadeIn relative">
                          <button 
                            onClick={() => setShowInviteBox(false)}
                            className="absolute top-2 right-2 text-slate-500 hover:text-slate-300 text-[10px]"
                          >
                            ✕
                          </button>
                          <div className="flex justify-between items-center pr-4">
                            <span className="text-slate-500 font-medium">Invite Code:</span>
                            <span className="font-mono font-bold text-[#F0F4FF] tracking-widest select-all">{team.invite_code}</span>
                          </div>
                          {inviteCopied && (
                            <p className="text-[10px] text-[#22D3A0] font-semibold">✓ Copied to clipboard!</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Training Server panel */}
                <div className="card p-5 h-fit" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                  <h2 className="heading-display mb-4" style={{ fontSize: "0.95rem" }}>
                    <Crosshair size={14} className="inline mr-2" /> Training Server
                  </h2>

                  {/* Active server quick info */}
                  {servers.filter(s => s.status !== "terminated").map(s => (
                    <div key={s.id} className="rounded-lg bg-white/5 p-4 border border-white/10 flex flex-col gap-3 mb-3">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${s.status === 'active' ? 'bg-[#22D3A0] animate-pulse' : 'bg-yellow-500 animate-pulse'}`} />
                          <span className="text-xs font-bold uppercase tracking-wider text-slate-200">{s.mode} Server</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${s.status === 'active' ? 'bg-[#22D3A0]/10 text-[#22D3A0] border border-[#22D3A0]/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'}`}>
                          {s.status}
                        </span>
                      </div>
                      {s.ip_address ? (
                        <div className="bg-black/40 p-2.5 rounded text-xs font-mono text-[#C4CEDD] break-all select-all border border-white/5">
                          connect {s.ip_address}; password {s.server_password}
                        </div>
                      ) : (
                        <div className="text-xs text-[#8BA7CC] italic">Provisioning server instance...</div>
                      )}
                    </div>
                  ))}

                  {/* Training modes launcher */}
                  <Link
                    href={`/teams/${teamId}/training`}
                    style={{
                      display: "block",
                      borderRadius: "10px",
                      overflow: "hidden",
                      position: "relative",
                      minHeight: "120px",
                      textDecoration: "none",
                      background: "linear-gradient(135deg, #0D1825 0%, #142135 100%)",
                      border: "1px solid #1E3A5F",
                      marginTop: servers.filter(s => s.status !== "terminated").length > 0 ? "8px" : "0",
                    }}
                  >
                    {/* Mode previews */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", height: "80px", overflow: "hidden" }}>
                      {["defense","prefire","grenade"].map((m) => (
                        <div key={m} style={{ position: "relative", overflow: "hidden" }}>
                          <img src={`/training_${m}.png`} alt={m} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "12px 14px", background: "linear-gradient(to top, rgba(8,14,26,0.95) 0%, rgba(8,14,26,0.6) 100%)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 700, color: "#F0F4FF" }}>Open Training Modes</div>
                          <div style={{ fontSize: "11px", color: "#8BA7CC", marginTop: "2px" }}>Defense · Prefire · AWP · Grenades · Retake + more</div>
                        </div>
                        <div style={{
                          width: "28px", height: "28px", borderRadius: "50%",
                          backgroundColor: "#2D7DD2",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                        </div>
                      </div>
                    </div>
                  </Link>
                </div>

                {/* Analyses feed */}
                <div className="md:col-span-2">
                  <div className="flex justify-between items-center mb-4">
                    <h2 className="heading-display" style={{ fontSize: "0.95rem" }}>Team Analyses</h2>
                    <button
                      onClick={() => setIsUploadModalOpen(true)}
                      className="rounded-lg bg-[#2D7DD2] hover:bg-[#2D7DD2]/85 px-4 py-2 text-xs font-bold text-white transition-all select-none shadow-md flex items-center gap-1.5 cursor-pointer"
                    >
                      <Upload size={13} /> Upload Match
                    </button>
                  </div>
                  {analyses.length === 0 ? (
                    <div className="card p-8 text-center" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                      <MapPin size={32} color="#1E3A5F" className="mx-auto mb-3" />
                      <p style={{ color: "#8BA7CC", fontSize: "0.875rem", marginBottom: "1rem" }}>No analyses yet. Have a teammate upload a demo!</p>
                      <button
                        onClick={() => setIsUploadModalOpen(true)}
                        className="mx-auto rounded-lg bg-[#2D7DD2] hover:bg-[#2D7DD2]/85 px-4 py-2 text-xs font-bold text-white transition-all select-none shadow-md flex items-center gap-1.5 cursor-pointer w-fit"
                      >
                        <Upload size={13} /> Upload Match
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {analyses.map(a => (
                        <Link
                          key={a.match_id}
                          href={`/analysis/${a.match_id}`}
                          className="card p-4 flex items-center justify-between group hover:border-[#2D7DD2]/40 transition-all hover:scale-[1.005]"
                          style={{ background: "rgba(13,24,37,0.7)", border: "1px solid #1E3A5F" }}
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
                              <span style={{ color: "#4A6A8A", fontSize: "0.7rem", display: "flex", alignItems: "center", gap: 3, justifySelf: "flex-end" }}>
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
            )}

            {activeTab === "tactics" && (
              /* ── TACTICS VIEW ── */
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                {/* Left panel: Strategies List (col-span-2) */}
                <div className="lg:col-span-2 flex flex-col gap-4">
                  <div className="card p-5 flex flex-col gap-4" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                    <div className="flex justify-between items-center">
                      <h2 className="heading-display text-sm font-bold uppercase tracking-wider text-slate-200">
                        <BookOpen size={14} className="inline mr-2 text-[#2D7DD2]" />
                        Tactical Playbook
                      </h2>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {strategies.length} ingested
                      </span>
                    </div>

                    {/* Search bar */}
                    <div className="relative">
                      <input
                        value={stratSearch}
                        onChange={(e) => setStratSearch(e.target.value)}
                        placeholder="Search strategies, maps, or authors..."
                        className="w-full rounded-lg pl-9 pr-4 py-2 text-xs outline-none"
                        style={{ background: "#070D18", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                      />
                      <Search size={12} className="absolute left-3 top-3 text-slate-500" />
                    </div>

                    {/* Discord Info Box */}
                    <div className="rounded-lg p-3 border border-[#1E3A5F]/60 bg-[#0D1825]/40 text-[11px] leading-relaxed text-slate-400">
                      <p className="font-semibold text-slate-300 mb-1">💡 Discord Webhook Ingestion</p>
                      To sync strategies, add an outgoing webhook in Discord pointing to:
                      <div className="mt-2 bg-black/40 p-2 rounded text-[10px] font-mono break-all select-all border border-white/5 text-[#8BA7CC]">
                        {typeof window !== 'undefined' ? `${window.location.origin}/api/discord/webhook?team_id=${teamId}` : `/api/discord/webhook?team_id=${teamId}`}
                      </div>
                    </div>
                  </div>

                  {/* Strategies List cards */}
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                    {strategiesLoading ? (
                      <div className="card p-8 text-center text-xs text-slate-500">
                        <div className="w-4 h-4 rounded-full border border-t-transparent animate-spin mx-auto mb-2" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
                        Loading playbook...
                      </div>
                    ) : strategies.length === 0 ? (
                      <div className="card p-8 text-center text-xs text-slate-500" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                        No strategies synced yet. Post a tactic in Discord or configure the webhook above to begin!
                      </div>
                    ) : (
                      strategies
                        .filter(s => {
                          const query = stratSearch.toLowerCase();
                          return s.title.toLowerCase().includes(query) ||
                            s.map_name.toLowerCase().includes(query) ||
                            s.author.toLowerCase().includes(query) ||
                            s.summary.toLowerCase().includes(query);
                        })
                        .map((s, idx) => {
                          const isCT = s.side === "CT";
                          const isT = s.side === "T";
                          const sideColor = isCT ? "#2D7DD2" : isT ? "#FF4D6D" : "#8BA7CC";
                          const isExpanded = !!expandedStrats[s.id];
                          
                          return (
                            <div 
                              key={s.id} 
                              className="card p-4 transition-all"
                              style={{ background: "rgba(13,24,37,0.7)", border: "1px solid #1E3A5F" }}
                            >
                              <div className="flex justify-between items-start gap-2 mb-2">
                                <div>
                                  <h4 className="text-xs font-bold text-[#F0F4FF]">{s.title}</h4>
                                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">By {s.author} · {timeAgo(s.created_at)}</p>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <span className="rounded px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase bg-slate-900 border border-slate-800 text-slate-400">
                                    {s.map_name}
                                  </span>
                                  <span 
                                    className="rounded px-1.5 py-0.5 text-[9px] font-bold font-mono uppercase border bg-slate-900"
                                    style={{ color: sideColor, borderColor: `${sideColor}33` }}
                                  >
                                    {s.side}
                                  </span>
                                </div>
                              </div>
                              <p className="text-xs text-slate-300 mb-3">{s.summary}</p>
                              
                              {/* Expand steps */}
                              {isExpanded ? (
                                <div className="border-t border-[#1E3A5F]/40 pt-3 mt-3 space-y-2">
                                  <h5 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tactical Steps:</h5>
                                  <ul className="list-disc pl-4 space-y-1 text-xs text-slate-300">
                                    {s.steps && s.steps.map((step: string, i: number) => (
                                      <li key={i}>{step}</li>
                                    ))}
                                  </ul>
                                  <button
                                    onClick={() => setExpandedStrats({ ...expandedStrats, [s.id]: false })}
                                    className="text-[10px] text-[#4A6A8A] hover:text-white font-mono mt-2 block"
                                  >
                                    <ChevronUp size={10} className="inline mr-1" /> Hide execution
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setExpandedStrats({ ...expandedStrats, [s.id]: true })}
                                  className="text-[10px] text-[#2D7DD2] hover:text-[#2D7DD2]/80 font-mono block"
                                >
                                  <ChevronDown size={10} className="inline mr-1" /> View execution
                                </button>
                              )}
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>

                {/* Right panel: AI Chat Board (col-span-3) */}
                <div className="lg:col-span-3 flex flex-col h-[650px] card" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                  {/* Chat header */}
                  <div className="p-4 border-b border-[#1E3A5F] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-[#2D7DD2]/10 border border-[#2D7DD2]/20 flex items-center justify-center text-white">
                        ⚔️
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">Great Khan Strategy Coach</h3>
                        <p className="text-[9px] text-slate-500 font-mono mt-0.5">RAG retrieval & strat refinement</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setChatHistory([])}
                      className="text-[10px] text-slate-500 hover:text-slate-300 font-mono uppercase"
                    >
                      Clear Chat
                    </button>
                  </div>

                  {/* Chat logs */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3.5 pr-2">
                    {chatHistory.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8">
                        <MessageSquare size={32} className="text-[#1E3A5F] mb-3" />
                        <p className="text-xs font-bold text-slate-400 mb-1">Ask the Great Khan</p>
                        <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                          &quot;How do we execute our A split on Mirage?&quot; or &quot;Refine our B site hold for Dust II based on our strategies.&quot;
                        </p>
                      </div>
                    ) : (
                      chatHistory.map((msg, i) => {
                        const isUser = msg.role === "user";
                        return (
                          <div key={i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                            <div 
                              className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed border ${
                                isUser 
                                  ? "bg-[#2D7DD2]/10 border-[#2D7DD2]/20 text-white"
                                  : "bg-slate-900/50 border-slate-800 text-slate-300"
                              }`}
                            >
                              {!isUser && <span className="font-bold text-[10px] block text-amber-500 font-mono mb-1">GREAT KHAN:</span>}
                              <p className="whitespace-pre-line">{msg.content}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {chatLoading && (
                      <div className="flex justify-start">
                        <div className="bg-slate-900/50 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-400 flex items-center gap-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Chat input */}
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!chatMessage.trim() || chatLoading) return;
                      
                      const userMsg = chatMessage.trim();
                      setChatMessage("");
                      
                      const newHistory = [...chatHistory, { role: "user", content: userMsg }];
                      setChatHistory(newHistory);
                      setChatLoading(true);
                      
                      try {
                        const res = await fetch(`/api/teams/${teamId}/strategies/chat`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            message: userMsg,
                            history: newHistory.map(h => ({
                              role: h.role === "user" ? "user" : "model",
                              content: h.content
                            }))
                          })
                        });
                        
                        if (res.ok) {
                          const data = await res.json();
                          setChatHistory([...newHistory, { role: "assistant", content: data.response || "No reply" }]);
                        } else {
                          setChatHistory([...newHistory, { role: "assistant", content: "Failed to connect to AI Coach." }]);
                        }
                      } catch (err) {
                        setChatHistory([...newHistory, { role: "assistant", content: "Error communicating with the coach." }]);
                      } finally {
                        setChatLoading(false);
                      }
                    }}
                    className="p-4 border-t border-[#1E3A5F] flex gap-3"
                  >
                    <input
                      value={chatMessage}
                      onChange={(e) => setChatMessage(e.target.value)}
                      placeholder="Ask the coach to refine a strategy..."
                      disabled={chatLoading}
                      className="flex-1 rounded-lg px-4 py-2.5 text-xs outline-none"
                      style={{ background: "#070D18", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                    />
                    <button
                      type="submit"
                      disabled={chatLoading || !chatMessage.trim()}
                      className="rounded-lg bg-[#2D7DD2] hover:bg-[#2D7DD2]/85 disabled:opacity-40 px-4 py-2 text-xs font-bold text-white transition-all flex items-center justify-center"
                    >
                      <Send size={12} />
                    </button>
                  </form>
                </div>
              </div>
            )}

            {activeTab === "settings" && (
              /* ── SETTINGS VIEW (SCL SIDEBAR STYLE) ── */
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {/* Left side sub-tabs */}
                <div className="col-span-1 flex flex-col gap-1.5">
                  <button
                    onClick={() => setSettingsTab("profile")}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200 border text-left select-none ${
                      settingsTab === "profile"
                        ? "bg-[#2D7DD2]/10 border-[#2D7DD2]/40 text-[#2E86AB]"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <Shield size={14} /> Team Profile
                  </button>
                  <button
                    onClick={() => setSettingsTab("password")}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200 border text-left select-none ${
                      settingsTab === "password"
                        ? "bg-[#2D7DD2]/10 border-[#2D7DD2]/40 text-[#2E86AB]"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <Key size={14} /> Password
                  </button>
                  <button
                    onClick={() => setSettingsTab("members")}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200 border text-left select-none ${
                      settingsTab === "members"
                        ? "bg-[#2D7DD2]/10 border-[#2D7DD2]/40 text-[#2E86AB]"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <Users size={14} /> Members
                  </button>
                  <button
                    onClick={() => setSettingsTab("subscription")}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200 border text-left select-none ${
                      settingsTab === "subscription"
                        ? "bg-[#2D7DD2]/10 border-[#2D7DD2]/40 text-[#2E86AB]"
                        : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
                    }`}
                  >
                    <CreditCard size={14} /> Subscription
                  </button>
                  <button
                    onClick={() => setSettingsTab("danger")}
                    className={`flex items-center gap-3 px-4 py-3.5 rounded-xl text-xs font-bold tracking-wide uppercase transition-all duration-200 border text-left select-none ${
                      settingsTab === "danger"
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-500"
                        : "border-transparent text-slate-400 hover:text-rose-500 hover:bg-rose-500/5"
                    }`}
                  >
                    <AlertTriangle size={14} /> Danger Zone
                  </button>
                </div>

                {/* Right side panels */}
                <div className="col-span-1 md:col-span-3">
                  {!isOwner ? (
                    /* Captain-Only Lock Screen */
                    <div className="card p-12 text-center flex flex-col items-center justify-center min-h-[340px]" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                      <div className="w-16 h-16 rounded-full bg-[#0F172A] flex items-center justify-center mb-5 border border-white/5 shadow-inner">
                        <Lock size={26} className="text-slate-400" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2 tracking-wide">Captain-Only Access</h3>
                      <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                        This section is restricted to the team captain. Contact your captain to make changes here.
                      </p>
                    </div>
                  ) : (
                    /* Settings Panels for Captain */
                    <div className="card p-6 min-h-[340px] flex flex-col justify-between" style={{ background: "rgba(13,24,37,0.6)", border: "1px solid #1E3A5F" }}>
                      
                      {/* Sub-tab 1: TEAM PROFILE */}
                      {settingsTab === "profile" && (
                        <div className="space-y-6">
                          <div>
                            <h3 className="heading-display mb-1" style={{ fontSize: "1rem" }}>Team Settings</h3>
                            <p className="text-xs text-slate-400">Configure team identities, names, and logos</p>
                          </div>

                          {/* Image upload row */}
                          <div className="flex flex-col sm:flex-row items-center gap-5 bg-white/2 rounded-xl p-4 border border-white/5">
                            <div className="relative group">
                              <TeamIcon teamId={team.team_id} name={team.name} logoUrl={team.logo_url} size="xl" />
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                className="absolute inset-0 bg-black/60 rounded-3xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-200 cursor-pointer"
                                disabled={logoUploading}
                              >
                                <Camera size={24} className="text-white" />
                              </button>
                            </div>
                            <div className="flex-1 text-center sm:text-left">
                              <h4 className="text-sm font-bold text-white mb-1">Custom Team Icon</h4>
                              <p className="text-xs text-slate-400 mb-3 leading-relaxed">Upload a PNG or JPG. Recommended size is 250x250px (Max 5MB).</p>
                              <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleLogoUpload}
                                accept="image/*"
                                className="hidden"
                              />
                              <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={logoUploading}
                                className="rounded-lg border border-[#2D7DD2]/40 hover:bg-[#2D7DD2]/10 px-4 py-2 text-xs font-bold text-[#2D7DD2] transition-all duration-200 disabled:opacity-50 select-none shadow"
                              >
                                {logoUploading ? "Uploading..." : "Upload Logo Image"}
                              </button>
                            </div>
                          </div>

                          {/* Team Name Form */}
                          <div className="space-y-2">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Team Name</label>
                            <div className="flex gap-3">
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="E.g. Team Liquid"
                                className="flex-1 rounded-lg px-4 py-2.5 text-sm outline-none"
                                style={{ background: "#070D18", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                              />
                              <button
                                onClick={handleUpdateName}
                                disabled={updatingName || !editName.trim() || editName.trim() === team.name}
                                className="rounded-lg bg-[#2D7DD2] hover:bg-[#2D7DD2]/85 px-5 py-2 text-xs font-bold text-white transition-all disabled:opacity-50 select-none shadow-md"
                              >
                                {updatingName ? "Saving..." : "Save Name"}
                              </button>
                            </div>
                            {saveSuccess && (
                              <p className="text-xs text-[#22D3A0] mt-1 font-semibold flex items-center gap-1">✓ Settings applied successfully!</p>
                            )}
                          </div>

                          {/* Devil Fruit Description Panel */}
                          {fruit && (
                            <div className="border-t border-[#1E3A5F] pt-6">
                              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-3">Deterministic Devil Fruit</h4>
                              <div className="flex items-start gap-4 p-4 rounded-xl border" style={{ background: "rgba(13,24,37,0.4)", borderColor: `${fruit.color}25` }}>
                                <div className="flex-shrink-0">
                                  <div className="w-14 h-14 rounded-2xl flex flex-col items-center justify-center font-bold text-white border text-base"
                                    style={{
                                      background: `linear-gradient(135deg, ${fruit.color}66 0%, #080E1A 100%)`,
                                      borderColor: `${fruit.color}33`,
                                    }}>
                                    <span className="font-mono text-slate-200">{team.name.slice(0,2).toUpperCase()}</span>
                                    <span className="text-sm absolute bottom-1 right-1">{fruit.emoji}</span>
                                  </div>
                                </div>
                                <div>
                                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: fruit.color }}>
                                    {fruit.type} Class
                                  </span>
                                  <h4 className="text-sm font-bold text-white mt-2 leading-none">{fruit.name}</h4>
                                  <p className="text-xs text-slate-400 mt-2 leading-relaxed max-w-lg">{fruit.description}</p>
                                  <p className="text-[10px] text-[#4A6A8A] mt-3 leading-relaxed italic">Your team is assigned this One Piece Devil Fruit based on your team ID&apos;s hash. Upload a custom logo above to override it.</p>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sub-tab 2: PASSWORD */}
                      {settingsTab === "password" && (
                        <div className="space-y-4">
                          <div>
                            <h3 className="heading-display mb-1" style={{ fontSize: "1rem" }}>Credentials</h3>
                            <p className="text-xs text-slate-400">Manage credentials and authentication profiles</p>
                          </div>
                          <div className="bg-[#070D18] p-5 rounded-xl border border-[#1E3A5F] flex items-center gap-4">
                            <Key className="text-[#2D7DD2] flex-shrink-0" size={24} />
                            <div>
                              <h4 className="text-sm font-bold text-white mb-0.5">Managed Provider</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">This team&apos;s security profile is managed by Clerk. Password-free sessions are enabled by default for all captains and members.</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 3: MEMBERS */}
                      {settingsTab === "members" && (
                        <div className="space-y-4">
                          <div>
                            <h3 className="heading-display mb-1" style={{ fontSize: "1rem" }}>Member Configuration</h3>
                            <p className="text-xs text-slate-400">View roster membership and manage player assignments</p>
                          </div>
                          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                            {team.members.map((m) => (
                              <div key={m.user_id} className="flex items-center justify-between bg-white/2 rounded-xl p-3 border border-white/5">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold font-mono" style={{ background: "rgba(45,125,210,0.1)", color: "#2D7DD2", border: "1px solid rgba(45,125,210,0.15)" }}>
                                    {m.user_id.slice(-2).toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="text-xs font-mono text-white leading-none">{m.user_id === user.id ? "You (Owner)" : `···${m.user_id.slice(-8)}`}</p>
                                    <p className="text-[10px] text-slate-500 mt-1 leading-none">Joined: {new Date(m.joined_at).toLocaleDateString()}</p>
                                  </div>
                                </div>
                                <span className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border" style={{
                                  background: m.role === "owner" ? "rgba(201,162,39,0.1)" : "rgba(45,125,210,0.08)",
                                  color: m.role === "owner" ? "#C9A227" : "#4A6A8A",
                                  borderColor: m.role === "owner" ? "rgba(201,162,39,0.2)" : "#1E3A5F",
                                }}>
                                  {m.role === "owner" ? "captain" : m.role}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 4: SUBSCRIPTION */}
                      {settingsTab === "subscription" && (
                        <div className="space-y-4">
                          <div>
                            <h3 className="heading-display mb-1" style={{ fontSize: "1rem" }}>Subscription</h3>
                            <p className="text-xs text-slate-400">View team subscription details and platform quotas</p>
                          </div>
                          <div className="bg-gradient-to-r from-[#070D18] to-[#1E3A5F]/20 p-5 rounded-xl border border-[#1E3A5F] flex items-center gap-4">
                            <CreditCard className="text-[#2D7DD2] flex-shrink-0" size={24} />
                            <div>
                              <h4 className="text-sm font-bold text-white mb-0.5">Synchronized Plan</h4>
                              <p className="text-xs text-slate-400 leading-relaxed">This team&apos;s subscription is synchronized with your captain account plan. Roster size limit: <b>Unlimited</b>.</p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Sub-tab 5: DANGER ZONE */}
                      {settingsTab === "danger" && (
                        <div className="space-y-5">
                          <div>
                            <h3 className="heading-display text-rose-500 mb-1" style={{ fontSize: "1rem" }}>Danger Zone</h3>
                            <p className="text-xs text-slate-400">Destructive, permanent administrative actions</p>
                          </div>
                          
                          <div className="bg-rose-500/5 p-5 rounded-xl border border-rose-500/20 space-y-4">
                            <div className="flex gap-3">
                              <AlertTriangle className="text-rose-500 flex-shrink-0" size={20} />
                              <div>
                                <h4 className="text-xs font-bold text-white mb-1 uppercase tracking-wide">Delete Team</h4>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                  Deleting this team is permanent. All analyses and server connections associated with this team will be lost.
                                </p>
                              </div>
                            </div>

                            <div className="space-y-2 pt-2">
                              <p className="text-xs text-slate-300">
                                To confirm deletion, type the team name <b className="text-white select-all">{team.name}</b> below:
                              </p>
                              <div className="flex flex-col sm:flex-row gap-3">
                                <input
                                  value={deleteConfirm}
                                  onChange={(e) => setDeleteConfirm(e.target.value)}
                                  placeholder="Confirm team name"
                                  className="flex-1 rounded-lg px-4 py-2.5 text-xs outline-none"
                                  style={{ background: "#070D18", border: "1px solid #1E3A5F", color: "#F0F4FF" }}
                                />
                                <button
                                  onClick={handleDeleteTeam}
                                  disabled={deleting || deleteConfirm !== team.name}
                                  className="rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-40 px-5 py-2 text-xs font-bold text-white transition-all flex items-center gap-1.5 justify-center select-none shadow"
                                >
                                  <Trash2 size={13} /> {deleting ? "Deleting..." : "Delete Team"}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <UploadModal
        isOpen={isUploadModalOpen}
        onClose={() => {
          setIsUploadModalOpen(false);
          fetchTeamDetails();
        }}
        teamId={teamId}
      />
    </div>
  );
}
