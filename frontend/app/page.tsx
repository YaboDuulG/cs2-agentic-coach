/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useState } from "react";
import { UploadZone } from "@/components/UploadZone";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useCallback } from "react";
import { useUser, SignInButton, SignUpButton } from "@clerk/nextjs";
import Link from "next/link";
import {
  Upload, Target, BarChart3, Zap, Shield, Users, ArrowRight,
  Star, CheckCircle, Crosshair, Brain, ChevronRight
} from "lucide-react";
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
  { icon: Target, title: "Kill Feed Analysis", desc: "Every frag dissected — weapon, distance, trade value, and positioning context." },
  { icon: BarChart3, title: "Economy Intelligence", desc: "Round-by-round buy decisions graded against optimal strategy for your rank." },
  { icon: Zap, title: "First Contact Events", desc: "Map which players consistently win the opening duel and control early info." },
  { icon: Shield, title: "Utility Sequencing", desc: "Grenade usage scored against pro player patterns from HLTV match data." },
  { icon: Brain, title: "Great Khan AI Coaching", desc: "Gemini-powered tactical analysis generates personalised coaching notes per match." },
  { icon: Users, title: "Team Collaboration", desc: "Create a team, share an invite code, and review squad analyses together." },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "",
    desc: "Try DemoSage, no card required.",
    features: ["2 demo analyses per month", "Kill feed & economy charts", "Round timeline", "7-day history"],
    cta: "Get Started Free",
    highlight: false,
    tier: "free" as const,
  },
  {
    name: "Basic",
    price: "$5",
    period: "/mo",
    desc: "For active players grinding rank.",
    features: ["10 demo analyses per month", "AI coaching panel (Great Khan)", "30-day history", "Team access"],
    cta: "Start Basic",
    highlight: true,
    tier: "basic" as const,
  },
  {
    name: "Pro",
    price: "$20",
    period: "/mo",
    desc: "Unlimited for serious competitors.",
    features: ["Unlimited demo analyses", "AI coaching + audio analysis", "365-day history", "Priority processing"],
    cta: "Go Pro",
    highlight: false,
    tier: "pro" as const,
  },
];





export default function HomePage() {
  const { user, isLoaded } = useUser();

  return (
    <div className="relative" style={{ background: "#050C15", minHeight: "100vh" }}>
      <CloudMotifBg />

      {/* ── HERO ── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-32 overflow-hidden">
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 mb-8"
            style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)", borderRadius: 20, padding: "6px 16px" }}>
            <SoyomboIcon size={14} color="#C9A227" />
            <span style={{ color: "#C9A227", fontSize: "0.72rem", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              AI-Powered CS2 Coaching
            </span>
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: "clamp(2.6rem, 6vw, 4.5rem)", fontFamily: "Cinzel, serif", fontWeight: 700, color: "#F0F4FF", lineHeight: 1.1, marginBottom: 24 }}>
            Analyze like a{" "}
            <span style={{ color: "#2D7DD2", textShadow: "0 0 40px rgba(45,125,210,0.6)" }}>Khan.</span>
            <br />
            Dominate like{" "}
            <span style={{ color: "#FFE135", textShadow: "0 0 30px rgba(255,225,53,0.5)" }}>Vitality.</span>
          </h1>

          <p style={{ color: "#8BA7CC", fontSize: "1.15rem", maxWidth: 560, margin: "0 auto 40px", lineHeight: 1.7 }}>
            Upload your CS2 demo. The Great Khan AI dissects every round, kill, and grenade — then tells you exactly where you lost the empire.
          </p>

          {/* Stats */}
          <div className="flex justify-center gap-10 mb-12">
            {STATS.map(s => (
              <div key={s.label} className="text-center">
                <div style={{ color: "#2D7DD2", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: "1.6rem" }}>{s.value}</div>
                <div style={{ color: "#8BA7CC", fontSize: "0.72rem", marginTop: 2 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* CTA — auth-aware */}
          {!isLoaded ? null : user ? (
            <UploadZone />
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-4">
                <SignUpButton mode="modal">
                  <button
                    className="flex items-center gap-2 rounded-xl px-8 py-3.5 font-semibold text-sm transition-all hover:scale-105"
                    style={{ background: "linear-gradient(135deg, #1B4F8A, #2D7DD2)", color: "#fff", boxShadow: "0 4px 24px rgba(45,125,210,0.4)" }}
                  >
                    Get Started Free <ArrowRight size={16} />
                  </button>
                </SignUpButton>
                <SignInButton mode="modal">
                  <button className="rounded-xl border px-8 py-3.5 font-semibold text-sm transition-all hover:bg-white/5"
                    style={{ borderColor: "rgba(45,125,210,0.4)", color: "#8BA7CC" }}>
                    Log In
                  </button>
                </SignInButton>
              </div>
              <p style={{ color: "#4A6A8A", fontSize: "0.78rem" }}>
                Free tier includes 2 demo analyses · No credit card required
              </p>
            </div>
          )}
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 animate-bounce">
          <div className="w-px h-8" style={{ background: "linear-gradient(to bottom, transparent, #2D7DD2)" }} />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="py-28 px-6" style={{ background: "rgba(8,14,26,0.95)" }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block rounded-full px-4 py-1.5 mb-4 text-xs font-semibold uppercase tracking-widest"
              style={{ background: "rgba(201,162,39,0.1)", color: "#C9A227", border: "1px solid rgba(201,162,39,0.2)" }}>
              What DemoSage Sees
            </div>
            <h2 style={{ color: "#F0F4FF", fontFamily: "Cinzel, serif", fontSize: "clamp(1.6rem, 3vw, 2.4rem)", fontWeight: 700 }}>
              Built for players who want to{" "}
              <span style={{ color: "#2D7DD2" }}>actually improve.</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div key={title}
                className="rounded-2xl p-6 flex gap-4 group transition-all duration-300 hover:scale-[1.02] hover:border-[#2D7DD2]/30"
                style={{ background: "rgba(13,24,37,0.7)", border: "1px solid #1E3A5F", backdropFilter: "blur(8px)" }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors group-hover:bg-[rgba(45,125,210,0.2)]"
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

      {/* ── PRICING ── */}
      <section className="py-28 px-6 relative overflow-hidden" style={{ background: "#080E1A" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(45,125,210,0.07) 0%, transparent 60%)" }} />
        <div className="relative max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-block rounded-full px-4 py-1.5 mb-4 text-xs font-semibold uppercase tracking-widest"
              style={{ background: "rgba(45,125,210,0.08)", color: "#2D7DD2", border: "1px solid rgba(45,125,210,0.2)" }}>
              Simple Pricing
            </div>
            <h2 style={{ color: "#F0F4FF", fontFamily: "Cinzel, serif", fontSize: "clamp(1.6rem, 3vw, 2.4rem)", fontWeight: 700 }}>
              Start free. Scale when you&apos;re ready.
            </h2>
            <p style={{ color: "#8BA7CC", marginTop: 12, fontSize: "1rem" }}>
              All plans include kill analysis, economy charts, and the round timeline.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PLANS.map(plan => (
              <div key={plan.name}
                className="rounded-2xl p-7 flex flex-col relative transition-all duration-300 hover:scale-[1.02]"
                style={{
                  background: plan.highlight ? "linear-gradient(135deg, rgba(27,79,138,0.4), rgba(45,125,210,0.15))" : "rgba(13,24,37,0.7)",
                  border: plan.highlight ? "1px solid rgba(45,125,210,0.5)" : "1px solid #1E3A5F",
                  backdropFilter: "blur(8px)",
                  boxShadow: plan.highlight ? "0 0 40px rgba(45,125,210,0.15)" : "none",
                }}>
                {plan.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full px-4 py-1 text-xs font-bold"
                    style={{ background: "linear-gradient(135deg, #1B4F8A, #2D7DD2)", color: "#fff" }}>
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 style={{ color: "#F0F4FF", fontWeight: 700, fontSize: "1.1rem" }}>{plan.name}</h3>
                  <div className="flex items-baseline gap-1 mt-2 mb-3">
                    <span style={{ color: plan.highlight ? "#2D7DD2" : "#F0F4FF", fontFamily: "JetBrains Mono", fontSize: "2.4rem", fontWeight: 700 }}>{plan.price}</span>
                    <span style={{ color: "#4A6A8A", fontSize: "0.875rem" }}>{plan.period}</span>
                  </div>
                  <p style={{ color: "#8BA7CC", fontSize: "0.85rem" }}>{plan.desc}</p>
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-center gap-2.5">
                      <CheckCircle size={14} color="#22D3A0" style={{ flexShrink: 0 }} />
                      <span style={{ color: "#C4CEDD", fontSize: "0.875rem" }}>{f}</span>
                    </li>
                  ))}
                </ul>
                {user ? (
                  plan.tier === "free" ? (
                    <Link href="/"
                      className="rounded-xl px-5 py-3 text-sm font-semibold text-center transition-all hover:opacity-80"
                      style={{ background: plan.highlight ? "linear-gradient(135deg,#1B4F8A,#2D7DD2)" : "#1E3A5F", color: "#fff" }}>
                      {plan.cta}
                    </Link>
                  ) : (
                    <Link href="/billing"
                      className="rounded-xl px-5 py-3 text-sm font-semibold text-center transition-all hover:opacity-80"
                      style={{ background: plan.highlight ? "linear-gradient(135deg,#1B4F8A,#2D7DD2)" : "#1E3A5F", color: "#fff" }}>
                      {plan.cta}
                    </Link>
                  )
                ) : (
                  <SignUpButton mode="modal">
                    <button className="w-full rounded-xl px-5 py-3 text-sm font-semibold transition-all hover:opacity-80"
                      style={{ background: plan.highlight ? "linear-gradient(135deg,#1B4F8A,#2D7DD2)" : "#1E3A5F", color: "#fff" }}>
                      {plan.cta}
                    </button>
                  </SignUpButton>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TEAMS CTA ── */}
      <section className="py-24 px-6" style={{ background: "rgba(8,14,26,0.97)" }}>
        <div className="max-w-3xl mx-auto text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: "rgba(201,162,39,0.1)", border: "1px solid rgba(201,162,39,0.25)" }}>
            <Users size={28} color="#C9A227" />
          </div>
          <h2 style={{ color: "#F0F4FF", fontFamily: "Cinzel, serif", fontSize: "clamp(1.5rem, 2.5vw, 2rem)", fontWeight: 700, marginBottom: 16 }}>
            Train with your squad.
          </h2>
          <p style={{ color: "#8BA7CC", fontSize: "1rem", lineHeight: 1.7, marginBottom: 32 }}>
            Create a team, share an 8-character invite code, and review every teammate&apos;s matches together. One dashboard for the whole roster.
          </p>
          {user ? (
            <Link href="/teams"
              className="inline-flex items-center gap-2 rounded-xl px-8 py-3.5 font-semibold text-sm transition-all hover:scale-105"
              style={{ background: "linear-gradient(135deg, rgba(201,162,39,0.15), rgba(201,162,39,0.08))", border: "1px solid rgba(201,162,39,0.3)", color: "#C9A227" }}>
              Create Your Team <ChevronRight size={16} />
            </Link>
          ) : (
            <SignUpButton mode="modal">
              <button className="inline-flex items-center gap-2 rounded-xl px-8 py-3.5 font-semibold text-sm transition-all hover:scale-105"
                style={{ background: "linear-gradient(135deg, rgba(201,162,39,0.15), rgba(201,162,39,0.08))", border: "1px solid rgba(201,162,39,0.3)", color: "#C9A227" }}>
                Create Your Team <ChevronRight size={16} />
              </button>
            </SignUpButton>
          )}
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="py-28 px-6 relative overflow-hidden" style={{ background: "#050C15" }}>
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 100%, rgba(45,125,210,0.08) 0%, transparent 60%)" }} />
        <div className="relative max-w-2xl mx-auto text-center">
          <SoyomboIcon size={52} color="#C9A227" className="mx-auto mb-6" />
          <h2 style={{ color: "#F0F4FF", fontFamily: "Cinzel, serif", fontSize: "clamp(1.8rem, 3.5vw, 2.6rem)", fontWeight: 700, marginBottom: 16 }}>
            The empire awaits.
          </h2>
          <p style={{ color: "#8BA7CC", fontSize: "1.05rem", marginBottom: 36 }}>
            Your last match is already a lesson. Let the Khan read it.
          </p>
          <SignUpButton mode="modal">
            <button className="inline-flex items-center gap-2 rounded-xl px-10 py-4 font-semibold transition-all hover:scale-105"
              style={{ background: "linear-gradient(135deg, #1B4F8A, #2D7DD2)", color: "#fff", fontSize: "1.05rem", boxShadow: "0 4px 32px rgba(45,125,210,0.35)" }}>
              Start Analyzing <ArrowRight size={18} />
            </button>
          </SignUpButton>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t py-10 px-6" style={{ borderColor: "#0D1825", background: "#050C15" }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SoyomboIcon size={20} color="#C9A227" />
            <span style={{ fontFamily: "Cinzel, serif", color: "#8BA7CC", fontWeight: 600 }}>DemoSage</span>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: "#4A6A8A" }}>
            <Link href="/billing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/sign-in" className="hover:text-white transition-colors">Log In</Link>
            <Link href="/sign-up" className="hover:text-white transition-colors">Sign Up</Link>
          </div>
          <p style={{ color: "#2A3A4A", fontSize: "0.8rem" }}>
            © 2026 DemoSage · Not affiliated with Valve Corporation
          </p>
        </div>
      </footer>
    </div>
  );
}
