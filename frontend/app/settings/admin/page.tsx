"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { Brain, ShieldAlert, CheckCircle, Save, RefreshCw, AlertCircle } from "lucide-react";

function formatTimestamp(iso: string) {
  if (!iso || iso === "Never" || iso === "") return "Never";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function AdminSettingsPage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();

  const [configs, setConfigs] = useState<Record<string, string>>({
    coaching_model: "",
    coaching_temperature: "",
    prompt_great_khan_instructions: "",
    prompt_scribe_base: "",
    prompt_focus_instruction: "",
    prompt_recon_instruction: "",
    last_hltv_ingest_run: "",
    last_social_ingest_run: "",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user) {
      router.push("/sign-in");
      return;
    }

    async function loadConfigs() {
      try {
        const res = await fetch("/api/admin/configs");
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setError("Unauthorized. You must be an administrator.");
            setLoading(false);
            return;
          }
          throw new Error("Failed to load configuration properties.");
        }
        const data = await res.json();
        setConfigs(data);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Failed to retrieve configurations.";
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    }
    loadConfigs();
  }, [user, isLoaded, router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSuccess(false);
    setError(null);

    const { last_hltv_ingest_run, last_social_ingest_run, ...configsToSave } = configs;

    try {
      const res = await fetch("/api/admin/configs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ configs: configsToSave }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save configuration properties.");
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 5000);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to update configurations.";
      setError(errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: string, val: string) => {
    setConfigs((prev) => ({ ...prev, [key]: val }));
  };

  if (!isLoaded || loading) {
    return (
      <div className="relative min-h-screen flex items-center justify-center" style={{ background: "#080E1A" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 border-4 border-[#C9A227] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-slate-400 font-mono">Accessing the Khan&apos;s Archives...</p>
        </div>
      </div>
    );
  }

  if (error && !configs.coaching_model) {
    return (
      <div className="relative min-h-screen flex items-center justify-center" style={{ background: "#080E1A" }}>
        <div className="card max-w-md p-8 text-center border-rose-500/30">
          <AlertCircle size={40} className="text-rose-500 mx-auto mb-4" />
          <h2 className="heading-display mb-2" style={{ fontSize: "1.2rem" }}>Access Denied</h2>
          <p className="text-xs text-slate-400 mb-6">{error}</p>
          <button 
            onClick={() => router.push("/")}
            className="px-5 py-2.5 bg-slate-900 border border-slate-800 text-xs font-semibold rounded-lg hover:text-white transition-colors cursor-pointer select-none"
          >
            Return to Command Hub
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-6 py-20" style={{ background: "#080E1A" }}>
      <CloudMotifBg />
      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center animate-pulse-glow" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)" }}>
            <SoyomboIcon size={28} color="#C9A227" />
          </div>
          <div className="text-left">
            <h1 className="heading-display" style={{ fontSize: "1.6rem" }}>
              Khan&apos;s Command Center
            </h1>
            <p style={{ color: "#8BA7CC", fontSize: "0.85rem", marginTop: 2 }}>
              Dynamic LLM configuration, temperature variables, and strategic prompts.
            </p>
          </div>
        </div>

        <UlziiBorder className="mb-10" />

        {/* ── Data Ingestion & Schedules Status ── */}
        <div className="card p-6 mb-8 text-left space-y-4"
          style={{ background: "rgba(13,24,37,0.5)", border: "1px solid #1E3A5F" }}>
          <h2 className="heading-display text-sm font-bold uppercase tracking-wider" style={{ color: "#2D7DD2" }}>
            Data Ingestion & Schedules Status
          </h2>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-xl">
            DemoSage pulls pro match lists, tweets, reddit discussions, and YouTube strategy transcripts on automated cron schedules to feed the Scout knowledge RAG index.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            {/* HLTV Cron */}
            <div className="rounded-xl p-4 bg-slate-950/60 border border-slate-900 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">HLTV Pro Matches Ingestion</p>
                <p className="text-xs font-bold text-slate-200 mt-1">Weekly Sunday at 02:00 UTC</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Last Ingested: <span className="font-semibold text-[#22D3A0] font-mono">{formatTimestamp(configs.last_hltv_ingest_run)}</span>
                </p>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#22D3A0] animate-pulse" title="System schedule active" />
            </div>

            {/* Social Cron */}
            <div className="rounded-xl p-4 bg-slate-950/60 border border-slate-900 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">Social Media & YouTube Ingestion</p>
                <p className="text-xs font-bold text-slate-200 mt-1">Biweekly Schedule</p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Last Ingested: <span className="font-semibold text-[#22D3A0] font-mono">{formatTimestamp(configs.last_social_ingest_run)}</span>
                </p>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-[#22D3A0] animate-pulse" title="System schedule active" />
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-8">
          {/* Model Params Card */}
          <div className="card p-6 space-y-6">
            <h2 className="heading-display text-left" style={{ fontSize: "1rem", color: "#FFE135" }}>
              1. LLM Parameters
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Model Selector
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  The primary Gemini model deployed by the scout/scribe pipeline.
                </p>
                <select
                  value={configs.coaching_model}
                  onChange={(e) => handleChange("coaching_model", e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-xs text-[#C9A227] font-semibold focus:outline-none focus:border-[#C9A227] transition-colors"
                >
                  <option value="gemini-2.5-flash">gemini-2.5-flash (Fast, analytical)</option>
                  <option value="gemini-2.5-pro">gemini-2.5-pro (Deep reasoning, strategic)</option>
                  <option value="gemini-1.5-flash">gemini-1.5-flash (Legacy fast)</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro (Legacy deep)</option>
                </select>
              </div>

              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Temperature
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Creativity bounds (0.0 to 1.0). Lower values offer consistent tactical guidelines.
                </p>
                <input
                  type="text"
                  value={configs.coaching_temperature}
                  onChange={(e) => handleChange("coaching_temperature", e.target.value)}
                  placeholder="0.4"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-[#C9A227] transition-colors font-mono"
                />
              </div>
            </div>
          </div>

          {/* Prompts Card */}
          <div className="card p-6 space-y-6">
            <h2 className="heading-display text-left" style={{ fontSize: "1rem", color: "#FFE135" }}>
              2. Core Directives & Prompts
            </h2>

            <div className="space-y-6">
              {/* Tactician Instructions */}
              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Great Khan Instructions (Tactician stage)
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Defines constraints and formatting rules for the automated tactician stage.
                </p>
                <textarea
                  value={configs.prompt_great_khan_instructions}
                  onChange={(e) => handleChange("prompt_great_khan_instructions", e.target.value)}
                  className="w-full h-24 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-[#C9A227] resize-y transition-colors font-mono leading-relaxed"
                />
              </div>

              {/* Scribe base */}
              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Scribe Base Prompt (Report Synthesizer)
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Defines general coaching tone, report structures, and markdown formatting guidelines.
                </p>
                <textarea
                  value={configs.prompt_scribe_base}
                  onChange={(e) => handleChange("prompt_scribe_base", e.target.value)}
                  className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-[#C9A227] resize-y transition-colors font-mono leading-relaxed"
                />
              </div>

              {/* Focus instruction */}
              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Coaching Focus Instruction (Individual / Team template)
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Appended when compiling coaching insights specifically targeting the user&apos;s squad. Supported variables: <code className="text-[#C9A227] font-bold font-mono text-[9px] bg-slate-950 px-1 py-0.5 rounded">&#123;user_team&#125;</code>, <code className="text-[#C9A227] font-bold font-mono text-[9px] bg-slate-950 px-1 py-0.5 rounded">&#123;uploader_steam_id&#125;</code>.
                </p>
                <textarea
                  value={configs.prompt_focus_instruction}
                  onChange={(e) => handleChange("prompt_focus_instruction", e.target.value)}
                  className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-[#C9A227] resize-y transition-colors font-mono leading-relaxed"
                />
              </div>

              {/* Recon instruction */}
              <div className="space-y-2 text-left">
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Ilchi Spy Scan Instruction (Opposition Research)
                </label>
                <p className="text-[10px] text-slate-500 leading-normal">
                  Appended when checking is_recon. Controls how Scribe highlights vulnerabilities and counter-strats of both factions.
                </p>
                <textarea
                  value={configs.prompt_recon_instruction}
                  onChange={(e) => handleChange("prompt_recon_instruction", e.target.value)}
                  className="w-full h-32 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 focus:outline-none focus:border-[#C9A227] resize-y transition-colors font-mono leading-relaxed"
                />
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl bg-slate-950/40 border border-slate-900">
            <div>
              {success && (
                <div className="flex items-center gap-1.5 text-xs text-[#22D3A0] font-bold animate-pulse">
                  <CheckCircle size={14} /> System parameters saved and synchronized.
                </div>
              )}
              {error && (
                <div className="flex items-center gap-1.5 text-xs text-[#FF4D6D] font-bold">
                  <ShieldAlert size={14} /> {error}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="px-5 py-2.5 rounded-lg border border-slate-800 bg-slate-900 hover:text-white text-xs font-semibold transition-colors cursor-pointer select-none focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2.5 rounded-lg bg-[#C9A227] hover:bg-[#A8841B] disabled:opacity-50 text-slate-950 text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer select-none focus:outline-none"
              >
                <Save size={13} /> {saving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
