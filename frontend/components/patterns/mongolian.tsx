// Soyombo symbol — Mongolian national symbol used as DemoSage logo mark
// Represents fire (top), sun, moon, earth, and water

export function SoyomboIcon({ size = 32, color = "#C9A227", className = "" }: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Flame */}
      <path d="M50 5 C46 15, 38 18, 42 28 C44 33, 50 35, 50 35 C50 35, 56 33, 58 28 C62 18, 54 15, 50 5Z" fill={color} />
      {/* Sun */}
      <circle cx="50" cy="45" r="8" fill={color} />
      <circle cx="50" cy="45" r="12" fill="none" stroke={color} strokeWidth="2.5" />
      {/* Moon */}
      <path d="M35 62 Q50 54 65 62" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* Horizontal bars */}
      <rect x="22" y="72" width="56" height="5" rx="2" fill={color} />
      <rect x="22" y="82" width="56" height="5" rx="2" fill={color} />
      {/* Vertical side bars */}
      <rect x="18" y="72" width="4" height="40" rx="2" fill={color} />
      <rect x="78" y="72" width="4" height="40" rx="2" fill={color} />
      {/* Bottom bars */}
      <rect x="22" y="107" width="56" height="5" rx="2" fill={color} />
    </svg>
  );
}

// Ulzii border — decorative horizontal divider
export function UlziiBorder({ className = "" }: { className?: string }) {
  return (
    <div className={`w-full h-px relative overflow-hidden ${className}`}>
      <svg width="100%" height="8" preserveAspectRatio="none" viewBox="0 0 400 8" xmlns="http://www.w3.org/2000/svg">
        <pattern id="ulzii-line" x="0" y="0" width="40" height="8" patternUnits="userSpaceOnUse">
          <rect x="0" y="3" width="12" height="2" fill="#1E3A5F" />
          <rect x="14" y="3" width="4" height="2" fill="#2D7DD2" />
          <rect x="20" y="3" width="12" height="2" fill="#1E3A5F" />
          <rect x="34" y="3" width="4" height="2" fill="#2D7DD2" />
        </pattern>
        <rect width="400" height="8" fill="url(#ulzii-line)" />
      </svg>
    </div>
  );
}

// Cloud motif — Mongolian хэрэм хээ background pattern (Now dynamic CS2 Case Hardened theme)
import { useEffect, useState } from "react";

export function CloudMotifBg({ className = "" }: { className?: string }) {
  const [sparks, setSparks] = useState<{
    id: number;
    size: number;
    left: number;
    delay: number;
    duration: number;
    glow: string;
  }[]>([]);

  useEffect(() => {
    const list = Array.from({ length: 15 }).map((_, i) => ({
      id: i,
      size: Math.random() * 3 + 2, // 2px to 5px
      left: Math.random() * 100,
      delay: Math.random() * -25, // negative delay so sparks are already active on page load
      duration: Math.random() * 15 + 15,
      glow: Math.random() > 0.6 
        ? "rgba(201,162,39,0.6)"  // Gold
        : Math.random() > 0.3 
          ? "rgba(45,125,210,0.6)"  // Cyan/Blue
          : "rgba(255,77,109,0.5)",  // Rose/Magenta
    }));
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setSparks(list);
  }, []);

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} style={{ zIndex: 0 }}>
      {/* ── Layer 1: Case Hardened Ambient Glows ── */}
      <div className="absolute inset-0 opacity-[0.45] mix-blend-color-dodge filter blur-[120px]">
        {/* Blob 1: Cyan/Blue */}
        <div
          className="absolute rounded-full"
          style={{
            width: "65vw",
            height: "65vh",
            background: "radial-gradient(circle, rgba(45,125,210,0.3) 0%, transparent 70%)",
            top: "-10%",
            left: "15%",
            animation: "driftCyan 30s ease-in-out infinite alternate",
          }}
        />
        {/* Blob 2: Gold */}
        <div
          className="absolute rounded-full"
          style={{
            width: "55vw",
            height: "55vh",
            background: "radial-gradient(circle, rgba(201,162,39,0.2) 0%, transparent 70%)",
            bottom: "-15%",
            right: "10%",
            animation: "driftGold 40s ease-in-out infinite alternate",
          }}
        />
        {/* Blob 3: Violet */}
        <div
          className="absolute rounded-full"
          style={{
            width: "60vw",
            height: "60vh",
            background: "radial-gradient(circle, rgba(95,15,64,0.35) 0%, transparent 75%)",
            top: "30%",
            left: "-10%",
            animation: "driftViolet 35s ease-in-out infinite alternate",
          }}
        />
      </div>

      {/* ── Layer 2: Tactical Hex Grid ── */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-screen"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='40' height='69.282' viewBox='0 0 40 69.282' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M 40 0 L 20 11.547 L 0 0 L 0 23.094 L 20 34.641 L 40 23.094 Z M 0 34.641 L 20 46.188 L 40 34.641 L 40 57.735 L 20 69.282 L 0 57.735 Z' fill='none' stroke='%238BA7CC' stroke-width='1.2'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "40px 69.282px",
          animation: "driftHex 70s linear infinite",
        }}
      />

      {/* ── Layer 3: Mongolian Cloud Motif (Drifting) ── */}
      <div
        className="absolute inset-0 opacity-[0.05] mix-blend-screen"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='120' height='60' viewBox='0 0 120 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 40 Q15 20 30 40 Q45 55 60 40 Q75 20 90 40 Q105 55 120 40' fill='none' stroke='%23F0F4FF' stroke-width='1.2'/%3E%3Cpath d='M0 55 Q15 35 30 55 Q45 70 60 55 Q75 35 90 55 Q105 70 120 55' fill='none' stroke='%23F0F4FF' stroke-width='0.8'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "120px 60px",
          animation: "driftClouds 45s linear infinite",
        }}
      />

      {/* ── Layer 4: Drifting Spark Embers ── */}
      <div className="absolute inset-0">
        {sparks.map((s) => (
          <div
            key={s.id}
            className="absolute rounded-full filter blur-[1px]"
            style={{
              width: `${s.size}px`,
              height: `${s.size}px`,
              left: `${s.left}%`,
              background: s.glow,
              boxShadow: `0 0 8px ${s.glow}, 0 0 16px ${s.glow}`,
              animation: `riseSpark ${s.duration}s linear infinite`,
              animationDelay: `${s.delay}s`,
              bottom: "-20px",
            }}
          />
        ))}
      </div>

      {/* Inject Keyframe Animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes driftCyan {
          0% { transform: translate(0, 0) scale(1) rotate(0deg); }
          50% { transform: translate(8vw, 6vh) scale(1.15) rotate(90deg); }
          100% { transform: translate(-4vw, 12vh) scale(0.9) rotate(180deg); }
        }
        @keyframes driftGold {
          0% { transform: translate(0, 0) scale(0.9) rotate(0deg); }
          50% { transform: translate(-6vw, -8vh) scale(1.1) rotate(-120deg); }
          100% { transform: translate(5vw, 4vh) scale(1) rotate(-240deg); }
        }
        @keyframes driftViolet {
          0% { transform: translate(0, 0) scale(1.1) rotate(0deg); }
          50% { transform: translate(10vw, -4vh) scale(0.9) rotate(140deg); }
          100% { transform: translate(-5vw, 8vh) scale(1.15) rotate(280deg); }
        }
        @keyframes driftHex {
          0% { background-position: 0px 0px; }
          100% { background-position: 400px 692.82px; }
        }
        @keyframes driftClouds {
          0% { background-position: 0px 0px; }
          100% { background-position: -240px 120px; }
        }
        @keyframes riseSpark {
          0% {
            transform: translateY(0) translateX(0) scale(1);
            opacity: 0;
          }
          10% {
            opacity: 0.8;
          }
          50% {
            transform: translateY(-50vh) translateX(30px) scale(1.2);
            opacity: 0.6;
          }
          90% {
            opacity: 0.3;
          }
          100% {
            transform: translateY(-110vh) translateX(-20px) scale(0.7);
            opacity: 0;
          }
        }
      `}} />
    </div>
  );
}
