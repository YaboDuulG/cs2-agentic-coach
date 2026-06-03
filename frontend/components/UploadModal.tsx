"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { UploadZone } from "./UploadZone";
import { SoyomboIcon } from "./patterns/mongolian";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId?: string;
  defaultMode?: "individual" | "team";
}

export function UploadModal({ isOpen, onClose, teamId, defaultMode }: UploadModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (isOpen) {
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.body.style.overflow = "unset";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const modeLabel = defaultMode === "team" ? "Team Demo Upload" : "Individual Demo Upload";
  const modeDesc = defaultMode === "team"
    ? "Analyze your full team's demo. All players will be profiled."
    : "Analyze your personal performance. Great Khan AI will focus on your stats.";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        ref={modalRef}
        className="relative w-full max-w-[580px] rounded-2xl border p-6 md:p-8 overflow-hidden transition-all duration-300 shadow-2xl"
        style={{
          background: "rgba(8, 14, 26, 0.95)",
          borderColor: defaultMode === "team" ? "rgba(201, 162, 39, 0.3)" : "rgba(45, 125, 210, 0.3)",
          boxShadow: "0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(45, 125, 210, 0.08)",
        }}
      >
        {/* Subtle top gradient line */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: defaultMode === "team"
              ? "linear-gradient(90deg, transparent, #C9A227, #2D7DD2, transparent)"
              : "linear-gradient(90deg, transparent, #2D7DD2, #22D3A0, transparent)"
          }}
        />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all duration-200 cursor-pointer"
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center border"
            style={{
              background: defaultMode === "team" ? "rgba(201, 162, 39, 0.1)" : "rgba(45, 125, 210, 0.1)",
              borderColor: defaultMode === "team" ? "rgba(201, 162, 39, 0.25)" : "rgba(45, 125, 210, 0.25)",
            }}
          >
            <SoyomboIcon size={20} color={defaultMode === "team" ? "#C9A227" : "#2D7DD2"} />
          </div>
          <div>
            <h2
              className="text-white font-bold tracking-wide"
              style={{ fontFamily: "Cinzel, serif", fontSize: "1.2rem" }}
            >
              {modeLabel}
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              {modeDesc}
            </p>
          </div>
        </div>

        {/* Mode badge */}
        <div className="mb-4 flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full font-mono"
            style={{
              background: defaultMode === "team" ? "rgba(201,162,39,0.12)" : "rgba(45,125,210,0.12)",
              color: defaultMode === "team" ? "#C9A227" : "#2D7DD2",
              border: `1px solid ${defaultMode === "team" ? "rgba(201,162,39,0.25)" : "rgba(45,125,210,0.25)"}`,
            }}
          >
            {defaultMode === "team" ? "⚔ Team Mode" : "◎ Individual Mode"}
          </span>
          <span className="text-[10px] text-slate-500">
            Change mode with the slider in the navbar
          </span>
        </div>

        {/* Upload Zone */}
        <div className="w-full">
          <UploadZone onSuccess={onClose} teamId={teamId} defaultMode={defaultMode} />
        </div>
      </div>
    </div>
  );
}
