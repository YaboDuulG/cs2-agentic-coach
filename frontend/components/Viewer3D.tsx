"use client";

import React, { useMemo, useState, useRef, useEffect } from "react";
import { Canvas, useLoader } from "@react-three/fiber";
import { OrbitControls, Html, Line } from "@react-three/drei";
import * as THREE from "three";

export interface KillEvent {
  killer: string;
  victim: string;
  weapon: string;
  round: number;
  killer_team?: string;
  attacker_x?: number;
  attacker_y?: number;
  attacker_z?: number;
  victim_x?: number;
  victim_y?: number;
  victim_z?: number;
  attacker_steamid?: string;
  victim_steamid?: string;
  tick?: number;
  headshot?: boolean;
  victim_team?: string;
}

// Same configs as KillHeatmap
const MAP_CONFIGS: Record<string, { pos_x: number; pos_y: number; scale: number }> = {
  de_mirage: { pos_x: -3230, pos_y: 1713, scale: 5 },
  de_inferno: { pos_x: -2087, pos_y: 3870, scale: 4.9 },
  de_nuke: { pos_x: -3453, pos_y: 2887, scale: 7 },
  de_vertigo: { pos_x: -3168, pos_y: 1762, scale: 4 },
  de_ancient: { pos_x: -2953, pos_y: 2164, scale: 5 },
  de_anubis: { pos_x: -2796, pos_y: 3328, scale: 5.22 },
  de_dust2: { pos_x: -2400, pos_y: 3383, scale: 4.4 },
  de_overpass: { pos_x: -4831, pos_y: 1781, scale: 5.2 },
};

function cleanPlayerName(name: string | undefined | null): string {
  if (!name) return "";
  return name.replace(/\s*\(\d+\)$/, "");
}

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

function MapPlane({ mapKey }: { mapKey: string }) {
  // Load texture
  const textureUrl = `https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images/radars/${mapKey}_radar_psd.png`;
  const texture = useLoader(THREE.TextureLoader, textureUrl);
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
      <planeGeometry args={[1024, 1024]} />
      <meshBasicMaterial map={texture} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

export function Viewer3D({ 
  kills, 
  mapName, 
  selectedRound 
}: { 
  kills: KillEvent[]; 
  mapName?: string; 
  selectedRound?: number | null;
}) {
  const mapKey = mapName?.split("/").pop()?.toLowerCase() || "";
  const hasConfig = mapKey in MAP_CONFIGS;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [hoveredKill, setHoveredKill] = useState<KillEvent | null>(null);

  // Prevent default scroll behavior on mouse wheel inside the 3D viewer (canvas only)
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const preventDefaultScroll = (e: WheelEvent) => {
      e.preventDefault();
    };

    container.addEventListener("wheel", preventDefaultScroll, { passive: false });
    return () => {
      container.removeEventListener("wheel", preventDefaultScroll);
    };
  }, []);

  const sceneObjects = useMemo(() => {
    if (!hasConfig) return null;
    const config = MAP_CONFIGS[mapKey];

    // Helper to map CS2 (x, y, z) to ThreeJS (x, y, z)
    // ThreeJS Y is up. CS2 Z is up.
    const toVector3 = (x: number, y: number, z: number) => {
      // Map X/Y to 1024x1024 plane exactly like 2D canvas
      const mapX = (x - config.pos_x) / config.scale;
      const mapY = (config.pos_y - y) / config.scale; // Y is inverted in CS2 radar
      
      // Shift by -512 so origin is center
      const finalX = mapX - 512;
      const finalZ = mapY - 512; // Z is depth in ThreeJS
      
      // Map Z (elevation). Divide by scale to match the X/Z scale compression
      const finalY = z / config.scale; 
      
      return new THREE.Vector3(finalX, finalY, finalZ);
    };

    const isAnyHovered = hoveredKill !== null;

    return kills.map((k, i) => {
      if (!k.attacker_x || !k.victim_x) return null;
      
      const isCT = k.killer_team === "CT";
      const color = isCT ? "#2D7DD2" : "#FF4D6D";
      const isVictimCT = k.victim_team === "CT" || (!k.victim_team && !isCT);
      const vicColor = isVictimCT ? "#2D7DD2" : "#FF4D6D";

      const start = toVector3(k.attacker_x, k.attacker_y ?? 0, k.attacker_z ?? 0);
      const end = toVector3(k.victim_x, k.victim_y ?? 0, k.victim_z ?? 0);

      const isHovered = hoveredKill === k;
      const opacity = isHovered ? 1.0 : (isAnyHovered ? 0.15 : 0.6);
      const sphereRadius = isHovered ? 7 : 4;

      return (
        <group key={i}>
          {/* Attacker sphere */}
          <mesh 
            position={start}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredKill(k); }}
            onPointerOut={(e) => { setHoveredKill(null); }}
          >
            <sphereGeometry args={[sphereRadius, 16, 16]} />
            <meshBasicMaterial color={color} transparent opacity={isHovered ? 1.0 : (isAnyHovered ? 0.25 : 0.85)} />
          </mesh>
          
          {/* Victim sphere */}
          <mesh 
            position={end}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredKill(k); }}
            onPointerOut={(e) => { setHoveredKill(null); }}
          >
            <sphereGeometry args={[sphereRadius, 16, 16]} />
            <meshBasicMaterial color={vicColor} transparent opacity={isHovered ? 1.0 : (isAnyHovered ? 0.25 : 0.85)} />
          </mesh>

          {/* Trajectory Line */}
          <Line 
            points={[start, end]} 
            color={color}
            lineWidth={isHovered ? 4 : 1.5}
            transparent
            opacity={opacity}
            onPointerOver={(e) => { e.stopPropagation(); setHoveredKill(k); }}
            onPointerOut={(e) => { setHoveredKill(null); }}
          />
          
          {/* Dynamic HTML Tooltip Overlay when hovered */}
          {isHovered && (
            <Html position={start.clone().lerp(end, 0.5)} center zIndexRange={[100, 0]} className="pointer-events-none select-none">
              <div 
                className="bg-slate-950/95 border border-[#1E3A5F] rounded-lg p-2 text-xs shadow-2xl backdrop-blur-md text-slate-200 w-[180px] select-none"
                style={{ transform: "translateY(-40px)" }}
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-1 mb-1.5 font-bold">
                  <span className="text-[#C9A227]">Round {k.round}</span>
                  <span className="font-mono text-slate-400 text-[10px]">{formatWeaponName(k.weapon)}</span>
                </div>
                <div className="space-y-0.5 text-[11px]">
                  <div className="truncate">
                    <span className="text-slate-500">Killer:</span>{" "}
                    <span className="font-bold" style={{ color: color }}>
                      {cleanPlayerName(k.killer)}
                    </span>
                  </div>
                  <div className="truncate">
                    <span className="text-slate-500">Victim:</span>{" "}
                    <span className="font-bold" style={{ color: vicColor }}>
                      {cleanPlayerName(k.victim)}
                    </span>
                  </div>
                </div>
              </div>
            </Html>
          )}
        </group>
      );
    }).filter(Boolean);
  }, [kills, mapKey, hasConfig, hoveredKill]);

  if (!hasConfig) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400">
        <p>3D Viewer not available for {mapKey}</p>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="w-full h-[600px] bg-[#0D1825] rounded-lg overflow-hidden border relative flex" 
      style={{ borderColor: "#142135" }}
    >
      {/* 3D Canvas Area */}
      <div ref={canvasContainerRef} className="flex-1 h-full relative">
        <Canvas camera={{ position: [0, 800, 600], fov: 60 }}>
          <OrbitControls 
            makeDefault
            maxPolarAngle={Math.PI / 2 - 0.05} // don't go below ground
            minDistance={50}
            maxDistance={1500}
          />
          <ambientLight intensity={1} />
          
          <React.Suspense fallback={null}>
            <MapPlane mapKey={mapKey} />
          </React.Suspense>

          {sceneObjects}
        </Canvas>

        {/* Floating Instruction overlay */}
        <div className="absolute top-4 left-4 pointer-events-none">
          <div className="bg-slate-900/80 border border-slate-700 rounded px-3 py-2 text-xs font-mono text-white backdrop-blur-sm">
            <p className="font-semibold text-slate-300 mb-1">3D Viewer Controls</p>
            <ul className="text-slate-400">
              <li><span className="text-slate-200">Left Click:</span> Rotate</li>
              <li><span className="text-slate-200">Right Click:</span> Pan</li>
              <li><span className="text-slate-200">Scroll:</span> Zoom</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Sleek Interactive Kill Feed Sidebar */}
      <div className="w-64 h-full bg-slate-950/80 border-l border-slate-800 p-4 flex flex-col gap-3 backdrop-blur-md overflow-hidden">
        <div className="border-b border-slate-800 pb-2 shrink-0">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider font-mono">
            {selectedRound !== null ? `Round ${selectedRound} Kill Feed` : "Match Kill Feed"}
          </h3>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            Hover an item to highlight in 3D
          </p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {kills.length === 0 ? (
            <div className="h-full flex items-center justify-center text-center text-[10px] text-slate-500 font-mono italic">
              No kills in this round
            </div>
          ) : (
            kills.map((k, i) => {
              const isCT = k.killer_team === "CT";
              const isVictimCT = k.victim_team === "CT" || (!k.victim_team && !isCT);
              const color = isCT ? "#2D7DD2" : "#FF4D6D";
              const vicColor = isVictimCT ? "#2D7DD2" : "#FF4D6D";

              return (
                <div 
                  key={i}
                  className={`flex items-center justify-between text-[10px] p-2 rounded cursor-pointer transition-all border ${
                    hoveredKill === k 
                      ? 'bg-slate-900 border-[#eb5e28] text-white shadow-md scale-[1.02]' 
                      : 'bg-slate-900/30 border-slate-800/40 text-slate-300 hover:bg-slate-900/50 hover:text-white'
                  }`}
                  onMouseEnter={() => setHoveredKill(k)}
                  onMouseLeave={() => setHoveredKill(null)}
                >
                  <div className="flex items-center gap-1 min-w-0 flex-1 flex-wrap">
                    <span 
                      className="font-bold truncate max-w-[70px]"
                      style={{ color }}
                      title={cleanPlayerName(k.killer)}
                    >
                      {cleanPlayerName(k.killer)}
                    </span>
                    <span className="text-slate-500 font-mono text-[9px] px-1 bg-slate-950/60 rounded border border-slate-800 shrink-0">
                      {formatWeaponName(k.weapon)}
                    </span>
                    {k.headshot && (
                      <span className="text-[9px] text-[#C9A227] font-bold shrink-0" title="Headshot">
                        🎯
                      </span>
                    )}
                    <span className="text-slate-400 font-medium shrink-0">→</span>
                    <span 
                      className="font-bold truncate max-w-[70px]"
                      style={{ color: vicColor }}
                      title={cleanPlayerName(k.victim)}
                    >
                      {cleanPlayerName(k.victim)}
                    </span>
                  </div>
                  {selectedRound === null && (
                    <span className="text-[9px] text-slate-500 font-mono shrink-0 ml-1">
                      R{k.round}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
