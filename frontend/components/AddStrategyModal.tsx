"use client";

import { useState } from "react";
import { Send, BookOpen } from "lucide-react";
import { Button, Modal } from "@/components/ui";

interface AddStrategyModalProps {
  isOpen: boolean;
  onClose: () => void;
  teamId: string;
  onSuccess: () => void;
}

const FIELD_CLASS =
  "w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors";

const FIELD_STYLE: React.CSSProperties = {
  background: "var(--color-bg-primary)",
  borderColor: "var(--color-border-primary)",
  color: "var(--color-text-primary)",
};

const LABEL_CLASS = "block text-[10px] font-bold uppercase tracking-wider";
const LABEL_STYLE: React.CSSProperties = { color: "var(--color-text-secondary)" };

export function AddStrategyModal({ isOpen, onClose, teamId, onSuccess }: AddStrategyModalProps) {
  const [title, setTitle] = useState("");
  const [mapName, setMapName] = useState("de_mirage");
  const [side, setSide] = useState("T");
  const [summary, setSummary] = useState("");
  const [stepsText, setStepsText] = useState("");
  const [author, setAuthor] = useState("Coach");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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
    <Modal open={isOpen} onClose={onClose} label="Add New Strategy">
      {/* Subtle top gradient line */}
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--color-accent-primary), var(--color-success), transparent)",
        }}
      />

      {/* Modal Header */}
      <div className="flex items-center gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            background: "var(--color-accent-soft)",
            borderColor: "var(--color-border-primary)",
          }}
        >
          <BookOpen size={20} style={{ color: "var(--color-accent-primary)" }} />
        </div>
        <div className="text-left">
          <h2
            className="font-bold tracking-wide"
            style={{ fontFamily: "var(--font-heading)", fontSize: "1.2rem" }}
          >
            Add New Strategy
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
            Manually compile tactics into the Scout playbook.
          </p>
        </div>
      </div>

      {error && (
        <div
          className="mb-4 p-3 rounded-lg border text-xs text-left"
          style={{
            borderColor: "color-mix(in srgb, var(--color-danger) 20%, transparent)",
            background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
            color: "var(--color-danger)",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 text-left">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Title */}
          <div className="space-y-1">
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
              Strategy Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. A Execute via Catwalk"
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>

          {/* Author */}
          <div className="space-y-1">
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
              Author
            </label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="e.g. Coach"
              className={FIELD_CLASS}
              style={FIELD_STYLE}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Map */}
          <div className="space-y-1">
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
              Active Map
            </label>
            <select
              value={mapName}
              onChange={(e) => setMapName(e.target.value)}
              className={`${FIELD_CLASS} py-2.5 font-mono`}
              style={FIELD_STYLE}
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
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
              Tactical Side
            </label>
            <select
              value={side}
              onChange={(e) => setSide(e.target.value)}
              className={`${FIELD_CLASS} py-2.5 font-mono`}
              style={FIELD_STYLE}
            >
              <option value="T">Terrorist (T)</option>
              <option value="CT">Counter-Terrorist (CT)</option>
              <option value="Both">Both Sides</option>
            </select>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1">
          <label className={LABEL_CLASS} style={LABEL_STYLE}>
            Summary
          </label>
          <input
            type="text"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Fast A site execution using smokes for stairs and jungle."
            className={FIELD_CLASS}
            style={FIELD_STYLE}
          />
        </div>

        {/* Steps */}
        <div className="space-y-1">
          <div className="flex justify-between">
            <label className={LABEL_CLASS} style={LABEL_STYLE}>
              Execution Steps
            </label>
            <span className="text-[9px] font-mono" style={{ color: "var(--color-text-muted)" }}>
              one step per line
            </span>
          </div>
          <textarea
            value={stepsText}
            onChange={(e) => setStepsText(e.target.value)}
            placeholder="1. Throw jungle smoke from A ramp&#10;2. Flash over A main&#10;3. Push site and clear default"
            rows={4}
            className={`${FIELD_CLASS} p-3 resize-y font-mono leading-relaxed`}
            style={FIELD_STYLE}
          />
        </div>

        {/* Submit */}
        <div
          className="flex justify-end gap-3 pt-4 border-t"
          style={{ borderColor: "var(--color-border-primary)" }}
        >
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={saving}>
            <Send size={12} /> {saving ? "Saving..." : "Add Strategy"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
