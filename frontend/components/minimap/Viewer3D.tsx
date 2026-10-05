"use client";

// 3D kill view: the round's kills as attacker→victim lines over the radar
// image laid flat, orbitable. Same calibration as the 2D radar
// (lib/maps.ts), so the two views agree. Colours come from the theme tokens,
// read once at mount because three.js materials need literal colours.

import { Html, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useLoader } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { JobKill } from "@/lib/api/hooks";
import { RADAR_SIZE, radarCalibration, radarImageUrl, worldToRadar, type RadarCalibration } from "@/lib/maps";

const HALF = RADAR_SIZE / 2;

function MapPlane({ url }: { url: string }) {
  // useLoader suspends until the image is in, so the material is created with
  // its map from the start (swapping `map` on a live material needs a shader
  // rebuild that is easy to miss).
  const texture = useLoader(THREE.TextureLoader, url);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <planeGeometry args={[RADAR_SIZE, RADAR_SIZE]} />
      {/* map-colorSpace: R3F's dashed path sets material.map.colorSpace without mutating the cached texture here. */}
      <meshBasicMaterial map={texture} map-colorSpace={THREE.SRGBColorSpace} transparent opacity={0.9} depthWrite={false} />
    </mesh>
  );
}

function toScene(cal: RadarCalibration, x: number, y: number, lift: number): THREE.Vector3 {
  const r = worldToRadar(cal, x, y);
  return new THREE.Vector3(r.x - HALF, lift, r.y - HALF);
}

export interface Viewer3DProps {
  kills: JobKill[];
  map: string;
  /** Resolves a side for a kill participant; "CT" or "T". */
  sideOf: (kill: JobKill, who: "killer" | "victim") => "CT" | "T";
  nameOf?: (raw: string) => string;
}

/** The round's kills in 3D. Hover a line or a row to single it out. */
export function Viewer3D({ kills, map, sideOf, nameOf = (s) => s }: Viewer3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [colors, setColors] = useState({ ct: "#5e98d9", t: "#e8b14b", text: "#e9eef4", bg: "#0b0f14" });
  const calibration = radarCalibration(map);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const css = getComputedStyle(el);
    const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    setColors({ ct: read("--color-ct", "#5e98d9"), t: read("--color-t", "#e8b14b"), text: read("--color-text", "#e9eef4"), bg: read("--color-bg", "#0b0f14") });
    // The canvas owns the wheel: zoom, not page scroll.
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  const placed = useMemo(() => {
    if (!calibration) return [];
    return kills
      .filter((k) => k.attacker_x || k.attacker_y || k.victim_x || k.victim_y)
      .map((k, i) => ({
        kill: k,
        index: i,
        start: toScene(calibration, k.attacker_x, k.attacker_y, 6),
        end: toScene(calibration, k.victim_x, k.victim_y, 6),
      }));
  }, [kills, calibration]);

  if (!calibration) {
    return (
      <div className="surface-2 flex aspect-square w-full items-center justify-center p-6 text-center text-sm" style={{ color: "var(--color-text-2)" }}>
        No radar calibration for {map || "this map"} yet, so the 3D view is unavailable.
      </div>
    );
  }

  const colorFor = (side: "CT" | "T") => (side === "CT" ? colors.ct : colors.t);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,640px)_minmax(220px,1fr)]">
      <div ref={hostRef} className="relative aspect-square w-full max-w-[640px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-line)]" style={{ background: "var(--color-bg)" }}>
        <Canvas camera={{ position: [0, 900, 650], fov: 55, near: 1, far: 6000 }} dpr={[1, 2]}>
          <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} minDistance={120} maxDistance={2200} />
          <ambientLight intensity={1} />
          <Suspense fallback={null}>
            <MapPlane url={radarImageUrl(map)} />
          </Suspense>
          {placed.map(({ kill, index, start, end }) => {
            const killerColor = colorFor(sideOf(kill, "killer"));
            const victimColor = colorFor(sideOf(kill, "victim"));
            const dim = hovered !== null && hovered !== index;
            const lit = hovered === index;
            const alpha = lit ? 1 : dim ? 0.15 : 0.7;
            const over = (e: { stopPropagation: () => void }) => {
              e.stopPropagation();
              setHovered(index);
            };
            return (
              <group key={index}>
                <mesh position={start} onPointerOver={over} onPointerOut={() => setHovered(null)}>
                  <sphereGeometry args={[lit ? 7 : 4.5, 16, 16]} />
                  <meshBasicMaterial color={killerColor} transparent opacity={alpha} />
                </mesh>
                <mesh position={end} onPointerOver={over} onPointerOut={() => setHovered(null)}>
                  <sphereGeometry args={[lit ? 7 : 4.5, 16, 16]} />
                  <meshBasicMaterial color={victimColor} transparent opacity={alpha} />
                </mesh>
                <Line points={[start, end]} color={killerColor} lineWidth={lit ? 3.5 : 1.5} transparent opacity={alpha} onPointerOver={over} onPointerOut={() => setHovered(null)} />
                {lit ? (
                  <Html position={start.clone().lerp(end, 0.5)} center zIndexRange={[100, 0]} className="pointer-events-none select-none">
                    <div className="surface px-3 py-2 text-[12px] shadow-lg" style={{ transform: "translateY(-36px)", whiteSpace: "nowrap" }}>
                      <span className="font-semibold" style={{ color: killerColor }}>
                        {nameOf(kill.killer)}
                      </span>
                      <span className="num mx-1.5" style={{ color: "var(--color-text-3)" }}>
                        {kill.weapon.replace(/^weapon_/, "")}
                        {kill.headshot ? " · HS" : ""}
                      </span>
                      <span className="font-semibold" style={{ color: victimColor }}>
                        {nameOf(kill.victim)}
                      </span>
                    </div>
                  </Html>
                ) : null}
              </group>
            );
          })}
        </Canvas>
        <p className="num pointer-events-none absolute left-3 top-3 text-[11px]" style={{ color: "var(--color-text-3)" }}>
          drag to orbit · right-drag to pan · scroll to zoom
        </p>
      </div>

      <div className="min-w-0">
        <h3 className="eyebrow mb-2">Kills this round</h3>
        {placed.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-text-3)" }}>
            No kills with positions in this round.
          </p>
        ) : (
          <ul className="max-h-[560px] space-y-1 overflow-y-auto pr-1" aria-label="Kills">
            {placed.map(({ kill, index }) => (
              <li key={index}>
                <button
                  type="button"
                  className="surface-2 flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-[border-color] duration-[var(--dur-fast)]"
                  style={{ borderColor: hovered === index ? "var(--color-focus)" : undefined }}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                >
                  <span className="truncate font-semibold" style={{ color: colorFor(sideOf(kill, "killer")) }}>
                    {nameOf(kill.killer)}
                  </span>
                  <span className="num shrink-0" style={{ color: "var(--color-text-3)" }}>
                    {kill.weapon.replace(/^weapon_/, "")}
                    {kill.headshot ? " HS" : ""}
                  </span>
                  <span aria-hidden="true" style={{ color: "var(--color-text-3)" }}>
                    →
                  </span>
                  <span className="truncate font-semibold" style={{ color: colorFor(sideOf(kill, "victim")) }}>
                    {nameOf(kill.victim)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
