"use client";

import { Upload } from "lucide-react";
import { Modal } from "@/components/ui";
import { UploadZone } from "./UploadZone";
import { SoyomboIcon } from "./patterns/mongolian";
import { useTheme } from "@/lib/themes";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId?: string;
  defaultMode?: "individual" | "team";
}

export function UploadModal({ isOpen, onClose, teamId, defaultMode }: UploadModalProps) {
  const { def } = useTheme();
  const isTeam = defaultMode === "team";

  const modeLabel = isTeam ? "Upload a team demo" : "Upload a demo";
  const modeDesc = isTeam
    ? "Every player on the demo gets profiled and coached."
    : "Coaching focuses on your own play.";

  const accentVar = isTeam ? "var(--color-accent-secondary)" : "var(--color-accent-primary)";
  const softVar = isTeam ? "var(--color-secondary-soft)" : "var(--color-accent-soft)";

  return (
    <Modal open={isOpen} onClose={onClose} label={modeLabel}>
      {/* Accent line keyed to mode: gold = team (rank), blue = individual (action) */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, transparent, ${accentVar}, transparent)` }}
      />

      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{ background: softVar, borderColor: accentVar }}
        >
          {def.motifs ? (
            <SoyomboIcon size={20} color={isTeam ? "#C9A227" : "#2D7DD2"} />
          ) : (
            <Upload size={18} style={{ color: accentVar }} />
          )}
        </div>
        <div>
          <h2 className="font-bold tracking-wide text-[1.2rem]" style={{ fontFamily: "var(--font-heading)" }}>
            {modeLabel}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            {modeDesc}
          </p>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full font-mono border"
          style={{ background: softVar, color: accentVar, borderColor: accentVar }}
        >
          {isTeam ? "Team mode" : "Individual mode"}
        </span>
        <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
          Switch modes with the toggle in the navbar
        </span>
      </div>

      <UploadZone onSuccess={onClose} teamId={teamId} defaultMode={defaultMode} />
    </Modal>
  );
}
