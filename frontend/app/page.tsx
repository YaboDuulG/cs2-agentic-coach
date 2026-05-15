"use client";

import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { useRouter } from "next/navigation";
import { Upload, Shield, Zap, ChevronRight, Star, Users, Target, BarChart3, ArrowRight } from "lucide-react";
import { SoyomboIcon, UlziiBorder, CloudMotifBg } from "@/components/patterns/mongolian";
import { PLAN_LIMITS } from "@/lib/flags";

const MAX_MB = PLAN_LIMITS.free.maxFileSizeMB;
const MAX_BYTES = MAX_MB * 1024 * 1024;

const STATS = [
  { value: "2.4M+", label: "Rounds Analyzed" },
  { value: "18K+", label: "Demos Processed" },
  { value: "94%", label: "Coaching Accuracy" },
];

const FEATURES = [
  {
    icon: Target,
    title: "Kill Feed Analysis",
    desc: "Every frag dissected — weapon, distance, trade value, and positioning context.",
  },
  {
    icon: BarChart3,
    title: "Economy Intelligence",
    desc: "Round-by-round buy decisions graded against optimal strategy for your rank.",
  },
  {
    icon: Zap,
    title: "First Contact Events",
    desc: "Who opened the round? Map which players consistently win the early information war.",
  },
  {
    icon: Shield,
    title: "Utility Sequencing",
    desc: "Your grenade usage scored against pro player patterns from HLTV match data.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      if (!file.name.endsWith(".dem")) {
        setError("Only .dem files are supported.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`File too large. Max size is ${MAX_MB}MB.`);
        return;
      }

      setError(null);
      setUploading(true);
      try {
        // Step 1: Get presigned GCS upload URL
        const presignRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size_bytes: file.size }),
        });
        if (!presignRes.ok) throw new Error(await presignRes.text());
        const { job_id, upload_url } = await presignRes.json();

        // Step 2: Upload directly to GCS (bypasses Vercel size limits)
        const gcsRes = await fetch(upload_url, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: file,
        });
        if (!gcsRes.ok) throw new Error("GCS upload failed.");

        // Step 3: Navigate to results page (Scout job auto-triggered on GCS upload)
        router.push(`/analysis/${job_id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
        setUploading(false);
      }
    },
    [router]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dem"] },
    maxFiles: 1,
    disabled: uploading,
  });

  return (
    <div className="min-h-screen" style={{ background: "#080E1A" }}>

      {/* ── Nav ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b" style={{ background: "rgba(8, 14, 26, 0.85)", borderColor: "#1E3A5F", backdropFilter: "blur(12px)" }}>
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SoyomboIcon size={28} color="#C9A227" />
            <span style={{ fontFamily: "Cinzel, serif", fontWeight: 700, fontSize: "1.1rem", color: "#F0F4FF" }}>
              DemoSage
            </span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/analysis" className="btn-ghost text-sm" style={{ padding: "8px 16px" }}>My Analyses</a>
            <button className="btn-primary text-sm" style={{ padding: "8px 18px" }}>
              Upload Demo
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative pt-36 pb-24 px-6 overflow-hidden">
        <CloudMotifBg />

        {/* Radial glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none"
          style={{ background: "radial-gradient(ellipse, rgba(45,125,210,0.12) 0%, transparent 70%)" }} />

        <div className="relative max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8" style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)", borderRadius: 20, padding: "6px 14px" }}>
            <SoyomboIcon size={14} color="#C9A227" />
            <span style={{ color: "#C9A227", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              AI-Powered CS2 Coaching
            </span>
          </div>

          {/* Headline */}
          <h1 className="heading-display mb-6" style={{ fontSize: "clamp(2.4rem, 5vw, 4rem)" }}>
            Analyze like a{" "}
            <span className="text-glow-blue">Khan.</span>
            <br />
            Dominate like{" "}
            <span style={{ color: "#FFE135", textShadow: "0 0 30px rgba(255,225,53,0.5)" }}>Vitality.</span>
          </h1>

          <p style={{ color: "#8BA7CC", fontSize: "1.1rem", maxWidth: 560, margin: "0 auto 40px", lineHeight: 1.7 }}>
            Upload your CS2 demo. The Great Khan AI orchestrator dissects every round, kill, and grenade — then tells you exactly where you lost the empire.
          </p>

          {/* Stats row */}
          <div className="flex justify-center gap-8 mb-12">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <div className="stat-number" style={{ fontSize: "1.5rem" }}>{s.value}</div>
                <div style={{ color: "#8BA7CC", fontSize: "0.75rem", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Upload dropzone */}
          <div
            {...getRootProps()}
            className="relative mx-auto cursor-pointer transition-all duration-300"
            style={{
              maxWidth: 560,
              background: isDragActive ? "rgba(45,125,210,0.1)" : "#0D1825",
              border: `2px dashed ${isDragActive ? "#2D7DD2" : "#1E3A5F"}`,
              borderRadius: 16,
              padding: "48px 32px",
              boxShadow: isDragActive ? "0 0 40px rgba(45,125,210,0.25)" : "none",
            }}
          >
            {/* Step-pattern border accent */}
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[14px]"
              style={{ background: "linear-gradient(90deg, #1E3A5F, #2D7DD2, #1E3A5F)" }} />

            <input {...getInputProps()} />

            {uploading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
                  style={{ borderColor: "#2D7DD2", borderTopColor: "transparent" }} />
                <p style={{ color: "#8BA7CC" }}>Uploading demo…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center animate-pulse-glow"
                  style={{ background: "rgba(45,125,210,0.15)", border: "1px solid rgba(45,125,210,0.3)" }}>
                  <Upload size={28} color="#2D7DD2" />
                </div>
                <div>
                  <p style={{ color: "#F0F4FF", fontWeight: 600, marginBottom: 4 }}>
                    {isDragActive ? "Drop your demo here" : "Drop your .dem file here"}
                  </p>
                  <p style={{ color: "#8BA7CC", fontSize: "0.85rem" }}>
                    or click to browse — up to {MAX_MB}MB
                  </p>
                </div>
                <button className="btn-primary" style={{ marginTop: 8 }}>
                  <Upload size={16} />
                  Choose Demo File
                </button>
              </div>
            )}
          </div>

          {error && (
            <p style={{ color: "#FF4D6D", marginTop: 12, fontSize: "0.875rem" }}>{error}</p>
          )}

          <p style={{ color: "#4A6A8A", fontSize: "0.75rem", marginTop: 16 }}>
            Free tier: {PLAN_LIMITS.free.uploadsPerDay} demos/day · No account required to start
          </p>
        </div>
      </section>

      <UlziiBorder className="max-w-6xl mx-auto px-6" />

      {/* ── Features ── */}
      <section className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="badge-gold mb-4">What DemoSage Sees</div>
            <h2 className="heading-display" style={{ fontSize: "2rem" }}>
              Built for players who want to<br />
              <span style={{ color: "#2D7DD2" }}>actually improve.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} className="card p-6 flex gap-4 group hover:border-[#2D7DD2] transition-colors duration-300"
                style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(45,125,210,0.1)", border: "1px solid rgba(45,125,210,0.2)" }}>
                  <Icon size={20} color="#2D7DD2" />
                </div>
                <div>
                  <h3 style={{ color: "#F0F4FF", fontWeight: 600, marginBottom: 6 }}>{title}</h3>
                  <p style={{ color: "#8BA7CC", fontSize: "0.875rem", lineHeight: 1.6 }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <UlziiBorder className="max-w-6xl mx-auto px-6" />

      {/* ── CTA ── */}
      <section className="py-24 px-6 text-center relative overflow-hidden">
        <CloudMotifBg className="opacity-50" />
        <div className="relative max-w-2xl mx-auto">
          <SoyomboIcon size={48} color="#C9A227" className="mx-auto mb-6 animate-float" />
          <h2 className="heading-display mb-4" style={{ fontSize: "2.2rem" }}>
            The empire awaits.
          </h2>
          <p style={{ color: "#8BA7CC", marginBottom: 32, fontSize: "1.05rem" }}>
            Your last match is already a lesson. Let the Khan read it.
          </p>
          <button className="btn-primary" style={{ fontSize: "1rem", padding: "14px 32px" }}
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Upload Your Demo
            <ArrowRight size={18} />
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t py-8 px-6" style={{ borderColor: "#1E3A5F" }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <SoyomboIcon size={20} color="#C9A227" />
            <span style={{ fontFamily: "Cinzel, serif", color: "#8BA7CC", fontSize: "0.875rem" }}>DemoSage</span>
          </div>
          <p style={{ color: "#4A6A8A", fontSize: "0.8rem" }}>
            © 2026 DemoSage · Not affiliated with Valve Corporation
          </p>
        </div>
      </footer>
    </div>
  );
}
