"use client";

import React, { useMemo } from "react";
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

function MapPlane({ mapKey }: { mapKey: string }) {
  // Load texture
  const textureUrl = `/images/maps/${mapKey}_radar.png`;
  const texture = useLoader(THREE.TextureLoader, textureUrl);
  
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]}>
      <planeGeometry args={[1024, 1024]} />
      <meshBasicMaterial map={texture} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

export function Viewer3D({ kills, mapName }: { kills: KillEvent[]; mapName?: string }) {
  const mapKey = mapName?.split("/").pop()?.toLowerCase() || "";
  const hasConfig = mapKey in MAP_CONFIGS;

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

    return kills.map((k, i) => {
      if (!k.attacker_x || !k.victim_x) return null;
      
      const isCT = k.killer_team === "CT";
      const color = isCT ? "#2D7DD2" : "#C9A227";
      const vicColor = "#FF4D6D";

      const start = toVector3(k.attacker_x, k.attacker_y ?? 0, k.attacker_z ?? 0);
      const end = toVector3(k.victim_x, k.victim_y ?? 0, k.victim_z ?? 0);

      return (
        <group key={i}>
          {/* Attacker sphere */}
          <mesh position={start}>
            <sphereGeometry args={[4, 16, 16]} />
            <meshBasicMaterial color={color} />
          </mesh>
          
          {/* Victim sphere */}
          <mesh position={end}>
            <sphereGeometry args={[4, 16, 16]} />
            <meshBasicMaterial color={vicColor} />
          </mesh>

          {/* Trajectory Line */}
          <Line 
            points={[start, end]} 
            color={color}
            lineWidth={2}
            transparent
            opacity={0.6}
          />
          
          {/* HTML Overlay for Weapon Label on the trajectory */}
          <Html position={start.clone().lerp(end, 0.5)} center zIndexRange={[100, 0]} className="pointer-events-none">
            <div className="bg-slate-900/80 border border-slate-700 rounded px-2 py-0.5 text-[9px] font-mono text-white opacity-0 hover:opacity-100 transition-opacity">
              {k.weapon}
            </div>
          </Html>
        </group>
      );
    }).filter(Boolean);
  }, [kills, mapKey, hasConfig]);

  if (!hasConfig) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-slate-900 text-slate-400">
        <p>3D Viewer not available for {mapKey}</p>
      </div>
    );
  }

  return (
    <div className="w-full h-[600px] bg-[#0D1825] rounded-lg overflow-hidden border" style={{ borderColor: "#142135" }}>
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
  );
}
