"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Image from "next/image";
import {
  ArrowLeft, Server, ChevronRight, AlertTriangle,
  Search, Crosshair, Shield, Zap, Target, Eye,
  RotateCcw, Dumbbell, Flame, Layers, Star
} from "lucide-react";
import { PageSection, PageTransition } from "@/components/ui";

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
  job_id?: string | null;
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
  const [, setLoadingServer] = useState(true);
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
      backgroundColor: "var(--color-bg-primary)",
      color: "var(--color-text-primary)",
      fontFamily: "var(--font-inter, Inter, sans-serif)",
    }}>
    <PageTransition>

      {/* ── Header — standard skeleton: eyebrow · display title · one-liner ── */}
      <PageSection className="sticky top-0 z-50 flex items-center gap-4 border-b bg-[var(--color-bg-secondary)] border-[var(--color-border-primary)] px-6 py-4">
        <button
          onClick={() => router.push(`/teams/${teamId}`)}
          style={{
            background: "none",
            border: "none",
            color: "var(--color-text-secondary)",
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
          <span
            className="block text-[10px] font-bold uppercase tracking-[0.2em]"
            style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-secondary)" }}
          >
            Team training
          </span>
          <h1 className="section-heading" style={{ margin: 0, fontSize: "1.15rem" }}>
            Training server
          </h1>
          <p style={{ margin: 0, fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "2px" }}>
            Spin up a server for any training mode — defense, prefire, grenades, and more.
          </p>
        </div>

        {/* Search */}
        <div style={{ position: "relative", width: "220px" }}>
          <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-secondary)" }} />
          <input
            id="training-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            style={{
              width: "100%",
              padding: "8px 8px 8px 32px",
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "8px",
              color: "var(--color-text-primary)",
              fontSize: "13px",
              outline: "none",
            }}
          />
        </div>
      </PageSection>

      <PageSection>
      <div style={{ maxWidth: "900px", margin: "0 auto", padding: "24px 24px 80px" }}>

        {/* ── Update Window Banner ─────────────────────────────── */}
        {updateWindowActive && (
          <div style={{
            backgroundColor: "color-mix(in srgb, var(--color-warning) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-warning) 40%, transparent)",
            borderRadius: "10px",
            padding: "12px 16px",
            marginBottom: "20px",
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
          }}>
            <AlertTriangle size={18} style={{ color: "var(--color-warning)", flexShrink: 0, marginTop: "1px" }} />
            <div>
              <div style={{ fontWeight: 600, color: "var(--color-warning)", fontSize: "14px" }}>CS2 Update In Progress</div>
              <div style={{ color: "var(--color-text-secondary)", fontSize: "13px", marginTop: "2px" }}>
                {updateDetail || "A CS2 update was recently released. Server provisioning is paused while DatHost applies the update (~2h window). Try again shortly."}
              </div>
            </div>
          </div>
        )}

        {/* ── Active Server Banner ─────────────────────────────── */}
        {server && (
          <div style={{
            backgroundColor: "color-mix(in srgb, var(--color-success) 8%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-success) 30%, transparent)",
            borderRadius: "12px",
            padding: "16px 20px",
            marginBottom: "20px",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "8px", height: "8px", borderRadius: "50%",
                  backgroundColor: "var(--color-success)",
                  boxShadow: "0 0 8px color-mix(in srgb, var(--color-success) 60%, transparent)",
                  animation: "pulse 2s infinite",
                }} />
                <span style={{ fontWeight: 700, color: "var(--color-success)", fontSize: "15px" }}>
                  Server Active — {TRAINING_MODES.find(m => m.key === server.mode)?.label || server.mode}
                </span>
              </div>
              <button
                id="terminate-server-btn"
                onClick={terminateServer}
                disabled={spinning}
                style={{
                  padding: "6px 14px",
                  backgroundColor: "color-mix(in srgb, var(--color-danger) 15%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--color-danger) 40%, transparent)",
                  borderRadius: "6px",
                  color: "var(--color-danger)",
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
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border-primary)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  flex: 1,
                  minWidth: "200px",
                }}>
                  <Server size={14} style={{ color: "var(--color-accent-electric)" }} />
                  <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>connect</span>
                  <code style={{ fontSize: "13px", color: "var(--color-text-primary)", flex: 1 }}>{server.ip_address}</code>
                  <button
                    onClick={() => copyText(`connect ${server.ip_address}; password ${server.server_password}`, "connect")}
                    style={{ background: "none", border: "none", color: copied === "connect" ? "var(--color-success)" : "var(--color-text-secondary)", cursor: "pointer", fontSize: "12px" }}
                  >
                    {copied === "connect" ? "✓ Copied" : "Copy"}
                  </button>
                </div>
              )}
              <div style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                minWidth: "180px",
              }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Password</span>
                <code style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{server.server_password}</code>
                <button
                  onClick={() => copyText(server.server_password, "pass")}
                  style={{ background: "none", border: "none", color: copied === "pass" ? "var(--color-success)" : "var(--color-text-secondary)", cursor: "pointer", fontSize: "12px" }}
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
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border-primary)",
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
              backgroundColor: "var(--color-bg-secondary)",
              border: "1px solid var(--color-border-primary)",
              borderRadius: "8px",
              flex: "1",
              minWidth: "160px",
            }}>
              {activeMode ? (
                <>
                  {/* @ts-expect-error - LucideIcon expects size but TS inference fails here */}
                  <activeMode.icon size={14} style={{ color: "var(--color-accent-primary)" }} />
                  <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{activeMode.label}</span>
                </>
              ) : (
                <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>← Select a mode below</span>
              )}
            </div>

            {/* Region */}
            <select
              id="region-select"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              style={{
                padding: "8px 12px",
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "8px",
                color: "var(--color-text-primary)",
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
                backgroundColor: "var(--color-bg-secondary)",
                border: "1px solid var(--color-border-primary)",
                borderRadius: "8px",
                color: "var(--color-text-primary)",
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
                backgroundColor: (!selectedMode || updateWindowActive) ? "var(--color-bg-secondary)" : "var(--color-accent-primary)",
                border: (!selectedMode || updateWindowActive) ? "1px solid var(--color-border-primary)" : "none",
                borderRadius: "8px",
                color: (!selectedMode || updateWindowActive) ? "var(--color-text-muted)" : "#fff",
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
            backgroundColor: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "16px",
            color: "var(--color-danger)",
            fontSize: "13px",
          }}>
            {error}
          </div>
        )}

        {/* ── Tabs ─────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "20px", borderBottom: "1px solid var(--color-border-primary)", paddingBottom: "0" }}>
          {(["modes", "stats"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setActiveTab(tab);
                if (tab === "stats") {
                  setLoadingStats(true);
                }
              }}
              style={{
                padding: "10px 16px",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
                color: activeTab === tab ? "var(--color-accent-primary)" : "var(--color-text-secondary)",
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
                    border: isSelected ? "2px solid var(--color-accent-primary)" : "2px solid transparent",
                    outline: "none",
                    textAlign: "left",
                    padding: 0,
                    background: "none",
                    transition: "border-color 0.2s, transform 0.15s",
                    transform: isSelected ? "scale(1.01)" : "scale(1)",
                    boxShadow: isSelected ? "0 0 24px color-mix(in srgb, var(--color-accent-primary) 35%, transparent)" : "none",
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
                      ? "linear-gradient(to top, color-mix(in srgb, var(--color-bg-secondary) 92%, transparent) 0%, color-mix(in srgb, var(--color-bg-secondary) 50%, transparent) 60%, color-mix(in srgb, var(--color-accent-primary) 8%, transparent) 100%)"
                      : "linear-gradient(to top, color-mix(in srgb, var(--color-bg-primary) 92%, transparent) 0%, color-mix(in srgb, var(--color-bg-primary) 55%, transparent) 60%, transparent 100%)",
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
                    backgroundColor: isSelected ? "var(--color-accent-primary)" : "color-mix(in srgb, var(--color-bg-secondary) 85%, transparent)",
                    border: "1px solid " + (isSelected ? "var(--color-accent-electric)" : "var(--color-border-strong)"),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.2s",
                    backdropFilter: "blur(4px)",
                  }}>
                    {/* @ts-expect-error - LucideIcon expects size but TS inference fails here */}
                    <Icon size={15} style={{ color: isSelected ? "#fff" : "var(--color-accent-electric)" }} />
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
                        color: "var(--color-text-primary)",
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
                            backgroundColor: "color-mix(in srgb, var(--color-accent-primary) 25%, transparent)",
                            borderRadius: "4px",
                            color: "var(--color-accent-electric)",
                            border: "1px solid color-mix(in srgb, var(--color-accent-primary) 20%, transparent)",
                          }}>{tag}</span>
                        ))}
                      </div>
                    </div>
                    <div style={{
                      width: "28px",
                      height: "28px",
                      borderRadius: "50%",
                      backgroundColor: isSelected ? "var(--color-accent-primary)" : "color-mix(in srgb, var(--color-bg-secondary) 60%, transparent)",
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
                    backgroundColor: "transparent",
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
              <div style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>Loading stats…</div>
            ) : !stats || stats.total_sessions === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--color-text-muted)" }}>
                <Target size={40} style={{ marginBottom: "16px", opacity: 0.4 }} />
                <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-text-secondary)" }}>No sessions yet</div>
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
                      backgroundColor: "var(--color-bg-card)",
                      border: "1px solid var(--color-border-primary)",
                      borderRadius: "10px",
                      padding: "14px 16px",
                    }}>
                      <div style={{ fontSize: "20px", marginBottom: "6px" }}>{icon}</div>
                      <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-text-primary)" }}>{value}</div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Session history table */}
                <div style={{ backgroundColor: "var(--color-bg-card)", border: "1px solid var(--color-border-primary)", borderRadius: "10px", overflow: "hidden" }}>
                  <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border-primary)", fontSize: "13px", fontWeight: 600, color: "var(--color-text-secondary)" }}>Session History</div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "1px solid var(--color-border-primary)" }}>
                          {["Mode", "Map", "Region", "Date", "Duration", "Analysis"].map(h => (
                            <th key={h} style={{ padding: "8px 16px", textAlign: "left", color: "var(--color-text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.sessions.slice(0, 20).map((s) => (
                          <tr key={s.id} style={{ borderBottom: "1px solid var(--color-border-primary)" }}>
                            <td style={{ padding: "10px 16px", color: "var(--color-text-primary)" }}>
                              {TRAINING_MODES.find(m => m.key === s.mode)?.label ?? s.mode}
                            </td>
                            <td style={{ padding: "10px 16px", color: "var(--color-text-secondary)", fontFamily: "monospace" }}>{s.map_name}</td>
                            <td style={{ padding: "10px 16px", color: "var(--color-text-secondary)" }}>{s.region.toUpperCase()}</td>
                            <td style={{ padding: "10px 16px", color: "var(--color-text-secondary)", whiteSpace: "nowrap" }}>
                              {new Date(s.started_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td style={{ padding: "10px 16px", color: s.duration_seconds ? "var(--color-success)" : "var(--color-text-muted)" }}>
                              {s.duration_seconds
                                ? `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`
                                : "—"}
                            </td>
                            <td style={{ padding: "10px 16px" }}>
                              {s.job_id ? (
                                <button
                                  onClick={() => router.push(`/analysis/${s.job_id}`)}
                                  style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--color-accent-primary)",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontWeight: 600,
                                    textDecoration: "underline",
                                    fontFamily: "inherit",
                                    fontSize: "inherit",
                                  }}
                                >
                                  View Analysis
                                </button>
                              ) : (
                                <span style={{ color: "var(--color-text-muted)" }}>—</span>
                              )}
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
      </PageSection>
    </PageTransition>

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
          background-color: color-mix(in srgb, var(--color-accent-primary) 6%, transparent) !important;
        }
        select option { background: var(--color-bg-secondary); }
        input::placeholder { color: var(--color-text-muted); }
      `}</style>
    </div>
  );
}
