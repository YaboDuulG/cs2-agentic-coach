"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import {
  ArrowLeft, Server, ChevronRight, MapPin, Clock, AlertTriangle,
  Search, Crosshair, Shield, Zap, Target, Eye, BookOpen,
  RotateCcw, Dumbbell, Flame, Layers, Star
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TrainingMode {
  key: string;
  label: string;
  description: string;
  game_mode: string;
  image: string;
  icon: React.ElementType;
  tags: string[];
}

interface ServerInfo {
  id: string;
  status: string;
  ip_address: string | null;
  rcon_password: string;
  server_password: string;
  mode: string;
}

interface TrainingSessionRecord {
  id: string;
  mode: string;
  map_name: string;
  region: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
}

interface TrainingStats {
  sessions: TrainingSessionRecord[];
  total_sessions: number;
  total_seconds: number;
  favourite_mode: string | null;
  sessions_this_week: number;
}

// ---------------------------------------------------------------------------
// Training Mode Definitions
// ---------------------------------------------------------------------------
const TRAINING_MODES: TrainingMode[] = [
  {
    key: "defense",
    label: "Defense Mode",
    description: "Master angles, holds, and passive plays on each site.",
    game_mode: "competitive",
    image: "/training_defense.png",
    icon: Shield,
    tags: ["Positioning", "Holds"],
  },
  {
    key: "prefire",
    label: "Prefire Mode",
    description: "Pre-aim common spots and prefire every peek systematically.",
    game_mode: "competitive",
    image: "/training_prefire.png",
    icon: Crosshair,
    tags: ["Aim", "Timing"],
  },
  {
    key: "tradefire",
    label: "Tradefire Mode",
    description: "Drill trade mechanics — never let a teammate die unavenged.",
    game_mode: "deathmatch",
    image: "/training_tradefire.png",
    icon: Zap,
    tags: ["Teamwork", "Mechanics"],
  },
  {
    key: "spray",
    label: "Spray Transfer/Pattern Mode",
    description: "Perfect your spray control and inter-target transitions.",
    game_mode: "deathmatch",
    image: "/training_spray.png",
    icon: Layers,
    tags: ["Recoil", "Control"],
  },
  {
    key: "awp",
    label: "AWP Mode",
    description: "Sniper-only deathmatch to sharpen flick shots and positioning.",
    game_mode: "deathmatch",
    image: "/training_awp.png",
    icon: Eye,
    tags: ["Sniping", "Flicks"],
  },
  {
    key: "aimtrainer",
    label: "Aim Trainer",
    description: "Track and click bots to build raw aiming mechanics.",
    game_mode: "deathmatch",
    image: "/training_aimtrainer.png",
    icon: Target,
    tags: ["Aim", "Tracking"],
  },
  {
    key: "promode",
    label: "Pro Mode",
    description: "Full competitive rules — no cheats, real economy.",
    game_mode: "competitive",
    image: "/training_promode.png",
    icon: Star,
    tags: ["Competitive", "Economy"],
  },
  {
    key: "grenade",
    label: "Grenade Learner",
    description: "Visualize grenade trajectories and learn lineups on any map.",
    game_mode: "competitive",
    image: "/training_grenade.png",
    icon: Flame,
    tags: ["Utility", "Smokes"],
  },
  {
    key: "retake",
    label: "Retake Mode",
    description: "Post-plant retake scenarios — clutch or defuse.",
    game_mode: "competitive",
    image: "/training_retake.png",
    icon: RotateCcw,
    tags: ["Clutch", "Post-plant"],
  },
  {
    key: "practice",
    label: "Practice Mode",
    description: "Free-form practice with infinite ammo, cheats enabled.",
    game_mode: "competitive",
    image: "/training_practice.png",
    icon: Dumbbell,
    tags: ["Free", "Warmup"],
  },
];

const REGIONS = [
  { value: "dfw", label: "🇺🇸 Dallas (NA)" },
  { value: "fra", label: "🇩🇪 Frankfurt (EU)" },
  { value: "ord", label: "🇺🇸 Chicago (NA)" },
  { value: "sea", label: "🇺🇸 Seattle (NA)" },
  { value: "sgp", label: "🇸🇬 Singapore (APAC)" },
  { value: "syd", label: "🇦🇺 Sydney (OCE)" },
];

const MAPS: { value: string; label: string }[] = [
  { value: "de_dust2", label: "Dust2" },
  { value: "de_mirage", label: "Mirage" },
  { value: "de_inferno", label: "Inferno" },
  { value: "de_nuke", label: "Nuke" },
  { value: "de_overpass", label: "Overpass" },
  { value: "de_ancient", label: "Ancient" },
  { value: "de_anubis", label: "Anubis" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TrainingPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const router = useRouter();
  const { user, isLoaded } = useUser();

  const [search, setSearch] = useState("");
  const [selectedMode, setSelectedMode] = useState<string | null>(null);
  const [region, setRegion] = useState("dfw");
  const [map, setMap] = useState("de_dust2");
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updateWindowActive, setUpdateWindowActive] = useState(false);
  const [updateDetail, setUpdateDetail] = useState<string>("");
  const [server, setServer] = useState<ServerInfo | null>(null);
  const [loadingServer, setLoadingServer] = useState(true);
  const [copied, setCopied] = useState<"connect" | "pass" | null>(null);
  const [activeTab, setActiveTab] = useState<"modes" | "stats">("modes");
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Load current server + update window status
  const fetchStatus = useCallback(async () => {
    if (!isLoaded || !user) return;
    try {
      const [serverRes, modesRes] = await Promise.all([
        fetch(`/api/teams/${teamId}/servers`),
        fetch(`/api/servers/modes`),
      ]);
      const serverData = await serverRes.json().catch(() => []);
      const modesData = await modesRes.json().catch(() => ({}));

      const active = Array.isArray(serverData)
        ? serverData.find((s: ServerInfo) => s.status !== "terminated")
        : null;
      setServer(active || null);
      setUpdateWindowActive(modesData.update_window_active ?? false);
      setUpdateDetail(modesData.update_detail ?? "");
    } finally {
      setLoadingServer(false);
    }
  }, [teamId, isLoaded, user]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Load training stats when stats tab is opened
  useEffect(() => {
    if (activeTab !== "stats" || !isLoaded || !user) return;
    setLoadingStats(true);
    fetch(`/api/teams/${teamId}/training-sessions`)
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => setStats(null))
      .finally(() => setLoadingStats(false));
  }, [activeTab, teamId, isLoaded, user]);

  // Also auto-create a session record when server starts
  async function createSessionRecord(serverId: string) {
    try {
      await fetch(`/api/teams/${teamId}/training-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: serverId,
          mode: selectedMode || "practice",
          map_name: map,
          region,
        }),
      });
    } catch { /* non-critical */ }
  }

  // Filter modes by search
  const filteredModes = TRAINING_MODES.filter(
    (m) =>
      !search ||
      m.label.toLowerCase().includes(search.toLowerCase()) ||
      m.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
  );

  async function spinUpServer() {
    if (!selectedMode) return;
    setSpinning(true);
    setError(null);
    try {
      const res = await fetch(`/api/teams/${teamId}/servers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: selectedMode, region, map: map }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 503) {
          setError("⏳ " + (data.detail || "Servers unavailable during Valve maintenance window."));
        } else {
          setError(data.detail || "Failed to start server.");
        }
        return;
      }
      setServer(data);
      // Record the session
      if (data?.id) createSessionRecord(data.id);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSpinning(false);
    }
  }

  async function terminateServer() {
    if (!server) return;
    setSpinning(true);
    try {
      await fetch(`/api/servers/${server.id}`, { method: "DELETE" });
      setServer(null);
    } finally {
      setSpinning(false);
    }
  }

  function copyText(text: string, kind: "connect" | "pass") {
    navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 2000);
  }

  const activeMode = TRAINING_MODES.find((m) => m.key === selectedMode);

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#080E1A",
      color: "#F0F4FF",
      fontFamily: "var(--font-inter, Inter, sans-serif)",
    }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{
        backgroundColor: "#0D1825",
        borderBottom: "1px solid #1E3A5F",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        position: "sticky",
        top: 0,
        zIndex: 50,
      }}>
        <button
          onClick={() => router.push(`/teams/${teamId}`)}
          style={{
            background: "none",
            border: "none",
            color: "#8BA7CC",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "14px",
            padding: "4px 8px",
            borderRadius: "6px",
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>

        <div style={{ flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#F0F4FF" }}>
            Training Server
          </h1>
          <p style={{ margin: 0, fontSize: "13px", color: "#8BA7CC", marginTop: "2px" }}>
            Launch a unified training server with access to all training modes: Defense, Prefire, and Grenade practice.
          </p>
        </div>

        {/* Search */}
        <div style={{ position: "relative", width: "220px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#8BA7CC" }} />
          <input
            id="training-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              width: "100%",
              padding: "8px 8px 8px 32px",
              backgroundColor: "#142135",
              border: "1px solid #1E3A5F",
              borderRadius: "8px",
              color: "#F0F4FF",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>
      </div>

      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 24px 80px" }}>

        {/* ── Update Window Banner ─────────────────────────────── */}
        {updateWindowActive && (
          <div style={{
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            border: "1px solid rgba(245, 158, 11, 0.4)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
          }}>
            <AlertTriangle size={18} style={{ color: "#F59E0B", flexShrink: 0, marginTop: "1px" }} />
            <div>
              <div style={{ fontWeight: 600, color: "#F59E0B", fontSize: "14px" }}>CS2 Update In Progress</div>
              <div style={{ color: "#8BA7CC", fontSize: "13px", marginTop: "2px" }}>
                {updateDetail || "A CS2 update was recently released. Server provisioning is paused while DatHost applies the update (~2h window). Try again shortly."}
              </div>
            </div>
          </div>
        )}

        {/* ── Active Server Banner ─────────────────────────────── */}
        {server && (
          <div style={{
            backgroundColor: "rgba(34, 211, 160, 0.08)",
            border: "1px solid rgba(34, 211, 160, 0.3)",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  backgroundColor: "#22D3A0",
                  boxShadow: "0 0 8px rgba(34, 211, 160, 0.6)",
                  animation: "pulse 2s infinite",
                }} />
                <span style={{ fontWeight: 700, color: "#22D3A0", fontSize: "15px" }}>
                  Server Active — {TRAINING_MODES.find(m => m.key === server.mode)?.label || server.mode}
                </span>
              </div>
              <button
                id="terminate-server-btn"
                onClick={terminateServer}
                disabled={spinning}
                style={{
                  padding: "6px 14px",
                  backgroundColor: "rgba(255, 77, 109, 0.15)",
                  border: "1px solid rgba(255, 77, 109, 0.4)",
                  borderRadius: "6px",
                  color: "#FF4D6D",
                  fontSize: "13px",
                  cursor: spinning ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                Terminate
              </button>
            </div>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {server.ip_address && (
                <div style={{
                  backgroundColor: "#0D1825",
                  border: "1px solid #1E3A5F",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flex: 1,
                  minWidth: "200px",
                }}>
                  <Server size={14} style={{ color: "#5BA3E8" }} />
                  <span style={{ fontSize: "13px", color: "#8BA7CC" }}>connect</span>
                  <code style={{ fontSize: "13px", color: "#F0F4FF", flex: 1 }}>{server.ip_address}</code>
                  <button
                    onClick={() => copyText(`connect ${server.ip_address}; password ${server.server_password}`, "connect")}
                    style={{ background: "none", border: "none", color: copied === "connect" ? "#22D3A0" : "#8BA7CC", cursor: "pointer", fontSize: "12px" }}
                  >
                    {copied === "connect" ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              )}
              <div style={{
                backgroundColor: "#0D1825",
                border: "1px solid #1E3A5F",
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minWidth: "180px",
              }}>
                <span style={{ fontSize: "13px", color: "#8BA7CC" }}>Password</span>
                <code style={{ fontSize: "13px", color: "#F0F4FF" }}>{server.server_password}</code>
                <button
                  onClick={() => copyText(server.server_password, "pass")}
                  style={{ background: "none", border: "none", color: copied === "pass" ? "#22D3A0" : "#8BA7CC", cursor: "pointer", fontSize: "12px" }}
                >
                  {copied === "pass" ? "✓" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Launch Bar ───────────────────────────────────────── */}
        {!server && (
          <div style={{
            backgroundColor: "#0D1825",
            border: "1px solid #1E3A5F",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "24px",
            display: "flex",
            gap: "12px",
            alignItems: "center",
            flexWrap: "wrap",
          }}>
            {/* Mode display */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              backgroundColor: "#142135",
              border: "1px solid #1E3A5F",
              borderRadius: "8px",
              flex: "1",
              minWidth: "160px",
            }}>
              {activeMode ? (
                <>
                  <activeMode.icon size={14} style={{ color: "#2D7DD2" }} />
                  <span style={{ fontSize: "13px", color: "#F0F4FF" }}>{activeMode.label}</span>
                </>
              ) : (
                <span style={{ fontSize: "13px", color: "#8BA7CC" }}>← Select a mode below</span>
              )}
            </div>

            {/* Region */}
            <select
              id="region-select"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              style={{
                padding: "8px 12px",
                backgroundColor: "#142135",
                border: "1px solid #1E3A5F",
                borderRadius: "8px",
                color: "#F0F4FF",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {REGIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>

            {/* Map */}
            <select
              id="map-select"
              value={map}
              onChange={(e) => setMap(e.target.value)}
              style={{
                padding: "8px 12px",
                backgroundColor: "#142135",
                border: "1px solid #1E3A5F",
                borderRadius: "8px",
                color: "#F0F4FF",
                fontSize: "13px",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {MAPS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            {/* Start button */}
            <button
              id="start-training-btn"
              onClick={spinUpServer}
              disabled={!selectedMode || spinning || updateWindowActive}
              style={{
                padding: "10px 24px",
                backgroundColor: (!selectedMode || updateWindowActive) ? "#142135" : "#2D7DD2",
                border: (!selectedMode || updateWindowActive) ? "1px solid #1E3A5F" : "none",
                borderRadius: "8px",
                color: (!selectedMode || updateWindowActive) ? "#4A6A8A" : "#fff",
                fontSize: "14px",
                fontWeight: 700,
                cursor: (!selectedMode || spinning || updateWindowActive) ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                whiteSpace: "nowrap",
                transition: "all 0.2s",
                flex: "0 0 auto",
              }}
            >
              {spinning ? (
                <>
                  <div style={{ width: "14px", height: "14px", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  Starting...
                </>
              ) : (
                <>Start Training Session →</>
              )}
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div style={{
            backgroundColor: "rgba(255, 77, 109, 0.1)",
            border: "1px solid rgba(255, 77, 109, 0.3)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            color: "#FF4D6D",
            fontSize: "13px",
          }}>
            {error}
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid #1E3A5F", paddingBottom: "0" }}>
          {(["modes", "stats"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 16px",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #2D7DD2" : "2px solid transparent",
                color: activeTab === tab ? "#2D7DD2" : "#8BA7CC",
                fontSize: "14px",
                fontWeight: activeTab === tab ? 600 : 400,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginBottom: "-1px",
                textTransform: "capitalize",
              }}
            >
              {tab === "modes" ? <><Crosshair size={14} /> Training Modes</> : <><Target size={14} /> Statistics</>}
            </button>
          ))}
        </div>

        {/* ── Mode Grid ────────────────────────────────────────── */}
        {activeTab === "modes" && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "12px",
          }}>
            {filteredModes.map((mode) => {
              const isSelected = selectedMode === mode.key;
              const Icon = mode.icon;
              return (
                <button
                  key={mode.key}
                  id={`mode-card-${mode.key}`}
                  onClick={() => setSelectedMode(isSelected ? null : mode.key)}
                  style={{
                    position: "relative",
                    height: "160px",
                    borderRadius: "12px",
                    overflow: "hidden",
                    cursor: "pointer",
                    border: isSelected ? "2px solid #2D7DD2" : "2px solid transparent",
                    outline: "none",
                    textAlign: "left",
                    padding: 0,
                    background: "none",
                    transition: "border-color 0.2s, transform 0.15s",
                    transform: isSelected ? "scale(1.01)" : "scale(1)",
                    boxShadow: isSelected ? "0 0 24px rgba(45,125,210,0.35)" : "none",
                  }}
                >
                  {/* Background image */}
                  <Image
                    src={mode.image}
                    alt={mode.label}
                    fill
                    style={{ objectFit: "cover" }}
                    sizes="(max-width: 900px) 50vw, 420px"
                    priority={["defense", "prefire"].includes(mode.key)}
                  />

                  {/* Dark gradient overlay */}
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    background: isSelected
                      ? "linear-gradient(to top, rgba(4,20,50,0.92) 0%, rgba(4,20,50,0.5) 60%, rgba(45,125,210,0.08) 100%)"
                      : "linear-gradient(to top, rgba(8,14,26,0.92) 0%, rgba(8,14,26,0.55) 60%, transparent 100%)",
                    transition: "background 0.2s",
                  }} />

                  {/* Mode icon chip */}
                  <div style={{
                    position: "absolute",
                    top: "12px",
                    left: "12px",
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: isSelected ? "#2D7DD2" : "rgba(13,24,37,0.85)",
                    border: "1px solid " + (isSelected ? "#5BA3E8" : "rgba(30,58,95,0.8)"),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    backdropFilter: "blur(4px)",
                  }}>
                    <Icon size={15} style={{ color: isSelected ? "#fff" : "#5BA3E8" }} />
                  </div>

                  {/* Label + arrow */}
                  <div style={{
                    position: "absolute",
                    bottom: "12px",
                    left: "12px",
                    right: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}>
                    <div>
                      <div style={{
                        fontSize: "15px",
                        fontWeight: 700,
                        color: "#F0F4FF",
                        letterSpacing: "0.01em",
                        textShadow: "0 1px 4px rgba(0,0,0,0.8)",
                      }}>
                        {mode.label}
                      </div>
                      <div style={{ display: "flex", gap: "4px", marginTop: "4px", flexWrap: "wrap" }}>
                        {mode.tags.map((tag) => (
                          <span key={tag} style={{
                            fontSize: "10px",
                            padding: "2px 6px",
                            backgroundColor: "rgba(45,125,210,0.25)",
                            borderRadius: "4px",
                            color: "#5BA3E8",
                            border: "1px solid rgba(45,125,210,0.2)",
                          }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      backgroundColor: isSelected ? "#2D7DD2" : "rgba(30,58,95,0.6)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all 0.2s",
                      flexShrink: 0,
                    }}>
                      <ChevronRight size={14} style={{ color: "#fff" }} />
                    </div>
                  </div>

                  {/* Hover overlay */}
                  <div className="mode-hover-overlay" style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(45,125,210,0)",
                    transition: "background-color 0.2s",
                    pointerEvents: "none",
                  }} />
                </button>
              );
            })}
          </div>
        )}

        {/* ── Statistics Tab ───────────────────────────────────── */}
        {activeTab === "stats" && (
          <div>
            {loadingStats ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#4A6A8A" }}>Loading stats…</div>
            ) : !stats || stats.total_sessions === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "#4A6A8A" }}>
                <Target size={40} style={{ marginBottom: "16px", opacity: 0.4 }} />
                <div style={{ fontSize: "16px", fontWeight: 600, color: "#8BA7CC" }}>No sessions yet</div>
                <div style={{ fontSize: "13px", marginTop: "8px" }}>Start your first training session to see stats here.</div>
              </div>
            ) : (
              <div>
                {/* Aggregate cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "24px" }}>
                  {[
                    { label: "Total Sessions", value: stats.total_sessions.toString(), icon: "🎯" },
                    { label: "Total Hours", value: (stats.total_seconds / 3600).toFixed(1) + "h", icon: "⏱️" },
                    { label: "This Week", value: stats.sessions_this_week.toString(), icon: "📅" },
                    { label: "Favourite Mode", value: stats.favourite_mode
                      ? (TRAINING_MODES.find(m => m.key === stats.favourite_mode)?.label ?? stats.favourite_mode)
                      : "—", icon: "⭐" },
                  ].map(({ label, value, icon }) => (
                    <div key={label} style={{
                      backgroundColor: "#0D1825",
                      border: "1px solid #1E3A5F",
                      borderRadius: "10px",
                      padding: "14px 16px",
                    }}>
                      <div style={{ fontSize: "20px", marginBottom: "6px" }}>{icon}</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "#F0F4FF" }}>{value}</div>
                      <div style={{ fontSize: "11px", color: "#8BA7CC", marginTop: "2px" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Session history table */}
                <div style={{ backgroundColor: "#0D1825", border: "1px solid #1E3A5F", borderRadius: "10px", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid #1E3A5F", fontSize: "13px", fontWeight: 600, color: "#8BA7CC" }}>Session History</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid #1E3A5F" }}>
                          {["Mode", "Map", "Region", "Date", "Duration"].map(h => (
                            <th key={h} style={{ padding: "8px 16px", textAlign: "left", color: "#4A6A8A", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.sessions.slice(0, 20).map((s) => (
                          <tr key={s.id} style={{ borderBottom: "1px solid rgba(30,58,95,0.4)" }}>
                            <td style={{ padding: "10px 16px", color: "#F0F4FF" }}>
                              {TRAINING_MODES.find(m => m.key === s.mode)?.label ?? s.mode}
                            </td>
                            <td style={{ padding: "10px 16px", color: "#8BA7CC", fontFamily: "monospace" }}>{s.map_name}</td>
                            <td style={{ padding: "10px 16px", color: "#8BA7CC" }}>{s.region.toUpperCase()}</td>
                            <td style={{ padding: "10px 16px", color: "#8BA7CC", whiteSpace: "nowrap" }}>
                              {new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td style={{ padding: "10px 16px", color: s.duration_seconds ? "#22D3A0" : "#4A6A8A" }}>
                              {s.duration_seconds
                                ? `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      </div>

      {/* ── Global Styles ─────────────────────────────────────── */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        button[id^="mode-card-"]:hover .mode-hover-overlay {
          background-color: rgba(45, 125, 210, 0.06) !important;
        }
        select option { background: #142135; }
        input::placeholder { color: #4A6A8A; }
      `}</style>
    </div>
  );
}
