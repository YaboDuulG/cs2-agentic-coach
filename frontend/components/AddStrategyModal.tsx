"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send, BookOpen } from "lucide-react";
import { SoyomboIcon } from "./patterns/mongolian";

interface AddStrategyModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  onSuccess: () => void;
}

export function AddStrategyModal({ isOpen, onClose, teamId, onSuccess }: AddStrategyModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [mapName, setMapName] = useState("de_mirage");
  const [side, setSide] = useState("T");
  const [summary, setSummary] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [author, setAuthor] = useState("Coach");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    setError("");

    const steps = stepsText
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    try {
      const res = await fetch(`/api/teams/${teamId}/strategies`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          map_name: mapName,
          side,
          summary,
          steps,
          author: author || "Coach",
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to save strategy");
      }

      onSuccess();
      // Reset form
      setTitle("");
      setMapName("de_mirage");
      setSide("T");
      setSummary("");
      setStepsText("");
      setAuthor("Coach");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create strategy");
    } finally {
      setSaving(false);
    }
  };

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
        {/* Subtle top gradient line */}
        <div
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: "linear-gradient(90deg, transparent, #2D7DD2, #22D3A0, transparent)"
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
              background: "rgba(45, 125, 210, 0.1)",
              borderColor: "rgba(45, 125, 210, 0.25)",
            }}
          >
            <BookOpen size={20} color="#2D7DD2" />
          </div>
          <div className="text-left">
            <h2
              className="text-white font-bold tracking-wide"
              style={{ fontFamily: "Cinzel, serif", fontSize: "1.2rem" }}
            >
              Add New Strategy
            </h2>
            <p className="text-slate-400 text-xs mt-0.5">
              Manually compile tactics into the Scout playbook.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 text-xs text-left">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Title */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Strategy Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. A Execute via Catwalk"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#2D7DD2] transition-colors"
              />
            </div>

            {/* Author */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Author
              </label>
              <input
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Coach"
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#2D7DD2] transition-colors"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Map */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Active Map
              </label>
              <select
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#2D7DD2] transition-colors font-mono"
              >
                <option value="de_mirage">de_mirage</option>
                <option value="de_inferno">de_inferno</option>
                <option value="de_dust2">de_dust2</option>
                <option value="de_nuke">de_nuke</option>
                <option value="de_overpass">de_overpass</option>
                <option value="de_ancient">de_ancient</option>
                <option value="de_anubis">de_anubis</option>
                <option value="de_vertigo">de_vertigo</option>
                <option value="All Maps">All Maps</option>
              </select>
            </div>

            {/* Side */}
            <div className="space-y-1">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Tactical Side
              </label>
              <select
                value={side}
                onChange={(e) => setSide(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#2D7DD2] transition-colors font-mono"
              >
                <option value="T">Terrorist (T)</option>
                <option value="CT">Counter-Terrorist (CT)</option>
                <option value="Both">Both Sides</option>
              </select>
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-1">
            <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
              Summary
            </label>
            <input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="e.g. Fast A site execution using smokes for stairs and jungle."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-[#2D7DD2] transition-colors"
            />
          </div>

          {/* Steps */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <label className="block text-[10px] font-bold text-slate-300 uppercase tracking-wider">
                Execution Steps
              </label>
              <span className="text-[9px] text-slate-500 font-mono">one step per line</span>
            </div>
            <textarea
              value={stepsText}
              onChange={(e) => setStepsText(e.target.value)}
              placeholder="1. Throw jungle smoke from A ramp&#10;2. Flash over A main&#10;3. Push site and clear default"
              rows={4}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-[#2D7DD2] resize-y transition-colors font-mono leading-relaxed"
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-900">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-800 bg-slate-900 hover:text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-[#2D7DD2] hover:bg-[#1B4F8A] disabled:opacity-50 text-white text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Send size={12} /> {saving ? "Saving..." : "Add Strategy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
