"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { UploadZone } from "./UploadZone";
import { SoyomboIcon } from "./patterns/mongolian";

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId?: string;
}

export function UploadModal({ isOpen, onClose, teamId }: UploadModalProps) {
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
          borderColor: "rgba(45, 125, 210, 0.3)",
          boxShadow: "0 24px 64px -12px rgba(0, 0, 0, 0.8), 0 0 40px rgba(45, 125, 210, 0.08)",
        }}
      >
        {/* Subtle top gold gradient line */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{ background: "linear-gradient(90deg, transparent, #C9A227, #2D7DD2, transparent)" }}
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
              background: "rgba(201, 162, 39, 0.1)",
              borderColor: "rgba(201, 162, 39, 0.25)",
            }}
          >
            <SoyomboIcon size={20} color="#C9A227" />
          </div>
          <div>
            <h2
              className="text-white font-bold tracking-wide"
              style={{ fontFamily: "Cinzel, serif", fontSize: "1.2rem" }}
            >
              Upload CS2 Demo
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Analyze ticks, frags, utility, and team economy.
            </p>
          </div>
        </div>

        {/* Upload Zone */}
        <div className="w-full">
          <UploadZone onSuccess={onClose} teamId={teamId} />
        </div>
      </div>
    </div>
  );
}
