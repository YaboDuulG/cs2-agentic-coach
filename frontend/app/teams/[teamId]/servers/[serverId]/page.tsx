/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { 
  ArrowLeft, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  RefreshCw, 
  Power, 
  Settings as SettingsIcon, 
  FileCode, 
  Folder, 
  Shield, 
  Info, 
  AlertTriangle,
  Play,
  CheckCircle,
  HelpCircle
} from "lucide-react";
import { CloudMotifBg } from "@/components/patterns/mongolian";

interface PracticeServer {
  id: string;
  status: string;
  ip_address: string | null;
  rcon_password: string;
  server_password: string;
  mode: string;
  created_at: string;
  expires_at: string;
}

interface TeamDetail {
  team_id: string;
  name: string;
  invite_code: string;
  owner_user_id: string;
}

const LOCATIONS = [
  { id: "ord", name: "Chicago", code: "ord", ping: "4 ms", flag: "🇺🇸" },
  { id: "dfw", name: "Dallas", code: "dfw", ping: "12 ms", flag: "🇺🇸" },
  { id: "fra", name: "Frankfurt", code: "fra", ping: "78 ms", flag: "🇩🇪" },
  { id: "lhr", name: "London", code: "lhr", ping: "84 ms", flag: "🇬🇧" },
  { id: "sgp", name: "Singapore", code: "sgp", ping: "210 ms", flag: "🇸🇬" },
];

const MAPS = [
  { id: "de_mirage", name: "Mirage" },
  { id: "de_dust2", name: "Dust II" },
  { id: "de_inferno", name: "Inferno" },
  { id: "de_nuke", name: "Nuke" },
  { id: "de_overpass", name: "Overpass" },
  { id: "de_ancient", name: "Ancient" },
  { id: "de_anubis", name: "Anubis" },
  { id: "de_vertigo", name: "Vertigo" },
];

export default function ServerDashboardPage() {
  const { teamId, serverId } = useParams<{ teamId: string; serverId: string }>();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [server, setServer] = useState<PracticeServer | null>(null);
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"settings" | "configs">("settings");

  const handleTabChange = (tab: "settings" | "configs") => {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    if (typeof document !== "undefined" && (document as any).startViewTransition) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      (document as any).startViewTransition(() => {
        setActiveTab(tab);
      });
    } else {
      setActiveTab(tab);
    }
  };

  // Server state settings (localStorage persistent)
  const [serverMap, setServerMap] = useState("de_mirage");
  const [serverLocation, setServerLocation] = useState("ord");
  const [gameMode, setGameMode] = useState("scrim_practice");
  const [serverName, setServerName] = useState("");
  const [fakeRcon, setFakeRcon] = useState("rconconfig");
  const [serverPassword, setServerPassword] = useState("haeha4");
  const [privateServer, setPrivateServer] = useState(true);
  const [skinPlugin, setSkinPlugin] = useState(true);
  const [autoUpdates, setAutoUpdates] = useState(true);
  const [updateTime, setUpdateTime] = useState("04:00");

  // UI States
  const [showGameIp, setShowGameIp] = useState(false);
  const [showGotvIp, setShowGotvIp] = useState(false);
  const [copiedGame, setCopiedGame] = useState(false);
  const [copiedGotv, setCopiedGotv] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  
  // Power states
  const [isRebooting, setIsRebooting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Dropdown UI
  const [mapOpen, setMapOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);

  useEffect(() => {
    if (!isLoaded || !user) return;

    // Fetch team details and server details
    Promise.all([
      fetch(`/api/teams/${teamId}`).then(r => r.json().catch(() => null)),
      fetch(`/api/teams/${teamId}/servers`).then(r => r.json().catch(() => [])),
    ]).then(([teamData, serversData]) => {
      if (teamData) {
        setTeam(teamData);
      }
      
      const activeServer = Array.isArray(serversData) 
        ? serversData.find((s: PracticeServer) => s.id === serverId) 
        : null;
      
      if (activeServer) {
        setServer(activeServer);
        
        // Retrieve local configurations
        const savedMap = localStorage.getItem(`server_map_${serverId}`);
        const savedLoc = localStorage.getItem(`server_loc_${serverId}`);
        const savedMode = localStorage.getItem(`server_mode_${serverId}`);
        const savedName = localStorage.getItem(`server_name_${serverId}`);
        const savedRcon = localStorage.getItem(`server_rcon_${serverId}`);
        const savedPass = localStorage.getItem(`server_pass_${serverId}`);
        const savedPrivate = localStorage.getItem(`server_private_${serverId}`);
        const savedSkin = localStorage.getItem(`server_skin_${serverId}`);
        const savedAuto = localStorage.getItem(`server_auto_${serverId}`);
        const savedTime = localStorage.getItem(`server_time_${serverId}`);

        if (savedMap) setServerMap(savedMap);
        if (savedLoc) setServerLocation(savedLoc);
        if (savedMode) setGameMode(savedMode);
        if (savedName) setServerName(savedName);
        else setServerName(`${teamData?.name || "Team"}'s Server`);
        if (savedRcon) setFakeRcon(savedRcon);
        if (savedPass) setServerPassword(savedPass);
        else setServerPassword(activeServer.server_password);
        if (savedPrivate) setPrivateServer(savedPrivate === "true");
        if (savedSkin) setSkinPlugin(savedSkin === "true");
        if (savedAuto) setAutoUpdates(savedAuto === "true");
        if (savedTime) setUpdateTime(savedTime);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [teamId, serverId, user, isLoaded]);

  // Status polling if server is booting or rebooting
  useEffect(() => {
    if (!user || !server || (server.status !== "booting" && !isRebooting)) return;

    const interval = setInterval(() => {
      fetch(`/api/teams/${teamId}/servers`)
        .then(r => r.json().catch(() => []))
        .then(data => {
          if (Array.isArray(data)) {
            const current = data.find((s: PracticeServer) => s.id === serverId);
            if (current) {
              setServer(current);
              if (current.status === "active") {
                setIsRebooting(false);
              }
            }
          }
        })
        .catch(console.error);
    }, 5000);

    return () => clearInterval(interval);
  }, [teamId, serverId, user, server, isRebooting]);

  if (!isLoaded) return null;
  if (!user) { router.push("/sign-in"); return null; }

  const getGotvIp = (ip: string | null) => {
    if (!ip) return "";
    const parts = ip.split(":");
    if (parts.length === 2) {
      const port = parseInt(parts[1]);
      return `${parts[0]}:${port + 15}`;
    }
    return `${ip} (GOTV)`;
  };

  const copyToClipboard = (text: string, type: "game" | "gotv" | string) => {
    navigator.clipboard.writeText(text);
    if (type === "game") {
      setCopiedGame(true);
      setTimeout(() => setCopiedGame(false), 2000);
    } else if (type === "gotv") {
      setCopiedGotv(true);
      setTimeout(() => setCopiedGotv(false), 2000);
    } else {
      setCopiedCmd(type);
      setTimeout(() => setCopiedCmd(null), 1500);
    }
  };

  const handleStopServer = async () => {
    if (!server) return;
    setIsStopping(true);
    setServerError(null);
    try {
      const res = await fetch(`/api/servers/${server.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setServer(prev => prev ? { ...prev, status: "terminated" } : null);
        router.push(`/teams/${teamId}`);
      } else {
        const err = await res.json().catch(() => ({ detail: "Failed to terminate server." }));
        setServerError(err.detail || "Failed to terminate server.");
        setIsStopping(false);
      }
    } catch (e) {
      console.error(e);
      setServerError("An error occurred during server termination.");
      setIsStopping(false);
    }
  };

  const handleReboot = () => {
    setIsRebooting(true);
    setServer(prev => prev ? { ...prev, status: "booting" } : null);
    setTimeout(() => {
      // Mock reboot transition completes if offline, or state handles it
    }, 10000);
  };

  const handleSaveChanges = () => {
    setIsSaving(true);
    setSaveStatus("saving");
    
    // Save to localStorage
    localStorage.setItem(`server_map_${serverId}`, serverMap);
    localStorage.setItem(`server_loc_${serverId}`, serverLocation);
    localStorage.setItem(`server_mode_${serverId}`, gameMode);
    localStorage.setItem(`server_name_${serverId}`, serverName);
    localStorage.setItem(`server_rcon_${serverId}`, fakeRcon);
    localStorage.setItem(`server_pass_${serverId}`, serverPassword);
    localStorage.setItem(`server_private_${serverId}`, String(privateServer));
    localStorage.setItem(`server_skin_${serverId}`, String(skinPlugin));
    localStorage.setItem(`server_auto_${serverId}`, String(autoUpdates));
    localStorage.setItem(`server_time_${serverId}`, updateTime);

    setTimeout(() => {
      setIsSaving(false);
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }, 1200);
  };

  // Commands helper list
  const PRACTICE_COMMANDS = [
    { cmd: ".setup", desc: "Launches the practice mode layout, configs, and cheats." },
    { cmd: ".noclip", desc: "Toggles fly mode to float and check utility landings." },
    { cmd: ".grenade", desc: "Provides full utility grenade smoke/flash/molotov packs." },
    { cmd: ".rethrow", desc: "Rethrows your last grenade to check line-of-sight flash blinds." },
    { cmd: ".clear", desc: "Clears active smoke cloud states and molotov fire layers immediately." },
    { cmd: ".bot", desc: "Spawns a target training bot at your current crosshair point." },
    { cmd: ".kick", desc: "Kicks all training bots from the practice server." },
    { cmd: ".spawn", desc: "Teleports your player directly back to your team spawn point." },
  ];

  const activeLoc = LOCATIONS.find(l => l.id === serverLocation) || LOCATIONS[0];
  const activeMap = MAPS.find(m => m.id === serverMap) || MAPS[0];

  return (
    <div className="min-h-screen px-6 py-12" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-5xl mx-auto">
        
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 mb-6 text-xs" style={{ color: "#4A6A8A" }}>
          <Link href="/teams" className="hover:text-white transition-colors">All Teams</Link>
          <span>/</span>
          {team && (
            <Link href={`/teams/${teamId}`} className="hover:text-white transition-colors">
              {team.name}
            </Link>
          )}
          <span>/</span>
          <span className="text-[#8BA7CC]">Server Manager</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 gap-3">
            <div className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
            <span style={{ color: "#8BA7CC" }} className="text-sm font-semibold">Retrieving server profile…</span>
          </div>
        ) : !server || server.status === "terminated" ? (
          <div className="card p-10 text-center border-rose-500/20 bg-rose-500/5 max-w-md mx-auto mt-10">
            <AlertTriangle className="text-rose-500 mx-auto mb-4" size={40} />
            <h2 className="text-lg font-bold text-white mb-2">Server Offline</h2>
            <p className="text-sm text-[#8BA7CC] mb-6">
              This practice server has been terminated or does not exist.
            </p>
            <Link 
              href={`/teams/${teamId}`} 
              className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded bg-white/5 hover:bg-white/10 text-white transition-all border border-white/10"
            >
              <ArrowLeft size={14} /> Back to Team
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            
            {/* Dashboard Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-xl border border-white/10" style={{ background: "rgba(13,24,37,0.4)", backdropFilter: "blur(8px)" }}>
              <div className="flex items-start gap-4">
                <div className="p-3.5 rounded-lg bg-[#2D7DD2]/10 border border-[#2D7DD2]/25 text-[#2D7DD2]">
                  <Shield size={28} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-black text-white tracking-wide uppercase">
                      {serverName || "Zealous's server"}
                    </h1>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                      server.status === "active" 
                        ? "bg-[#22D3A0]/15 text-[#22D3A0] border border-[#22D3A0]/20" 
                        : "bg-yellow-500/15 text-yellow-500 border border-yellow-500/20"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${server.status === "active" ? "bg-[#22D3A0]" : "bg-yellow-500"} animate-pulse`} />
                      Server {server.status === "active" ? "On" : "Booting"}
                    </span>
                  </div>
                  <p className="text-xs text-[#8BA7CC] mt-1 leading-relaxed max-w-xl">
                    Configure, manage, and monitor your team&apos;s on-demand practice server with real-time settings and configs.
                  </p>
                </div>
              </div>

              {/* Power Controls */}
              <div className="flex items-center gap-2 self-end md:self-center">
                <button
                  onClick={handleReboot}
                  disabled={isRebooting || isStopping || server.status !== "active"}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider border transition-all duration-200 ${
                    isRebooting 
                      ? "bg-yellow-500/10 border-yellow-500/30 text-yellow-500 cursor-not-allowed"
                      : "border-[#C9A227]/30 hover:bg-[#C9A227]/10 text-[#C9A227] disabled:opacity-40 disabled:cursor-not-allowed"
                  }`}
                >
                  <RefreshCw size={14} className={isRebooting ? "animate-spin" : ""} />
                  {isRebooting ? "Rebooting..." : "Reboot"}
                </button>
                <button
                  onClick={handleStopServer}
                  disabled={isStopping || isRebooting}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded text-xs font-bold uppercase tracking-wider border border-rose-500/30 hover:bg-rose-500/10 text-rose-500 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Power size={14} className={isStopping ? "animate-pulse" : ""} />
                  {isStopping ? "Stopping..." : "Stop"}
                </button>
              </div>
            </div>

            {/* Error notifications */}
            {serverError && (
              <div className="p-3.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-semibold">
                {serverError}
              </div>
            )}

            {/* Stats Overview Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Game IP Card */}
              <div className="card p-5 flex flex-col justify-between">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xs font-bold text-[#8BA7CC] uppercase tracking-wider">IP Address</h3>
                    <p className="text-[10px] text-[#4A6A8A] uppercase mt-0.5">Game Server Connect</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button 
                      onClick={() => setShowGameIp(!showGameIp)} 
                      className="p-1.5 rounded hover:bg-white/5 text-[#8BA7CC] hover:text-white transition-colors"
                      title={showGameIp ? "Hide IP" : "Show IP"}
                    >
                      {showGameIp ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    {server.ip_address && (
                      <button 
                        onClick={() => copyToClipboard(`connect ${server.ip_address}; password ${serverPassword}`, "game")} 
                        className="p-1.5 rounded hover:bg-white/5 text-[#8BA7CC] hover:text-white transition-colors relative"
                        title="Copy command"
                      >
                        {copiedGame ? <Check size={14} className="text-[#22D3A0]" /> : <Copy size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="bg-black/30 px-3 py-3 rounded-lg border border-white/5 font-mono text-xs text-white overflow-hidden text-ellipsis whitespace-nowrap">
                  {server.ip_address ? (
                    showGameIp ? `connect ${server.ip_address}; password ${serverPassword}` : `connect •••••••••••••••••; password ••••••`
                  ) : (
                    <span className="italic text-[#4A6A8A]">Provisioning IP...</span>
                  )}
                </div>
              </div>

              {/* GOTV IP Card */}
              <div className="card p-5 flex flex-col justify-between">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xs font-bold text-[#8BA7CC] uppercase tracking-wider">GOTV IP</h3>
                    <p className="text-[10px] text-[#4A6A8A] uppercase mt-0.5">Spectator GOTV Link</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button 
                      onClick={() => setShowGotvIp(!showGotvIp)} 
                      className="p-1.5 rounded hover:bg-white/5 text-[#8BA7CC] hover:text-white transition-colors"
                      title={showGotvIp ? "Hide GOTV" : "Show GOTV"}
                    >
                      {showGotvIp ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    {server.ip_address && (
                      <button 
                        onClick={() => copyToClipboard(`connect ${getGotvIp(server.ip_address)}`, "gotv")} 
                        className="p-1.5 rounded hover:bg-white/5 text-[#8BA7CC] hover:text-white transition-colors"
                        title="Copy GOTV command"
                      >
                        {copiedGotv ? <Check size={14} className="text-[#22D3A0]" /> : <Copy size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="bg-black/30 px-3 py-3 rounded-lg border border-white/5 font-mono text-xs text-white overflow-hidden text-ellipsis whitespace-nowrap">
                  {server.ip_address ? (
                    showGotvIp ? `connect ${getGotvIp(server.ip_address)}` : `connect •••••••••••••••••`
                  ) : (
                    <span className="italic text-[#4A6A8A]">Provisioning GOTV...</span>
                  )}
                </div>
              </div>

              {/* Players Online Card */}
              <div className="card p-5 flex flex-col justify-between">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xs font-bold text-[#8BA7CC] uppercase tracking-wider">Players Online</h3>
                    <p className="text-[10px] text-[#4A6A8A] uppercase mt-0.5">Active connections</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-white/5 text-[#8BA7CC] border border-white/10">
                    Stable
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <div className="text-2xl font-black text-white tracking-tight">
                    0 <span className="text-sm font-bold text-[#4A6A8A]">/ 14</span>
                  </div>
                  <div className="text-[10px] text-[#22D3A0] font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#22D3A0] animate-ping" />
                    Latency: {activeLoc.ping}
                  </div>
                </div>
              </div>

            </div>

            {/* Tabs Toggle (Settings vs Configs) */}
            <div className="flex border-b border-white/10">
              <button
                onClick={() => handleTabChange("settings")}
                className={`flex items-center gap-2 px-6 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  activeTab === "settings"
                    ? "border-[#2D7DD2] text-[#2D7DD2]"
                    : "border-transparent text-[#8BA7CC] hover:text-white"
                }`}
              >
                <SettingsIcon size={14} />
                Settings
              </button>
              <button
                onClick={() => handleTabChange("configs")}
                className={`flex items-center gap-2 px-6 py-3.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                  activeTab === "configs"
                    ? "border-[#2D7DD2] text-[#2D7DD2]"
                    : "border-transparent text-[#8BA7CC] hover:text-white"
                }`}
              >
                <FileCode size={14} />
                Configs & Commands
              </button>
            </div>

            {/* TAB CONTENT */}
            <div style={{ viewTransitionName: "tab-content" } as React.CSSProperties}>
              {activeTab === "settings" ? (
                <div className="space-y-6">
                
                {/* Map, Location, Game Mode selector card */}
                <div className="card p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* Map Selector */}
                  <div className="relative">
                    <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider mb-2">Map</label>
                    <button
                      onClick={() => setMapOpen(!mapOpen)}
                      className="w-full flex items-center justify-between bg-[#0F172A] border border-white/10 rounded-lg px-4 py-3 text-sm text-white hover:border-[#2D7DD2] transition-colors"
                    >
                      <span className="font-semibold">{activeMap.name}</span>
                      <span className="text-xs text-[#8BA7CC]">▼</span>
                    </button>
                    {mapOpen && (
                      <div className="absolute left-0 right-0 mt-1.5 z-20 rounded-lg border border-white/10 bg-[#0F172A] shadow-xl overflow-hidden max-h-60 overflow-y-auto">
                        {MAPS.map(m => (
                          <button
                            key={m.id}
                            onClick={() => { setServerMap(m.id); setMapOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 ${
                              serverMap === m.id ? "text-[#2D7DD2] bg-[#2D7DD2]/5 font-bold" : "text-slate-300"
                            }`}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Location Selector */}
                  <div className="relative">
                    <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider mb-2">Server Location</label>
                    <button
                      onClick={() => setLocOpen(!locOpen)}
                      className="w-full flex items-center justify-between bg-[#0F172A] border border-white/10 rounded-lg px-4 py-3 text-sm text-white hover:border-[#2D7DD2] transition-colors"
                    >
                      <span className="font-semibold flex items-center gap-1.5">
                        <span className="text-base">{activeLoc.flag}</span>
                        {activeLoc.name} <span className="text-xs text-[#22D3A0]">• {activeLoc.ping}</span>
                      </span>
                      <span className="text-xs text-[#8BA7CC]">▼</span>
                    </button>
                    {locOpen && (
                      <div className="absolute left-0 right-0 mt-1.5 z-20 rounded-lg border border-white/10 bg-[#0F172A] shadow-xl overflow-hidden">
                        {LOCATIONS.map(l => (
                          <button
                            key={l.id}
                            onClick={() => { setServerLocation(l.id); setLocOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-sm transition-colors hover:bg-white/5 flex items-center justify-between ${
                              serverLocation === l.id ? "text-[#2D7DD2] bg-[#2D7DD2]/5 font-bold" : "text-slate-300"
                            }`}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="text-base">{l.flag}</span>
                              {l.name}
                            </span>
                            <span className="text-[10px] font-mono text-[#22D3A0]">{l.ping}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <span className="block text-[10px] text-[#4A6A8A] mt-1">Changing location will update the server IP.</span>
                  </div>

                  {/* Game Mode Dropdown */}
                  <div>
                    <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider mb-2">Game Mode</label>
                    <select
                      value={gameMode}
                      onChange={(e) => setGameMode(e.target.value)}
                      className="w-full bg-[#0F172A] border border-white/10 rounded-lg px-4 py-3 text-sm text-white hover:border-[#2D7DD2] transition-colors outline-none focus:border-[#2D7DD2]"
                    >
                      <option value="scrim_practice">Scrim & Practice</option>
                      <option value="deathmatch">Deathmatch Arena</option>
                      <option value="retakes">Retakes Mode</option>
                      <option value="1v1">1v1 Arena Duel</option>
                    </select>
                    <span className="block text-[10px] text-[#4A6A8A] mt-1">Select the active game mode ruleset.</span>
                  </div>

                </div>

                {/* Submode Cards layout */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Scrim Option Card */}
                  <button 
                    onClick={() => setGameMode("scrim_practice")}
                    className={`card p-5 text-left border flex items-center justify-between transition-all duration-300 hover:border-[#2D7DD2]/50 ${
                      gameMode === "scrim_practice" ? "border-[#2D7DD2]/60 bg-[#2D7DD2]/5" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded bg-white/5 text-[#8BA7CC]">
                        <Folder size={18} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Scrim Mode</h4>
                        <p className="text-xs text-[#8BA7CC]">Official 5v5 ruleset configurations</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#4A6A8A] font-bold uppercase">Active</span>
                  </button>

                  {/* Practice Option Card */}
                  <button 
                    onClick={() => setGameMode("scrim_practice")}
                    className={`card p-5 text-left border flex items-center justify-between transition-all duration-300 hover:border-[#2D7DD2]/50 ${
                      gameMode === "scrim_practice" ? "border-[#2D7DD2]/60 bg-[#2D7DD2]/5" : "border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded bg-white/5 text-[#8BA7CC]">
                        <Shield size={18} />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Practice Mode</h4>
                        <p className="text-xs text-[#8BA7CC]">Grenade trajectories & infinite buys</p>
                      </div>
                    </div>
                    <span className="text-[10px] text-[#4A6A8A] font-bold uppercase">Active</span>
                  </button>

                </div>

                {/* Text Configs Inputs */}
                <div className="card p-6 space-y-5">
                  <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider border-b border-white/5 pb-3">Server Configuration Details</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    
                    {/* Server Name */}
                    <div>
                      <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider mb-2">Server Name</label>
                      <input
                        type="text"
                        value={serverName}
                        onChange={(e) => setServerName(e.target.value)}
                        placeholder="Zealous's server"
                        className="w-full bg-[#0F172A] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#2D7DD2] transition-colors outline-none"
                      />
                      <span className="block text-[10px] text-[#4A6A8A] mt-1">This name will be visible in the server.</span>
                    </div>

                    {/* Fake RCON */}
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider">Fake RCON Password</label>
                        <span className="cursor-help" title="Use in-game console to run admin commands">
                          <HelpCircle size={12} className="text-[#4A6A8A]" />
                        </span>
                      </div>
                      <input
                        type="text"
                        value={fakeRcon}
                        onChange={(e) => setFakeRcon(e.target.value)}
                        placeholder="rconconfig"
                        className="w-full bg-[#0F172A] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#2D7DD2] transition-colors outline-none"
                      />
                      <span className="block text-[10px] text-[#4A6A8A] mt-1">RCON password. Use in the in-game console.</span>
                    </div>

                    {/* Server Password */}
                    <div>
                      <label className="block text-xs font-bold text-[#8BA7CC] uppercase tracking-wider mb-2">Server Password</label>
                      <input
                        type="text"
                        value={serverPassword}
                        onChange={(e) => setServerPassword(e.target.value)}
                        placeholder="password"
                        className="w-full bg-[#0F172A] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white focus:border-[#2D7DD2] transition-colors outline-none"
                      />
                      <span className="block text-[10px] text-[#4A6A8A] mt-1">Password for users to join the server.</span>
                    </div>

                  </div>
                </div>

                {/* Feature Toggles */}
                <div className="card p-6 space-y-6">
                  
                  {/* Private Server Toggle */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white">Private Server</h4>
                      <p className="text-xs text-[#8BA7CC] mt-0.5">Hides the server from Steam and the community server browser in-game.</p>
                    </div>
                    <button
                      onClick={() => setPrivateServer(!privateServer)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 outline-none ${
                        privateServer ? "bg-[#2D7DD2]" : "bg-white/15"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                          privateServer ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Skin Plugin Toggle */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
                        CS2 Skin Plugin (!ws)
                        <span className="text-[9px] px-1 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-bold uppercase tracking-wider">Warning</span>
                      </h4>
                      <p className="text-xs text-[#8BA7CC] mt-0.5">
                        Enable the `!ws` and `!knife` commands for weapon and knife skins in chat.
                      </p>
                      <span className="text-[10px] text-amber-500 flex items-center gap-1 mt-1 font-semibold">
                        <AlertTriangle size={10} /> Violates Valve&apos;s guidelines. Use at your own risk.
                      </span>
                    </div>
                    <button
                      onClick={() => setSkinPlugin(!skinPlugin)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 outline-none ${
                        skinPlugin ? "bg-[#2D7DD2]" : "bg-white/15"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                          skinPlugin ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Auto Updates Toggle */}
                  <div className="flex items-center justify-between border-b border-white/5 pb-4">
                    <div>
                      <h4 className="text-sm font-bold text-white">Automatic Updates</h4>
                      <p className="text-xs text-[#8BA7CC] mt-0.5">
                        Server will automatically update at the scheduled time if an update is available and the server has been empty for 30+ minutes.
                      </p>
                    </div>
                    <button
                      onClick={() => setAutoUpdates(!autoUpdates)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-300 outline-none ${
                        autoUpdates ? "bg-[#2D7DD2]" : "bg-white/15"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-300 ${
                          autoUpdates ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Daily Update Time */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
                    <div>
                      <h4 className="text-sm font-bold text-white">Update Time</h4>
                      <p className="text-xs text-[#8BA7CC] mt-0.5">Your timezone: America/Chicago. Last updated 4 days ago.</p>
                    </div>
                    <select
                      value={updateTime}
                      disabled={!autoUpdates}
                      onChange={(e) => setUpdateTime(e.target.value)}
                      className="bg-[#0F172A] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white hover:border-[#2D7DD2] transition-colors outline-none focus:border-[#2D7DD2] disabled:opacity-40"
                    >
                      <option value="01:00">01:00</option>
                      <option value="02:00">02:00</option>
                      <option value="03:00">03:00</option>
                      <option value="04:00">04:00</option>
                      <option value="05:00">05:00</option>
                    </select>
                  </div>

                </div>

                {/* Save Changes bottom bar */}
                <div className="flex items-center justify-end p-4 rounded-xl border border-white/10 bg-[#0D1825]/40 backdrop-blur">
                  {saveStatus === "success" && (
                    <span className="text-xs font-bold text-[#22D3A0] uppercase tracking-wider flex items-center gap-1.5 mr-4 animate-pulse">
                      <CheckCircle size={14} /> All changes applied
                    </span>
                  )}
                  <button
                    onClick={handleSaveChanges}
                    disabled={isSaving || server.status !== "active"}
                    className="flex items-center gap-2 px-6 py-3 rounded-lg text-xs font-bold uppercase tracking-wider bg-[#2D7DD2] hover:bg-[#2D7DD2]/85 text-white transition-all disabled:opacity-40"
                  >
                    {isSaving ? (
                      <>
                        <div className="w-3.5 h-3.5 rounded-full border border-t-transparent animate-spin" style={{ borderColor: "#fff", borderTopColor: "transparent" }} />
                        Applying...
                      </>
                    ) : (
                      "Apply Changes"
                    )}
                  </button>
                </div>

              </div>
            ) : (
              
              /* CONFIGS AND COMMANDS TAB */
              <div className="card p-6 space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Server Chat Commands</h3>
                  <p className="text-xs text-[#8BA7CC]">
                    Type these commands directly in the CS2 game text chat (press `Y` or `U`) to configure options during practice.
                  </p>
                </div>

                <div className="space-y-3">
                  {PRACTICE_COMMANDS.map(c => (
                    <div key={c.cmd} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3.5 rounded-lg bg-black/20 border border-white/5">
                      <div className="flex items-center gap-4">
                        <span className="px-2.5 py-1 rounded bg-[#2D7DD2]/10 border border-[#2D7DD2]/25 text-[#2D7DD2] font-mono text-xs font-bold">
                          {c.cmd}
                        </span>
                        <span className="text-xs text-[#C4CEDD]">
                          {c.desc}
                        </span>
                      </div>
                      <button
                        onClick={() => copyToClipboard(c.cmd, c.cmd)}
                        className="self-end sm:self-center px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-[10px] font-bold text-[#8BA7CC] hover:text-white uppercase tracking-wider border border-white/10 transition-all flex items-center gap-1"
                      >
                        {copiedCmd === c.cmd ? (
                          <>
                            <Check size={10} className="text-[#22D3A0]" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy size={10} />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>

                {/* Pro Tip */}
                <div className="flex gap-3 p-4 rounded-lg bg-[#2D7DD2]/5 border border-[#2D7DD2]/15 text-[#8BA7CC]">
                  <Info size={16} className="text-[#2D7DD2] shrink-0 mt-0.5" />
                  <div className="text-xs leading-relaxed">
                    <span className="font-bold text-white">Pro Tip: </span> 
                    You can bind any of these commands to a keyboard shortcut via the game console. For example, open your console (~) and type: <code className="px-1.5 py-0.5 rounded bg-black/40 text-slate-100 font-mono text-[10px]">bind &quot;p&quot; &quot;say .rethrow&quot;</code> to rethrow your utility instantaneously.
                  </div>
                </div>

              </div>
            )}
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
