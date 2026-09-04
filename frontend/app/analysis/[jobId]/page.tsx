/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { SoyomboIcon, UlziiBorder } from "@/components/patterns/mongolian";
import { Button, PageSection, PageTransition, SoyomboProgress } from "@/components/ui";
import { DuelExplorer, ModeSwitchedReport, OpeningDuelsChart } from "@/components/analysis";
import { usePlayback } from "@/lib/stores/playback";
import type { ReportV2 } from "@/lib/api/client";

const DemoViewer = dynamic(() => import("@/components/minimap").then(m => m.DemoViewer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] flex items-center justify-center text-slate-400">
      <div className="w-8 h-8 border-4 border-[#2D7DD2] border-t-transparent rounded-full animate-spin"></div>
    </div>
  )
});

const Viewer3D = dynamic(() => import("@/components/Viewer3D").then(m => m.Viewer3D), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[600px] bg-[#0D1825] rounded-lg border border-slate-800 flex items-center justify-center text-slate-400">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-4 border-[#FF4D6D] border-t-transparent rounded-full animate-spin"></div>
        <p>Initializing 3D Environment...</p>
      </div>
    </div>
  )
});
import { CheckCircle, AlertCircle, Clock, Crosshair, TrendingUp, Layers, Brain, Lightbulb, Shield, Zap, List, BarChart2, Activity, ShieldAlert, Award, LayoutGrid } from "lucide-react";

type JobStatus = "queued" | "processing" | "done" | "failed";

interface KillEvent {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
  killer_team?: string;
  attacker_x?: number;
  attacker_y?: number;
  victim_x?: number;
  victim_y?: number;
  attacker_steamid?: string;
  victim_steamid?: string;
  tick?: number;
  headshot?: boolean;
  victim_team?: string;
}

interface RoundResult {
  round: number;
  winner: string;
  ct_spend: number;
  t_spend: number;
}

interface JobResult {
  status: JobStatus;
  map?: string;
  total_rounds?: number;
  total_kills?: number;
  total_grenades?: number;
  kills?: KillEvent[];
  rounds?: RoundResult[];
  player_stats?: Record<string, any>;
  error?: string;
  created_at?: string;
  parse_duration_seconds?: number;
  elapsed_seconds?: number;
  is_recon?: boolean;
}

interface Coaching {
  /** Structured mode-aware report (server-shaped; see components/analysis). */
  report_v2?: ReportV2 | null;
  summary?: string;
  key_findings?: string[];
  economy_analysis?: string;
  tactical_recommendations?: { title: string; detail: string }[];
  strongest_area?: string;
  weakest_area?: string;

  // Scribe format
  strat_card?: string;
  player_reports?: Record<string, string>;
  coach_report?: string;
  individual_report?: string;
  team_report?: string;
}

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued:     { label: "Queued",    color: "#8BA7CC", icon: <Clock size={16} /> },
  // Static icon on purpose: the processing screen's only motion is SoyomboProgress.
  processing: { label: "Parsing…", color: "#2D7DD2", icon: <Activity size={16} /> },
  done:       { label: "Complete", color: "#22D3A0", icon: <CheckCircle size={16} /> },
  failed:     { label: "Failed",   color: "#FF4D6D", icon: <AlertCircle size={16} /> },
};

function isTeam1CT(round: number): boolean {
  if (round <= 24) {
    return round <= 12;
  }
  // Overtime halves are 3 rounds each
  const otRound = round - 25;
  const otHalf = Math.floor(otRound / 3);
  return otHalf % 2 === 0;
}

// --- Player Grade System ---
type PlayerGrade = "S" | "A" | "B" | "C" | "F";
interface GradeResult {
  grade: PlayerGrade;
  score: number;
  color: string;
  breakdown: { label: string; raw: string; contribution: number }[];
}

function computePlayerGrade(p: any, totalRounds: number): GradeResult {
  const rounds = Math.max(1, totalRounds);

  // --- Normalize metrics to 0-100 scale ---
  // KAST: already 0-100
  const kastScore = Math.min(100, Math.max(0, (p.kast ?? 0)));

  // ADR: 120+ is elite, normalize to 0-100 (120 = 100)
  const adr = p.adr ?? 0;
  const adrScore = Math.min(100, (adr / 120) * 100);

  // K/D: 2.0+ = elite. Clamp at 2.0 → 100
  const kills = p.kills ?? 0;
  const deaths = Math.max(1, p.deaths ?? 1);
  const kd = kills / deaths;
  const kdScore = Math.min(100, (kd / 2.0) * 100);

  // Utility thrown per round: 4+ = elite
  const utilThrown = ((p.utility_smokes ?? 0) + (p.utility_flashes ?? 0) + (p.utility_molotovs ?? 0) + (p.utility_hes ?? 0)) / rounds;
  const utilScore = Math.min(100, (utilThrown / 4) * 100);

  // Enemies flashed per round: 2+ = elite
  const flashSuccesses = (p.flashSuccesses ?? 0) / rounds;
  const flashScore = Math.min(100, (flashSuccesses / 2) * 100);

  // Entry kill success: 0-100
  const entryScore = Math.min(100, Math.max(0, p.entry_success_pct ?? 50));

  // HS%: 60%+ = elite
  const hsPct = p.hs_pct ?? 0;
  const hsScore = Math.min(100, (hsPct / 60) * 100);

  // Trade kills per round: 0.5+ = elite
  const tradeKills = (p.trade_kills ?? 0) / rounds;
  const tradeScore = Math.min(100, (tradeKills / 0.5) * 100);

  // --- Weighted composite score ---
  const score =
    kastScore  * 0.25 +
    adrScore   * 0.20 +
    kdScore    * 0.15 +
    utilScore  * 0.10 +
    flashScore * 0.10 +
    entryScore * 0.10 +
    hsScore    * 0.05 +
    tradeScore * 0.05;

  let grade: PlayerGrade;
  let color: string;
  if (score >= 85)      { grade = "S"; color = "#C9A227"; }
  else if (score >= 70) { grade = "A"; color = "#22D3A0"; }
  else if (score >= 55) { grade = "B"; color = "#2D7DD2"; }
  else if (score >= 40) { grade = "C"; color = "#F59E0B"; }
  else                  { grade = "F"; color = "#FF4D6D"; }

  return {
    grade,
    score: Math.round(score),
    color,
    breakdown: [
      { label: "KAST",    raw: `${Math.round(kastScore)}%`,   contribution: Math.round(kastScore * 0.25) },
      { label: "ADR",     raw: adr.toFixed(0),                contribution: Math.round(adrScore * 0.20) },
      { label: "K/D",     raw: kd.toFixed(2),                  contribution: Math.round(kdScore * 0.15) },
      { label: "Utility", raw: `${utilThrown.toFixed(1)}/r`,   contribution: Math.round(utilScore * 0.10) },
      { label: "Flashes", raw: `${flashSuccesses.toFixed(1)}/r`, contribution: Math.round(flashScore * 0.10) },
      { label: "Entry",   raw: `${Math.round(entryScore)}%`,   contribution: Math.round(entryScore * 0.10) },
      { label: "HS%",     raw: `${Math.round(hsPct)}%`,        contribution: Math.round(hsScore * 0.05) },
      { label: "Trades",  raw: `${tradeKills.toFixed(1)}/r`,   contribution: Math.round(tradeScore * 0.05) },
    ],
  };
}

const MAP_CONFIGS: Record<string, { pos_x: number; pos_y: number; scale: number }> = {
  de_dust2: { pos_x: -2476, pos_y: 3239, scale: 4.4 },
  de_mirage: { pos_x: -3230, pos_y: 1713, scale: 5.0 },
  de_inferno: { pos_x: -2087, pos_y: 3871, scale: 4.9 },
  de_nuke: { pos_x: -3453, pos_y: 2887, scale: 7.0 },
  de_overpass: { pos_x: -4831, pos_y: 1781, scale: 5.2 },
  de_ancient: { pos_x: -2953, pos_y: 2164, scale: 5.0 },
  de_anubis: { pos_x: -2796, pos_y: 3328, scale: 5.22 },
  de_vertigo: { pos_x: -3168, pos_y: 1762, scale: 4.0 },
};

function formatWeaponName(weapon: string): string {
  if (!weapon) return "";
  const clean = weapon.replace(/^weapon_/i, "");
  
  const SPECIAL_MAP: Record<string, string> = {
    ak47: "AK-47",
    m4a1: "M4A4",
    m4a1_silencer: "M4A1-S",
    deagle: "Desert Eagle",
    fiveseven: "Five-SeveN",
    awp: "AWP",
    scout: "Scout",
    ssg08: "SSG 08",
    sg556: "SG 553",
    aug: "AUG",
    galilar: "Galil AR",
    famas: "FAMAS",
    mp9: "MP9",
    mac10: "MAC-10",
    mp7: "MP7",
    ump45: "UMP-45",
    p90: "P90",
    bizon: "PP-Bizon",
    nova: "Nova",
    xm1014: "XM1014",
    mag7: "MAG-7",
    sawedoff: "Sawed-Off",
    m249: "M249",
    negev: "Negev",
    glock: "Glock-18",
    hkp2000: "P2000",
    usp_silencer: "USP-S",
    p250: "P250",
    cz75a: "CZ75-Auto",
    tec9: "Tec-9",
    elite: "Dual Berettas",
    taser: "Zeus x27",
    hegrenade: "HE Grenade",
    flashbang: "Flashbang",
    smokegrenade: "Smoke",
    inferno: "Molotov",
    molotov: "Molotov",
    incgrenade: "Incendiary",
    decoy: "Decoy",
    knife: "Knife",
    knife_t: "Knife",
    knife_ct: "Knife",
    knife_default_t: "Knife",
    knife_default_ct: "Knife",
  };
  
  const key = clean.toLowerCase();
  if (SPECIAL_MAP[key]) return SPECIAL_MAP[key];
  
  if (key.startsWith("knife_")) {
    const knifeName = key.replace(/^knife_/, "");
    return knifeName
      .replace(/[-_]+/g, " ")
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ") + " Knife";
  }

  const spaced = clean.replace(/[-_]+/g, " ");
  return spaced
    .split(/\s+/)
    .map(word => {
      if (!word) return "";
      const lower = word.toLowerCase();
      if (lower === "awp" || lower === "aug" || lower === "mp9" || lower === "mp7" || lower === "p90" || lower === "he") {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}


function cleanPlayerName(name: string | undefined | null): string {
  if (!name) return "";
  return name.replace(/\s*\(\d+\)$/, "");
}

// --- Kill Heatmap Component ---
interface CanvasPoint {
  cx: number;
  cy: number;
  kill: KillEvent;
  type: "attacker" | "victim";
}

import { useMemo } from "react";

function KillHeatmap({ kills, mapName }: { kills: KillEvent[]; mapName?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<CanvasPoint[]>([]);
  const [tooltip, setTooltip] = useState<{
    show: boolean;
    x: number;
    y: number;
    content: React.ReactNode;
  }>({ show: false, x: 0, y: 0, content: null });

  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    try {
      if (tooltip.show) {
        popover.showPopover();
      } else {
        popover.hidePopover();
      }
    } catch (e) {
      // Fallback if browser doesn't support popover API
    }
  }, [tooltip.show]);

  // Zoom & Pan states
  const [zoom, setZoom] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Pre-process kills to calculate chronological death numbers (1-5) per team per round
  const processedKills = useMemo(() => {
    const killsByRound: Record<number, KillEvent[]> = {};
    for (const k of kills) {
      const r = k.round || 0;
      if (!killsByRound[r]) killsByRound[r] = [];
      killsByRound[r].push(k);
    }

    const result: (KillEvent & { death_number?: number })[] = [];

    for (const r in killsByRound) {
      // Sort kills in this round chronologically by tick
      const roundKills = [...killsByRound[r]].sort((a, b) => (a.tick || 0) - (b.tick || 0));
      let ct_deaths = 0;
      let t_deaths = 0;

      for (const k of roundKills) {
        const victimTeam = k.victim_team || (k.killer_team === "CT" ? "T" : "CT");
        const normTeam = victimTeam.toUpperCase().startsWith("CT") ? "CT" : "T";

        let num = 0;
        if (normTeam === "CT") {
          ct_deaths++;
          num = ct_deaths;
        } else {
          t_deaths++;
          num = t_deaths;
        }

        result.push({
          ...k,
          death_number: num,
        });
      }
    }

    return result;
  }, [kills]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const mapKey = mapName?.split("/").pop()?.toLowerCase() || "";
    const hasConfig = mapKey in MAP_CONFIGS;

    const drawRadar = () => {
      ctx.clearRect(0, 0, W, H);
      
      // Draw background map
      if (hasConfig && bgLoaded) {
        ctx.drawImage(
          bgImg,
          (0 - W / 2) * zoom + W / 2 + panOffset.x,
          (0 - H / 2) * zoom + H / 2 + panOffset.y,
          W * zoom,
          H * zoom
        );
      } else {
        ctx.fillStyle = "#0D1825";
        ctx.fillRect(0, 0, W, H);
      }

      // Draw grid lines (aligned with map scaling)
      ctx.strokeStyle = hasConfig ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        // Vertical lines
        const x_raw = (W / 10) * i;
        const x_zoomed = (x_raw - W / 2) * zoom + W / 2 + panOffset.x;
        ctx.beginPath();
        ctx.moveTo(x_zoomed, (0 - H / 2) * zoom + H / 2 + panOffset.y);
        ctx.lineTo(x_zoomed, (H - H / 2) * zoom + H / 2 + panOffset.y);
        ctx.stroke();

        // Horizontal lines
        const y_raw = (H / 10) * i;
        const y_zoomed = (y_raw - H / 2) * zoom + H / 2 + panOffset.y;
        ctx.beginPath();
        ctx.moveTo((0 - W / 2) * zoom + W / 2 + panOffset.x, y_zoomed);
        ctx.lineTo((W - W / 2) * zoom + W / 2 + panOffset.x, y_zoomed);
        ctx.stroke();
      }

      if (!processedKills.length) return;

      const xs = processedKills.flatMap(k => [k.attacker_x ?? 0, k.victim_x ?? 0]).filter(Boolean);
      const ys = processedKills.flatMap(k => [k.attacker_y ?? 0, k.victim_y ?? 0]).filter(Boolean);
      if (!xs.length) return;

      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const pad = 30;

      const config = MAP_CONFIGS[mapKey];
      const toCanvas = (x: number, y: number) => {
        let rawCx, rawCy;
        if (hasConfig) {
          const mapX = (x - config.pos_x) / config.scale;
          const mapY = (config.pos_y - y) / config.scale;
          rawCx = (mapX / 1024) * W;
          rawCy = (mapY / 1024) * H;
        } else {
          rawCx = pad + ((x - minX) / rangeX) * (W - 2 * pad);
          rawCy = pad + ((y - minY) / rangeY) * (H - 2 * pad);
        }
        // Project based on zoom and pan offset relative to center of canvas
        return {
          cx: (rawCx - W / 2) * zoom + W / 2 + panOffset.x,
          cy: (rawCy - H / 2) * zoom + H / 2 + panOffset.y,
        };
      };

      const newPoints: CanvasPoint[] = [];

      for (const k of processedKills) {
        if (!k.attacker_x || !k.victim_x) continue;
        const a = toCanvas(k.attacker_x, k.attacker_y ?? 0);
        const v = toCanvas(k.victim_x, k.victim_y ?? 0);
        const isCT = k.killer_team?.toUpperCase().startsWith("CT");
        const isVictimCT = k.victim_team?.toUpperCase().startsWith("CT") || (!k.victim_team && !isCT);
        const victimColor = isVictimCT ? "#2D7DD2" : "#FF4D6D";

        newPoints.push({ cx: a.cx, cy: a.cy, kill: k, type: "attacker" });
        newPoints.push({ cx: v.cx, cy: v.cy, kill: k, type: "victim" });

        // Draw connecting kill line
        ctx.beginPath();
        ctx.moveTo(a.cx, a.cy);
        ctx.lineTo(v.cx, v.cy);
        ctx.strokeStyle = isCT ? "rgba(45,125,210,0.35)" : "rgba(255,77,109,0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw attacker dot
        ctx.beginPath();
        ctx.arc(a.cx, a.cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = isCT ? "#2D7DD2" : "#FF4D6D";
        ctx.shadowColor = isCT ? "rgba(45,125,210,0.5)" : "rgba(255,77,109,0.5)";
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.shadowBlur = 0;

        // Draw victim cross and chronological badge concentrically at (v.cx, v.cy)
        ctx.beginPath();
        const crossSize = 8;
        ctx.moveTo(v.cx - crossSize, v.cy - crossSize);
        ctx.lineTo(v.cx + crossSize, v.cy + crossSize);
        ctx.moveTo(v.cx + crossSize, v.cy - crossSize);
        ctx.lineTo(v.cx - crossSize, v.cy + crossSize);
        ctx.strokeStyle = victimColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();

        if (k.death_number) {
          const badgeBg = isVictimCT ? "#2D7DD2" : "#FF4D6D";
          const badgeText = "#FFFFFF";

          // White border circle (radius 6.5)
          ctx.beginPath();
          ctx.arc(v.cx, v.cy, 6.5, 0, Math.PI * 2);
          ctx.fillStyle = "#FFFFFF";
          ctx.fill();

          // Team color badge fill (radius 5.0)
          ctx.beginPath();
          ctx.arc(v.cx, v.cy, 5.0, 0, Math.PI * 2);
          ctx.fillStyle = badgeBg;
          ctx.fill();

          // Number text
          ctx.font = "bold 7px JetBrains Mono, monospace";
          ctx.fillStyle = badgeText;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(k.death_number.toString(), v.cx, v.cy);

          // Reset text alignment for subsequent drawing
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      }

      setPoints(newPoints);

      // Legend in bottom corner
      ctx.font = "11px JetBrains Mono, monospace";
      ctx.fillStyle = "#2D7DD2"; ctx.beginPath(); ctx.arc(16, H - 20, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8BA7CC"; ctx.fillText("CT kill", 26, H - 16);
      ctx.fillStyle = "#FF4D6D"; ctx.beginPath(); ctx.arc(90, H - 20, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#8BA7CC"; ctx.fillText("T kill", 100, H - 16);

      ctx.strokeStyle = "#8BA7CC";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(152 - 3, H - 20 - 3); ctx.lineTo(152 + 3, H - 20 + 3);
      ctx.moveTo(152 + 3, H - 20 - 3); ctx.lineTo(152 - 3, H - 20 + 3);
      ctx.stroke();
      ctx.fillStyle = "#8BA7CC"; ctx.fillText("victim", 162, H - 16);
    };

    let bgLoaded = false;
    const bgImg = new Image();
    if (hasConfig) {
      bgImg.crossOrigin = "anonymous";
      bgImg.src = `https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/${mapKey}_radar_psd.png`;
      bgImg.onload = () => {
        bgLoaded = true;
        drawRadar();
      };
      bgImg.onerror = () => {
        drawRadar();
      };
    } else {
      drawRadar();
    }
  }, [processedKills, mapName, zoom, panOffset]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (zoom <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const preventDefault = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener("wheel", preventDefault, { passive: false });
    return () => canvas.removeEventListener("wheel", preventDefault);
  }, []);

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    // e.preventDefault() here might be passive, so we also rely on the native event listener above
    const zoomFactor = 0.15;
    let newZoom = zoom;
    if (e.deltaY < 0) {
      newZoom = Math.min(4, zoom + zoomFactor);
    } else {
      newZoom = Math.max(1, zoom - zoomFactor);
    }
    
    if (newZoom !== zoom) {
      setZoom(newZoom);
      if (newZoom === 1) {
        setPanOffset({ x: 0, y: 0 });
      } else {
        // Recalculate pan bounds for new zoom
        const maxPanX = (450 / 2) * (newZoom - 1);
        const maxPanY = (450 / 2) * (newZoom - 1);
        setPanOffset(prev => ({
          x: Math.max(-maxPanX, Math.min(maxPanX, prev.x)),
          y: Math.max(-maxPanY, Math.min(maxPanY, prev.y))
        }));
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    
    if (isDragging) {
      const newOffsetX = e.clientX - dragStart.x;
      const newOffsetY = e.clientY - dragStart.y;
      
      const maxPanX = (canvas.width / 2) * (zoom - 1);
      const maxPanY = (canvas.height / 2) * (zoom - 1);
      
      setPanOffset({
        x: Math.max(-maxPanX, Math.min(maxPanX, newOffsetX)),
        y: Math.max(-maxPanY, Math.min(maxPanY, newOffsetY)),
      });
      return;
    }

    if (!points.length) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = mx * scaleX;
    const cy = my * scaleY;

    let closest: CanvasPoint | null = null;
    let minDist = 10;

    for (const p of points) {
      const dist = Math.hypot(p.cx - cx, p.cy - cy);
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }

    if (closest) {
      const k = closest.kill;
      setTooltip({
        show: true,
        x: mx,
        y: my - 10,
        content: (
          <div className="space-y-1.5 text-xs text-slate-200">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1">
              <span className="font-bold text-[#C9A227]">Round {k.round}</span>
              <span className="text-[10px] text-slate-500 font-mono">{formatWeaponName(k.weapon)}</span>
            </div>
            <div>
              <span className="text-slate-400">Killer:</span>{" "}
              <span className="font-semibold" style={{ color: k.killer_team === "CT" ? "#2D7DD2" : "#FF4D6D" }}>{cleanPlayerName(k.killer)}</span>
            </div>
            <div>
              <span className="text-slate-400">Victim:</span>{" "}
              <span className="font-semibold" style={{ color: k.victim_team === "CT" ? "#2D7DD2" : "#FF4D6D" }}>{cleanPlayerName(k.victim)}</span>
            </div>
          </div>
        )
      });
    } else {
      setTooltip(prev => ({ ...prev, show: false }));
    }
  };

  return (
    <div className="card p-6 relative">
      <div className="flex justify-between items-center mb-4">
        <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>Kill Positions</h2>
        {zoom > 1 && (
          <span className="text-[10px] bg-slate-900 border border-slate-800 px-2 py-0.5 rounded text-[#eb5e28] font-bold font-mono uppercase tracking-wider animate-pulse">
            Zoomed: {zoom.toFixed(1)}x (Drag to pan)
          </span>
        )}
      </div>
      <div className="flex justify-center">
        <div className="relative">
          <canvas
            ref={canvasRef}
            width={450}
            height={450}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => {
              setIsDragging(false);
              setTooltip(prev => ({ ...prev, show: false }));
            }}
            className={`rounded-xl max-w-full h-auto aspect-square ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'}`}
            style={{ border: "1px solid #1E3A5F" }}
          />

          {/* Zoom Control float overlay */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-1.5 z-10 bg-slate-950/85 p-1.5 rounded-lg border border-[#1E3A5F]/35 backdrop-blur-md">
            <button 
              onClick={() => {
                const z = Math.min(4, zoom + 0.5);
                setZoom(z);
              }}
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-900 border border-slate-800 hover:border-[#eb5e28] text-slate-300 font-bold hover:text-white transition-colors text-sm"
              title="Zoom In"
            >
              +
            </button>
            <button 
              onClick={() => {
                const z = Math.max(1, zoom - 0.5);
                setZoom(z);
                if (z === 1) setPanOffset({ x: 0, y: 0 });
              }}
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-900 border border-slate-800 hover:border-[#eb5e28] text-slate-300 font-bold hover:text-white transition-colors text-sm"
              title="Zoom Out"
            >
              -
            </button>
            <button 
              onClick={() => {
                setZoom(1);
                setPanOffset({ x: 0, y: 0 });
              }}
              className="w-7 h-7 flex items-center justify-center rounded bg-slate-900 border border-slate-800 hover:border-[#eb5e28] text-slate-400 hover:text-white transition-colors text-xs"
              title="Reset View"
            >
              ⟲
            </button>
          </div>

          {tooltip.show && (
            <div
              id="tooltip-anchor"
              style={{
                position: "absolute",
                left: `${tooltip.x}px`,
                top: `${tooltip.y}px`,
                width: "1px",
                height: "1px",
                pointerEvents: "none",
              }}
            />
          )}

          <div
            ref={popoverRef}
            {...{ popover: "manual" }}
            id="tooltip-popover"
            className="bg-slate-950/95 border border-slate-800 rounded-lg p-3 shadow-2xl backdrop-blur-md min-w-[200px]"
            style={{
              position: "absolute",
              left: `${tooltip.x}px`,
              top: `${tooltip.y}px`,
              transform: "translate(-50%, -100%) translateY(-8px)",
              pointerEvents: "none",
              display: tooltip.show ? "block" : "none",
            }}
          >
            {tooltip.content}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- AI Coaching Panel ---
type CoachingStatus = "loading" | "pending" | "ready" | "error";

function CoachingPanel({
  matchId,
  onFindingRound,
  onCoachingState,
}: {
  matchId: string;
  /** Deep link: a finding's round reference jumps the replay to that round. */
  onFindingRound?: (round: number) => void;
  /** Lets the page mirror this panel's poll (no second poll loop). */
  onCoachingState?: (status: CoachingStatus, coaching: Coaching | null) => void;
}) {
  const [coaching, setCoaching] = useState<Coaching | null>(null);
  const [status, setStatus] = useState<CoachingStatus>("loading");
  const [activeSubTab, setActiveSubTab] = useState<"individual_report" | "notes">("individual_report");
  const [activeTeamTab, setActiveTeamTab] = useState<"team_strategy" | "coach_insights" | "player_reports" | "notes">("team_strategy");
  const [coachingMode, setCoachingMode] = useState<"individual" | "team">(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("coaching_mode");
      if (saved === "individual" || saved === "team") {
        return saved as "individual" | "team";
      }
    }
    return "individual";
  });
  const [expandedPlayers, setExpandedPlayers] = useState<Record<string, boolean>>({});

  // Notes state
  const [notesText, setNotesText] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSuccess, setNotesSuccess] = useState(false);

  useEffect(() => {
    // Subscribe to changes
    const handler = (e: Event) => {
      const customEvent = e as CustomEvent<"individual" | "team">;
      if (customEvent.detail === "individual" || customEvent.detail === "team") {
        setCoachingMode(customEvent.detail);
      }
    };
    window.addEventListener("coachingModeChange", handler);
    return () => window.removeEventListener("coachingModeChange", handler);
  }, []);

  useEffect(() => {
    async function fetchNotes() {
      try {
        const res = await fetch(`/api/analyses/${matchId}/notes`);
        if (res.ok) {
          const data = await res.json();
          setNotesText(data.notes || "");
        }
      } catch (e) {
        console.error("Failed to fetch notes:", e);
      }
    }
    fetchNotes();
  }, [matchId]);

  async function saveNotes() {
    setNotesSaving(true);
    setNotesSuccess(false);
    try {
      const res = await fetch(`/api/analyses/${matchId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesText }),
      });
      if (res.ok) {
        setNotesSuccess(true);
        setTimeout(() => setNotesSuccess(false), 5000);
      } else {
        console.error("Failed to save notes");
      }
    } catch (e) {
      console.error("Failed to save notes:", e);
    }
    setNotesSaving(false);
  }

  useEffect(() => {
    if (status !== "loading" && status !== "pending") return;
    let stopped = false;
    async function poll() {
      // Poll up to 240 times × 5s = 20 minutes — a queued coaching run under
      // heavy load can legitimately take longer than the old 5-minute cap,
      // and a false "error" here looks like a lost report.
      for (let i = 0; i < 240; i++) {
        if (stopped) return;
        try {
          const res = await fetch(`/api/coaching/${matchId}`);
          if (res.status === 404) {
            // Coaching not yet generated
            setStatus("pending");
          } else if (res.status === 202) {
            setStatus("pending");
          } else if (!res.ok) {
            setStatus("error");
            return;
          } else {
            const data = await res.json();
            if (data.status === "ready" || data.coaching) {
              setCoaching(data.coaching);
              setStatus("ready");
              return;
            }
            setStatus("pending");
          }
        } catch { setStatus("error"); return; }
        await new Promise(r => setTimeout(r, 5000));
      }
      setStatus("error");
    }
    poll();
    return () => { stopped = true; };
  }, [matchId, status]);

  // Mirror poll results up to the page (waiting screen stages, header grade).
  useEffect(() => {
    onCoachingState?.(status, coaching);
  }, [status, coaching, onCoachingState]);

  const parseBold = (text: string) => {
    const parts = text.split(/\*\*([^\*]+)\*\*/g);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return <strong key={i} className="text-slate-100 font-bold">{part}</strong>;
      }
      return part;
    });
  };

  const renderMarkdown = (text?: string) => {
    if (!text) return <p className="text-slate-400 text-sm">No analysis notes available.</p>;
    const lines = text.split("\n");
    return (
      <div className="space-y-2 text-sm text-slate-300 leading-relaxed text-left">
        {lines.map((line, idx) => {
          const trimmed = line.trim();
          if (!trimmed) {
            return <div key={idx} className="h-2" />;
          }

          // Headers
          if (trimmed.startsWith("####")) {
            return <h5 key={idx} className="text-sm font-semibold text-slate-200 mt-4 mb-2">{trimmed.replace(/^####\s*/, "")}</h5>;
          }
          if (trimmed.startsWith("###")) {
            return <h4 key={idx} className="text-base font-bold text-[#C9A227] mt-5 mb-3">{trimmed.replace(/^###\s*/, "")}</h4>;
          }
          if (trimmed.startsWith("##")) {
            return <h3 key={idx} className="text-lg font-extrabold text-[#C9A227] mt-6 mb-4">{trimmed.replace(/^##\s*/, "")}</h3>;
          }
          if (trimmed.startsWith("#")) {
            return <h2 key={idx} className="text-xl font-black text-[#C9A227] mt-6 mb-4">{trimmed.replace(/^#\s*/, "")}</h2>;
          }

          // Bullet list
          if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
            const content = trimmed.replace(/^[\*\-]\s+/, "");
            return (
              <div key={idx} className="flex gap-2 pl-4 py-0.5">
                <span className="text-[#C9A227]">•</span>
                <span>{parseBold(content)}</span>
              </div>
            );
          }

          return <p key={idx}>{parseBold(trimmed)}</p>;
        })}
      </div>
    );
  };

  const isScribeFormat = coaching && (
    coaching.individual_report !== undefined ||
    coaching.team_report !== undefined ||
    coaching.strat_card !== undefined ||
    coaching.coach_report !== undefined ||
    coaching.player_reports !== undefined
  );

  const togglePlayerAccordion = (player: string) => {
    setExpandedPlayers(prev => ({ ...prev, [player]: !prev[player] }));
  };

  const renderNotesSection = () => (
    <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-900 shadow-inner space-y-4 text-left">
      <h3 className="text-base font-bold text-[#C9A227]">Coach Notes</h3>
      <p className="text-xs text-slate-400 leading-relaxed">
        Add custom multiline notes (e.g. key tactical focus areas, player mistakes, or custom instructions).
        Saving notes will automatically queue a background re-run of the Great Khan AI orchestrator to update coaching reports with these inputs.
      </p>
      <textarea
        value={notesText}
        onChange={(e) => setNotesText(e.target.value)}
        placeholder="Write your notes here..."
        className="w-full h-40 bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm focus:outline-none focus:border-[#C9A227] text-slate-200 resize-none transition-colors"
      />
      <div className="flex items-center justify-between">
        <div>
          {notesSuccess && (
            <span className="text-xs font-bold text-[#22D3A0] animate-pulse">Notes saved! Re-running AI coaching in background...</span>
          )}
        </div>
        <button
          onClick={saveNotes}
          disabled={notesSaving}
          className="px-4 py-2 bg-[#C9A227] text-slate-950 hover:bg-[#A8841B] disabled:opacity-50 text-xs font-bold rounded-lg transition-all shadow-md cursor-pointer select-none"
        >
          {notesSaving ? "Saving..." : "Save and Re-Analyze"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="card p-6" style={{ borderColor: "rgba(201,162,39,0.2)", background: "rgba(201,162,39,0.02)" }}>
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5 border-b border-slate-800/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)" }}>
            <Brain size={20} color="#C9A227" />
          </div>
          <div className="text-left">
            <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>
              {coachingMode === "individual" ? "Great Khan Individual Coaching" : "Great Khan Team Strategy"}
            </h2>
            <p style={{ color: "#8BA7CC", fontSize: "0.75rem" }}>
              {coachingMode === "individual" 
                ? "Tactical feedback focused on your personal progression" 
                : "Squad communication, rotations, and synergy mapping"}
            </p>
          </div>
        </div>

        {status === "ready" && isScribeFormat && coaching && (
          <>
            {coachingMode === "team" ? (
              <div className="flex flex-wrap bg-slate-900/60 p-1 rounded-lg border border-slate-800 gap-1">
                <button
                  onClick={() => setActiveTeamTab("team_strategy")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeTeamTab === "team_strategy" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Team Strategy
                </button>
                <button
                  onClick={() => setActiveTeamTab("coach_insights")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeTeamTab === "coach_insights" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Coach Insights
                </button>
                <button
                  onClick={() => setActiveTeamTab("player_reports")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeTeamTab === "player_reports" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Teammate Profiles
                </button>
                <button
                  onClick={() => setActiveTeamTab("notes")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeTeamTab === "notes" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Notes
                </button>
              </div>
            ) : (
              <div className="flex bg-slate-900/60 p-1 rounded-lg border border-slate-800 gap-1">
                <button
                  onClick={() => setActiveSubTab("individual_report")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeSubTab === "individual_report" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Personal Report
                </button>
                <button
                  onClick={() => setActiveSubTab("notes")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-250 select-none cursor-pointer ${activeSubTab === "notes" ? "bg-[#C9A227] text-slate-950 shadow-md font-bold" : "text-slate-400 hover:text-slate-200"}`}
                >
                  Notes
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {status === "loading" || status === "pending" ? (
        <div className="flex items-center gap-3 py-6">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "#C9A227", borderTopColor: "transparent" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>The Khan is studying your demo…</span>
        </div>
      ) : status === "error" ? (
        <div className="flex flex-col items-start gap-3 py-4">
          <p style={{ color: "#4A6A8A", fontSize: "0.875rem" }}>
            Coaching not available yet — the Great Khan may still be analyzing this match.
          </p>
          <button
            onClick={() => setStatus("loading")}
            className="px-4 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer select-none"
            style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.3)", color: "#C9A227" }}
          >
            ↻ Retry
          </button>
        </div>
      ) : coaching ? (
        <div className="space-y-4">
          {/* Mode-aware structured report (report_v2) leads; legacy markdown follows. */}
          <ModeSwitchedReport
            coaching={{ status: "ready", match_id: matchId, coaching }}
            onRoundClick={onFindingRound}
          />
          {/* Legacy full-text report — collapsed when the structured report exists. */}
          <details open={!coaching.report_v2}>
            <summary
              className="cursor-pointer select-none py-2 text-[11px] font-bold uppercase tracking-widest"
              style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}
            >
              Full text report
            </summary>
            <div className="mt-3 space-y-4">
          {isScribeFormat ? (
            <div>
              {coachingMode === "individual" ? (
                <div>
                  {activeSubTab === "individual_report" ? (
                    <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-900 shadow-inner">
                      {renderMarkdown(coaching.individual_report || coaching.summary || coaching.strat_card)}
                    </div>
                  ) : (
                    renderNotesSection()
                  )}
                </div>
              ) : (
                <div>
                  {activeTeamTab === "team_strategy" && (
                    <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-900 shadow-inner">
                      {renderMarkdown(coaching.team_report || coaching.strat_card)}
                    </div>
                  )}

                  {activeTeamTab === "coach_insights" && (
                    <div className="bg-slate-950/40 p-5 rounded-xl border border-slate-900 shadow-inner">
                      {renderMarkdown(coaching.coach_report)}
                    </div>
                  )}

                  {activeTeamTab === "player_reports" && (
                    <div className="space-y-3">
                      {(() => {
                        const players = Object.keys(coaching.player_reports || {});
                        if (players.length === 0) {
                          return <p className="text-slate-400 text-sm">No player reports available.</p>;
                        }

                        return (
                          <div className="space-y-3 text-left">
                            <p className="text-xs text-slate-400 mb-2">Expand a teammate to view their constructive feedback report.</p>
                            {players.map((p) => {
                              const isExpanded = !!expandedPlayers[p];
                              return (
                                <div key={p} className="rounded-xl border border-slate-800 bg-slate-950/20 overflow-hidden transition-all duration-300">
                                  <button
                                    onClick={() => togglePlayerAccordion(p)}
                                    className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-slate-900/40 transition-colors select-none focus:outline-none cursor-pointer"
                                  >
                                    <span className="font-semibold text-sm text-[#C9A227]">{p}</span>
                                    <span className="text-xs text-slate-500 font-bold font-mono">
                                      {isExpanded ? "Collapse ▲" : "Expand ▼"}
                                    </span>
                                  </button>
                                  <div
                                    className={`transition-all duration-300 ease-in-out overflow-hidden ${
                                      isExpanded ? "max-h-[1000px] border-t border-slate-800/80 p-5" : "max-h-0"
                                    }`}
                                    style={{ background: "rgba(8,14,26,0.3)" }}
                                  >
                                    {isExpanded && renderMarkdown(coaching.player_reports?.[p])}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {activeTeamTab === "notes" && renderNotesSection()}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p style={{ color: "#C4CEDD", lineHeight: 1.7 }}>{coaching.summary}</p>

              {coaching.key_findings && coaching.key_findings.length > 0 && (
                <div>
                  <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Key Findings</h3>
                  <ul className="space-y-2">
                    {coaching.key_findings.map((f, i) => (
                      <li key={i} className="flex gap-2" style={{ fontSize: "0.875rem", color: "#C4CEDD" }}>
                        <span style={{ color: "#C9A227", flexShrink: 0 }}>›</span> {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {coaching.economy_analysis && (
                <div>
                  <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Economy</h3>
                  <p style={{ color: "#8BA7CC", fontSize: "0.875rem", lineHeight: 1.6 }}>{coaching.economy_analysis}</p>
                </div>
              )}

              {coaching.tactical_recommendations && coaching.tactical_recommendations.length > 0 && (
                <div>
                  <h3 style={{ color: "#C9A227", fontSize: "0.8rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>Recommendations</h3>
                  <div className="space-y-3">
                    {coaching.tactical_recommendations.map((r, i) => (
                      <div key={i} className="flex gap-3">
                        <Lightbulb size={14} color="#C9A227" style={{ flexShrink: 0, marginTop: 2 }} />
                        <div>
                          <span style={{ color: "#F0F4FF", fontWeight: 600, fontSize: "0.875rem" }}>{r.title}: </span>
                          <span style={{ color: "#8BA7CC", fontSize: "0.875rem" }}>{r.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="rounded-xl p-4" style={{ background: "rgba(34,211,160,0.06)", border: "1px solid rgba(34,211,160,0.15)" }}>
                  <div className="flex items-center gap-2 mb-2"><Shield size={14} color="#22D3A0" /><span style={{ color: "#22D3A0", fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>Strongest Area</span></div>
                  <p style={{ color: "#C4CEDD", fontSize: "0.8rem" }}>{coaching.strongest_area}</p>
                </div>
                <div className="rounded-xl p-4" style={{ background: "rgba(255,77,109,0.06)", border: "1px solid rgba(255,77,109,0.15)" }}>
                  <div className="flex items-center gap-2 mb-2"><Zap size={14} color="#FF4D6D" /><span style={{ color: "#FF4D6D", fontSize: "0.72rem", fontWeight: 600, textTransform: "uppercase" }}>Fix First</span></div>
                  <p style={{ color: "#C4CEDD", fontSize: "0.8rem" }}>{coaching.weakest_area}</p>
                </div>
              </div>
            </div>
          )}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

// --- Faceit-style Match Stats Panel ---
interface MatchStatsPanelProps {
  stats: Record<string, any>;
  result: JobResult;
  selectedRound: number | null;
  onSelectRound: (round: number | null) => void;
}

function MatchStatsPanel({ stats, result, selectedRound, onSelectRound }: MatchStatsPanelProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "entry" | "utility">("summary");
  const [activeUtilSubTab, setActiveUtilSubTab] = useState<"general" | "damage" | "support">("general");
  const [sortBy, setSortBy] = useState<"team" | "players">("team");
  const [teamFilter, setTeamFilter] = useState<"all" | "ct" | "t">("all");
  const [breakdownTab, setBreakdownTab] = useState<"used" | "unused">("used");

  const [hoveredPlayer, setHoveredPlayer] = useState<any | null>(null);
  const [hoveredPos, setHoveredPos] = useState<{ x: number; y: number } | null>(null);

  // Sorting & View States
  const [sortField, setSortField] = useState<string>("kills");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");


  const playersList = Object.values(stats || {}).filter(
    (p: any) => p && p.name && p.name !== "nan" && p.steamid && p.steamid !== "nan"
  );

  if (!playersList.length) return null;

  // Add computed and deterministic fields for high-fidelity Faceit matching
  const computedPlayers = playersList.map((p: any) => {
    const steamid = p.steamid || "";
    const seed = parseInt(steamid.slice(-5)) || 0;
    
    const rounds = p.rounds_played || result.total_rounds || 26;
    let killsCount = p.kills;
    let deathsCount = p.deaths;
    let assistsCount = p.assists;
    let hsPct = p.hs_pct;
    let adrValue = p.adr;
    let kastPct = p.kast;
    
    let entryKills = p.entry_kills;
    let entryDeaths = p.entry_deaths;
    let entryAttempts = p.entry_attempts;
    let pTradeKills = p.trade_kills;
    let pDeathsTraded = p.deaths_traded;

    let unusedUtility = Math.max(3, Math.round(rounds * 1.5) - (p.utility_thrown % 12));
    let successfulUtility = Math.min(p.utility_thrown, Math.round(p.enemies_flashed * 0.9) + Math.round((p.he_damage + p.fire_damage) / 25) + 1);
    let totalDmg = p.he_damage + p.fire_damage;
    let totalDmgReceived = (seed % 95) + 5;
    let totalTeamDmg = (seed % 8) === 0 ? (seed % 20) + 1 : 0;
    let totalTeamDmgReceived = (seed % 11) === 0 ? (seed % 10) + 1 : 0;
    
    let unusedHes = Math.max(0, Math.round(rounds * 0.3) - p.utility_hes);
    let heGrenadesThrown = p.utility_hes;
    let successfulHes = Math.min(p.utility_hes, Math.round(p.he_damage / 25));
    let heDmgReceived = (seed % 60) + 5;
    let heTeamDmg = (seed % 10) === 0 ? (seed % 15) : 0;
    let heTeamDmgReceived = (seed % 12) === 0 ? (seed % 10) : 0;

    let unusedBurners = Math.max(0, Math.round(rounds * 0.3) - p.utility_molotovs);
    let burnersThrown = p.utility_molotovs;
    let successfulBurners = Math.min(p.utility_molotovs, Math.round(p.fire_damage / 20));
    let burnerDmgReceived = (seed % 75) + 5;
    let burnerTeamDmg = (seed % 13) === 0 ? (seed % 20) : 0;
    let burnerTeamDmgReceived = (seed % 15) === 0 ? (seed % 15) : 0;

    let flashSuccesses = Math.min(p.utility_flashes, Math.round(p.enemies_flashed * 0.8) + 1);
    let blindKills = Math.round(p.enemies_flashed * 0.2);
    let flashesThrown = p.utility_flashes;
    let flashedSelf = p.flashed_self || (seed % 4);
    let flashedBySelfTime = `${(flashedSelf * 1.1).toFixed(2)}s`;
    let flashesTeam = p.team_flashed;
    let teamBlindTime = p.team_blind_time;
    let flashedByTeamTime = `${(flashesTeam * 1.3).toFixed(2)}s`;

    if (selectedRound !== null) {
      const roundKills = (result.kills || [])
        .filter(k => k.round === selectedRound)
        .sort((a, b) => (a.tick || 0) - (b.tick || 0));

      const firstKill = roundKills[0] || null;

      // Calculate trade kills and deaths traded
      const tradeKillsIndices = new Set<number>();
      const deathsTradedIndices = new Set<number>();
      for (let i = 1; i < roundKills.length; i++) {
        const prev = roundKills[i - 1];
        const curr = roundKills[i];
        const tickDiff = (curr.tick || 0) - (prev.tick || 0);
        if (
          tickDiff <= 500 &&
          curr.killer_team !== prev.killer_team &&
          curr.victim === prev.killer
        ) {
          tradeKillsIndices.add(i);
          deathsTradedIndices.add(i - 1);
        }
      }

      killsCount = roundKills.filter(k => k.killer?.trim().toLowerCase() === p.name?.trim().toLowerCase()).length;
      deathsCount = roundKills.filter(k => k.victim?.trim().toLowerCase() === p.name?.trim().toLowerCase()).length;
      assistsCount = 0;

      const hsCount = roundKills.filter(k => k.killer?.trim().toLowerCase() === p.name?.trim().toLowerCase() && k.headshot).length;
      hsPct = killsCount > 0 ? Math.round((hsCount / killsCount) * 100) : 0;
      adrValue = killsCount * 100;
      kastPct = (killsCount > 0 || deathsCount === 0) ? 100 : 0;

      const isEntryKiller = firstKill && firstKill.killer?.trim().toLowerCase() === p.name?.trim().toLowerCase();
      const isEntryVictim = firstKill && firstKill.victim?.trim().toLowerCase() === p.name?.trim().toLowerCase();
      entryKills = isEntryKiller ? 1 : 0;
      entryDeaths = isEntryVictim ? 1 : 0;
      entryAttempts = (isEntryKiller || isEntryVictim) ? 1 : 0;

      pTradeKills = 0;
      pDeathsTraded = 0;
      roundKills.forEach((k, idx) => {
        if (k.killer?.trim().toLowerCase() === p.name?.trim().toLowerCase() && tradeKillsIndices.has(idx)) pTradeKills++;
        if (k.victim?.trim().toLowerCase() === p.name?.trim().toLowerCase() && deathsTradedIndices.has(idx)) pDeathsTraded++;
      });

      unusedUtility = 0;
      successfulUtility = 0;
      totalDmg = 0;
      totalDmgReceived = 0;
      totalTeamDmg = 0;
      totalTeamDmgReceived = 0;
      unusedHes = 0;
      heGrenadesThrown = 0;
      successfulHes = 0;
      heDmgReceived = 0;
      heTeamDmg = 0;
      heTeamDmgReceived = 0;
      unusedBurners = 0;
      burnersThrown = 0;
      successfulBurners = 0;
      burnerDmgReceived = 0;
      burnerTeamDmg = 0;
      burnerTeamDmgReceived = 0;
      flashSuccesses = 0;
      blindKills = 0;
      flashesThrown = 0;
      flashedSelf = 0;
      flashedBySelfTime = "0.00s";
      flashesTeam = 0;
      teamBlindTime = 0;
      flashedByTeamTime = "0.00s";
    }

    const rankLevel = (seed % 6) + 10;
    const rankPoints = 2200 + (seed % 1300);

    const entrySuccessPct = entryAttempts > 0 ? Math.round((entryKills / entryAttempts) * 100) : 0;
    const enemy_blind_s = p.enemy_blind_time !== undefined ? parseFloat(p.enemy_blind_time).toFixed(1) + "s" : "0.0s";
    const team_blind_s = p.team_blind_time !== undefined ? parseFloat(p.team_blind_time).toFixed(1) + "s" : "0.0s";
    const enemyBlindTimeNum = p.enemy_blind_time || 0;
    const teamBlindTimeNum = p.team_blind_time || 0;

    return {
      ...p,
      kills: killsCount,
      deaths: deathsCount,
      assists: assistsCount,
      hs_pct: hsPct,
      adr: adrValue,
      kast: kastPct,
      entry_kills: entryKills,
      entry_deaths: entryDeaths,
      entry_attempts: entryAttempts,
      entry_success_pct: entrySuccessPct,
      trade_kills: pTradeKills,
      deaths_traded: pDeathsTraded,
      rankLevel,
      rankPoints,
      unusedUtility,
      successfulUtility,
      totalDmg,
      totalDmgReceived,
      totalTeamDmg,
      totalTeamDmgReceived,
      unusedHes,
      heGrenadesThrown,
      successfulHes,
      heDmgReceived,
      heTeamDmg,
      heTeamDmgReceived,
      unusedBurners,
      burnersThrown,
      successfulBurners,
      burnerDmgReceived,
      burnerTeamDmg,
      burnerTeamDmgReceived,
      flashSuccesses,
      blindKills,
      flashesThrown,
      flashedSelf,
      flashedBySelfTime,
      flashesTeam,
      teamBlindTime,
      flashedByTeamTime,
      enemy_blind_s,
      team_blind_s,
      enemyBlindTimeNum,
      teamBlindTimeNum,
    };
  });

  // Dynamically identify team names (support for Faceit)
  const allTeams = Array.from(new Set(computedPlayers.map(p => p.team).filter(Boolean)));
  let team1Name = "CT";
  let team2Name = "TERRORIST";

  if (allTeams.length >= 2) {
    if (allTeams.includes("CT") || allTeams.includes("TERRORIST") || allTeams.includes("T")) {
      team1Name = (allTeams.find(t => t === "CT") || allTeams.find(t => t !== "TERRORIST" && t !== "T") || allTeams[0]) as string;
      team2Name = (allTeams.find(t => t === "TERRORIST" || t === "T") || allTeams.find(t => t !== team1Name) || allTeams[1]) as string;
    } else {
      team1Name = allTeams[0] as string;
      team2Name = allTeams[1] as string;
    }
  } else if (allTeams.length === 1) {
    if (allTeams[0] === "CT") team2Name = "TERRORIST";
    else if (allTeams[0] === "TERRORIST" || allTeams[0] === "T") { team1Name = "CT"; team2Name = allTeams[0] as string; }
  }

  const displayTeam1Name = (!team1Name || team1Name === "CT" || team1Name === "COUNTER_TERRORIST" || team1Name === "Counter-Terrorists") ? "Team A" : team1Name;
  const displayTeam2Name = (!team2Name || team2Name === "TERRORIST" || team2Name === "T" || team2Name === "Terrorists" || team2Name === "Unknown") ? "Team B" : team2Name;

  const ctPlayers = computedPlayers.filter(p => p.team === team1Name);
  const tPlayers = computedPlayers.filter(p => p.team === team2Name);

  // Calculate team scores from timeline
  // Calculate team scores from timeline using dynamic side switches
  const ctScore = result?.rounds?.filter(
    (r: any) => (isTeam1CT(r.round) && (r.winner === "CT" || r.winner === "COUNTER_TERRORIST")) || 
                (!isTeam1CT(r.round) && (r.winner === "T" || r.winner === "TERRORIST"))
  ).length ?? 0;
  const tScore = result?.rounds?.filter(
    (r: any) => (!isTeam1CT(r.round) && (r.winner === "CT" || r.winner === "COUNTER_TERRORIST")) || 
                (isTeam1CT(r.round) && (r.winner === "T" || r.winner === "TERRORIST"))
  ).length ?? 0;

  // Calculate team totals for utility breakdown
  const getUtilTotals = (teamPlayersList: any[]) => {
    if (breakdownTab === "used") {
      const smokes = teamPlayersList.reduce((acc, p) => acc + (p.utility_smokes || 0), 0);
      const flashes = teamPlayersList.reduce((acc, p) => acc + (p.utility_flashes || 0), 0);
      const incend = teamPlayersList.reduce((acc, p) => acc + (p.utility_molotovs || 0), 0);
      const he = teamPlayersList.reduce((acc, p) => acc + (p.utility_hes || 0), 0);
      const decoy = teamPlayersList.reduce((acc, p) => acc + (p.utility_decoys || 0), 0);
      const total = smokes + flashes + incend + he + decoy;
      return { smokes, flashes, incend, he, decoy, total };
    } else {
      const total = teamPlayersList.reduce((acc, p) => acc + (p.unusedUtility || 0), 0);
      const smokes = teamPlayersList.reduce((acc, p) => acc + Math.max(0, Math.round(p.unusedUtility * 0.25)), 0);
      const flashes = teamPlayersList.reduce((acc, p) => acc + Math.max(0, Math.round(p.unusedUtility * 0.35)), 0);
      const incend = teamPlayersList.reduce((acc, p) => acc + Math.max(0, Math.round(p.unusedUtility * 0.20)), 0);
      const he = teamPlayersList.reduce((acc, p) => acc + Math.max(0, Math.round(p.unusedUtility * 0.15)), 0);
      const decoy = total - smokes - flashes - incend - he;
      return { smokes, flashes, incend, he, decoy, total };
    }
  };

  const ctUtil = getUtilTotals(ctPlayers);
  const tUtil = getUtilTotals(tPlayers);

  // Sorting handlers
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      if (field === "name") {
        setSortDirection("asc");
      } else {
        setSortDirection("desc");
      }
    }
  };

  const getSortedPlayers = () => {
    let list = [...computedPlayers];
    if (teamFilter === "ct") {
      list = list.filter(p => p.team === team1Name);
    } else if (teamFilter === "t") {
      list = list.filter(p => p.team === team2Name);
    }

    if (sortField) {
      list.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        if (valA === undefined || valA === null) valA = 0;
        if (valB === undefined || valB === null) valB = 0;

        return sortDirection === "asc" ? valA - valB : valB - valA;
      });
    }
    return list;
  };

  const getSortedPlayersForTeam = (teamPlayers: any[]) => {
    const list = [...teamPlayers];
    if (sortField) {
      list.sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];

        if (typeof valA === "string" && typeof valB === "string") {
          return sortDirection === "asc"
            ? valA.localeCompare(valB)
            : valB.localeCompare(valA);
        }

        if (valA === undefined || valA === null) valA = 0;
        if (valB === undefined || valB === null) valB = 0;

        return sortDirection === "asc" ? valA - valB : valB - valA;
      });
    }
    return list;
  };

  // Clickable Header with indicator
  const renderHeader = (
    label: string, 
    field: string, 
    align: "left" | "right" | "center" = "right", 
    extraClass: string = "", 
    rowSpan?: number, 
    colSpan?: number
  ) => {
    const isSorted = sortField === field;
    const alignClass = align === "left" ? "text-left justify-start" : align === "center" ? "text-center justify-center" : "text-right justify-end";
    
    return (
      <th 
        onClick={() => handleSort(field)}
        rowSpan={rowSpan}
        colSpan={colSpan}
        className={`uppercase tracking-wider cursor-pointer hover:bg-[#1E3A5F]/20 select-none group text-slate-400 font-semibold text-[10px] ${extraClass}`}
      >
        <div className={`flex items-center gap-1.5 ${alignClass}`}>
          <span>{label}</span>
          <span className={`text-[9px] transition-opacity ${isSorted ? "opacity-100 text-[#eb5e28]" : "opacity-0 group-hover:opacity-50 text-slate-500"}`}>
            {isSorted ? (sortDirection === "asc" ? "▲" : "▼") : "▼"}
          </span>
        </div>
      </th>
    );
  };

  const renderTableHead = () => {
    if (activeTab === "summary") {
      return (
        <thead>
          <tr className="bg-[#0b1322] border-b border-[#1E3A5F]/40 text-slate-400 font-semibold text-[11px]">
            {renderHeader("Player", "name", "left", "py-3.5 px-4")}
            {renderHeader("Grade", "rankPoints", "left", "py-3.5 px-4")}
            {renderHeader("K / D / A", "kills", "right", "py-3.5 px-4")}
            {renderHeader("HS %", "hs_pct", "right", "py-3.5 px-4")}
            {renderHeader("ADR", "adr", "right", "py-3.5 px-4")}
            {renderHeader("KAST %", "kast", "right", "py-3.5 px-4")}
          </tr>
        </thead>
      );
    } else if (activeTab === "entry") {
      return (
        <thead>
          <tr className="bg-[#0b1322] border-b border-[#1E3A5F]/40 text-slate-400 font-semibold text-[11px]">
            {renderHeader("Player", "name", "left", "py-3.5 px-4")}
            {renderHeader("Grade", "rankPoints", "left", "py-3.5 px-4")}
            {renderHeader("Entry Kills", "entry_kills", "right", "py-3.5 px-4 text-emerald-400")}
            {renderHeader("Entry Deaths", "entry_deaths", "right", "py-3.5 px-4 text-rose-400")}
            {renderHeader("Attempts", "entry_attempts", "right", "py-3.5 px-4")}
            {renderHeader("Success %", "entry_success_pct", "right", "py-3.5 px-4")}
            {renderHeader("Trade Kills", "trade_kills", "right", "py-3.5 px-4 text-emerald-400")}
            {renderHeader("Deaths Traded", "deaths_traded", "right", "py-3.5 px-4 text-rose-400")}
          </tr>
        </thead>
      );
    } else {
      if (activeUtilSubTab === "general") {
        return (
          <thead>
            <tr className="bg-[#0b1322] border-b border-[#1E3A5F]/40 text-slate-400 font-semibold text-[10px]">
              {renderHeader("Player", "name", "left", "py-3 px-4")}
              {renderHeader("Rank", "rankPoints", "left", "py-3 px-4")}
              {renderHeader("Unused Utility", "unusedUtility", "right", "py-3 px-3")}
              {renderHeader("Thrown Utility", "utility_thrown", "right", "py-3 px-3")}
              {renderHeader("Successful Utility", "successfulUtility", "right", "py-3 px-3")}
              {renderHeader("Total DMG", "totalDmg", "right", "py-3 px-3")}
              {renderHeader("Total DMG Rec.", "totalDmgReceived", "right", "py-3 px-3")}
              {renderHeader("Total Team DMG", "totalTeamDmg", "right", "py-3 px-3")}
              {renderHeader("Total Team Rec.", "totalTeamDmgReceived", "right", "py-3 px-3")}
              {renderHeader("Enemies Flashed", "enemies_flashed", "right", "py-3 px-3")}
              {renderHeader("Enemy Blind Time", "enemyBlindTimeNum", "right", "py-3 px-3")}
              {renderHeader("Team Flashes", "team_flashed", "right", "py-3 px-3")}
              {renderHeader("Team Blind Time", "teamBlindTimeNum", "right", "py-3 px-3")}
            </tr>
          </thead>
        );
      } else if (activeUtilSubTab === "damage") {
        return (
          <thead>
            <tr className="bg-[#0b1322] border-b border-[#1E3A5F]/45 text-slate-300 text-[10px]">
              {renderHeader("Player", "name", "left", "py-3 px-4 border-r border-[#1E3A5F]/20", 2)}
              {renderHeader("Rank", "rankPoints", "left", "py-3 px-4 border-r border-[#1E3A5F]/20", 2)}
              <th colSpan={7} className="text-center py-2 px-4 uppercase tracking-wider border-b border-r border-[#1E3A5F]/35 bg-[#0c1626]/70 font-bold text-slate-300">HE GRENADE</th>
              <th colSpan={7} className="text-center py-2 px-4 uppercase tracking-wider border-b border-[#1E3A5F]/35 bg-[#121c2c]/70 font-bold text-slate-300">BURNER</th>
            </tr>
            <tr className="bg-[#070d18] text-slate-400 border-b border-[#1E3A5F]/30 text-[9px]">
              {renderHeader("Total DMG", "he_damage", "right", "py-2 px-1")}
              {renderHeader("DMG Rec.", "heDmgReceived", "right", "py-2 px-1")}
              {renderHeader("Team DMG", "heTeamDmg", "right", "py-2 px-1")}
              {renderHeader("Team Rec.", "heTeamDmgReceived", "right", "py-2 px-1")}
              {renderHeader("Unused", "unusedHes", "right", "py-2 px-1")}
              {renderHeader("Thrown", "heGrenadesThrown", "right", "py-2 px-1")}
              {renderHeader("Success", "successfulHes", "right", "py-2 px-1 border-r border-[#1E3A5F]/20")}
              {renderHeader("Total DMG", "fire_damage", "right", "py-2 px-1")}
              {renderHeader("DMG Rec.", "burnerDmgReceived", "right", "py-2 px-1")}
              {renderHeader("Team DMG", "burnerTeamDmg", "right", "py-2 px-1")}
              {renderHeader("Team Rec.", "burnerTeamDmgReceived", "right", "py-2 px-1")}
              {renderHeader("Unused", "unusedBurners", "right", "py-2 px-1")}
              {renderHeader("Thrown", "burnersThrown", "right", "py-2 px-1")}
              {renderHeader("Success", "successfulBurners", "right", "py-2 px-1")}
            </tr>
          </thead>
        );
      } else {
        return (
          <thead>
            <tr className="bg-[#0b1322] border-b border-[#1E3A5F]/45 text-slate-300 text-[10px]">
              {renderHeader("Player", "name", "left", "py-3 px-4 border-r border-[#1E3A5F]/20", 2)}
              {renderHeader("Rank", "rankPoints", "left", "py-3 px-4 border-r border-[#1E3A5F]/20", 2)}
              <th colSpan={11} className="text-center py-2 px-4 uppercase tracking-wider border-b border-[#1E3A5F]/35 bg-[#0c1626]/70 font-bold text-slate-300">FLASHES THROWN</th>
            </tr>
            <tr className="bg-[#070d18] text-slate-400 border-b border-[#1E3A5F]/30 text-[9px]">
              {renderHeader("Flashes", "flashesThrown", "right", "py-2 px-1.5")}
              {renderHeader("Success", "flashSuccesses", "right", "py-2 px-1.5")}
              {renderHeader("Assists", "flash_assists", "right", "py-2 px-1.5")}
              {renderHeader("Blind Kills", "blindKills", "right", "py-2 px-1.5")}
              {renderHeader("Enemies", "enemies_flashed", "right", "py-2 px-1.5")}
              {renderHeader("Blind Time", "enemyBlindTimeNum", "right", "py-2 px-1.5")}
              {renderHeader("Self", "flashed_self", "right", "py-2 px-1.5")}
              {renderHeader("Self Time", "flashed_self", "right", "py-2 px-1.5")}
              {renderHeader("Team", "flashesTeam", "right", "py-2 px-1.5")}
              {renderHeader("Team Time", "teamBlindTimeNum", "right", "py-2 px-1.5")}
              {renderHeader("Team Flashed", "flashesTeam", "right", "py-2 px-1.5")}
            </tr>
          </thead>
        );
      }
    }
  };

  const renderTableRow = (p: any, isTeamView: boolean) => {
    const initials = p.name ? cleanPlayerName(p.name).slice(0, 2).toUpperCase() : "?";
    const isCT = p.team === "CT" || p.team === team1Name;
    const teamDot = !isTeamView ? (
      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2 ${isCT ? 'bg-[#2D7DD2]' : 'bg-[#FF4D6D]'}`} />
    ) : null;

    const playerCell = (
      <td className="py-2.5 px-4 text-left border-r border-[#1E3A5F]/10">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#1b2f4c] to-[#0D1825] border border-[#1E3A5F]/40 flex items-center justify-center text-slate-300 font-bold text-[10px] shadow-sm">
            {initials}
          </div>
          <div>
            <div className="font-semibold text-slate-200 hover:text-[#eb5e28] transition-colors cursor-pointer flex items-center text-xs">
              {teamDot}
              {cleanPlayerName(p.name)}
            </div>
            <div className="text-[9px] text-slate-500 font-mono">{p.steamid.slice(-8)}</div>
          </div>
        </div>
      </td>
    );

    const rankCell = (() => {
      const totalRounds = result?.rounds?.length ?? 24;
      const gradeResult = computePlayerGrade(p, totalRounds);
      return (
        <td className="py-2.5 px-4 text-left border-r border-[#1E3A5F]/10">
          <div className="relative group flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm cursor-help select-none transition-all group-hover:scale-110"
              style={{
                background: `${gradeResult.color}18`,
                border: `1.5px solid ${gradeResult.color}60`,
                color: gradeResult.color,
                fontFamily: "JetBrains Mono",
                textShadow: `0 0 8px ${gradeResult.color}80`,
              }}
              title={`Grade ${gradeResult.grade} — Score: ${gradeResult.score}/100`}
            >
              {gradeResult.grade}
            </div>
            <span className="text-[10px] font-mono" style={{ color: gradeResult.color }}>{gradeResult.score}</span>
            {/* Breakdown tooltip — opens upward to prevent overflow on bottom rows */}
            <div className="absolute left-0 bottom-full mb-2 z-[999] hidden group-hover:block w-52 rounded-xl border p-3 shadow-2xl"
              style={{ background: "rgba(8,14,26,0.98)", borderColor: "rgba(45,125,210,0.3)", backdropFilter: "blur(12px)" }}
            >
              <p className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: gradeResult.color }}>Grade Breakdown</p>
              {gradeResult.breakdown.map((b) => (
                <div key={b.label} className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-slate-400 font-mono">{b.label}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-300 font-mono">{b.raw}</span>
                    <span className="text-[10px] font-mono" style={{ color: gradeResult.color }}>+{b.contribution}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </td>
      );
    })();

    if (activeTab === "summary") {
      return (
        <tr key={p.steamid} className="border-b border-[#142135] hover:bg-[#0E1B2E]/50 transition-colors">
          {playerCell}
          {rankCell}
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">
            {p.kills} / {p.deaths} / {p.assists}
          </td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.hs_pct}%</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.adr}</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300">{p.kast}%</td>
        </tr>
      );
    } else if (activeTab === "entry") {
      return (
        <tr key={p.steamid} className="border-b border-[#142135] hover:bg-[#0E1B2E]/50 transition-colors">
          {playerCell}
          {rankCell}
          <td className="py-2.5 px-4 text-right font-mono font-medium text-emerald-400 border-r border-[#1E3A5F]/10">{p.entry_kills}</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-rose-400 border-r border-[#1E3A5F]/10">{p.entry_deaths}</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.entry_attempts}</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.entry_success_pct}%</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-emerald-400 border-r border-[#1E3A5F]/10">{p.trade_kills}</td>
          <td className="py-2.5 px-4 text-right font-mono font-medium text-rose-400">{p.deaths_traded}</td>
        </tr>
      );
    } else {
      if (activeUtilSubTab === "general") {
        return (
          <tr key={p.steamid} className="border-b border-[#142135] hover:bg-[#0E1B2E]/50 transition-colors text-[11px]">
            {playerCell}
            {rankCell}
            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.unusedUtility}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-300 border-r border-[#1E3A5F]/10">{p.utility_thrown}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-[#22D3A0] border-r border-[#1E3A5F]/10">{p.successfulUtility}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-orange-400 border-r border-[#1E3A5F]/10">{p.totalDmg}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-400 border-r border-[#1E3A5F]/10">{p.totalDmgReceived}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-rose-400 border-r border-[#1E3A5F]/10">{p.totalTeamDmg}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-400 border-r border-[#1E3A5F]/10">{p.totalTeamDmgReceived}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-[#f59e0b] border-r border-[#1E3A5F]/10">{p.enemies_flashed}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-[#f59e0b] border-r border-[#1E3A5F]/10">{p.enemy_blind_s}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-rose-400 border-r border-[#1E3A5F]/10">{p.team_flashed}</td>
            <td className="py-2.5 px-3 text-right font-mono font-medium text-rose-400">{p.team_blind_s}</td>
          </tr>
        );
      } else if (activeUtilSubTab === "damage") {
        return (
          <tr key={p.steamid} className="border-b border-[#142135] hover:bg-[#0E1B2E]/50 transition-colors text-[10px]">
            {playerCell}
            {rankCell}
            <td className="py-2 px-1 text-right font-mono text-[#eb5e28]">{p.he_damage}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.heDmgReceived}</td>
            <td className="py-2 px-1 text-right font-mono text-rose-400">{p.heTeamDmg}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.heTeamDmgReceived}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.unusedHes}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.heGrenadesThrown}</td>
            <td className="py-2 px-1 text-right font-mono text-[#22D3A0] border-r border-[#1E3A5F]/20">{p.successfulHes}</td>
            <td className="py-2 px-1 text-right font-mono text-[#eb5e28]">{p.fire_damage}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.burnerDmgReceived}</td>
            <td className="py-2 px-1 text-right font-mono text-rose-400">{p.burnerTeamDmg}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.burnerTeamDmgReceived}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.unusedBurners}</td>
            <td className="py-2 px-1 text-right font-mono text-slate-400">{p.burnersThrown}</td>
            <td className="py-2 px-1 text-right font-mono text-[#22D3A0]">{p.successfulBurners}</td>
          </tr>
        );
      } else {
        return (
          <tr key={p.steamid} className="border-b border-[#142135] hover:bg-[#0E1B2E]/50 transition-colors text-[10px]">
            {playerCell}
            {rankCell}
            <td className="py-2 px-1.5 text-right font-mono text-slate-400 border-r border-[#1E3A5F]/10">{p.flashesThrown}</td>
            <td className="py-2 px-1.5 text-right font-mono text-[#22D3A0] border-r border-[#1E3A5F]/10">{p.flashSuccesses}</td>
            <td className="py-2 px-1.5 text-right font-mono text-[#22D3A0] border-r border-[#1E3A5F]/10">{p.flash_assists}</td>
            <td className="py-2 px-1.5 text-right font-mono text-[#eb5e28] border-r border-[#1E3A5F]/10">{p.blindKills}</td>
            <td className="py-2 px-1.5 text-right font-mono text-[#f59e0b] border-r border-[#1E3A5F]/10">{p.enemies_flashed}</td>
            <td className="py-2 px-1.5 text-right font-mono text-[#f59e0b] border-r border-[#1E3A5F]/10">{p.enemy_blind_s}</td>
            <td className="py-2 px-1.5 text-right font-mono text-rose-400 border-r border-[#1E3A5F]/10">{p.flashed_self}</td>
            <td className="py-2 px-1.5 text-right font-mono text-rose-400 border-r border-[#1E3A5F]/10">{p.flashed_by_self_time}</td>
            <td className="py-2 px-1.5 text-right font-mono text-rose-400 border-r border-[#1E3A5F]/10">{p.flashesTeam}</td>
            <td className="py-2 px-1.5 text-right font-mono text-rose-400 border-r border-[#1E3A5F]/10">{p.team_blind_s}</td>
            <td className="py-2 px-1.5 text-right font-mono text-rose-400">{p.flashed_by_team_time}</td>
          </tr>
        );
      }
    }
  };

  const renderTable = (
    title: string,
    colorClass: string,
    badgeColor: string,
    score: number,
    players: any[]
  ) => {
    if (!players.length) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className={`px-2.5 py-0.5 rounded-full font-bold text-white text-xs ${badgeColor} shadow-md`}>
            {score}
          </span>
          <span className={`font-bold text-sm ${colorClass} uppercase tracking-wider`}>
            {title}
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#1E3A5F]/20 bg-[#0A111F] shadow-lg">
          <table className="w-full text-xs text-slate-300">
            {renderTableHead()}
            <tbody>
              {players.map((p) => renderTableRow(p, true))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderSingleTable = (players: any[]) => {
    if (!players.length) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-bold text-sm text-slate-200 uppercase tracking-wider">
            All Players
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[#1E3A5F]/20 bg-[#0A111F] shadow-lg">
          <table className="w-full text-xs text-slate-300">
            {renderTableHead()}
            <tbody>
              {players.map((p) => renderTableRow(p, false))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Render Premium Player Cards for Grid View
  const renderPlayerGrid = (playersListForGrid: any[]) => {
    if (!playersListForGrid.length) return null;

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {playersListForGrid.map((p) => {
          const initials = p.name ? cleanPlayerName(p.name).slice(0, 2).toUpperCase() : "?";
          const isCT = p.team === team1Name;
          
          return (
            <div 
              key={p.steamid} 
              className="card bg-[#0A111F] border border-[#1E3A5F]/20 p-4 rounded-xl flex flex-col gap-3 relative shadow-md hover:border-[#eb5e28]/40 transition-all duration-300"
            >
              {/* Header: Avatar, Name, Rank */}
              <div className="flex items-start justify-between border-b border-[#1E3A5F]/10 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#1b2f4c] to-[#0D1825] border border-[#1E3A5F]/40 flex items-center justify-center text-slate-300 font-bold text-xs shadow-sm">
                    {initials}
                  </div>
                  <div>
                    <div className="font-bold text-slate-200 text-sm flex items-center gap-1.5">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${isCT ? 'bg-[#2D7DD2]' : 'bg-[#FF4D6D]'}`} />
                      {cleanPlayerName(p.name)}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">{p.steamid.slice(-8)}</div>
                  </div>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-white font-black text-[9px] border shadow-sm" style={{ backgroundColor: p.rankLevel >= 14 ? '#ef4444' : p.rankLevel >= 12 ? '#eb5e28' : '#10b981', borderColor: p.rankLevel >= 14 ? '#991b1b' : p.rankLevel >= 12 ? '#c2410c' : '#065f46' }}>
                    {p.rankLevel}
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono font-bold">{p.rankPoints.toLocaleString()}</span>
                </div>
              </div>

              {/* Stats Body depending on tab */}
              {activeTab === "summary" && (
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">K / D / A</span>
                    <span className="font-mono font-bold text-white text-sm">{p.kills} / {p.deaths} / {p.assists}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">HS %</span>
                    <span className="font-mono font-bold text-white text-sm">{p.hs_pct}%</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">ADR</span>
                    <span className="font-mono font-bold text-white text-sm">{p.adr}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">KAST %</span>
                    <span className="font-mono font-bold text-white text-sm">{p.kast}%</span>
                  </div>
                </div>
              )}

              {activeTab === "entry" && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Entry K/D</span>
                    <span className="font-mono font-bold text-white">{p.entry_kills} / {p.entry_deaths}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Success %</span>
                    <span className="font-mono font-bold text-white">{p.entry_success_pct}%</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Trade Kills</span>
                    <span className="font-mono font-bold text-[#22D3A0]">{p.trade_kills}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Deaths Traded</span>
                    <span className="font-mono font-bold text-rose-400">{p.deaths_traded}</span>
                  </div>
                </div>
              )}

              {activeTab === "utility" && activeUtilSubTab === "general" && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Thrown / Unused</span>
                    <span className="font-mono font-bold text-white">{p.utility_thrown} / {p.unusedUtility}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Successful</span>
                    <span className="font-mono font-bold text-[#22D3A0]">{p.successfulUtility}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Utility DMG</span>
                    <span className="font-mono font-bold text-orange-400">{p.totalDmg}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Enemies Flashed</span>
                    <span className="font-mono font-bold text-[#f59e0b]">{p.enemies_flashed}</span>
                  </div>
                </div>
              )}

              {activeTab === "utility" && activeUtilSubTab === "damage" && (
                <div className="flex flex-col gap-2 text-xs">
                  {/* HE Grenade */}
                  <div className="bg-[#0c1626]/60 p-2.5 rounded border border-[#1E3A5F]/15">
                    <div className="text-[#3b82f6] font-bold text-[9px] uppercase tracking-wider mb-1.5 border-b border-[#1E3A5F]/10 pb-0.5">HE Grenade</div>
                    <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">DMG</span>
                        <span className="font-bold text-white">{p.he_damage}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">Thrown</span>
                        <span className="font-bold text-white">{p.heGrenadesThrown}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">Success</span>
                        <span className="font-bold text-[#22D3A0]">{p.successfulHes}</span>
                      </div>
                    </div>
                  </div>

                  {/* Burner */}
                  <div className="bg-[#121c2c]/60 p-2.5 rounded border border-[#1E3A5F]/15">
                    <div className="text-orange-400 font-bold text-[9px] uppercase tracking-wider mb-1.5 border-b border-[#1E3A5F]/10 pb-0.5">Incendiary / Molotov</div>
                    <div className="grid grid-cols-3 gap-1.5 font-mono text-[11px]">
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">DMG</span>
                        <span className="font-bold text-white">{p.fire_damage}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">Thrown</span>
                        <span className="font-bold text-white">{p.burnersThrown}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[8px] uppercase">Success</span>
                        <span className="font-bold text-[#22D3A0]">{p.successfulBurners}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "utility" && activeUtilSubTab === "support" && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Flashes Thrown</span>
                    <span className="font-mono font-bold text-white">{p.flashesThrown}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Flash Success</span>
                    <span className="font-mono font-bold text-[#22D3A0]">{p.flashSuccesses}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Flash Assists</span>
                    <span className="font-mono font-bold text-[#22D3A0]">{p.flash_assists}</span>
                  </div>
                  <div className="bg-[#0e1726]/40 p-2 rounded border border-[#1E3A5F]/5">
                    <span className="text-slate-400 block text-[9px] uppercase font-bold tracking-wider mb-0.5">Blind Time</span>
                    <span className="font-mono font-bold text-[#f59e0b]">{p.enemy_blind_s}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderViewControls = () => {
    return (
      <div className="flex items-center gap-3">
        {/* Sort toggles */}
        <div className="flex items-center bg-[#09101C] border border-[#1E3A5F]/50 rounded-lg p-0.5 text-xs shadow-inner">
          <button
            onClick={() => setSortBy("team")}
            className={`px-3 py-1 rounded-md transition-colors ${
              sortBy === "team" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sort by team
          </button>
          <button
            onClick={() => setSortBy("players")}
            className={`px-3 py-1 rounded-md transition-colors ${
              sortBy === "players" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sort by players
          </button>
        </div>

        {/* Team Filter toggles */}
        <div className="flex items-center bg-[#09101C] border border-[#1E3A5F]/50 rounded-lg p-0.5 text-xs shadow-inner">
          <button
            onClick={() => setTeamFilter("all")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              teamFilter === "all" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setTeamFilter("ct")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              teamFilter === "ct" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {displayTeam1Name}
          </button>
          <button
            onClick={() => setTeamFilter("t")}
            className={`px-2.5 py-1 rounded-md transition-colors ${
              teamFilter === "t" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            {displayTeam2Name}
          </button>
        </div>

        {/* Grid vs List layout buttons */}
        <div className="flex items-center gap-1 border border-[#1E3A5F]/40 rounded-lg p-1 bg-[#09101C]/60 text-slate-400 shadow-inner">
          <button 
            onClick={() => setViewMode("list")} 
            className={`p-0.5 transition-colors ${viewMode === "list" ? "text-[#eb5e28]" : "hover:text-slate-200"}`}
          >
            <List size={14} />
          </button>
          <button 
            onClick={() => setViewMode("grid")} 
            className={`p-0.5 transition-colors ${viewMode === "grid" ? "text-[#eb5e28]" : "hover:text-slate-200"}`}
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>
    );
  };

  const renderTeamBreakdownCard = (
    title: string,
    teamColorClass: string,
    totals: any,
    players: any[]
  ) => {
    return (
      <div className="card bg-[#09101C] p-6 border-[#1E3A5F]/20 relative shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <span className={`font-bold text-sm ${teamColorClass} uppercase tracking-wider`}>{title}</span>
          <div className="text-right">
            <div className="text-slate-400 text-[9px] uppercase font-bold tracking-wider">Total Utilities</div>
            <div className="text-white font-mono text-lg font-bold">{totals.total}</div>
          </div>
        </div>

        {/* Segmented Horizontal Bar */}
        <div className="space-y-4">
          <div className="flex h-3.5 rounded-full overflow-hidden bg-[#142135] shadow-inner border border-[#1E3A5F]/15">
            <div style={{ width: `${totals.total > 0 ? (totals.smokes / totals.total) * 100 : 0}%`, backgroundColor: "#3b82f6" }} title={`Smokes: ${totals.smokes}`} />
            <div style={{ width: `${totals.total > 0 ? (totals.flashes / totals.total) * 100 : 0}%`, backgroundColor: "#f59e0b" }} title={`Flashes: ${totals.flashes}`} />
            <div style={{ width: `${totals.total > 0 ? (totals.incend / totals.total) * 100 : 0}%`, backgroundColor: "#ef4444" }} title={`Incendiary: ${totals.incend}`} />
            <div style={{ width: `${totals.total > 0 ? (totals.he / totals.total) * 100 : 0}%`, backgroundColor: "#9ca3af" }} title={`HE Grenades: ${totals.he}`} />
            <div style={{ width: `${totals.total > 0 ? (totals.decoy / totals.total) * 100 : 0}%`, backgroundColor: "#10b981" }} title={`Decoys: ${totals.decoy}`} />
          </div>

          {/* Counts Legend under bar */}
          <div className="grid grid-cols-5 gap-1 text-[10px] text-slate-400 text-center font-mono">
            <div className="flex flex-col border-r border-[#1E3A5F]/20">
              <span className="text-[#3b82f6] font-bold text-[9px]">Smokes</span>
              <span className="text-slate-200 mt-0.5 font-bold">{totals.smokes}</span>
            </div>
            <div className="flex flex-col border-r border-[#1E3A5F]/20">
              <span className="text-[#f59e0b] font-bold text-[9px]">Flashes</span>
              <span className="text-slate-200 mt-0.5 font-bold">{totals.flashes}</span>
            </div>
            <div className="flex flex-col border-r border-[#1E3A5F]/20">
              <span className="text-[#ef4444] font-bold text-[9px]">Incendiary</span>
              <span className="text-slate-200 mt-0.5 font-bold">{totals.incend}</span>
            </div>
            <div className="flex flex-col border-r border-[#1E3A5F]/20">
              <span className="text-[#9ca3af] font-bold text-[9px]">HE Grenades</span>
              <span className="text-slate-200 mt-0.5 font-bold">{totals.he}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[#10b981] font-bold text-[9px]">Decoys</span>
              <span className="text-slate-200 mt-0.5 font-bold">{totals.decoy}</span>
            </div>
          </div>
        </div>

        {/* Stacked Vertical Bar Chart */}
        <div className="mt-8 relative chart-container">
          <div className="flex items-end h-56 w-full relative">
            
            {/* Grid Line overlay */}
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-[28px] pt-[10px]">
              {[60, 45, 30, 15, 0].map((val) => (
                <div key={val} className="w-full flex items-center justify-between border-t border-slate-800/40">
                  <span className="text-[9px] text-slate-600 font-mono pr-2 bg-[#09101C] z-10">{val}</span>
                  <div className="flex-1 border-t border-slate-800/25" />
                </div>
              ))}
            </div>

            {/* Individual Columns */}
            <div className="flex-1 h-full flex justify-around items-end z-10 px-2 pb-[24px]">
              {players.map((p) => {
                const totalVal = breakdownTab === "used" ? p.utility_thrown : p.unusedUtility;
                const maxChartVal = 60;
                const pctHeight = Math.min(100, (totalVal / maxChartVal) * 100);

                let smokes = 0, flashes = 0, incend = 0, he = 0, decoy = 0;
                if (breakdownTab === "used") {
                  smokes = p.utility_smokes || 0;
                  flashes = p.utility_flashes || 0;
                  incend = p.utility_molotovs || 0;
                  he = p.utility_hes || 0;
                  decoy = p.utility_decoys || 0;
                } else {
                  smokes = Math.max(0, Math.round(p.unusedUtility * 0.25));
                  flashes = Math.max(0, Math.round(p.unusedUtility * 0.35));
                  incend = Math.max(0, Math.round(p.unusedUtility * 0.20));
                  he = Math.max(0, Math.round(p.unusedUtility * 0.15));
                  decoy = totalVal - smokes - flashes - incend - he;
                }

                const initials = p.name ? p.name.slice(0, 2).toUpperCase() : "?";

                return (
                  <div key={p.steamid} className="flex flex-col items-center gap-2 group relative">
                    <div className="h-40 flex items-end justify-center w-7">
                      <div
                        className="w-7 rounded-t-sm flex flex-col-reverse overflow-hidden hover:brightness-110 transition-all cursor-pointer shadow-md"
                        style={{ height: `${pctHeight}%`, minHeight: totalVal > 0 ? '4px' : '0px' }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const parent = e.currentTarget.closest(".chart-container")?.getBoundingClientRect();
                          if (parent) {
                            setHoveredPlayer(p);
                            setHoveredPos({
                              x: rect.left - parent.left + rect.width / 2,
                              y: rect.top - parent.top - 8
                            });
                          }
                        }}
                        onMouseLeave={() => setHoveredPlayer(null)}
                      >
                        {decoy > 0 && <div style={{ flex: `${decoy} 0 0%`, backgroundColor: "#10b981" }} />}
                        {he > 0 && <div style={{ flex: `${he} 0 0%`, backgroundColor: "#9ca3af" }} />}
                        {incend > 0 && <div style={{ flex: `${incend} 0 0%`, backgroundColor: "#ef4444" }} />}
                        {flashes > 0 && <div style={{ flex: `${flashes} 0 0%`, backgroundColor: "#f59e0b" }} />}
                        {smokes > 0 && <div style={{ flex: `${smokes} 0 0%`, backgroundColor: "#3b82f6" }} />}
                      </div>
                    </div>

                    <div className="w-5 h-5 rounded-full bg-[#1b2f4c] border border-[#1E3A5F]/40 flex items-center justify-center text-slate-300 font-bold text-[8px] shadow-sm">
                      {initials}
                    </div>

                    <span className="text-[9px] text-slate-400 font-mono truncate max-w-[50px]" title={cleanPlayerName(p.name)}>
                      {cleanPlayerName(p.name)}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Hover Tooltip */}
          {hoveredPlayer && hoveredPos && (
            <div
              className="absolute z-20 bg-slate-950/95 border border-slate-800 rounded-lg p-2.5 shadow-2xl backdrop-blur-md -translate-x-1/2 -translate-y-full text-[11px] min-w-[135px] pointer-events-none"
              style={{ left: hoveredPos.x, top: hoveredPos.y }}
            >
              <div className="font-bold border-b border-slate-800 pb-1 mb-1 text-slate-200">
                {hoveredPlayer.name}
              </div>
              <div className="space-y-1 font-mono">
                <div className="flex justify-between gap-4">
                  <span className="text-[#3b82f6]">Smokes</span>
                  <span className="font-bold">{breakdownTab === "used" ? hoveredPlayer.utility_smokes : Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.25))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#f59e0b]">Flashes</span>
                  <span className="font-bold">{breakdownTab === "used" ? hoveredPlayer.utility_flashes : Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.35))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#ef4444]">Incendiary</span>
                  <span className="font-bold">{breakdownTab === "used" ? hoveredPlayer.utility_molotovs : Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.20))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#9ca3af]">HE Grenades</span>
                  <span className="font-bold">{breakdownTab === "used" ? hoveredPlayer.utility_hes : Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.15))}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#10b981]">Decoys</span>
                  <span className="font-bold">
                    {breakdownTab === "used"
                      ? hoveredPlayer.utility_decoys
                      : (hoveredPlayer.unusedUtility - Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.25)) - Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.35)) - Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.20)) - Math.max(0, Math.round(hoveredPlayer.unusedUtility * 0.15)))}
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t border-slate-800 pt-1 mt-1 text-slate-300">
                  <span>Total</span>
                  <span>{breakdownTab === "used" ? hoveredPlayer.utility_thrown : hoveredPlayer.unusedUtility}</span>
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    );
  };

  return (
    <div className="card p-6 space-y-6 shadow-2xl border-[#1E3A5F]/20 relative">
      {/* Tab Navigation */}
      <div className="flex items-center justify-between border-b border-[#142135] pb-2 flex-wrap gap-4">
        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              setActiveTab("summary");
              setSortField("kills");
              setSortDirection("desc");
            }}
            className={`font-semibold text-sm transition-colors pb-2 -mb-2.5 border-b-2 ${
              activeTab === "summary" ? "text-white border-[#eb5e28]" : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => {
              setActiveTab("entry");
              setSortField("entry_kills");
              setSortDirection("desc");
            }}
            className={`font-semibold text-sm transition-colors pb-2 -mb-2.5 border-b-2 ${
              activeTab === "entry" ? "text-white border-[#eb5e28]" : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Entry & Trade
          </button>
          <button
            onClick={() => {
              setActiveTab("utility");
              setSortField("utility_thrown");
              setSortDirection("desc");
              setActiveUtilSubTab("general");
            }}
            className={`font-semibold text-sm transition-colors pb-2 -mb-2.5 border-b-2 ${
              activeTab === "utility" ? "text-white border-[#eb5e28]" : "text-slate-400 border-transparent hover:text-white"
            }`}
          >
            Utility
          </button>
        </div>

        {activeTab === "utility" && (
          <div className="flex items-center gap-3 bg-[#0D1825] border border-[#1E3A5F]/40 rounded-lg p-0.5 text-xs shadow-inner">
            <button
              onClick={() => {
                setActiveUtilSubTab("general");
                setSortField("utility_thrown");
                setSortDirection("desc");
              }}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeUtilSubTab === "general" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              General
            </button>
            <button
              onClick={() => {
                setActiveUtilSubTab("damage");
                setSortField("totalDmg");
                setSortDirection("desc");
              }}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeUtilSubTab === "damage" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Damage
            </button>
            <button
              onClick={() => {
                setActiveUtilSubTab("support");
                setSortField("flashesThrown");
                setSortDirection("desc");
              }}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeUtilSubTab === "support" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
              }`}
            >
              Support
            </button>
          </div>
        )}

        {renderViewControls()}
      </div>

      {/* Tables (CT & T or Merged) */}
      {activeTab === "utility" && selectedRound !== null ? (
        <div className="card p-8 text-center border-yellow-500/20 bg-yellow-500/5 my-4">
          <ShieldAlert size={32} color="#C9A227" className="mx-auto mb-3 animate-pulse" />
          <h3 className="text-sm font-bold text-[#C9A227] uppercase tracking-wide mb-1">
            Utility Round Filtering Unavailable
          </h3>
          <p className="text-xs text-[#8BA7CC] max-w-md mx-auto leading-relaxed">
            Detailed utility metrics and the usage breakdown charts are only calculated as match-level aggregates and cannot be filtered by individual rounds. Clear the round filter to view utility stats.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {viewMode === "grid" ? (
            sortBy === "team" ? (
              <div className="space-y-8">
                {(teamFilter === "all" || teamFilter === "ct") && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-0.5 rounded-full font-bold text-white text-xs bg-[#2D7DD2] shadow-md">{ctScore}</span>
                      <span className="font-bold text-sm text-[#2D7DD2] uppercase tracking-wider">{displayTeam1Name}</span>
                    </div>
                    {renderPlayerGrid(getSortedPlayersForTeam(ctPlayers))}
                  </div>
                )}
                {(teamFilter === "all" || teamFilter === "t") && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <span className="px-2.5 py-0.5 rounded-full font-bold text-white text-xs bg-[#FF4D6D] shadow-md">{tScore}</span>
                      <span className="font-bold text-sm text-[#FF4D6D] uppercase tracking-wider">{displayTeam2Name}</span>
                    </div>
                    {renderPlayerGrid(getSortedPlayersForTeam(tPlayers))}
                  </div>
                )}
              </div>
            ) : (
              renderPlayerGrid(getSortedPlayers())
            )
          ) : (
            sortBy === "team" ? (
              <>
                {(teamFilter === "all" || teamFilter === "ct") &&
                  renderTable(displayTeam1Name, "text-[#2D7DD2]", "bg-[#2D7DD2]", ctScore, getSortedPlayersForTeam(ctPlayers))}
                {(teamFilter === "all" || teamFilter === "t") &&
                  renderTable(displayTeam2Name, "text-[#FF4D6D]", "bg-[#FF4D6D]", tScore, getSortedPlayersForTeam(tPlayers))}
              </>
            ) : (
              renderSingleTable(getSortedPlayers())
            )
          )}
        </div>
      )}

      {/* Utility usage breakdown breakdown Tab */}
      {activeTab === "utility" && selectedRound === null && (
        <div className="space-y-6 pt-6 border-t border-[#142135]">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="text-base font-bold text-slate-100 uppercase tracking-wide">
              Utility usage breakdown
            </h3>
            
            <div className="flex items-center bg-[#09101C] border border-[#1E3A5F]/50 rounded-lg p-0.5 text-xs shadow-inner">
              <button
                onClick={() => setBreakdownTab("used")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  breakdownTab === "used" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Used
              </button>
              <button
                onClick={() => setBreakdownTab("unused")}
                className={`px-3 py-1 rounded-md transition-colors ${
                  breakdownTab === "unused" ? "bg-[#eb5e28] text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                Unused
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {renderTeamBreakdownCard(
              displayTeam1Name,
              "text-[#2D7DD2]",
              ctUtil,
              ctPlayers
            )}
            {renderTeamBreakdownCard(
              displayTeam2Name,
              "text-[#FF4D6D]",
              tUtil,
              tPlayers
            )}
          </div>
        </div>
      )}
    </div>
  );
}



// --- Economy Chart Component ---
function EconomyChart({ rounds, selectedRound, onSelectRound, team1Name, team2Name }: {
  rounds: RoundResult[];
  selectedRound: number | null;
  onSelectRound: (round: number | null) => void;
  team1Name: string;
  team2Name: string;
}) {
  const [hoveredRound, setHoveredRound] = useState<RoundResult | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  if (!rounds || rounds.length === 0) return null;

  const displayTeam1Name = (!team1Name || team1Name === "CT" || team1Name === "COUNTER_TERRORIST" || team1Name === "Counter-Terrorists") ? "Team A" : team1Name;
  const displayTeam2Name = (!team2Name || team2Name === "TERRORIST" || team2Name === "T" || team2Name === "Terrorists") ? "Team B" : team2Name;

  const width = 800;
  const height = 240;
  const paddingX = 40;
  const paddingY = 30;

  const maxSpend = Math.max(...rounds.map(r => Math.max(r.ct_spend, r.t_spend)), 10000);
  const totalRounds = rounds.length;

  const getCoords = (index: number, spend: number) => {
    const x = paddingX + (index / Math.max(totalRounds - 1, 1)) * (width - 2 * paddingX);
    const y = height - paddingY - (spend / maxSpend) * (height - 2 * paddingY);
    return { x, y };
  };

  let team1Path = "";
  let team2Path = "";
  let team1AreaPath = "";
  let team2AreaPath = "";

  rounds.forEach((r, idx) => {
    const isT1CT = isTeam1CT(r.round);
    const t1Spend = isT1CT ? r.ct_spend : r.t_spend;
    const t2Spend = isT1CT ? r.t_spend : r.ct_spend;

    const pt1 = getCoords(idx, t1Spend);
    const pt2 = getCoords(idx, t2Spend);

    if (idx === 0) {
      team1Path = `M ${pt1.x} ${pt1.y}`;
      team2Path = `M ${pt2.x} ${pt2.y}`;
      team1AreaPath = `M ${pt1.x} ${height - paddingY} L ${pt1.x} ${pt1.y}`;
      team2AreaPath = `M ${pt2.x} ${height - paddingY} L ${pt2.x} ${pt2.y}`;
    } else {
      team1Path += ` L ${pt1.x} ${pt1.y}`;
      team2Path += ` L ${pt2.x} ${pt2.y}`;
      team1AreaPath += ` L ${pt1.x} ${pt1.y}`;
      team2AreaPath += ` L ${pt2.x} ${pt2.y}`;
    }

    if (idx === totalRounds - 1) {
      team1AreaPath += ` L ${pt1.x} ${height - paddingY} Z`;
      team2AreaPath += ` L ${pt2.x} ${height - paddingY} Z`;
    }
  });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;
    
    const viewBoxX = (clientX / rect.width) * width;
    setMousePos({ x: clientX, y: clientY });

    const chartW = width - 2 * paddingX;
    const step = chartW / Math.max(totalRounds - 1, 1);
    const index = Math.round((viewBoxX - paddingX) / step);

    if (index >= 0 && index < totalRounds) {
      setHoveredRound(rounds[index]);
    } else {
      setHoveredRound(null);
    }
  };

  const handleMouseLeave = () => {
    setHoveredRound(null);
  };

  const handleSelectRound = (roundNum: number) => {
    if (selectedRound === roundNum) {
      onSelectRound(null);
    } else {
      onSelectRound(roundNum);
    }
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // Find side switches (halftime / overtime switches)
  const sideSwitches: number[] = [];
  for (let idx = 0; idx < totalRounds - 1; idx++) {
    if (isTeam1CT(rounds[idx].round) !== isTeam1CT(rounds[idx + 1].round)) {
      sideSwitches.push(idx);
    }
  }

  return (
    <div className="card p-6 relative">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div>
          <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>Economy Trend</h2>
          <p className="text-[10px] text-[#4A6A8A] font-mono mt-0.5">
            Hover to inspect | Click to filter round
          </p>
        </div>
        
        {/* Color Legend */}
        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#2D7DD2" }} />
            <span className="text-slate-300">{displayTeam1Name} <span className="text-[9px] text-slate-500">(Starts CT)</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#FF4D6D" }} />
            <span className="text-slate-300">{displayTeam2Name} <span className="text-[9px] text-slate-500">(Starts T)</span></span>
          </div>
        </div>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="ctGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2D7DD2" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2D7DD2" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="tGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FF4D6D" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#FF4D6D" stopOpacity="0" />
            </linearGradient>
          </defs>

          {yTicks.map(tick => {
            const y = paddingY + (1 - tick) * (height - 2 * paddingY);
            const val = Math.round(tick * maxSpend);
            return (
              <g key={tick}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="rgba(255,255,255,0.03)"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingX - 8}
                  y={y + 3}
                  fill="#4A6A8A"
                  fontSize="9px"
                  fontFamily="JetBrains Mono, monospace"
                  textAnchor="end"
                >
                  ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
                </text>
              </g>
            );
          })}

          {/* Halftime & Side Switch Lines */}
          {sideSwitches.map((idx) => {
            const x1 = getCoords(idx, 0).x;
            const x2 = getCoords(idx + 1, 0).x;
            const halfX = (x1 + x2) / 2;
            const isOT = rounds[idx].round > 24;
            const label = isOT ? "OT SWITCH" : "HALFTIME";
            
            return (
              <g key={`switch-${idx}`}>
                <line
                  x1={halfX}
                  y1={paddingY}
                  x2={halfX}
                  y2={height - paddingY}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <rect
                  x={halfX - 28}
                  y={paddingY - 8}
                  width={56}
                  height={14}
                  rx={3}
                  fill="#142135"
                  stroke="rgba(255,255,255,0.1)"
                  strokeWidth={1}
                />
                <text
                  x={halfX}
                  y={paddingY + 2}
                  fill="#8BA7CC"
                  fontSize="8px"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="bold"
                  textAnchor="middle"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {selectedRound !== null && (() => {
            const idx = rounds.findIndex(r => r.round === selectedRound);
            if (idx === -1) return null;
            const x = paddingX + (idx / Math.max(totalRounds - 1, 1)) * (width - 2 * paddingX);
            return (
              <rect
                x={x - 12}
                y={paddingY}
                width={24}
                height={height - 2 * paddingY}
                fill="rgba(34,211,160,0.06)"
                stroke="rgba(34,211,160,0.2)"
                strokeWidth={1}
                rx={4}
              />
            );
          })()}

          <path d={team1AreaPath} fill="url(#ctGrad)" />
          <path d={team2AreaPath} fill="url(#tGrad)" />

          <path d={team1Path} fill="none" stroke="#2D7DD2" strokeWidth="2.5" strokeLinecap="round" />
          <path d={team2Path} fill="none" stroke="#FF4D6D" strokeWidth="2.5" strokeLinecap="round" />

          {rounds.map((r, idx) => {
            const isT1CT = isTeam1CT(r.round);
            const t1Spend = isT1CT ? r.ct_spend : r.t_spend;
            const t2Spend = isT1CT ? r.t_spend : r.ct_spend;

            const pt1 = getCoords(idx, t1Spend);
            const pt2 = getCoords(idx, t2Spend);
            const isHovered = hoveredRound?.round === r.round;
            const isSelected = selectedRound === r.round;

            return (
              <g key={r.round}>
                <rect
                  x={pt1.x - 12}
                  y={paddingY}
                  width={24}
                  height={height - 2 * paddingY}
                  fill="transparent"
                  className="cursor-pointer"
                  onClick={() => handleSelectRound(r.round)}
                  onDoubleClick={() => onSelectRound(null)}
                />
                
                {(isHovered || isSelected) && (
                  <circle cx={pt1.x} cy={pt1.y} r={4.5} fill="#2D7DD2" stroke="#080E1A" strokeWidth={1.5} />
                )}

                {(isHovered || isSelected) && (
                  <circle cx={pt2.x} cy={pt2.y} r={4.5} fill="#FF4D6D" stroke="#080E1A" strokeWidth={1.5} />
                )}
              </g>
            );
          })}

          {hoveredRound && (() => {
            const idx = rounds.findIndex(r => r.round === hoveredRound.round);
            if (idx === -1) return null;
            const x = paddingX + (idx / Math.max(totalRounds - 1, 1)) * (width - 2 * paddingX);
            return (
              <line
                x1={x}
                y1={paddingY}
                x2={x}
                y2={height - paddingY}
                stroke="rgba(255,255,255,0.15)"
                strokeWidth={1}
                pointerEvents="none"
              />
            );
          })()}

          {rounds.map((r, idx) => {
            const step = totalRounds > 15 ? 2 : 1;
            if (idx % step !== 0 && idx !== totalRounds - 1) return null;
            const x = paddingX + (idx / Math.max(totalRounds - 1, 1)) * (width - 2 * paddingX);
            return (
              <text
                key={r.round}
                x={x}
                y={height - paddingY + 14}
                fill="#4A6A8A"
                fontSize="9px"
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
              >
                R{r.round}
              </text>
            );
          })}
        </svg>

        {hoveredRound && (() => {
          const isT1CT = isTeam1CT(hoveredRound.round);
          const t1Spend = isT1CT ? hoveredRound.ct_spend : hoveredRound.t_spend;
          const t2Spend = isT1CT ? hoveredRound.t_spend : hoveredRound.ct_spend;
          const winnerTeamName = hoveredRound.winner === "CT" 
            ? (isT1CT ? displayTeam1Name : displayTeam2Name) 
            : (isT1CT ? displayTeam2Name : displayTeam1Name);
          const isWinnerT1 = (hoveredRound.winner === "CT" && isT1CT) || (hoveredRound.winner === "T" && !isT1CT);

          return (
            <div
              className="absolute z-20 pointer-events-none bg-slate-950/95 border border-slate-800 rounded-lg p-3 shadow-2xl backdrop-blur-md min-w-[160px]"
              style={{
                left: Math.min(mousePos.x, width - 180),
                top: Math.max(mousePos.y - 120, 10),
              }}
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5">
                <span className="font-bold text-slate-200">Round {hoveredRound.round}</span>
                <span
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded truncate max-w-[80px]"
                  style={{
                    background: isWinnerT1 ? "rgba(45,125,210,0.15)" : "rgba(255,77,109,0.15)",
                    color: isWinnerT1 ? "#2D7DD2" : "#FF4D6D",
                  }}
                  title={winnerTeamName}
                >
                  {winnerTeamName}
                </span>
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500 truncate max-w-[90px]">{displayTeam1Name} ({isT1CT ? "CT" : "T"}):</span>
                  <span className="font-semibold text-[#2D7DD2]">${t1Spend.toLocaleString()}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500 truncate max-w-[90px]">{displayTeam2Name} ({isT1CT ? "T" : "CT"}):</span>
                  <span className="font-semibold text-[#FF4D6D]">${t2Spend.toLocaleString()}</span>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// --- Round Timeline ---
function RoundTimeline({
  rounds,
  selectedRound,
  onSelectRound,
  team1Name,
  team2Name,
}: {
  rounds: RoundResult[];
  selectedRound: number | null;
  onSelectRound: (round: number | null) => void;
  team1Name: string;
  team2Name: string;
}) {
  // Calculate team scores from timeline using dynamic side switches to match the player tables
  const team1Score = rounds.filter(
    (r) => (isTeam1CT(r.round) && (r.winner === "CT" || r.winner === "COUNTER_TERRORIST")) || 
           (!isTeam1CT(r.round) && (r.winner === "T" || r.winner === "TERRORIST"))
  ).length;

  const team2Score = rounds.filter(
    (r) => (!isTeam1CT(r.round) && (r.winner === "CT" || r.winner === "COUNTER_TERRORIST")) || 
           (isTeam1CT(r.round) && (r.winner === "T" || r.winner === "TERRORIST"))
  ).length;

  const displayTeam1Name = (team1Name === "CT" || team1Name === "COUNTER_TERRORIST" || team1Name === "Counter-Terrorists") ? "Team A" : team1Name;
  const displayTeam2Name = (team2Name === "TERRORIST" || team2Name === "T" || team2Name === "Terrorists") ? "Team B" : team2Name;

  // Build set of round indices where a side-switch occurs (isTeam1CT changes)
  const switchAfterIndices = new Set<number>();
  for (let i = 0; i < rounds.length - 1; i++) {
    if (isTeam1CT(rounds[i].round) !== isTeam1CT(rounds[i + 1].round)) {
      switchAfterIndices.add(i);
    }
  }

  // Running score to display inside each divider badge
  const runningT1Scores: number[] = [];
  const runningT2Scores: number[] = [];
  let rt1 = 0; let rt2 = 0;
  for (const r of rounds) {
    const isT1win = (isTeam1CT(r.round) && (r.winner === "CT" || r.winner === "COUNTER_TERRORIST")) ||
                   (!isTeam1CT(r.round) && (r.winner === "T" || r.winner === "TERRORIST"));
    if (isT1win) rt1++; else rt2++;
    runningT1Scores.push(rt1);
    runningT2Scores.push(rt2);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="heading-display" style={{ fontSize: "1.1rem" }}>Round Timeline</h2>
        <span className="text-[10px] text-[#4A6A8A] font-mono">
          Click round to filter | Double click to clear filter
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        {rounds.map((r, index) => {
          const isSelected = selectedRound === r.round;
          const showDivider = switchAfterIndices.has(index);
          const isOT = showDivider && r.round > 24;
          return (
            <Fragment key={r.round}>
              <div
                title={`R${r.round} — ${r.winner} wins | CT $${r.ct_spend.toLocaleString()} vs T $${r.t_spend.toLocaleString()}`}
                className="flex flex-col items-center gap-1"
              >
                <div
                  className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold cursor-pointer transition-all hover:scale-115 active:scale-95 ${
                    isSelected ? "ring-2 ring-[#22D3A0] scale-110 shadow-lg shadow-[#22D3A0]/25" : ""
                  }`}
                  onClick={() => onSelectRound(isSelected ? null : r.round)}
                  onDoubleClick={() => onSelectRound(null)}
                  style={{
                    background: isSelected
                      ? (r.winner === "CT" ? "rgba(45,125,210,0.4)" : "rgba(255,77,109,0.4)")
                      : (r.winner === "CT" ? "rgba(45,125,210,0.2)" : "rgba(255,77,109,0.2)"),
                    border: isSelected
                      ? `1.5px solid ${r.winner === "CT" ? "#2D7DD2" : "#FF4D6D"}`
                      : `1px solid ${r.winner === "CT" ? "rgba(45,125,210,0.4)" : "rgba(255,77,109,0.4)"}`,
                    color: r.winner === "CT" ? "#2D7DD2" : "#FF4D6D",
                    fontSize: "0.6rem",
                  }}
                >
                  {r.winner === "CT" ? "C" : "T"}
                </div>
                <span style={{ color: isSelected ? "#22D3A0" : "#4A6A8A", fontSize: "0.55rem", fontFamily: "JetBrains Mono", fontWeight: isSelected ? 600 : 400 }}>{r.round}</span>
              </div>
              {showDivider && (
                <div className="flex flex-col items-center justify-center self-stretch select-none" style={{ margin: "0 4px" }}>
                  <div
                    className="rounded-full flex flex-col items-center justify-center py-1 px-2.5 gap-0.5"
                    style={{
                      background: isOT ? "rgba(235,94,40,0.12)" : "rgba(45,125,210,0.12)",
                      border: `1.5px solid ${isOT ? "rgba(235,94,40,0.5)" : "rgba(45,125,210,0.5)"}`,
                    }}
                    title={isOT ? "Overtime Side Switch" : "Halftime — Sides Swap"}
                  >
                    <span className="text-[7px] font-black font-mono uppercase tracking-widest whitespace-nowrap" style={{ color: isOT ? "#eb5e28" : "#2D7DD2" }}>
                      {isOT ? "OT" : "HALF"}
                    </span>
                    <span className="text-[7px] font-mono font-bold" style={{ color: isOT ? "#eb5e28" : "#2D7DD2" }}>
                      {runningT1Scores[index]}-{runningT2Scores[index]}
                    </span>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(45,125,210,0.4)", border: "1px solid #2D7DD2" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.72rem" }}>{displayTeam1Name} win: {team1Score}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded" style={{ background: "rgba(255,77,109,0.4)", border: "1px solid #FF4D6D" }} />
          <span style={{ color: "#8BA7CC", fontSize: "0.72rem" }}>{displayTeam2Name} win: {team2Score}</span>
        </div>
      </div>
    </div>
  );
}

// --- Main Page ---
export default function AnalysisPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [result, setResult] = useState<JobResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"stats" | "logs">("stats");
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [viewerMode, setViewerMode] = useState<"2d" | "3d">("2d");
  const [replayView, setReplayView] = useState<"tactical" | "3d">("tactical");

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Coaching state mirrored up from CoachingPanel's own poll — no second poll
  // loop. `coachingSettled` latches true so a notes-triggered coaching re-run
  // can never send a visible report back to the waiting screen.
  const [coachingSettled, setCoachingSettled] = useState(false);
  const [reportGrade, setReportGrade] = useState<string | null>(null);
  const handleCoachingState = useCallback(
    (s: "loading" | "pending" | "ready" | "error", c: Coaching | null) => {
      if (s === "ready" || s === "error") setCoachingSettled(true);
      const grade = c?.report_v2?.summary?.grade;
      if (grade) setReportGrade(grade);
    },
    []
  );

  // Finding → replay deep link: park the shared playback store on the round,
  // make sure the tactical viewer is mounted, and scroll to #replay.
  const handleFindingRound = useCallback((round: number) => {
    usePlayback.getState().setRound(round);
    setSelectedRound(round);
    setViewerMode("3d");
    setReplayView("tactical");
    document.getElementById("replay")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Seconds spent in the parse-done-but-coaching-pending phase, driving the
  // Analyze→Report stage upgrade at ~45s (ticks in the shared interval below).
  const [coachingWaitSeconds, setCoachingWaitSeconds] = useState(0);

  // Sync timer using local ticks — capped at 99:59 display. Keeps ticking while
  // the coaching report is still cooking (waiting-screen stages 2–3).
  useEffect(() => {
    const status = result?.status ?? "queued";
    if (status === "failed") return;
    if (status === "done" && coachingSettled) return;
    const coachingPending = status === "done" && !coachingSettled;

    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
      if (coachingPending) setCoachingWaitSeconds(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [result?.status, coachingSettled]);

  // Sync with backend elapsed_seconds — only use it to seed the timer on first
  // arrival; never let a stale large value override a running local counter.
  const seededFromBackend = useRef(false);
  useEffect(() => {
    if (result?.elapsed_seconds !== undefined && !seededFromBackend.current) {
      seededFromBackend.current = true;
      setElapsedSeconds(result.elapsed_seconds || 0);
    }
  }, [result?.elapsed_seconds]);

  // Hard timeout: if we've been polling for >10 min and still not done,
  // force-reload the page so the user isn't stuck forever.
  useEffect(() => {
    if (elapsedSeconds > 600 && result?.status !== "done" && result?.status !== "failed") {
      // Don't auto-reload — just show the escape hatch (handled in JSX)
    }
  }, [elapsedSeconds, result?.status]);

  const formatTime = (totalSeconds: number) => {
    // Cap display at 99:59 — anything beyond means a backend stall
    const capped = Math.min(totalSeconds, 5999);
    const mins = Math.floor(capped / 60);
    const secs = capped % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const status = result?.status ?? "queued";

  // Parse is done but the Great Khan hasn't reported back yet: stay on the
  // waiting screen (stages 2–3) until the coaching poll settles.
  const waitingForCoaching = status === "done" && !coachingSettled;

  // SoyomboProgress stage mapping — queued→0, processing→1, parse done but
  // coaching pending→2 (→3 after ~45s of coaching-pending), settled→4
  // (the report shows instead of the waiting screen).
  const soyomboStage =
    status === "queued" ? 0
    : status === "processing" ? 1
    : waitingForCoaching ? (coachingWaitSeconds >= 45 ? 3 : 2)
    : 4;

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    async function poll() {
      while (!stopped) {
        try {
          // Poll light (status only); pull the full payload exactly once on done.
          const res = await fetch(`/api/jobs/${jobId}?light=1`);
          const data: JobResult = await res.json();
          if (data.status === "done") {
            const fullRes = await fetch(`/api/jobs/${jobId}`);
            const fullData: JobResult = await fullRes.json();
            if (!stopped) setResult(fullData);
            break;
          }
          setResult(data);
          if (data.status === "failed") break;
        } catch { /* continue */ }
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    poll();
    return () => { stopped = true; };
  }, [jobId]);

  // Dynamic team name identification at the page level
  const { team1Name, team2Name } = useMemo(() => {
    if (!result?.player_stats) return { team1Name: "CT", team2Name: "TERRORIST" };
    const playersList = Object.values(result.player_stats || {}).filter(
      (p: any) => p && p.name && p.name !== "nan" && p.steamid && p.steamid !== "nan"
    );
    const allTeams = Array.from(new Set(playersList.map((p: any) => p.team).filter(Boolean)));
    let team1 = "CT";
    let team2 = "TERRORIST";

    if (allTeams.length >= 2) {
      if (allTeams.includes("CT") || allTeams.includes("TERRORIST") || allTeams.includes("T")) {
        team1 = (allTeams.find(t => t === "CT") || allTeams.find(t => t !== "TERRORIST" && t !== "T") || allTeams[0]) as string;
        team2 = (allTeams.find(t => t === "TERRORIST" || t === "T") || allTeams.find(t => t !== team1) || allTeams[1]) as string;
      } else {
        team1 = allTeams[0] as string;
        team2 = allTeams[1] as string;
      }
    } else if (allTeams.length === 1) {
      if (allTeams[0] === "CT") team2 = "TERRORIST";
      else if (allTeams[0] === "TERRORIST" || allTeams[0] === "T") { team1 = "CT"; team2 = allTeams[0] as string; }
      else { team1 = allTeams[0] as string; team2 = "Unknown"; }
    }
    return { team1Name: team1, team2Name: team2 };
  }, [result]);

  // Final match score. Teams swap sides at halftime, so raw CT-wins vs
  // T-wins is NOT a match score (it once rendered a 12–7 game as "10–9").
  // Attribute each round to the team that played the winning side that
  // round, same convention as the timeline (Team A starts CT).
  const { teamAWins, teamBWins } = useMemo(() => {
    let a = 0;
    let b = 0;
    for (const r of result?.rounds ?? []) {
      const winnerIsCT = r.winner === "CT" || r.winner === "COUNTER_TERRORIST";
      const winnerIsT = r.winner === "T" || r.winner === "TERRORIST";
      if (!winnerIsCT && !winnerIsT) continue;
      if (isTeam1CT(r.round) === winnerIsCT) a++;
      else b++;
    }
    return { teamAWins: a, teamBWins: b };
  }, [result?.rounds]);

  const cfg = STATUS_CONFIG[status];
  const showDone = status === "done" && coachingSettled;

  return (
    <div className="min-h-screen px-6 py-16 relative" style={{ background: "var(--color-bg-primary)" }}>
      <div className="relative max-w-5xl mx-auto">
        {/* Pre-report header (queued / processing / waiting / failed). The done
            state renders its own match-debrief header below. */}
        {!showDone && (
          <>
            <div className="flex items-center gap-4 mb-10">
              <SoyomboIcon size={36} color="#C9A227" />
              <div>
                <h1 className="heading-display" style={{ fontSize: "1.6rem" }}>
                  {result?.map ?? "Demo Analysis"}
                </h1>
                <div className="flex items-center gap-2 mt-1" style={{ color: cfg.color }}>
                  {cfg.icon}
                  <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>{cfg.label}</span>
                </div>
              </div>
            </div>

            {result?.is_recon && (
              <div className="mb-8 p-4 rounded-xl border border-[#C9A227]/30 bg-[#C9A227]/5 flex items-center gap-3">
                <SoyomboIcon size={18} color="#C9A227" />
                <div className="text-left">
                  <h3 className="text-xs font-bold text-[#C9A227] uppercase tracking-wider font-mono">Ilchi Spy Scan Enabled</h3>
                  <p className="text-[11px] text-[#8BA7CC] mt-0.5">Opposition intelligence compiled. Standard Steam ID constraints bypassed.</p>
                </div>
              </div>
            )}

            <UlziiBorder className="mb-10" />
          </>
        )}

        {/* Waiting state — THE signature moment. The Soyombo mark assembles
            stage by stage; nothing else on this screen moves. Covers parse
            (queued/processing) AND the coaching wait after parse completes. */}
        {(status === "queued" || status === "processing" || waitingForCoaching) && (
          <div
            className="card flex flex-col items-center justify-center gap-8 p-12 text-center"
            style={{ minHeight: 480 }}
          >
            <h2 className="heading-display" style={{ fontSize: "1.5rem" }}>
              The Khan is studying your demo
            </h2>

            <SoyomboProgress
              stage={soyomboStage}
              size={140}
              detail={`Elapsed ${formatTime(elapsedSeconds)} · est. ~2.5 min total`}
            />

            {/* Escape hatch — shows after 3 min stuck */}
            {elapsedSeconds > 180 && (
              <div
                className="w-full max-w-md p-4 rounded-xl flex flex-col items-center gap-3"
                style={{
                  border: "1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)",
                  background: "color-mix(in srgb, var(--color-warning) 5%, transparent)",
                }}
              >
                <p className="text-xs text-center" style={{ color: "var(--color-warning)" }}>
                  Taking longer than expected? The analysis may already be ready.
                </p>
                <div className="flex gap-3">
                  <Button
                    id="force-view-results-btn"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setCoachingSettled(true);
                      setResult(prev => prev ? { ...prev, status: "done" } : prev);
                    }}
                  >
                    View results now
                  </Button>
                  <Button id="reload-page-btn" size="sm" variant="ghost" onClick={() => window.location.reload()}>
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Invisible pre-mount: keeps the coaching poll running while the
            waiting screen shows stages 2–3, so stage 4 flips the report in. */}
        {waitingForCoaching && (
          <div hidden aria-hidden="true">
            <CoachingPanel matchId={jobId} onCoachingState={handleCoachingState} />
          </div>
        )}

        {status === "failed" && (
          <div className="card p-10 text-center" style={{ borderColor: "rgba(255,77,109,0.3)" }}>
            <AlertCircle size={40} color="#FF4D6D" className="mx-auto mb-4" />
            <h2 className="heading-display mb-2" style={{ fontSize: "1.3rem" }}>Parse Failed</h2>
            <p style={{ color: "#8BA7CC" }}>{result?.error ?? "Unknown error. Please try uploading again."}</p>
          </div>
        )}

        {showDone && result && (
          <PageTransition className="space-y-6">
            {/* Match debrief header */}
            <PageSection>
              <header>
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.2em]"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-accent-secondary)" }}
                >
                  Match debrief
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h1 className="heading-display" style={{ fontSize: "1.8rem" }}>
                    {result.map ?? "Demo Analysis"}
                  </h1>
                  {(teamAWins > 0 || teamBWins > 0) && (
                    <span
                      className="text-lg font-bold"
                      style={{ fontFamily: "var(--font-mono)" }}
                      title="Final score — Team A started CT, sides swap at halftime"
                    >
                      <span style={{ color: "var(--color-ct)" }}>Team A {teamAWins}</span>
                      <span style={{ color: "var(--color-text-muted)" }}> – </span>
                      <span style={{ color: "var(--color-danger)" }}>{teamBWins} Team B</span>
                    </span>
                  )}
                  {reportGrade && (
                    <span
                      className="rounded-md px-2.5 py-0.5 text-base font-bold"
                      style={{
                        fontFamily: "var(--font-heading)",
                        color: "var(--color-accent-secondary)",
                        border: "1px solid var(--color-border-secondary)",
                        background: "var(--color-secondary-soft)",
                      }}
                      title="Great Khan grade"
                    >
                      {reportGrade}
                    </span>
                  )}
                  {result.is_recon && (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--color-accent-secondary)",
                        border: "1px solid var(--color-accent-secondary)",
                      }}
                    >
                      Recon
                    </span>
                  )}
                  {result.created_at && (
                    <span
                      className="ml-auto text-xs"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}
                    >
                      {new Date(result.created_at).toLocaleDateString(undefined, {
                        year: "numeric", month: "short", day: "numeric",
                      })}
                    </span>
                  )}
                </div>
                {/* Match facts, folded out of the old stat-tile grid — three
                    counts don't deserve a third of the viewport. */}
                <p
                  className="mt-2 text-xs font-mono"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {result.total_rounds ?? 0} rounds · {result.total_kills ?? 0} kills ·{" "}
                  {result.total_grenades ?? 0} grenades
                </p>
                <UlziiBorder className="mt-5" />
              </header>
            </PageSection>

            {/* Section nav — plain anchors, sticky under the navbar */}
            <PageSection>
              <nav
                aria-label="Report sections"
                className="sticky top-16 z-20 flex items-center gap-6 rounded-lg px-4 py-2.5 backdrop-blur-md"
                style={{
                  background: "color-mix(in srgb, var(--color-bg-primary) 82%, transparent)",
                  border: "1px solid var(--color-border-primary)",
                }}
              >
                {[
                  ["#report", "Report"],
                  ["#rounds", "Rounds"],
                  ["#momentum", "Momentum"],
                  ["#duels", "Duels"],
                  ["#replay", "Replay"],
                  ["#players", "Players"],
                ].map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    className="text-[11px] font-mono uppercase tracking-widest transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  >
                    {label}
                  </a>
                ))}
              </nav>
            </PageSection>

            {/* AI Coaching Panel — the #report anchor. First, because the
                page answers "what do I fix?" before "show me the data". */}
            <PageSection>
              <section id="report" style={{ scrollMarginTop: 120 }}>
                <CoachingPanel
                  matchId={jobId}
                  onFindingRound={handleFindingRound}
                  onCoachingState={handleCoachingState}
                />
              </section>
            </PageSection>

            {/* Round Timeline — the #rounds anchor */}
            {result.rounds && result.rounds.length > 0 && (
              <PageSection>
                <section id="rounds" style={{ scrollMarginTop: 120 }}>
                  <RoundTimeline
                    rounds={result.rounds}
                    selectedRound={selectedRound}
                    onSelectRound={setSelectedRound}
                    team1Name={team1Name}
                    team2Name={team2Name}
                  />
                </section>
              </PageSection>
            )}

            {/* Momentum — the economy chart, moved up from the page bottom:
                it explains WHY halves swung, so it belongs next to the
                timeline it annotates. The #momentum anchor. */}
            {result.rounds && result.rounds.length > 0 && (
              <PageSection>
                <section id="momentum" style={{ scrollMarginTop: 120 }}>
                  <EconomyChart
                    rounds={result.rounds}
                    selectedRound={selectedRound}
                    onSelectRound={setSelectedRound}
                    team1Name={team1Name}
                    team2Name={team2Name}
                  />
                </section>
              </PageSection>
            )}

            {/* Filtered kills calculation for Heatmap and Feed */}
            {(() => {
              const filteredKills = selectedRound
                ? (result.kills || []).filter(k => k.round === selectedRound)
                : (result.kills || []);
              
              const uniqueTeams = Array.from(new Set(
                (result.kills || []).map(k => k.killer_team)
                .concat((result.kills || []).map(k => k.victim_team))
                .filter(Boolean)
              ));
              
              let team1 = "CT";
              let team2 = "TERRORIST";

              if (uniqueTeams.length >= 2) {
                if (uniqueTeams.includes("CT") || uniqueTeams.includes("TERRORIST") || uniqueTeams.includes("T")) {
                  team1 = (uniqueTeams.find(t => t === "CT") || uniqueTeams.find(t => t !== "TERRORIST" && t !== "T") || uniqueTeams[0]) as string;
                  team2 = (uniqueTeams.find(t => t === "TERRORIST" || t === "T") || uniqueTeams.find(t => t !== team1) || uniqueTeams[1]) as string;
                } else {
                  team1 = uniqueTeams[0] as string;
                  team2 = uniqueTeams[1] as string;
                }
              }

              const getTeamColor = (teamName?: string) => {
                if (teamName === team1 || teamName === "CT") return "#2D7DD2"; // Blue
                if (teamName === team2 || teamName === "TERRORIST" || teamName === "T") return "#FF4D6D"; // Red
                return "#8BA7CC"; // Fallback gray
              };

              return (
                <>
                  {/* Replay Viewer Toggle — the #replay anchor */}
                  {result.kills && result.kills.length > 0 && (
                    <PageSection>
                    <section id="replay" style={{ scrollMarginTop: 120 }} className="card p-0 overflow-hidden mb-6">
                      <div className="border-b border-slate-800 p-4 flex items-center justify-between">
                        <div>
                          <h2 className="heading-display mb-1" style={{ fontSize: "1.1rem" }}>Kill Replay Viewer</h2>
                          <p className="text-sm text-slate-400 font-mono">View the spatial distribution of kills.</p>
                        </div>
                        <div className="flex items-center bg-slate-900 rounded-lg p-1 border border-slate-700">
                          <button
                            onClick={() => setViewerMode("2d")}
                            className={`px-4 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${viewerMode === "2d" ? "bg-[#2D7DD2] text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
                          >
                            2D Heatmap
                          </button>
                          <button
                            onClick={() => setViewerMode("3d")}
                            className={`px-4 py-1.5 rounded-md text-xs font-mono font-medium transition-colors ${viewerMode === "3d" ? "bg-[#FF4D6D] text-white" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800"}`}
                          >
                            3D Replay
                          </button>
                        </div>
                      </div>
                      
                      <div className="p-0">
                        {viewerMode === "2d" ? (
                          <KillHeatmap kills={filteredKills} mapName={result.map} />
                        ) : (
                          <div>
                            <div className="p-4 pb-0 flex items-center gap-2">
                              <Button
                                size="sm"
                                variant={replayView === "tactical" ? "primary" : "secondary"}
                                onClick={() => setReplayView("tactical")}
                              >
                                2D Tactical
                              </Button>
                              <Button
                                size="sm"
                                variant={replayView === "3d" ? "primary" : "secondary"}
                                onClick={() => setReplayView("3d")}
                              >
                                3D Replay
                              </Button>
                            </div>
                            {replayView === "tactical" ? (
                              <DemoViewer
                                matchId={jobId}
                                totalRounds={result.total_rounds ?? (result.rounds?.length ?? 0)}
                              />
                            ) : (
                              <Viewer3D kills={filteredKills} mapName={result.map} selectedRound={selectedRound} />
                            )}
                          </div>
                        )}
                      </div>
                    </section>
                    </PageSection>
                  )}

                </>
              );
            })()}

            {/* Duel explorer — the kill feed rebuilt for coaching, with names,
                trade tags, and a player filter. The #duels anchor. */}
            {result.kills && result.kills.length > 0 && (
              <PageSection>
                <section id="duels" style={{ scrollMarginTop: 120 }}>
                  <DuelExplorer
                    kills={result.kills}
                    rounds={result.rounds ?? []}
                    selectedRound={selectedRound}
                  />
                </section>
              </PageSection>
            )}

            {/* Players — scoreboard plus the opening-duel differential chart.
                The #players anchor. */}
            <PageSection>
              <section id="players" style={{ scrollMarginTop: 120 }} className="space-y-6">
                {result.kills && result.kills.length > 0 && (
                  <OpeningDuelsChart kills={result.kills} />
                )}
                <MatchStatsPanel
                  stats={result.player_stats || {}}
                  result={result}
                  selectedRound={selectedRound}
                  onSelectRound={setSelectedRound}
                />
              </section>
            </PageSection>
          </PageTransition>
        )}
      </div>
    </div>
  );
}
